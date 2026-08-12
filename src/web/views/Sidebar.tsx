import { can, type Capability, type Role } from "../../domain/rbac.ts";
import { Icon, type IconName } from "./components/Icon.tsx";

export type NavKey =
  | "dashboard"
  | "projects"
  | "clients"
  | "employees"
  | "capacity"
  | "payroll"
  | "invoices"
  | "commits"
  | "repos"
  | "orgs"
  | "mapping"
  | "settings";

interface NavItem {
  key: NavKey;
  href: string;
  label: string;
  icon: IconName;
  capability: Capability;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Ordered by how often the owner opens it: delivery work daily, money monthly,
 * the GitHub tooling underneath. Items appear here as their phase ships — a nav
 * link to a route that 404s is worse than no link.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { key: "dashboard", href: "/", label: "Dashboard", icon: "dashboard", capability: "code.view" },
    ],
  },
  {
    label: "Delivery",
    items: [
      { key: "projects", href: "/projects", label: "Projects", icon: "projects", capability: "delivery.view" },
      { key: "clients", href: "/clients", label: "Clients", icon: "clients", capability: "delivery.view" },
      { key: "employees", href: "/employees", label: "People", icon: "people", capability: "people.view" },
      { key: "capacity", href: "/capacity", label: "Capacity", icon: "capacity", capability: "capacity.view" },
    ],
  },
  {
    label: "Money",
    items: [
      { key: "payroll", href: "/payroll", label: "Payroll", icon: "payroll", capability: "payroll.manage" },
      { key: "invoices", href: "/invoices", label: "Invoices", icon: "invoices", capability: "invoice.view" },
    ],
  },
  {
    label: "Code",
    items: [
      { key: "commits", href: "/commits", label: "Commits", icon: "commits", capability: "code.view" },
      { key: "repos", href: "/repos", label: "Repositories", icon: "repos", capability: "code.view" },
      { key: "orgs", href: "/orgs", label: "Organizations", icon: "orgs", capability: "code.view" },
      { key: "mapping", href: "/people/unmapped", label: "Author mapping", icon: "mapping", capability: "people.manage" },
    ],
  },
  {
    label: "System",
    items: [
      { key: "settings", href: "/settings", label: "Settings", icon: "settings", capability: "code.view" },
    ],
  },
];

const ACTIVE = "flex items-center gap-2.5 rounded-md bg-plane px-3 py-2 text-sm font-medium text-ink";
const IDLE =
  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-2 hover:bg-plane hover:text-ink";

export function Sidebar({
  active,
  role,
  principal,
}: {
  active?: NavKey;
  role: Role;
  principal?: { name: string; role: Role } | null;
}) {
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => can(role, item.capability)),
  })).filter((group) => group.items.length > 0);

  return (
    <>
      {/* Mobile bar — the sidebar itself is off-canvas below md. */}
      <header class="flex items-center justify-between border-b border-hairline bg-surface px-4 py-3 md:hidden">
        <a href="/" class="flex items-center gap-2 font-semibold text-ink">
          <span class="inline-flex h-6 w-6 items-center justify-center rounded bg-accent text-xs font-bold text-white">
            OC
          </span>
          OC Tracker
        </a>
        <button
          type="button"
          id="nav-toggle"
          aria-controls="nav"
          aria-expanded="false"
          class="rounded-md px-2 py-2 text-ink-2 hover:bg-plane hover:text-ink"
        >
          <Icon name="menu" class="h-5 w-5" />
          <span class="sr-only">Menu</span>
        </button>
      </header>

      <nav
        id="nav"
        aria-label="Main"
        class="hidden border-b border-hairline bg-surface px-3 pb-4
               md:sticky md:top-0 md:block md:h-screen md:overflow-y-auto
               md:border-b-0 md:border-r md:pb-6 md:pt-4"
      >
        <a href="/" class="mb-2 hidden items-center gap-2 px-3 py-1 font-semibold text-ink md:flex">
          <span class="inline-flex h-6 w-6 items-center justify-center rounded bg-accent text-xs font-bold text-white">
            OC
          </span>
          OC Tracker
        </a>

        {groups.map((group) => (
          <div class="mt-2">
            <p class="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
              {group.label}
            </p>
            {group.items.map((item) => (
              <a
                href={item.href}
                aria-current={item.key === active ? "page" : undefined}
                class={item.key === active ? ACTIVE : IDLE}
              >
                <Icon name={item.icon} class="h-4 w-4 shrink-0 text-ink-muted" />
                {item.label}
              </a>
            ))}
          </div>
        ))}

        {principal ? (
          <div class="mt-4 border-t border-hairline pt-3">
            <div class="px-3 pb-2">
              <p class="truncate text-sm text-ink">{principal.name}</p>
              <p class="text-[11px] uppercase tracking-wide text-ink-muted">{principal.role}</p>
            </div>
            {can(role, "users.manage") ? (
              <a href="/settings/users" class={IDLE}>
                <Icon name="people" class="h-4 w-4 shrink-0 text-ink-muted" />
                Accounts
              </a>
            ) : null}
            {can(role, "settings.manage") ? (
              <a href="/settings/audit" class={IDLE}>
                <Icon name="mapping" class="h-4 w-4 shrink-0 text-ink-muted" />
                Audit log
              </a>
            ) : null}
            <a href="/logout" class={IDLE}>
              <Icon name="close" class="h-4 w-4 shrink-0 text-ink-muted" />
              Sign out
            </a>
          </div>
        ) : null}
      </nav>
    </>
  );
}
