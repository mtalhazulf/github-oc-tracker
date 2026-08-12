import type { Capability } from "../domain/rbac.ts";

/**
 * The authorisation policy for every route in the application.
 *
 * This exists because the previous approach — sprinkling `app.use(prefix, guard)`
 * calls near the routes they protect — silently left holes: a prefix pattern like
 * `/employees/*` never matches `POST /employees`, and guarding a mutation with a
 * *view* capability that every role holds is not a guard at all. Both mistakes
 * are invisible at the call site and were live.
 *
 * So: one table, and the middleware **denies anything not listed**. A new route
 * is unreachable until someone declares who may call it, and
 * `tests/rbac.test.ts` fails if any registered route is missing from here.
 */

export type Access =
  /** No session required (login, health, webhooks — which authenticate by HMAC). */
  | { kind: "public" }
  /** Any signed-in user, regardless of role. */
  | { kind: "authenticated" }
  /** Requires a capability; the handler may apply a further per-record check. */
  | { kind: "capability"; capability: Capability; note?: string };

const PUBLIC: Access = { kind: "public" };
const SIGNED_IN: Access = { kind: "authenticated" };
const need = (capability: Capability, note?: string): Access => ({ kind: "capability", capability, note });

export interface PolicyEntry {
  /** HTTP methods this entry covers. */
  methods: readonly string[];
  /** Route pattern as registered, e.g. "/employees/:id/compensation". */
  path: string;
  access: Access;
}

