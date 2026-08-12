import { describe, expect, test } from "bun:test";
import { createDb } from "../src/db/index.ts";
import { createStore, type Store } from "../src/db/store.ts";
import { ConflictError, ValidationError } from "../src/domain/errors.ts";
import { createDeliveryService } from "../src/services/delivery.ts";
import { createEmployeeService } from "../src/services/employees.ts";
import { createIdentityService } from "../src/services/identities.ts";

function setup() {
  const store = createStore(createDb(":memory:"));
  return {
    store,
    delivery: createDeliveryService(store),
    employees: createEmployeeService(store),
    identities: createIdentityService(store),
  };
}

const CLIENT = { name: "Northwind Ltd", code: "NW", status: "active", currency: "USD" };

function seedRepo(store: Store, fullName: string): number {
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

function commit(sha: string, login: string, ts = 1_700_000_000) {
  return {
    sha,
    message: `commit ${sha}`,
    authorName: login,
    authorEmail: `${login}@house.pk`,
    authorLogin: login,
    authorAvatarUrl: null,
    authorTs: ts,
    committerName: null,
    committerEmail: null,
    committerTs: ts,
    isMerge: false,
    htmlUrl: null,
  };
}

describe("clients", () => {
  test("create, update and archive", () => {
    const { store, delivery } = setup();
    const created = delivery.createClient(CLIENT);
    expect(created.name).toBe("Northwind Ltd");
    expect(created.payment_terms_days).toBe(30);

    delivery.updateClient(created.id, { ...CLIENT, name: "Northwind International" });
    expect(store.getClient(created.id)?.name).toBe("Northwind International");

    delivery.archiveClient(created.id, true);
    expect(store.listClients()).toHaveLength(0);
    expect(store.listClients({ includeArchived: true })).toHaveLength(1);
  });

  test("duplicate codes are refused by name", () => {
    const { delivery } = setup();
    delivery.createClient(CLIENT);
    expect(() => delivery.createClient({ ...CLIENT, name: "Other" })).toThrow(/Northwind/);
  });

  test("a client with projects cannot be deleted, and the message says why", () => {
    const { delivery } = setup();
    const client = delivery.createClient(CLIENT);
    delivery.createProject({
      code: "NW-1",
      name: "Portal",
      kind: "client",
      client_id: String(client.id),
      billing_model: "fixed_price",
    });
    expect(() => delivery.removeClient(client.id)).toThrow(/still has 1 project/);
  });
});

describe("projects: the client vs internal rule", () => {
  test("a client project requires a client", () => {
    const { delivery } = setup();
    try {
      delivery.createProject({ code: "X", name: "X", kind: "client" });
      throw new Error("expected a ValidationError");
    } catch (err) {
      expect((err as ValidationError).fields.client_id).toContain("needs a client");
    }
  });

  test("internal work cannot have a client", () => {
    const { delivery } = setup();
    const client = delivery.createClient(CLIENT);
    try {
      delivery.createProject({
        code: "INT",
        name: "Our product",
        kind: "internal_product",
        client_id: String(client.id),
        billing_model: "none",
      });
      throw new Error("expected a ValidationError");
    } catch (err) {
      expect((err as ValidationError).fields.client_id).toContain("cannot belong to a client");
    }
  });

  test("internal work cannot be billed", () => {
    const { delivery } = setup();
    try {
      delivery.createProject({
        code: "INT",
        name: "Our product",
        kind: "internal_product",
        billing_model: "fixed_price",
      });
      throw new Error("expected a ValidationError");
    } catch (err) {
      expect((err as ValidationError).fields.billing_model).toContain("none");
    }
  });

  test("an internal product is created without a client", () => {
    const { store, delivery } = setup();
    const created = delivery.createProject({
      code: "INT",
      name: "Scheduler",
      kind: "internal_product",
      billing_model: "none",
    });
    expect(created.client_id).toBeNull();
    expect(store.listProjects({ kind: "internal_product" })).toHaveLength(1);
  });

  test("budgets are parsed to minor units", () => {
    const { delivery } = setup();
    const client = delivery.createClient(CLIENT);
    const project = delivery.createProject({
      code: "NW-1",
      name: "Portal",
      kind: "client",
      client_id: String(client.id),
      billing_model: "fixed_price",
      currency: "USD",
      budget_minor: "120,000.00",
    });
    expect(project.budget_minor).toBe(12_000_000);
  });

  test("end date cannot precede start date", () => {
    const { delivery } = setup();
    const client = delivery.createClient(CLIENT);
    expect(() =>
      delivery.createProject({
        code: "NW-1",
        name: "Portal",
        kind: "client",
        client_id: String(client.id),
        start_on: "2026-06-01",
        end_on: "2026-01-01",
      }),
    ).toThrow(ValidationError);
  });
});

describe("project ↔ repositories (many to many)", () => {
  function twoProjectsOneSharedRepo() {
    const ctx = setup();
    const { store, delivery } = ctx;
    const client = delivery.createClient(CLIENT);
    const a = delivery.createProject({
      code: "A",
      name: "Alpha",
      kind: "client",
      client_id: String(client.id),
    });
    const b = delivery.createProject({
      code: "B",
      name: "Beta",
      kind: "client",
      client_id: String(client.id),
    });
    const shared = seedRepo(store, "acme/shared");
    const own = seedRepo(store, "acme/alpha-only");
    store.insertCommits(shared, [commit("s1", "alice"), commit("s2", "alice"), commit("s3", "bob")]);
    store.insertCommits(own, [commit("o1", "alice")]);
    return { ...ctx, a, b, shared, own };
  }

  test("a project spans several repositories", () => {
    const { store, delivery, a, shared, own } = twoProjectsOneSharedRepo();
    delivery.linkRepo(a.id, shared, false);
    delivery.linkRepo(a.id, own, false);
    expect(store.listProjectRepos(a.id)).toHaveLength(2);
    expect(store.getProject(a.id)?.commit_count).toBe(4);
  });

  test("a shared repo appears under BOTH projects", () => {
    const { store, delivery, a, b, shared } = twoProjectsOneSharedRepo();
    delivery.linkRepo(a.id, shared, false);
    delivery.linkRepo(b.id, shared, false);
    expect(store.getProject(a.id)?.commit_count).toBe(3);
    expect(store.getProject(b.id)?.commit_count).toBe(3);
  });

  test("but company rollups count each commit exactly once", () => {
    const { store, delivery, a, b, shared, own } = twoProjectsOneSharedRepo();
    delivery.linkRepo(a.id, shared, false);
    delivery.linkRepo(b.id, shared, false);
    delivery.linkRepo(a.id, own, false);

    const rollup = store.commitsByProject(0);
    const total = rollup.reduce((sum, row) => sum + row.commits, 0);
    // 4 commits exist; a naive per-project sum would report 7.
    expect(total).toBe(4);
    expect(store.countCommits()).toBe(4);
  });

  test("the first project to link a repo holds the primary link", () => {
    const { store, delivery, a, b, shared } = twoProjectsOneSharedRepo();
    delivery.linkRepo(a.id, shared, false);
    delivery.linkRepo(b.id, shared, false);
    const holders = store.projectsForRepo(shared);
    expect(holders.filter((h) => h.is_primary === 1).map((h) => h.project_id)).toEqual([a.id]);
  });

  test("asking for primary when another project holds it explains how to move it", () => {
    const { delivery, a, b, shared } = twoProjectsOneSharedRepo();
    delivery.linkRepo(a.id, shared, false);
    expect(() => delivery.linkRepo(b.id, shared, true)).toThrow(ConflictError);
    expect(() => delivery.linkRepo(b.id, shared, true)).toThrow(/Alpha still holds its primary link/);
  });

  test("make primary moves the rollup to the other project", () => {
    const { store, delivery, a, b, shared } = twoProjectsOneSharedRepo();
    delivery.linkRepo(a.id, shared, false);
    delivery.linkRepo(b.id, shared, false);
    expect(store.commitsByProject(0).find((r) => r.project_id === a.id)?.commits).toBe(3);

    delivery.setPrimaryRepo(b.id, shared);
    expect(store.commitsByProject(0).find((r) => r.project_id === a.id)).toBeUndefined();
    expect(store.commitsByProject(0).find((r) => r.project_id === b.id)?.commits).toBe(3);
  });

  test("unlinking keeps the repository and its commits", () => {
    const { store, delivery, a, shared } = twoProjectsOneSharedRepo();
    delivery.linkRepo(a.id, shared, false);
    delivery.unlinkRepo(a.id, shared);
    expect(store.listProjectRepos(a.id)).toHaveLength(0);
    expect(store.getRepo(shared)).not.toBeNull();
    expect(store.countCommits({ repoId: shared })).toBe(3);
  });

  test("deleting a project keeps the repositories", () => {
    const { store, delivery, a, shared } = twoProjectsOneSharedRepo();
    delivery.linkRepo(a.id, shared, false);
    delivery.removeProject(a.id);
    expect(store.getRepo(shared)).not.toBeNull();
    expect(store.listProjectRepos(a.id)).toHaveLength(0);
  });

  test("unlinked repositories with commits are reported so activity is not lost silently", () => {
    const { store, delivery, a, shared, own } = twoProjectsOneSharedRepo();
    delivery.linkRepo(a.id, shared, false);
    const stats = store.unlinkedRepoStats();
    expect(stats.repos).toBe(1);
    expect(stats.commits).toBe(1);
    delivery.linkRepo(a.id, own, false);
    expect(store.unlinkedRepoStats().repos).toBe(0);
  });
});

describe("project activity and contributors", () => {
  test("activity spans all linked repos and names mapped employees", () => {
    const { store, delivery, employees, identities } = setup();
    const client = delivery.createClient(CLIENT);
    const project = delivery.createProject({
      code: "NW-1",
      name: "Portal",
      kind: "client",
      client_id: String(client.id),
    });
    const r1 = seedRepo(store, "acme/api");
    const r2 = seedRepo(store, "acme/web");
    const now = Math.floor(Date.now() / 1000);
    store.insertCommits(r1, [commit("a", "alice", now - 100)]);
    store.insertCommits(r2, [commit("b", "bob", now - 50)]);
    delivery.linkRepo(project.id, r1, false);
    delivery.linkRepo(project.id, r2, false);

    const alice = employees.create({
      code: "E1",
      full_name: "Alice A",
      joined_on: "2024-01-01",
      status: "active",
      employment_type: "full_time",
    });
    identities.add(alice.id, "login", "alice");

    const activity = store.projectActivity(project.id, { sinceTs: now - 86_400, beforeTs: now + 10 });
    expect(activity).toHaveLength(2);
    expect(activity[0]?.repo_full_name).toBe("acme/web"); // newest first
    expect(activity.find((a) => a.sha === "a")?.employee_name).toBe("Alice A");
    expect(activity.find((a) => a.sha === "b")?.employee_id).toBeNull();

    const contributors = store.projectContributors(project.id, now - 86_400);
    expect(contributors.map((c) => c.name).sort()).toEqual(["Alice A", "bob"]);
  });
});

describe("team assignments", () => {
  test("allocate a person to a project", () => {
    const { store, delivery, employees } = setup();
    const client = delivery.createClient(CLIENT);
    const project = delivery.createProject({
      code: "NW-1",
      name: "Portal",
      kind: "client",
      client_id: String(client.id),
    });
    const emp = employees.create({
      code: "E1",
      full_name: "Alice A",
      joined_on: "2024-01-01",
      status: "active",
      employment_type: "full_time",
    });
    delivery.addAssignment(project.id, {
      employee_id: String(emp.id),
      allocation_pct: "60",
      start_on: "2026-01-01",
      role: "Tech lead",
    });
    const team = store.listAssignments(project.id);
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ allocation_pct: 60, role: "Tech lead", employee_name: "Alice A" });
  });

  test("allocation must be a sane percentage", () => {
    const { delivery, employees } = setup();
    const project = delivery.createProject({
      code: "INT",
      name: "Internal",
      kind: "internal_ops",
      billing_model: "none",
    });
    const emp = employees.create({
      code: "E1",
      full_name: "Alice A",
      joined_on: "2024-01-01",
      status: "active",
      employment_type: "full_time",
    });
    expect(() =>
      delivery.addAssignment(project.id, {
        employee_id: String(emp.id),
        allocation_pct: "150",
        start_on: "2026-01-01",
      }),
    ).toThrow(ValidationError);
  });

  test("archiving an employee leaves their assignments in place", () => {
    const { store, delivery, employees } = setup();
    const project = delivery.createProject({
      code: "INT",
      name: "Internal",
      kind: "internal_ops",
      billing_model: "none",
    });
    const emp = employees.create({
      code: "E1",
      full_name: "Alice A",
      joined_on: "2024-01-01",
      status: "active",
      employment_type: "full_time",
    });
    delivery.addAssignment(project.id, { employee_id: String(emp.id), start_on: "2026-01-01" });
    employees.archive(emp.id, true);
    expect(store.listAssignments(project.id)).toHaveLength(1);
  });
});
