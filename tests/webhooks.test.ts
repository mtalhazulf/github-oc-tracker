import { describe, expect, test } from "bun:test";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { createDb } from "../src/db/index.ts";
import { createStore, type Store } from "../src/db/store.ts";
import { GitHubClient } from "../src/github/client.ts";
import { GitHubAppService } from "../src/github/app.ts";
import { SyncService } from "../src/sync/service.ts";
import { createWebhookRoutes, verifySignature } from "../src/web/webhooks.ts";

const SECRET = "test-webhook-secret";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs1", format: "pem" }) as string;

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** GitHub API stub: commit listing returns empty pages so queued syncs finish. */
const stubFetch = (async (input: URL | Request | string) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  if (/\/commits$/.test(url.pathname)) return json([]);
  if (/\/access_tokens$/.test(url.pathname)) {
    return json({ token: "inst-token", expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201);
  }
  if (url.pathname.endsWith("/installation/repositories")) return json({ repositories: [] });
  return json({});
}) as unknown as typeof fetch;

function makeApp(withAppRow = false): {
  store: Store;
  app: ReturnType<typeof createWebhookRoutes>;
  sync: SyncService;
} {
  const store = createStore(createDb(":memory:"));
  if (withAppRow) {
    store.saveGithubApp({
      appId: 1234,
      slug: "oc-tracker-test",
      name: "oc tracker test",
      clientId: null,
      clientSecret: null,
      privateKey: PRIVATE_KEY_PEM,
      webhookSecret: SECRET,
      htmlUrl: "https://github.com/apps/oc-tracker-test",
    });
  }
  const github = new GitHubClient({ token: "t", fetchFn: stubFetch });
  const appSvc = new GitHubAppService(store, stubFetch);
  const sync = new SyncService(store, github, appSvc);
  const app = createWebhookRoutes(store, sync, appSvc);
  return { store, app, sync };
}

async function drainSyncs(sync: SyncService): Promise<void> {
  for (let i = 0; i < 200 && sync.pendingCount > 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function deliver(
  app: ReturnType<typeof createWebhookRoutes>,
  event: string,
  payload: unknown,
  opts: { secret?: string; badSig?: boolean } = {},
): Promise<Response> {
  const body = JSON.stringify(payload);
  return app.request("/webhooks/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": "d-1",
      "x-hub-signature-256": opts.badSig ? sign(body, "wrong") : sign(body, opts.secret ?? SECRET),
    },
    body,
  });
}

describe("verifySignature", () => {
  test("accepts a valid signature and rejects tampering", () => {
    const body = '{"a":1}';
    expect(verifySignature(body, sign(body), [SECRET])).toBe(true);
    expect(verifySignature('{"a":2}', sign(body), [SECRET])).toBe(false);
    expect(verifySignature(body, sign(body, "other"), [SECRET])).toBe(false);
    expect(verifySignature(body, undefined, [SECRET])).toBe(false);
    expect(verifySignature(body, "sha1=abc", [SECRET])).toBe(false);
  });
});

