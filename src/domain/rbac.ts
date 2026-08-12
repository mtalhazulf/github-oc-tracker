/**
 * Role-based access control. A frozen lookup table, no library.
 *
 * Enforced in two places, and both are required: the sidebar hides items a role
 * cannot use, and every route calls `requireCap()` before doing work. Hiding a
 * link is not access control.
 */

export const ROLES = ["owner", "admin", "manager", "member"] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  "code.view", // dashboard, commits, repositories, organizations
  "code.manage", // add/remove repos & orgs, trigger sync, GitHub App settings
  "delivery.view", // clients & projects
  "delivery.manage", // create/edit clients & projects, link repos
  "people.view", // employee profiles & identities
  "people.manage", // create/edit employees, map identities
  "compensation.view", // salary figures and anyone's payslip
  "payslip.viewOwn", // one's own payslip only
  "payroll.manage", // generate/approve/pay cycles, edit tax slabs
  "invoice.view",
  "invoice.manage",
  "capacity.view", // capacity grid & bench
  "settings.manage", // settings, backup, API tokens, audit log
  "users.manage", // create users, change roles
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const MATRIX: Readonly<Record<Role, ReadonlySet<Capability>>> = Object.freeze({
  owner: new Set<Capability>(CAPABILITIES),
  admin: new Set<Capability>([
    "code.view",
    "code.manage",
    "delivery.view",
    "delivery.manage",
    "people.view",
    "people.manage",
    "compensation.view",
    "payslip.viewOwn",
    "payroll.manage",
    "invoice.view",
    "invoice.manage",
    "capacity.view",
    "settings.manage",
  ]),
  manager: new Set<Capability>([
    "code.view",
    "code.manage",
    "delivery.view",
    "delivery.manage",
    "people.view",
    "people.manage",
    "payslip.viewOwn",
    "invoice.view",
    "capacity.view",
  ]),
  member: new Set<Capability>(["code.view", "delivery.view", "people.view", "payslip.viewOwn"]),
});

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, capability: Capability): boolean {
  return MATRIX[role].has(capability);
}

/**
 * Until accounts land (Phase 3) there is no session, so the app runs as owner.
 * Centralised here so the switch-over is one line rather than a search.
 */
export const DEFAULT_ROLE: Role = "owner";
