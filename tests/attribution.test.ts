import { describe, expect, test } from "bun:test";
import { createDb } from "../src/db/index.ts";
import { createStore, type Store } from "../src/db/store.ts";
import { createEmployeeService } from "../src/services/employees.ts";
import { createIdentityService, githubLoginFromNoreply } from "../src/services/identities.ts";

function setup() {
  const store = createStore(createDb(":memory:"));
  return {
    store,
    employees: createEmployeeService(store),
    identities: createIdentityService(store),
  };
}

function seedRepo(store: Store, fullName = "acme/api"): number {
  const [owner = "acme", name = "api"] = fullName.split("/");
  return store.upsertRepo({
    githubId: null,
    orgId: null,
    owner,
    name,
    fullName,
    description: null,
    defaultBranch: "main",
    isPrivate: false,
    isFork: false,
    isArchived: false,
    htmlUrl: null,
  }).id;
}

function commit(
  sha: string,
  opts: { login?: string | null; email?: string | null; ts?: number; avatar?: string | null } = {},
) {
  return {
    sha,
    message: `commit ${sha}`,
    authorName: "Someone",
    authorEmail: opts.email ?? null,
    authorLogin: opts.login ?? null,
    authorAvatarUrl: opts.avatar ?? null,
    authorTs: opts.ts ?? 1_700_000_000,
    committerName: null,
    committerEmail: null,
    committerTs: opts.ts ?? 1_700_000_000,
    isMerge: false,
    htmlUrl: null,
  };
}

function makeEmployee(employees: ReturnType<typeof createEmployeeService>, over: Record<string, string> = {}) {
  return employees.create({
    code: "EMP-001",
    full_name: "Ayesha Khan",
    joined_on: "2024-01-01",
    status: "active",
    employment_type: "full_time",
    ...over,
  });
}

describe("commit → employee attribution", () => {
  test("a case-variant GitHub login still counts (the collation trap)", () => {
    const { store, employees, identities } = setup();
    const repo = seedRepo(store);
    store.insertCommits(repo, [
      commit("a", { login: "ayeshak" }),
      commit("b", { login: "AyeshaK" }),
    ]);
    const emp = makeEmployee(employees);
    identities.add(emp.id, "login", "ayeshak");

    expect(store.getEmployee(emp.id)?.commit_count).toBe(2);
  });

  test("the attribution view never fans out", () => {
    const { store, employees, identities } = setup();
    const repo = seedRepo(store);
    store.insertCommits(repo, [
      commit("a", { login: "ayeshak", email: "ayesha@house.pk" }),
      commit("b", { login: "someone-else", email: "other@house.pk" }),
    ]);
    const emp = makeEmployee(employees);
    identities.add(emp.id, "login", "ayeshak");
    identities.add(emp.id, "email", "ayesha@house.pk");

    const counts = store.attributionRowCount();
    expect(counts.view_rows).toBe(counts.commit_rows);
    expect(store.getEmployee(emp.id)?.commit_count).toBe(1);
  });

  test("login wins over email when they disagree", () => {
    const { store, employees, identities } = setup();
    const repo = seedRepo(store);
    store.insertCommits(repo, [commit("a", { login: "ayeshak", email: "shared@house.pk" })]);
    const ayesha = makeEmployee(employees);
    const bilal = employees.create({
      code: "EMP-002",
      full_name: "Bilal Ahmed",
      joined_on: "2024-01-01",
      status: "active",
      employment_type: "full_time",
    });
    identities.add(ayesha.id, "login", "ayeshak");
    identities.add(bilal.id, "email", "shared@house.pk");

    expect(store.getEmployee(ayesha.id)?.commit_count).toBe(1);
    expect(store.getEmployee(bilal.id)?.commit_count).toBe(0);
  });

  test("history corrects itself when an identity is added — no re-sync", () => {
    const { store, employees, identities } = setup();
    const repo = seedRepo(store);
    store.insertCommits(repo, [commit("a", { login: "ayeshak" }), commit("b", { login: "ayeshak" })]);
    const emp = makeEmployee(employees);
    expect(store.getEmployee(emp.id)?.commit_count).toBe(0);
    identities.add(emp.id, "login", "ayeshak");
    expect(store.getEmployee(emp.id)?.commit_count).toBe(2);
    const identity = store.listIdentities(emp.id).find((i) => i.kind === "login");
    identities.remove(emp.id, identity?.id ?? 0);
    expect(store.getEmployee(emp.id)?.commit_count).toBe(0);
  });
});