const GET = ["GET"] as const;
const WRITE = ["POST", "PUT", "PATCH", "DELETE"] as const;
const ANY = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export const POLICY: PolicyEntry[] = [
  // ---- unauthenticated surface ----
  { methods: GET, path: "/healthz", access: PUBLIC },
  { methods: ANY, path: "/login", access: PUBLIC },
  { methods: ANY, path: "/logout", access: PUBLIC },
  { methods: ANY, path: "/setup", access: PUBLIC },
  { methods: ANY, path: "/webhooks/github", access: PUBLIC },
  { methods: GET, path: "/app.css", access: PUBLIC },
  { methods: GET, path: "/app.js", access: PUBLIC },
  { methods: GET, path: "/htmx.min.js", access: PUBLIC },

  // ---- code: the original tracker ----
  { methods: GET, path: "/", access: need("code.view") },
  { methods: GET, path: "/commits", access: need("code.view") },
  { methods: GET, path: "/commits/table", access: need("code.view") },
  { methods: GET, path: "/commits/rows", access: need("code.view") },
  { methods: GET, path: "/repos", access: need("code.view") },
  { methods: GET, path: "/repos/:id/row", access: need("code.view") },
  { methods: GET, path: "/orgs", access: need("code.view") },
  { methods: GET, path: "/orgs/:id/row", access: need("code.view") },
  { methods: WRITE, path: "/repos", access: need("code.manage") },
  { methods: WRITE, path: "/repos/:id", access: need("code.manage") },
  { methods: WRITE, path: "/repos/:id/sync", access: need("code.manage") },
  { methods: WRITE, path: "/orgs", access: need("code.manage") },
  { methods: WRITE, path: "/orgs/:id", access: need("code.manage") },
  { methods: WRITE, path: "/orgs/:id/sync", access: need("code.manage") },

  // ---- delivery: clients ----
  { methods: GET, path: "/clients", access: need("delivery.view") },
  { methods: GET, path: "/clients/table", access: need("delivery.view") },
  { methods: GET, path: "/clients/:id", access: need("delivery.view") },
  { methods: GET, path: "/clients/new", access: need("delivery.manage") },
  { methods: GET, path: "/clients/:id/edit", access: need("delivery.manage") },
  { methods: WRITE, path: "/clients", access: need("delivery.manage") },
  { methods: WRITE, path: "/clients/:id", access: need("delivery.manage") },
  { methods: WRITE, path: "/clients/:id/archive", access: need("delivery.manage") },
  { methods: WRITE, path: "/clients/:id/restore", access: need("delivery.manage") },

  // ---- delivery: projects ----
  { methods: GET, path: "/projects", access: need("delivery.view") },
  { methods: GET, path: "/projects/table", access: need("delivery.view") },
  { methods: GET, path: "/projects/:id", access: need("delivery.view") },
  { methods: GET, path: "/projects/new", access: need("delivery.manage") },
  { methods: GET, path: "/projects/:id/edit", access: need("delivery.manage") },
  { methods: WRITE, path: "/projects", access: need("delivery.manage") },
  { methods: WRITE, path: "/projects/:id", access: need("delivery.manage") },
  { methods: WRITE, path: "/projects/:id/archive", access: need("delivery.manage") },
  { methods: WRITE, path: "/projects/:id/restore", access: need("delivery.manage") },
  { methods: WRITE, path: "/projects/:id/repos", access: need("delivery.manage") },
  { methods: WRITE, path: "/projects/:id/repos/:repoId", access: need("delivery.manage") },
  { methods: WRITE, path: "/projects/:id/repos/:repoId/primary", access: need("delivery.manage") },
  { methods: WRITE, path: "/projects/:id/assignments", access: need("delivery.manage") },
  { methods: WRITE, path: "/projects/:id/assignments/:assignmentId", access: need("delivery.manage") },

  // ---- people ----
  { methods: GET, path: "/employees", access: need("people.view") },
  { methods: GET, path: "/employees/table", access: need("people.view") },
  { methods: GET, path: "/employees/:id", access: need("people.view") },
  { methods: GET, path: "/employees/new", access: need("people.manage") },
  { methods: GET, path: "/employees/:id/edit", access: need("people.manage") },
  { methods: WRITE, path: "/employees", access: need("people.manage") },
  { methods: WRITE, path: "/employees/:id", access: need("people.manage") },
  { methods: WRITE, path: "/employees/:id/archive", access: need("people.manage") },
  { methods: WRITE, path: "/employees/:id/restore", access: need("people.manage") },
  { methods: WRITE, path: "/employees/:id/identities", access: need("people.manage") },
  { methods: WRITE, path: "/employees/:id/identities/:identityId", access: need("people.manage") },

  // Salary is the sharpest line in the app: writing it is admin-and-above,
  // separately from managing the person's profile.
  { methods: WRITE, path: "/employees/:id/compensation", access: need("compensation.manage") },
  {
    methods: WRITE,
    path: "/employees/:id/compensation/:compensationId",
    access: need("compensation.manage"),
  },

  // ---- author mapping ----
  { methods: GET, path: "/people/unmapped", access: need("people.manage") },
  { methods: WRITE, path: "/people/unmapped/suggest", access: need("people.manage") },
  { methods: WRITE, path: "/people/unmapped/map", access: need("people.manage") },
  { methods: WRITE, path: "/people/unmapped/ignore", access: need("people.manage") },
  { methods: WRITE, path: "/people/ignored/:id", access: need("people.manage") },

  // ---- payroll ----
  { methods: ANY, path: "/payroll", access: need("payroll.manage") },
  { methods: ANY, path: "/payroll/cycles", access: need("payroll.manage") },
  { methods: ANY, path: "/payroll/cycles/:id", access: need("payroll.manage") },
  { methods: ANY, path: "/payroll/cycles/:id/generate", access: need("payroll.manage") },
  { methods: ANY, path: "/payroll/cycles/:id/status", access: need("payroll.manage") },
  { methods: GET, path: "/payroll/cycles/:id/export.csv", access: need("payroll.manage") },
  { methods: WRITE, path: "/payslips/:id", access: need("payroll.manage") },
  { methods: WRITE, path: "/payslips/:id/items", access: need("payroll.manage") },

  // Everyone may open a payslip; the handler then checks it is their own
  // unless they hold compensation.view.
  {
    methods: GET,
    path: "/payslips/:id",
    access: need("payslip.viewOwn", "handler additionally checks ownership"),
  },
  {
    methods: GET,
    path: "/payslips/:id/print",
    access: need("payslip.viewOwn", "handler additionally checks ownership"),
  },

  // ---- money ----
  { methods: GET, path: "/invoices", access: need("invoice.view") },
  { methods: GET, path: "/invoices/aging", access: need("invoice.view") },
  { methods: WRITE, path: "/invoices", access: need("invoice.manage") },
  { methods: WRITE, path: "/invoices/:id", access: need("invoice.manage") },
  { methods: WRITE, path: "/invoices/:id/status", access: need("invoice.manage") },
  { methods: GET, path: "/capacity", access: need("capacity.view") },

  // ---- settings ----
  { methods: GET, path: "/settings", access: need("code.view") },
  { methods: GET, path: "/settings/roles", access: SIGNED_IN },
  { methods: GET, path: "/settings/backup.db", access: need("settings.manage") },
  { methods: GET, path: "/settings/github-app/new", access: need("settings.manage") },
  { methods: GET, path: "/settings/github-app/callback", access: need("settings.manage") },
  { methods: WRITE, path: "/settings/github-app", access: need("settings.manage") },
  { methods: ANY, path: "/settings/tokens", access: need("settings.manage") },
  { methods: ANY, path: "/settings/tokens/:id", access: need("settings.manage") },
  { methods: GET, path: "/settings/audit", access: need("settings.manage") },
  { methods: ANY, path: "/settings/tax-slabs", access: need("payroll.manage") },
  { methods: ANY, path: "/settings/tax-slabs/:id", access: need("payroll.manage") },
  { methods: ANY, path: "/settings/users", access: need("users.manage") },
  { methods: ANY, path: "/settings/users/:id", access: need("users.manage") },

  // ---- JSON API (same capabilities as the screens they mirror) ----
  { methods: GET, path: "/api/v1/clients", access: need("delivery.view") },
  { methods: GET, path: "/api/v1/projects", access: need("delivery.view") },
  { methods: GET, path: "/api/v1/projects/:id", access: need("delivery.view") },
  { methods: GET, path: "/api/v1/projects/:id/activity", access: need("delivery.view") },
  { methods: GET, path: "/api/v1/employees", access: need("people.view") },
  { methods: GET, path: "/api/v1/employees/:id/contribution", access: need("people.view") },
  { methods: GET, path: "/api/v1/commits", access: need("code.view") },
  { methods: GET, path: "/api/v1/payroll/cycles", access: need("payroll.manage") },
  { methods: GET, path: "/api/v1/payroll/cycles/:id/payslips", access: need("payroll.manage") },
  { methods: GET, path: "/api/v1/invoices", access: need("invoice.view") },
];

