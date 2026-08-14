export const ROLES = ["owner", "admin", "manager", "member"] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  "code.view",
  "code.manage",
  "delivery.view",
  "delivery.manage",
  "people.view",
  "people.manage",
  "compensation.view",
  "compensation.manage",
  "payslip.viewOwn",
  "payroll.manage",
  "invoice.view",
  "invoice.manage",
  "capacity.view",
  "settings.manage",
  "users.manage",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  "code.view": "View dashboard, commits, repositories and organizations",
  "code.manage": "Add or remove repositories and organizations, trigger syncs",
  "delivery.view": "View clients and projects",
  "delivery.manage": "Create and edit clients and projects, link repositories, staff teams",
  "people.view": "View people and their GitHub identities",
  "people.manage": "Create and edit people, map commit authors",
  "compensation.view": "See salary figures and anyone's payslip",
  "compensation.manage": "Add or remove salary records",
  "payslip.viewOwn": "See their own payslip",
  "payroll.manage": "Run, approve and pay payroll; edit tax slabs",
  "invoice.view": "View invoices and receivables",
  "invoice.manage": "Create invoices and change their status",
  "capacity.view": "View the capacity grid and bench",
  "settings.manage": "Settings, backup, API tokens and the audit log",
  "users.manage": "Create accounts and change roles",
};

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
    "compensation.manage",
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

export const DEFAULT_ROLE: Role = "owner";
