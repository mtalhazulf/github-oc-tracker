import { describe, expect, test } from "bun:test";
import { createDb } from "../src/db/index.ts";
import { createStore, type Store } from "../src/db/store.ts";
import { hashToken, mintToken } from "../src/api/v1.ts";
import { buildApp } from "../src/app.ts";
import { GitHubClient } from "../src/github/client.ts";
import { GitHubAppService } from "../src/github/app.ts";
import { SyncService } from "../src/sync/service.ts";
import { createAuthService } from "../src/services/auth.ts";
import { createDeliveryService } from "../src/services/delivery.ts";

const stubFetch = (async () =>
  new Response("[]", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

async function setup() {
  const store = createStore(createDb(":memory:"));
  const github = new GitHubClient({ token: "t", fetchFn: stubFetch });
  const appSvc = new GitHubAppService(store, stubFetch);
  const sync = new SyncService(store, github, appSvc);
  const app = buildApp(store, sync, appSvc);
  const auth = createAuthService(store);
  const owner = await auth.setupOwner({
    name: "Owner",
    email: "owner@house.pk",
    password: "correct-horse-battery",
  });
  return { store, app, auth, owner };
}

function tokenFor(store: Store, role?: string): string {
  const { token, hash, prefix } = mintToken();
  let userId: number | null = null;
  if (role) {
    userId = store.insertUser({
      email: `${role}@house.pk`,
      name: role,
      passwordHash: "x",
      role: role as "owner",
      employeeId: null,
    });
  }
  store.insertApiToken({ name: `${role ?? "admin"} token`, tokenHash: hash, prefix, userId });
  return token;
}

function get(app: Awaited<ReturnType<typeof setup>>["app"], path: string, token?: string) {
  return app.request(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("api authentication", () => {
  test("fails closed without a token", async () => {
    const { app } = await setup();
    const res = await get(app, "/api/v1/clients");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  test("rejects an unknown token", async () => {
    const { app } = await setup();
    const res = await get(app, "/api/v1/clients", "oct_not-a-real-token");
    expect(res.status).toBe(401);
  });

  test("accepts a valid token", async () => {
    const { app, store } = await setup();
    const res = await get(app, "/api/v1/clients", tokenFor(store));
    expect(res.status).toBe(200);
  });

  test("only the hash is stored, never the token", async () => {
    const { store } = await setup();
    const token = tokenFor(store);
    const rows = store.listApiTokens();
    expect(rows[0]?.token_hash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  test("using a token stamps last_used_at", async () => {
    const { app, store } = await setup();
    const token = tokenFor(store);
    expect(store.listApiTokens()[0]?.last_used_at).toBeNull();
    await get(app, "/api/v1/clients", token);
    expect(store.listApiTokens()[0]?.last_used_at).not.toBeNull();
  });

  test("a revoked token stops working", async () => {
    const { app, store } = await setup();
    const token = tokenFor(store);
    expect((await get(app, "/api/v1/clients", token)).status).toBe(200);
    store.deleteApiToken(store.listApiTokens()[0]?.id ?? 0);
    expect((await get(app, "/api/v1/clients", token)).status).toBe(401);
  });
});

describe("api envelope", () => {
  test("collections return data and meta", async () => {
    const { app, store } = await setup();
    createDeliveryService(store).createClient({ name: "NW", code: "NW", currency: "USD", status: "active" });
    const res = await get(app, "/api/v1/clients", tokenFor(store));
    const body = (await res.json()) as { data: unknown[]; meta: { total: number; limit: number } };
    expect(body.data).toHaveLength(1);
    expect(body.meta).toMatchObject({ total: 1, limit: 50, offset: 0 });
  });

  test("limit is clamped and offset honoured", async () => {
    const { app, store } = await setup();
    const delivery = createDeliveryService(store);
    for (let i = 0; i < 5; i++) {
      delivery.createClient({ name: `C${i}`, code: `C${i}`, currency: "USD", status: "active" });
    }
    const token = tokenFor(store);
    const capped = (await (await get(app, "/api/v1/clients?limit=9999", token)).json()) as {
      meta: { limit: number };
    };
    expect(capped.meta.limit).toBe(200);

    const paged = (await (await get(app, "/api/v1/clients?limit=2&offset=2", token)).json()) as {
      data: { code: string }[];
    };
    expect(paged.data).toHaveLength(2);
    expect(paged.data[0]?.code).toBe("C2");
  });

  test("a missing record is a structured 404", async () => {
    const { app, store } = await setup();
    const res = await get(app, "/api/v1/projects/999", tokenFor(store));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  test("an unknown endpoint is a structured 404", async () => {
    const { app, store } = await setup();
    const res = await get(app, "/api/v1/nope", tokenFor(store));
    expect(res.status).toBe(404);
  });
});

describe("api authorisation", () => {
  test("a member token cannot read payroll", async () => {
    const { app, store } = await setup();
    const res = await get(app, "/api/v1/payroll/cycles", tokenFor(store, "member"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("forbidden");
  });

  test("a member token can read commits", async () => {
    const { app, store } = await setup();
    expect((await get(app, "/api/v1/commits", tokenFor(store, "member"))).status).toBe(200);
  });

  test("a manager token cannot read payroll but can read projects", async () => {
    const { app, store } = await setup();
    const token = tokenFor(store, "manager");
    expect((await get(app, "/api/v1/payroll/cycles", token)).status).toBe(403);
    expect((await get(app, "/api/v1/projects", token)).status).toBe(200);
  });
});

describe("api project detail", () => {
  test("includes repos and team", async () => {
    const { app, store } = await setup();
    const delivery = createDeliveryService(store);
    const client = delivery.createClient({ name: "NW", code: "NW", currency: "USD", status: "active" });
    const project = delivery.createProject({
      code: "P1",
      name: "Portal",
      kind: "client",
      client_id: String(client.id),
    });
    const repo = store.upsertRepo({
      githubId: null,
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
    }).id;
    delivery.linkRepo(project.id, repo, false);

    const res = await get(app, `/api/v1/projects/${project.id}`, tokenFor(store));
    const body = (await res.json()) as { data: { repos: unknown[]; team: unknown[]; name: string } };
    expect(body.data.name).toBe("Portal");
    expect(body.data.repos).toHaveLength(1);
    expect(body.data.team).toHaveLength(0);
  });
});

describe("csrf exemption for bearer tokens", () => {
  test("the API is reachable without a CSRF token", async () => {
    const { app, store } = await setup();
    // GETs are always safe; the point is that the session middleware does not
    // redirect an API call to /login when a bearer token is present.
    const res = await get(app, "/api/v1/employees", tokenFor(store));
    expect(res.status).toBe(200);
  });
});