describe("webhook endpoint", () => {
  test("rejects when no secret is configured", async () => {
    const { app } = makeApp(false); // no app row, no WEBHOOK_SECRET env in tests
    const res = await deliver(app, "ping", { zen: "keep it simple" });
    expect(res.status).toBe(503);
  });

  test("rejects invalid signatures with 401", async () => {
    const { app, store } = makeApp(true);
    const res = await deliver(app, "ping", { zen: "x" }, { badSig: true });
    expect(res.status).toBe(401);
    expect(store.recentWebhookEvents(1)[0]).toMatchObject({ status: "rejected" });
  });

  test("answers ping with the app secret", async () => {
    const { app, store } = makeApp(true);
    const res = await deliver(app, "ping", { zen: "x" });
    expect(res.status).toBe(200);
    expect(store.recentWebhookEvents(1)[0]).toMatchObject({ event: "ping", status: "ok" });
  });

  test("push to default branch of a tracked repo queues a sync", async () => {
    const { app, store } = makeApp(true);
    store.upsertRepo({
      githubId: 77,
      orgId: null,
      owner: "acme",
      name: "api",
      fullName: "acme/api",
      description: null,
      defaultBranch: "main",
      isPrivate: false,
      isFork: false,
      isArchived: false,
      htmlUrl: null,
    });
    const res = await deliver(app, "push", {
      ref: "refs/heads/main",
      repository: {
        id: 77,
        name: "api",
        full_name: "acme/api",
        default_branch: "main",
        owner: { login: "acme" },
      },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ queued: true });
  });

  test("push to a feature branch is skipped", async () => {
    const { app, store } = makeApp(true);
    store.upsertRepo({
      githubId: 77,
      orgId: null,
      owner: "acme",
      name: "api",
      fullName: "acme/api",
      description: null,
      defaultBranch: "main",
      isPrivate: false,
      isFork: false,
      isArchived: false,
      htmlUrl: null,
    });
    const res = await deliver(app, "push", {
      ref: "refs/heads/feature-x",
      repository: {
        id: 77,
        name: "api",
        full_name: "acme/api",
        default_branch: "main",
        owner: { login: "acme" },
      },
    });
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ skipped: true });
  });

  test("push for an untracked repo without context is ignored", async () => {
    const { app } = makeApp(true);
    const res = await deliver(app, "push", {
      ref: "refs/heads/main",
      repository: {
        id: 99,
        name: "mystery",
        full_name: "stranger/mystery",
        default_branch: "main",
        owner: { login: "stranger" },
      },
    });
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ ignored: true });
  });

  test("push rename refreshes the tracked repo in place", async () => {
    const { app, store } = makeApp(true);
    store.upsertRepo({
      githubId: 77,
      orgId: null,
      owner: "acme",
      name: "api",
      fullName: "acme/api",
      description: null,
      defaultBranch: "main",
      isPrivate: false,
      isFork: false,
      isArchived: false,
      htmlUrl: null,
    });
    await deliver(app, "push", {
      ref: "refs/heads/main",
      repository: {
        id: 77,
        name: "api-v2",
        full_name: "acme/api-v2",
        default_branch: "main",
        owner: { login: "acme" },
      },
    });
    const repo = store.getRepoByGithubId(77);
    expect(repo?.full_name).toBe("acme/api-v2");
    expect(store.listRepos()).toHaveLength(1);
  });

  test("installation created registers org + repos and cleans up on delete", async () => {
    const { app, store, sync } = makeApp(true);
    const res = await deliver(app, "installation", {
      action: "created",
      installation: { id: 555, account: { login: "acme", type: "Organization" } },
      repositories: [
        { id: 1, name: "api", full_name: "acme/api", private: true },
        { id: 2, name: "web", full_name: "acme/web", private: false },
      ],
    });
    expect(res.status).toBe(200);
    expect(store.listInstallations()).toHaveLength(1);
    const org = store.getOrgByLogin("acme");
    expect(org).not.toBeNull();
    const repos = store.listRepos();
    expect(repos).toHaveLength(2);
    expect(repos.every((r) => r.installation_id === 555)).toBe(true);

    await drainSyncs(sync);
    await deliver(app, "installation", {
      action: "deleted",
      installation: { id: 555, account: { login: "acme", type: "Organization" } },
    });
    expect(store.listInstallations()).toHaveLength(0);
    // History and repos are kept, but detached and flagged.
    const after = store.listRepos();
    expect(after).toHaveLength(2);
    expect(after.every((r) => r.installation_id === null)).toBe(true);
    expect(after.every((r) => r.sync_status === "error")).toBe(true);
  });

  test("installation_repositories add/remove", async () => {
    const { app, store } = makeApp(true);
    await deliver(app, "installation", {
      action: "created",
      installation: { id: 555, account: { login: "acme", type: "Organization" } },
      repositories: [{ id: 1, name: "api", full_name: "acme/api", private: false }],
    });
    const res = await deliver(app, "installation_repositories", {
      action: "added",
      installation: { id: 555, account: { login: "acme", type: "Organization" } },
      repositories_added: [{ id: 2, name: "web", full_name: "acme/web", private: false }],
      repositories_removed: [{ id: 1, name: "api", full_name: "acme/api", private: false }],
    });
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ added: 1, removed: 1 });
    expect(store.getRepoByGithubId(2)?.installation_id).toBe(555);
    expect(store.getRepoByGithubId(1)?.installation_id).toBeNull();
  });

  test("repository deleted marks the repo but keeps history", async () => {
    const { app, store } = makeApp(true);
    const { id } = store.upsertRepo({
      githubId: 42,
      orgId: null,
      owner: "acme",
      name: "gone",
      fullName: "acme/gone",
      description: null,
      defaultBranch: "main",
      isPrivate: false,
      isFork: false,
      isArchived: false,
      htmlUrl: null,
    });
    await deliver(app, "repository", {
      action: "deleted",
      repository: { id: 42, name: "gone", full_name: "acme/gone", owner: { login: "acme" } },
    });
    const repo = store.getRepo(id);
    expect(repo?.sync_status).toBe("error");
    expect(repo?.sync_error).toContain("deleted");
  });
});
