import { CAPABILITIES, CAPABILITY_LABELS, ROLES, can, type Role } from "../../domain/rbac.ts";
import { POLICY } from "../policy.ts";
import { Card, PageHeader, Table } from "./ui/kit.tsx";

const ROLE_SUMMARY: Record<Role, string> = {
  owner: "Everything, and the only role that can manage accounts.",
  admin: "Everything except managing accounts — including salaries and payroll.",
  manager: "Runs delivery and people. Sees no salaries, no payroll, no settings.",
  member: "Read-only across delivery and people, plus their own payslip.",
};

function routeCount(capability: string): number {
  return POLICY.filter((e) => e.access.kind === "capability" && e.access.capability === capability).reduce(
    (sum, e) => sum + e.methods.length,
    0,
  );
}

export function RolesPage({ current }: { current: Role }) {
  return (
    <div class="space-y-4">
      <PageHeader
        title="Roles and permissions"
        subtitle="What each role can do. Enforced on every request, not just hidden in the menu."
      />

      <Card title="The roles">
        <ul class="space-y-2 text-sm">
          {ROLES.map((role) => (
            <li class="flex flex-wrap items-baseline gap-2">
              <span class="font-medium text-ink">{role}</span>
              {role === current ? (
                <span class="rounded-full bg-plane px-2 py-0.5 text-[11px] text-up">you</span>
              ) : null}
              <span class="text-ink-2">{ROLE_SUMMARY[role]}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Permission matrix"
        subtitle="A capability gates every route that needs it — the count shows how many. “in-page” means it gates a panel or a single record instead."
      >
        <Table head={["Capability", "What it allows", ...ROLES.map((r) => r), "Routes"]}>
          {CAPABILITIES.map((capability) => (
            <tr class="border-t border-hairline">
              <td class="whitespace-nowrap py-2 pr-3 font-mono text-xs text-ink">{capability}</td>
              <td class="py-2 pr-3 text-ink-2">{CAPABILITY_LABELS[capability]}</td>
              {ROLES.map((role) => (
                <td class="py-2 pr-3 text-center">
                  {can(role, capability) ? (
                    <span class="text-up" title={`${role} can`}>
                      ✓<span class="sr-only"> {role} can</span>
                    </span>
                  ) : (
                    <span class="text-ink-muted" title={`${role} cannot`}>
                      —<span class="sr-only"> {role} cannot</span>
                    </span>
                  )}
                </td>
              ))}
              <td class="py-2 text-right tabular-nums text-ink-2">
                {routeCount(capability) > 0 ? (
                  routeCount(capability)
                ) : (
                  <span
                    class="text-xs text-ink-muted"
                    title="Gates fields and individual records rather than whole routes"
                  >
                    in-page
                  </span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="How it is enforced">
        <ul class="space-y-2 text-sm text-ink-2">
          <li>
            <span class="font-medium text-ink">One gate, deny by default.</span> Every request resolves
            against a single policy table. A route with no entry is refused, so a new endpoint is
            unreachable until someone declares who may call it.
          </li>
          <li>
            <span class="font-medium text-ink">Reads and writes differ.</span> Viewing a person needs{" "}
            <code>people.view</code>; editing one needs <code>people.manage</code>; changing their salary
            needs <code>compensation.manage</code>.
          </li>
          <li>
            <span class="font-medium text-ink">The API obeys the same table.</span> A token inherits its
            user's role, and a token with no user acts as admin — never owner.
          </li>
          <li>
            <span class="font-medium text-ink">Hidden buttons are not the control.</span> The menu and
            actions are filtered for tidiness; the server refuses regardless.
          </li>
        </ul>
      </Card>
    </div>
  );
}