describe("the mapping inbox", () => {
  test("unmapped authors are listed, mapped ones disappear", () => {
    const { store, employees, identities } = setup();
    const repo = seedRepo(store);
    const now = Math.floor(Date.now() / 1000);
    store.insertCommits(repo, [
      commit("a", { login: "ayeshak", ts: now - 100 }),
      commit("b", { login: "ayeshak", ts: now - 90 }),
      commit("c", { login: "stranger", ts: now - 80 }),
    ]);
    const since = now - 86_400;

    let inbox = store.unmappedAuthors(since);
    expect(inbox.map((a) => a.login).sort()).toEqual(["ayeshak", "stranger"]);
    expect(inbox.find((a) => a.login === "ayeshak")?.n).toBe(2);

    const emp = makeEmployee(employees);
    identities.add(emp.id, "login", "ayeshak");

    inbox = store.unmappedAuthors(since);
    expect(inbox.map((a) => a.login)).toEqual(["stranger"]);
    expect(store.countUnmappedAuthors(since)).toBe(1);
  });

  test("bots are excluded by the seeded pattern", () => {
    const { store } = setup();
    const repo = seedRepo(store);
    const now = Math.floor(Date.now() / 1000);
    store.insertCommits(repo, [
      commit("a", { login: "dependabot[bot]", ts: now - 50 }),
      commit("b", { login: "renovate", ts: now - 50 }),
      commit("c", { login: "real-person", ts: now - 50 }),
    ]);
    const inbox = store.unmappedAuthors(now - 86_400);
    expect(inbox.map((a) => a.login)).toEqual(["real-person"]);
  });

  test("ignoring an author removes it from the inbox", () => {
    const { store, identities } = setup();
    const repo = seedRepo(store);
    const now = Math.floor(Date.now() / 1000);
    store.insertCommits(repo, [commit("a", { login: "contractor", ts: now - 50 })]);
    expect(store.unmappedAuthors(now - 86_400)).toHaveLength(1);
    identities.ignore("login", "contractor", "one-off");
    expect(store.unmappedAuthors(now - 86_400)).toHaveLength(0);
  });
});

describe("suggestions", () => {
  test("work email matches a commit email exactly", () => {
    const { store, employees, identities } = setup();
    const repo = seedRepo(store);
    const now = Math.floor(Date.now() / 1000);
    store.insertCommits(repo, [commit("a", { email: "ayesha@house.pk", ts: now - 50 })]);
    const emp = makeEmployee(employees, { work_email: "ayesha@house.pk" });
    for (const identity of store.listIdentities(emp.id)) identities.remove(emp.id, identity.id);

    const { created } = identities.suggest(now - 86_400);
    expect(created).toBe(1);
    expect(store.getEmployee(emp.id)?.commit_count).toBe(1);
  });

  test("a GitHub noreply email resolves through a known login", () => {
    const { store, employees, identities } = setup();
    const repo = seedRepo(store);
    const now = Math.floor(Date.now() / 1000);
    store.insertCommits(repo, [
      commit("a", { email: "12345+ayeshak@users.noreply.github.com", ts: now - 50 }),
    ]);
    const emp = makeEmployee(employees);
    identities.add(emp.id, "login", "ayeshak");

    const { created } = identities.suggest(now - 86_400);
    expect(created).toBe(1);
    expect(store.getEmployee(emp.id)?.commit_count).toBe(1);
  });

  test("noreply parsing", () => {
    expect(githubLoginFromNoreply("12345+ayeshak@users.noreply.github.com")).toBe("ayeshak");
    expect(githubLoginFromNoreply("ayeshak@users.noreply.github.com")).toBe("ayeshak");
    expect(githubLoginFromNoreply("ayesha@house.pk")).toBeNull();
  });
});

describe("identity conflicts", () => {
  test("mapping a taken identity names the current holder", () => {
    const { employees, identities } = setup();
    const ayesha = makeEmployee(employees);
    const bilal = employees.create({
      code: "EMP-002",
      full_name: "Bilal Ahmed",
      joined_on: "2024-01-01",
      status: "active",
      employment_type: "full_time",
    });
    identities.add(ayesha.id, "login", "shared");
    expect(() => identities.add(bilal.id, "login", "shared")).toThrow(/already mapped to Ayesha Khan/);
  });

  test("move takes the identity from the other person", () => {
    const { store, employees, identities } = setup();
    const ayesha = makeEmployee(employees);
    const bilal = employees.create({
      code: "EMP-002",
      full_name: "Bilal Ahmed",
      joined_on: "2024-01-01",
      status: "active",
      employment_type: "full_time",
    });
    identities.add(ayesha.id, "login", "shared");
    identities.move(bilal.id, "login", "shared");
    expect(store.listIdentities(ayesha.id).filter((i) => i.value === "shared")).toHaveLength(0);
    expect(store.listIdentities(bilal.id).filter((i) => i.value === "shared")).toHaveLength(1);
  });

  test("re-adding the same identity to the same person is a no-op", () => {
    const { store, employees, identities } = setup();
    const emp = makeEmployee(employees);
    identities.add(emp.id, "login", "ayeshak");
    identities.add(emp.id, "login", "ayeshak");
    expect(store.listIdentities(emp.id).filter((i) => i.kind === "login")).toHaveLength(1);
  });

  test("a leading @ is stripped and junk is rejected", () => {
    const { store, employees, identities } = setup();
    const emp = makeEmployee(employees);
    identities.add(emp.id, "login", "@ayeshak");
    expect(store.listIdentities(emp.id).some((i) => i.value === "ayeshak")).toBe(true);
    expect(() => identities.add(emp.id, "email", "not-an-email")).toThrow(/valid email/);
    expect(() => identities.add(emp.id, "login", "bad login!")).toThrow(/valid GitHub username/);
  });
});

describe("avatars", () => {
  test("an employee adopts the avatar from their own commits", () => {
    const { store, employees, identities } = setup();
    const repo = seedRepo(store);
    store.insertCommits(repo, [
      commit("a", { login: "ayeshak", avatar: "https://avatars.githubusercontent.com/u/1" }),
    ]);
    const emp = makeEmployee(employees);
    expect(store.getEmployee(emp.id)?.avatar_url).toBeNull();
    identities.add(emp.id, "login", "ayeshak");
    expect(store.getEmployee(emp.id)?.avatar_url).toBe("https://avatars.githubusercontent.com/u/1");
  });
});
