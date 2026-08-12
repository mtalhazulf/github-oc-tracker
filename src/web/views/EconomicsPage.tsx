import type { ClientRow, ProjectRow } from "../../db/store.ts";
import type { AgingBucket, CapacityCell, InvoiceRow } from "../../db/stores/economics.ts";
import type { FieldErrors } from "../../domain/errors.ts";
import { fmtMoney } from "../../domain/money.ts";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  FormError,
  Money,
  PageHeader,
  Select,
  Table,
  TextInput,
  btn,
} from "./ui/kit.tsx";

const STATUS_TONES: Record<string, "neutral" | "good" | "warn" | "critical"> = {
  draft: "neutral",
  sent: "warn",
  paid: "good",
  void: "critical",
};

const BUCKET_LABELS: Record<string, string> = {
  current: "Not yet due",
  "1-30": "1–30 days late",
  "31-60": "31–60 days late",
  "60+": "Over 60 days late",
};

export function InvoicesPage({
  invoices,
  clients,
  projects,
  aging,
  filters,
  errors,
  message,
}: {
  invoices: InvoiceRow[];
  clients: ClientRow[];
  projects: ProjectRow[];
  aging: AgingBucket[];
  filters: { status: string };
  errors: FieldErrors;
  message?: string | undefined;
}) {
  const outstanding = aging.reduce((sum, b) => sum + b.amount_minor, 0);
  const overdue = aging.filter((b) => b.bucket !== "current").reduce((sum, b) => sum + b.amount_minor, 0);
  const currency = aging[0]?.currency ?? clients[0]?.currency ?? "PKR";

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="What has been billed, and what is still owed."
        actions={
          <a href="/invoices/aging" class={btn.secondary}>
            AR aging
          </a>
        }
      />

      <div class="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ["Invoices", String(invoices.length)],
          ["Outstanding", fmtMoney(outstanding, currency)],
          ["Overdue", fmtMoney(overdue, currency)],
          ["Paid", String(invoices.filter((i) => i.status === "paid").length)],
        ].map(([label, value]) => (
          <div class="rounded-lg border border-hairline bg-surface p-4">
            <div class="text-sm text-ink-2">{label}</div>
            <div class="mt-1 text-xl font-semibold text-ink">{value}</div>
          </div>
        ))}
      </div>

      <div class="grid gap-4 lg:grid-cols-3">
        <div class="lg:col-span-2">
          <form
            hx-get="/invoices"
            hx-target="body"
            hx-swap="outerHTML"
            class="mb-3 flex items-center gap-2"
          >
            <select name="status" aria-label="Status" class="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink">
              <option value="">All statuses</option>
              {["draft", "sent", "paid", "void"].map((s) => (
                <option value={s} selected={filters.status === s}>
                  {s}
                </option>
              ))}
            </select>
            <button type="submit" class={btn.small}>
              Filter
            </button>
          </form>

          {invoices.length === 0 ? (
            <EmptyState
              title="No invoices yet"
              body="Raise one against a client to start tracking what you are owed."
            />
          ) : (
            <Table head={["Number", "Client", "Project", "Amount", "Due", "Status", ""]}>
              {invoices.map((inv) => (
                <tr class="border-t border-hairline">
                  <td class="py-2 pr-3 font-mono text-xs text-ink">{inv.number}</td>
                  <td class="py-2 pr-3">
                    <a href={`/clients/${inv.client_id}`} class="text-accent hover:underline">
                      {inv.client_name}
                    </a>
                  </td>
                  <td class="py-2 pr-3 text-ink-2">{inv.project_name ?? "—"}</td>
                  <td class="py-2 pr-3 tabular-nums text-ink">
                    <Money minor={inv.amount_minor} currency={inv.currency} />
                  </td>
                  <td class="whitespace-nowrap py-2 pr-3 tabular-nums text-ink-2">{inv.due_on}</td>
                  <td class="py-2 pr-3">
                    <Badge label={inv.status} tone={STATUS_TONES[inv.status] ?? "neutral"} />
                  </td>
                  <td class="whitespace-nowrap py-2 text-right">
                    {inv.status === "draft" ? (
                      <button
                        class={btn.small}
                        hx-post={`/invoices/${inv.id}/status`}
                        hx-vals='{"status":"sent"}'
                        hx-target="body"
                        hx-swap="outerHTML"
                      >
                        Mark sent
                      </button>
                    ) : null}
                    {inv.status === "sent" ? (
                      <button
                        class={btn.small}
                        hx-post={`/invoices/${inv.id}/status`}
                        hx-vals='{"status":"paid"}'
                        hx-target="body"
                        hx-swap="outerHTML"
                      >
                        Mark paid
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </div>

        <Card title="Raise an invoice">
          <form hx-post="/invoices" hx-target="body" hx-swap="outerHTML" class="space-y-3">
            <FormError message={message} />
            <Field name="number" label="Invoice number" required error={errors.number}>
              <TextInput name="number" error={errors.number} placeholder="NW-2026-07" required />
            </Field>
            <Field name="client_id" label="Client" required error={errors.client_id}>
              <Select
                name="client_id"
                placeholder="Choose…"
                error={errors.client_id}
                options={clients.map((cl) => ({ value: String(cl.id), label: cl.name }))}
              />
            </Field>
            <Field name="project_id" label="Project" error={errors.project_id}>
              <Select
                name="project_id"
                placeholder="No specific project"
                error={errors.project_id}
                options={projects.map((p) => ({ value: String(p.id), label: p.name }))}
              />
            </Field>
            <Field name="amount_minor" label="Amount" required error={errors.amount_minor}>
              <TextInput name="amount_minor" error={errors.amount_minor} placeholder="30,000.00" required />
            </Field>
            <Field name="currency" label="Currency" error={errors.currency}>
              <TextInput name="currency" error={errors.currency} placeholder="USD" />
            </Field>
            <Field name="issued_on" label="Issued" required error={errors.issued_on}>
              <TextInput name="issued_on" type="date" error={errors.issued_on} required />
            </Field>
            <Field name="due_on" label="Due" required error={errors.due_on}>
              <TextInput name="due_on" type="date" error={errors.due_on} required />
            </Field>
            <button type="submit" class={btn.primary}>
              Create draft
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}

export function AgingPage({ aging, today }: { aging: AgingBucket[]; today: string }) {
  const byCurrency = new Map<string, AgingBucket[]>();
  for (const bucket of aging) {
    const list = byCurrency.get(bucket.currency) ?? [];
    list.push(bucket);
    byCurrency.set(bucket.currency, list);
  }
  const order = ["current", "1-30", "31-60", "60+"];

  return (
    <div>
      <PageHeader
        title="Accounts receivable"
        subtitle={`Unpaid invoices marked sent, as at ${today}. Grouped by currency — never summed across them.`}
        actions={
          <a href="/invoices" class={btn.secondary}>
            All invoices
          </a>
        }
      />
      {byCurrency.size === 0 ? (
        <EmptyState title="Nothing outstanding" body="Every invoice you have sent has been paid or voided." />
      ) : (
        [...byCurrency.entries()].map(([currency, buckets]) => {
          const total = buckets.reduce((sum, b) => sum + b.amount_minor, 0);
          return (
            <Card title={currency} subtitle={`${fmtMoney(total, currency)} outstanding`}>
              <Table head={["Bucket", "Invoices", "Amount", ""]}>
                {order
                  .map((name) => buckets.find((b) => b.bucket === name))
                  .filter((b): b is AgingBucket => b !== undefined)
                  .map((b) => (
                    <tr class="border-t border-hairline">
                      <td class="py-2 pr-3">
                        <span class={b.bucket === "60+" ? "text-status-critical" : "text-ink"}>
                          {BUCKET_LABELS[b.bucket] ?? b.bucket}
                        </span>
                      </td>
                      <td class="py-2 pr-3 tabular-nums text-ink-2">{b.n}</td>
                      <td class="py-2 pr-3 tabular-nums text-ink">
                        <Money minor={b.amount_minor} currency={b.currency} />
                      </td>
                      <td class="py-2 text-right">
                        <span
                          class={`inline-block h-2 rounded-full ${b.bucket === "60+" ? "bg-status-critical" : "bg-accent"}`}
                          style={`width: ${Math.max(4, Math.round((b.amount_minor / Math.max(1, total)) * 120))}px`}
                        ></span>
                      </td>
                    </tr>
                  ))}
              </Table>
            </Card>
          );
        })
      )}
    </div>
  );
}

export function CapacityPage({
  cells,
  monday,
  benchPct,
  bench,
}: {
  cells: CapacityCell[];
  monday: string;
  benchPct: number;
  bench: { id: number; full_name: string; pct: number }[];
}) {
  const people = new Map<number, { name: string; weeks: number[] }>();
  for (const cell of cells) {
    const entry = people.get(cell.id) ?? { name: cell.full_name, weeks: Array(8).fill(0) };
    entry.weeks[cell.week] = cell.pct;
    people.set(cell.id, entry);
  }

  const weekLabel = (n: number): string => {
    const d = new Date(`${monday}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n * 7);
    return d.toISOString().slice(5, 10);
  };

  const tone = (pct: number): string => {
    if (pct === 0) return "bg-plane text-ink-muted";
    if (pct > 100) return "bg-status-critical/15 text-status-critical";
    if (pct >= 100) return "bg-accent/20 text-ink";
    return "bg-accent/10 text-ink-2";
  };

  return (
    <div>
      <PageHeader
        title="Capacity"
        subtitle={`Eight weeks from ${monday}. Over 100% is over-committed; under is sellable time.`}
      />

      <div class="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div class="rounded-lg border border-hairline bg-surface p-4">
          <div class="text-sm text-ink-2">Bench today</div>
          <div class="mt-1 text-2xl font-semibold text-ink">{benchPct}%</div>
          <div class="mt-1 text-xs text-ink-2">Share of the team's time not booked</div>
        </div>
        <div class="rounded-lg border border-hairline bg-surface p-4">
          <div class="text-sm text-ink-2">People with free time</div>
          <div class="mt-1 text-2xl font-semibold text-ink">{bench.length}</div>
        </div>
      </div>

      {people.size === 0 ? (
        <EmptyState
          title="Nobody to plan yet"
          body="Add people and allocate them to projects to see the next eight weeks."
        />
      ) : (
        <div class="overflow-x-auto rounded-lg border border-hairline bg-surface p-4" tabindex={0}>
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs text-ink-2">
                <th class="py-2 pr-3 font-medium">Person</th>
                {Array.from({ length: 8 }, (_, n) => (
                  <th class="px-1 py-2 text-center font-medium tabular-nums">{weekLabel(n)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...people.entries()].map(([id, person]) => (
                <tr class="border-t border-hairline">
                  <td class="py-1.5 pr-3">
                    <a href={`/employees/${id}`} class="text-accent hover:underline">
                      {person.name}
                    </a>
                  </td>
                  {person.weeks.map((pct) => (
                    <td class="px-1 py-1.5">
                      <div class={`rounded px-1 py-1 text-center text-xs tabular-nums ${tone(pct)}`}>
                        {pct === 0 ? "—" : `${pct}%`}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bench.length > 0 ? (
        <Card title="Available now" subtitle="Who has room this week — the list to sell against">
          <ul class="space-y-1.5 text-sm">
            {bench.map((b) => (
              <li class="flex items-center gap-2">
                <a href={`/employees/${b.id}`} class="text-accent hover:underline">
                  {b.full_name}
                </a>
                <span class="ml-auto tabular-nums text-ink-2">{100 - b.pct}% free</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/** Project economics panel, embedded on project detail. */
export function ProjectPnl({
  pnl,
  period,
}: {
  pnl: {
    currency: string;
    budgetMinor: number | null;
    invoicedMinor: number;
    collectedMinor: number;
    costMinor: number;
    costCurrency: string | null;
    marginMinor: number | null;
    marginPct: number | null;
  };
  period: string;
}) {
  const overBudget = pnl.budgetMinor !== null && pnl.invoicedMinor > pnl.budgetMinor;
  return (
    <Card title="Economics" subtitle={`Revenue to date; cost from final payslips for ${period}`}>
      <dl class="space-y-2 text-sm">
        <div class="flex justify-between">
          <dt class="text-ink-2">Budget</dt>
          <dd class="tabular-nums text-ink">
            {pnl.budgetMinor === null ? "—" : <Money minor={pnl.budgetMinor} currency={pnl.currency} />}
          </dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-ink-2">Invoiced</dt>
          <dd class={`tabular-nums ${overBudget ? "text-status-critical" : "text-ink"}`}>
            <Money minor={pnl.invoicedMinor} currency={pnl.currency} />
          </dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-ink-2">Collected</dt>
          <dd class="tabular-nums text-ink">
            <Money minor={pnl.collectedMinor} currency={pnl.currency} />
          </dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-ink-2">Payroll cost ({period})</dt>
          <dd class="tabular-nums text-ink">
            {pnl.costCurrency === null ? "—" : <Money minor={pnl.costMinor} currency={pnl.costCurrency} />}
          </dd>
        </div>
        <div class="flex justify-between border-t border-hairline pt-2">
          <dt class="font-medium text-ink">Margin</dt>
          <dd class="tabular-nums font-semibold text-ink">
            {pnl.costCurrency === null ? (
              // Cost of 0 is almost never true — it means payroll for this
              // period has not been finalised. Reporting a 100% margin from a
              // missing number would be worse than reporting nothing.
              <span class="text-xs font-normal text-ink-2">Approve {period} payroll to see margin</span>
            ) : pnl.marginMinor === null ? (
              <span class="text-xs font-normal text-ink-2">
                {pnl.costCurrency} cost vs {pnl.currency} revenue — not converted
              </span>
            ) : (
              <>
                <Money minor={pnl.marginMinor} currency={pnl.currency} />
                {pnl.marginPct !== null ? <span class="ml-1 text-xs text-ink-2">({pnl.marginPct}%)</span> : null}
              </>
            )}
          </dd>
        </div>
      </dl>
      {overBudget ? (
        <p class="mt-2 text-xs text-status-critical">Invoiced above the agreed budget.</p>
      ) : null}
    </Card>
  );
}