/** Compile "/employees/:id/compensation" into an exact-match matcher. */
function toRegExp(path: string): RegExp {
  const source = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) return "[^/]+";
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${source}/?$`);
}

const COMPILED = POLICY.map((entry) => ({ ...entry, re: toRegExp(entry.path) }));

/**
 * Resolve the access rule for a request. Returns null when nothing matches,
 * which the middleware treats as a denial — the fail-closed default.
 *
 * More specific patterns win over less specific ones: `/clients/new` must beat
 * `/clients/:id`, otherwise the "new" page would be readable by anyone who can
 * view a client.
 */
export function resolveAccess(method: string, path: string): Access | null {
  const candidates = COMPILED.filter(
    (entry) => entry.methods.includes(method) && entry.re.test(path),
  );
  if (candidates.length === 0) return null;
  // Fewest parameter segments = most specific.
  candidates.sort((a, b) => paramCount(a.path) - paramCount(b.path));
  return candidates[0]?.access ?? null;
}

function paramCount(path: string): number {
  return path.split("/").filter((s) => s.startsWith(":")).length;
}

/** Every route pattern the policy knows about, for the coverage test. */
export function declaredRoutes(): Set<string> {
  const out = new Set<string>();
  for (const entry of POLICY) {
    for (const method of entry.methods) out.add(`${method} ${entry.path}`);
  }
  return out;
}
