import type { Capability } from "../domain/rbac.ts";

export type Access =
  | { kind: "public" }
  | { kind: "authenticated" }
  | { kind: "capability"; capability: Capability; note?: string };

const PUBLIC: Access = { kind: "public" };
const SIGNED_IN: Access = { kind: "authenticated" };
const need = (capability: Capability, note?: string): Access => ({ kind: "capability", capability, note });

export interface PolicyEntry {
  methods: readonly string[];
  path: string;
  access: Access;
}

const GET = ["GET"] as const;
const WRITE = ["POST", "PUT", "PATCH", "DELETE"] as const;
const ANY = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export const POLICY: PolicyEntry[] = [
  { methods: GET, path: "/healthz", access: PUBLIC },
  { methods: ANY, path: "/login", access: PUBLIC },
  { methods: ANY, path: "/logout", access: PUBLIC },
  { methods: ANY, path: "/setup", access: PUBLIC },
  { methods: ANY, path: "/webhooks/github", access: PUBLIC },
  { methods: GET, path: "/app.css", access: PUBLIC },
  { methods: GET, path: "/app.js", access: PUBLIC },
  { methods: GET, path: "/htmx.min.js", access: PUBLIC },

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

  { methods: GET, path: "/clients", access: need("delivery.view") },
  { methods: GET, path: "/clients/table", access: need("delivery.view") },
  { methods: GET, path: "/clients/:id", access: need("delivery.view") },
  { methods: GET, path: "/clients/new", access: need("delivery.manage") },
  { methods: GET, path: "/clients/:id/edit", access: need("delivery.manage") },
  { methods: WRITE, path: "/clients", access: need("delivery.manage") },
  { methods: WRITE, path: "/clients/:id", access: need("delivery.manage") },
  { methods: WRITE, path: "/clients/:id/archive", access: need("delivery.manage") },
  { methods: WRITE, path: "/clients/:id/restore", access: need("delivery.manage") },

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

  { methods: WRITE, path: "/employees/:id/compensation", access: need("compensation.manage") },
  {
    methods: WRITE,
    path: "/employees/:id/compensation/:compensationId",
    access: need("compensation.manage"),
  },

  { methods: GET, path: "/people/unmapped", access: need("people.manage") },
  { methods: WRITE, path: "/people/unmapped/suggest", access: need("people.manage") },
  { methods: WRITE, path: "/people/unmapped/map", access: need("people.manage") },
  { methods: WRITE, path: "/people/unmapped/ignore", access: need("people.manage") },
  { methods: WRITE, path: "/people/ignored/:id", access: need("people.manage") },

  { methods: ANY, path: "/payroll", access: need("payroll.manage") },
  { methods: ANY, path: "/payroll/cycles", access: need("payroll.manage") },
  { methods: ANY, path: "/payroll/cycles/:id", access: need("payroll.manage") },
  { methods: ANY, path: "/payroll/cycles/:id/generate", access: need("payroll.manage") },
  { methods: ANY, path: "/payroll/cycles/:id/status", access: need("payroll.manage") },
  { methods: GET, path: "/payroll/cycles/:id/export.csv", access: need("payroll.manage") },
  { methods: WRITE, path: "/payslips/:id", access: need("payroll.manage") },
  { methods: WRITE, path: "/payslips/:id/items", access: need("payroll.manage") },

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

  { methods: GET, path: "/invoices", access: need("invoice.view") },
  { methods: GET, path: "/invoices/aging", access: need("invoice.view") },
  { methods: WRITE, path: "/invoices", access: need("invoice.manage") },
  { methods: WRITE, path: "/invoices/:id", access: need("invoice.manage") },
  { methods: WRITE, path: "/invoices/:id/status", access: need("invoice.manage") },
  { methods: GET, path: "/capacity", access: need("capacity.view") },

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

export function resolveAccess(method: string, path: string): Access | null {
  const candidates = COMPILED.filter(
    (entry) => entry.methods.includes(method) && entry.re.test(path),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => paramCount(a.path) - paramCount(b.path));
  return candidates[0]?.access ?? null;
}

function paramCount(path: string): number {
  return path.split("/").filter((s) => s.startsWith(":")).length;
}

export function declaredRoutes(): Set<string> {
  const out = new Set<string>();
  for (const entry of POLICY) {
    for (const method of entry.methods) out.add(`${method} ${entry.path}`);
  }
  return out;
}
