import { beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "../src/db/index.ts";
import { createStore, type Store } from "../src/db/store.ts";
import { buildApp } from "../src/app.ts";
import { GitHubClient } from "../src/github/client.ts";
import { GitHubAppService } from "../src/github/app.ts";
import { SyncService } from "../src/sync/service.ts";
import { createAuthService, type AuthService } from "../src/services/auth.ts";
import { ROLES, type Role } from "../src/domain/rbac.ts";
import { declaredRoutes, resolveAccess } from "../src/web/policy.ts";

const stubFetch = (async () =>
  new Response("[]", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

interface Ctx {
  store: Store;
  app: ReturnType<typeof buildApp>;
  auth: AuthService;
}

function makeApp(): Ctx {
  const store = createStore(createDb(":memory:"));
  const gh = new GitHubClient({ token: "t", fetchFn: stubFetch });
  const appSvc = new GitHubAppService(store, stubFetch);
  const app = buildApp(store, new SyncService(store, gh, appSvc), appSvc);
  return { store, app, auth: createAuthService(store) };
}

async function withRole(role: Role): Promise<Ctx & { cookie: string; csrf: string; userId: number }> {
  const ctx = makeApp();
  const owner = await ctx.auth.setupOwner({
    name: "Owner",
    email: "owner@h.pk",
    password: "correct-horse-battery",
  });
  let userId = owner.id;
  if (role !== "owner") {
    const created = await ctx.auth.createUser({
      name: role,
      email: `${role}@h.pk`,
      password: "correct-horse-battery",
      role,
    });
    userId = created.id;
  }
  const session = await ctx.auth.login(
    role === "owner" ? "owner@h.pk" : `${role}@h.pk`,
    "correct-horse-battery",
  );
  if (!session) throw new Error("login failed");
  return { ...ctx, cookie: `sid=${session.sessionId}`, csrf: session.csrfToken, userId };
}

function request(
  ctx: { app: ReturnType<typeof buildApp>; cookie: string; csrf: string },
  method: string,
  path: string,
  body?: string,
) {
  return ctx.app.request(path, {
    method,
    headers: {
      Cookie: ctx.cookie,
      "X-CSRF-Token": ctx.csrf,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: method === "GET" ? undefined : (body ?? ""),
  });
}

// ---------------------------------------------------------------- coverage

describe("policy coverage", () => {
  test("every registered route has a policy entry", () => {
    const ctx = makeApp();
    const declared = declaredRoutes();
    const missing: string[] = [];

    for (const route of ctx.app.routes) {
      if (route.method === "ALL") continue;
      const key = `${route.method} ${route.path}`;
      if (declared.has(key)) continue;
      // Also accept a resolvable match (the entry may cover it via a pattern).
      const probePath = route.path.replace(/:[A-Za-z]+/g, "1");
      if (resolveAccess(route.method, probePath) !== null) continue;
      missing.push(key);
    }

    expect(missing.sort()).toEqual([]);
  });

  test("an undeclared path resolves to null, so the gate denies it", () => {
    expect(resolveAccess("GET", "/some/route/nobody/declared")).toBeNull();
    expect(resolveAccess("DELETE", "/employees/1/secret-backdoor")).toBeNull();
  });

  test("more specific patterns win over parameterised ones", () => {
    // /clients/new must not be served by the /clients/:id rule.
    expect(resolveAccess("GET", "/clients/new")).toMatchObject({ capability: "delivery.manage" });
    expect(resolveAccess("GET", "/clients/7")).toMatchObject({ capability: "delivery.view" });
    expect(resolveAccess("GET", "/employees/new")).toMatchObject({ capability: "people.manage" });
    expect(resolveAccess("GET", "/employees/7")).toMatchObject({ capability: "people.view" });
  });

  test("reads and writes on the same path resolve differently", () => {
    expect(resolveAccess("GET", "/employees")).toMatchObject({ capability: "people.view" });
    expect(resolveAccess("POST", "/employees")).toMatchObject({ capability: "people.manage" });
    expect(resolveAccess("GET", "/repos")).toMatchObject({ capability: "code.view" });
    expect(resolveAccess("DELETE", "/repos/1")).toMatchObject({ capability: "code.manage" });
  });
});

// ---------------------------------------------------------------- the holes

/** Routes that were reachable by a read-only member before this policy existed. */
const REGRESSIONS: [string, string, string][] = [
  ["POST", "/employees/1/compensation", "write a salary record"],
  ["DELETE", "/employees/1/compensation/1", "delete a salary record"],
  ["DELETE", "/orgs/1", "delete an organization and its commits"],
  ["DELETE", "/repos/1", "delete a repository"],
  ["POST", "/repos", "add a repository"],
  ["POST", "/orgs", "add an organization"],
  ["DELETE", "/settings/github-app", "remove the GitHub App configuration"],
  ["POST", "/clients", "create a client"],
  ["POST", "/clients/1", "edit a client"],
  ["POST", "/clients/1/archive", "archive a client"],
  ["POST", "/employees", "create a person"],
  ["POST", "/employees/1", "edit a person"],
  ["POST", "/employees/1/archive", "archive a person"],
  ["POST", "/employees/1/identities", "map a commit author"],
  ["POST", "/projects", "create a project"],
  ["POST", "/projects/1/repos", "link a repository to a project"],
  ["POST", "/projects/1/assignments", "staff a project"],
  ["POST", "/settings/users", "create an account"],
  ["POST", "/settings/tokens", "mint an API token"],
];

describe("a member cannot mutate anything", () => {
  let member: Awaited<ReturnType<typeof withRole>>;
  beforeAll(async () => {
    member = await withRole("member");
  });

  for (const [method, path, what] of REGRESSIONS) {
    test(`${method} ${path} — ${what}`, async () => {
      const res = await request(member, method, path, "name=x&code=x&full_name=x&joined_on=2024-01-01");
      expect(res.status).toBe(403);
    });
  }
});

describe("a manager runs delivery but never touches money", () => {
  let manager: Awaited<ReturnType<typeof withRole>>;
  beforeAll(async () => {
    manager = await withRole("manager");
  });

  const DENIED: [string, string][] = [
    ["POST", "/employees/1/compensation"],
    ["DELETE", "/employees/1/compensation/1"],
    ["GET", "/payroll"],
    ["POST", "/payroll/cycles"],
    ["GET", "/payroll/cycles/1/export.csv"],
    ["POST", "/invoices"],
    ["GET", "/settings/audit"],
    ["GET", "/settings/tokens"],
    ["GET", "/settings/users"],
    ["GET", "/settings/backup.db"],
    ["GET", "/settings/tax-slabs"],
  ];
  for (const [method, path] of DENIED) {
    test(`denied ${method} ${path}`, async () => {
      expect((await request(manager, method, path)).status).toBe(403);
    });
  }

  const ALLOWED: [string, string][] = [
    ["GET", "/projects"],
    ["GET", "/clients"],
    ["GET", "/employees"],
    ["GET", "/capacity"],
    ["GET", "/invoices"],
    ["GET", "/people/unmapped"],
  ];
  for (const [method, path] of ALLOWED) {
    test(`allowed ${method} ${path}`, async () => {
      expect((await request(manager, method, path)).status).not.toBe(403);
    });
  }
});

describe("admin vs owner", () => {
  test("an admin can run payroll but cannot manage accounts", async () => {
    const admin = await withRole("admin");
    expect((await request(admin, "GET", "/payroll")).status).toBe(200);
    expect((await request(admin, "GET", "/settings/users")).status).toBe(403);
    expect((await request(admin, "POST", "/settings/users", "name=x")).status).toBe(403);
  });

  test("an owner can do everything the policy names", async () => {
    const owner = await withRole("owner");
    for (const path of ["/payroll", "/settings/users", "/settings/audit", "/capacity", "/invoices"]) {
      expect((await request(owner, "GET", path)).status).toBe(200);
    }
  });
});

// ---------------------------------------------------------------- per-record

describe("payslip ownership", () => {
  async function seedPayslip(ctx: Ctx): Promise<{ payslipId: number; employeeId: number }> {
    const { createEmployeeService } = await import("../src/services/employees.ts");
    const { createPayrollService } = await import("../src/services/payroll.ts");
    const employees = createEmployeeService(ctx.store);
    const payroll = createPayrollService(ctx.store);
    const emp = employees.create({
      code: "E1",
      full_name: "Ayesha",
      joined_on: "2024-01-01",
      status: "active",
      employment_type: "full_time",
    });
    employees.addCompensation(emp.id, {
      effective_from: "2024-01-01",
      base_monthly_minor: "300,000",
      currency: "PKR",
    });
    const cycle = payroll.createCycle({ period_month: "2026-07" });
    payroll.generate(cycle.id);
    const slip = ctx.store.listPayslips(cycle.id)[0];
    return { payslipId: slip?.id ?? 0, employeeId: emp.id };
  }

  test("a member sees their own payslip and nobody else's", async () => {
    const ctx = makeApp();
    await ctx.auth.setupOwner({ name: "Owner", email: "owner@h.pk", password: "correct-horse-battery" });
    const { payslipId, employeeId } = await seedPayslip(ctx);

    // Someone else's payslip: denied.
    const stranger = await ctx.auth.createUser({
      name: "Stranger",
      email: "stranger@h.pk",
      password: "correct-horse-battery",
      role: "member",
    });
    let session = await ctx.auth.login("stranger@h.pk", "correct-horse-battery");
    let probe = { app: ctx.app, cookie: `sid=${session?.sessionId}`, csrf: session?.csrfToken ?? "" };
    expect((await request(probe, "GET", `/payslips/${payslipId}`)).status).toBe(403);

    // Now link that account to the employee: their own payslip opens.
    ctx.auth.updateUser(
      stranger.id,
      { name: "Stranger", role: "member", employee_id: String(employeeId), status: "active" },
      { id: 1, email: "owner@h.pk", name: "Owner", role: "owner", employeeId: null },
    );
    session = await ctx.auth.login("stranger@h.pk", "correct-horse-battery");
    probe = { app: ctx.app, cookie: `sid=${session?.sessionId}`, csrf: session?.csrfToken ?? "" };
    expect((await request(probe, "GET", `/payslips/${payslipId}`)).status).toBe(200);
  });

  test("a member still cannot edit their own payslip", async () => {
    const ctx = makeApp();
    await ctx.auth.setupOwner({ name: "Owner", email: "owner@h.pk", password: "correct-horse-battery" });
    const { payslipId, employeeId } = await seedPayslip(ctx);
    const user = await ctx.auth.createUser({
      name: "Self",
      email: "self@h.pk",
      password: "correct-horse-battery",
      role: "member",
    });
    ctx.auth.updateUser(
      user.id,
      { name: "Self", role: "member", employee_id: String(employeeId), status: "active" },
      { id: 1, email: "owner@h.pk", name: "Owner", role: "owner", employeeId: null },
    );
    const session = await ctx.auth.login("self@h.pk", "correct-horse-battery");
    const probe = { app: ctx.app, cookie: `sid=${session?.sessionId}`, csrf: session?.csrfToken ?? "" };
    expect((await request(probe, "POST", `/payslips/${payslipId}`, "payable_days=31")).status).toBe(403);
  });
});

// ---------------------------------------------------------------- API parity

describe("the API enforces the same policy", () => {
  async function tokenFor(ctx: Ctx, role: Role): Promise<string> {
    const { mintToken } = await import("../src/api/v1.ts");
    const { token, hash, prefix } = mintToken();
    const user = await ctx.auth.createUser({
      name: role,
      email: `${role}-api@h.pk`,
      password: "correct-horse-battery",
      role,
    });
    ctx.store.insertApiToken({ name: role, tokenHash: hash, prefix, userId: user.id });
    return token;
  }

  test("a member token is refused payroll but allowed commits", async () => {
    const ctx = makeApp();
    await ctx.auth.setupOwner({ name: "Owner", email: "owner@h.pk", password: "correct-horse-battery" });
    const token = await tokenFor(ctx, "member");
    const headers = { Authorization: `Bearer ${token}` };
    expect((await ctx.app.request("/api/v1/payroll/cycles", { headers })).status).toBe(403);
    expect((await ctx.app.request("/api/v1/commits", { headers })).status).toBe(200);
  });

  test("no token is 401 JSON, not an HTML redirect", async () => {
    const ctx = makeApp();
    await ctx.auth.setupOwner({ name: "Owner", email: "owner@h.pk", password: "correct-horse-battery" });
    const res = await ctx.app.request("/api/v1/projects");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("an undeclared API path is a JSON 404, never a fallthrough", async () => {
    const ctx = makeApp();
    await ctx.auth.setupOwner({ name: "Owner", email: "owner@h.pk", password: "correct-horse-battery" });
    const res = await ctx.app.request("/api/v1/undeclared");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

// ---------------------------------------------------------------- full sweep

describe("full role × route sweep", () => {
  test("no role reaches a route its capability does not allow", async () => {
    const contexts = new Map<Role, Awaited<ReturnType<typeof withRole>>>();
    for (const role of ROLES) contexts.set(role, await withRole(role));

    const sample = contexts.get("owner");
    if (!sample) throw new Error("no owner context");
    const routes = [...new Set(sample.app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`))]
      .filter((r) => !r.includes("/logout") && !r.includes("/setup") && !r.includes("backup.db"));

    const violations: string[] = [];
    for (const role of ROLES) {
      const ctx = contexts.get(role);
      if (!ctx) continue;
      for (const route of routes) {
        const [method = "GET", pattern = "/"] = route.split(" ");
        const path = pattern.replace(/:[A-Za-z]+/g, "1");
        const access = resolveAccess(method, path);
        if (access === null || access.kind !== "capability") continue;

        const { can } = await import("../src/domain/rbac.ts");
        const permitted = can(role, access.capability);
        const res = await request(ctx, method, path, "name=x&code=x&full_name=x&joined_on=2024-01-01");

        if (!permitted && res.status !== 403) {
          violations.push(`${role} reached ${method} ${path} (status ${res.status}) without ${access.capability}`);
        }
        if (permitted && res.status === 403) {
          violations.push(`${role} was refused ${method} ${path} despite holding ${access.capability}`);
        }
      }
    }
    expect(violations).toEqual([]);
  }, 180_000);
});
