import type { CycleRow, PayslipItemRow, PayslipRow, TaxSlabRow } from "../../db/stores/payroll.ts";
import { fmtMoney } from "../../domain/money.ts";
import { Badge, Card, EmptyState, Field, Money, PageHeader, Table, TextInput, When, btn } from "./ui/kit.tsx";

const CYCLE_TONES: Record<string, "neutral" | "good" | "warn" | "critical"> = {
  draft: "neutral",
  approved: "warn",
  paid: "good",
  cancelled: "critical",
};

export function PayrollPage({
  cycles,
  currency,
  suggestedPeriod,
  message,
}: {
  cycles: CycleRow[];
  currency: string;
  suggestedPeriod: string;
  message?: string | undefined;
}) {
  return (
    <div>
      <PageHeader
        title="Payroll"
        subtitle={`Monthly cycles in ${currency}. A payslip is a document — once approved its figures never change.`}
      />

      {message ? (
        <p class="mb-3 rounded-md border border-hairline bg-surface p-3 text-sm text-status-critical" role="alert">
          {message}
        </p>
      ) : null}

      <Card title="Start a cycle">
        <form hx-post="/payroll/cycles" hx-target="body" hx-swap="outerHTML" class="flex flex-wrap items-end gap-2">
          <div class="w-44">
            <Field name="period_month" label="Period">
              <TextInput name="period_month" value={suggestedPeriod} placeholder="2026-07" required />
            </Field>
          </div>
          <button type="submit" class={btn.primary}>
            Create cycle
          </button>
        </form>
      </Card>

      <h2 class="mb-2 mt-6 text-sm font-semibold text-ink">Cycles</h2>
      {cycles.length === 0 ? (
        <EmptyState
          title="No payroll cycles yet"
          body="Create a cycle for a month, generate the payslips from everyone's compensation, then approve and mark it paid."
        />
      ) : (
        <Table head={["Period", "People", "Gross", "Deductions", "Net", "Status", ""]}>
          {cycles.map((cy) => (
            <tr class="border-t border-hairline">
              <td class="py-2 pr-3">
                <a href={`/payroll/cycles/${cy.id}`} class="text-accent hover:underline">
                  {cy.period_month}
                </a>
              </td>
              <td class="py-2 pr-3 tabular-nums text-ink-2">{cy.payslip_count}</td>
              <td class="py-2 pr-3 text-ink-2">
                <Money minor={cy.gross_minor} currency={cy.currency} />
              </td>
              <td class="py-2 pr-3 text-ink-2">
                <Money minor={cy.deductions_minor} currency={cy.currency} />
              </td>
              <td class="py-2 pr-3 font-medium text-ink">
                <Money minor={cy.net_minor} currency={cy.currency} />
              </td>
              <td class="py-2 pr-3">
                <Badge label={cy.status} tone={CYCLE_TONES[cy.status] ?? "neutral"} />
              </td>
              <td class="whitespace-nowrap py-2 text-right">
                <a href={`/payroll/cycles/${cy.id}`} class={btn.small}>
                  Open
                </a>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

export function CycleDetailPage({
  cycle,
  payslips,
  skipped,
  message,
}: {
  cycle: CycleRow;
  payslips: PayslipRow[];
  skipped?: { name: string; reason: string }[] | undefined;
  message?: string | undefined;
}) {
  const editable = cycle.status === "draft";
  return (
    <div>
      <PageHeader
        title={`Payroll ${cycle.period_month}`}
        subtitle={`${cycle.payslip_count} ${cycle.payslip_count === 1 ? "payslip" : "payslips"} · ${cycle.currency}`}
        actions={
          <>
            <a href={`/payroll/cycles/${cycle.id}/export.csv`} class={btn.secondary}>
              Export CSV
            </a>
            {editable ? (
              <button
                class={btn.secondary}
                hx-post={`/payroll/cycles/${cycle.id}/generate`}
                hx-target="body"
                hx-swap="outerHTML"
                hx-confirm={
                  cycle.payslip_count > 0
                    ? "Regenerate payslips from current compensation? Any manual lines on this cycle will be replaced."
                    : undefined
                }
              >
                {cycle.payslip_count > 0 ? "Regenerate" : "Generate payslips"}
              </button>
            ) : null}
            {cycle.status === "draft" && cycle.payslip_count > 0 ? (
              <button
                class={btn.primary}
                hx-post={`/payroll/cycles/${cycle.id}/status`}
                hx-vals='{"status":"approved"}'
                hx-target="body"
                hx-swap="outerHTML"
                hx-confirm="Approve this cycle? Payslip figures are frozen after this."
              >
                Approve
              </button>
            ) : null}
            {cycle.status === "approved" ? (
              <>
                <button
                  class={btn.secondary}
                  hx-post={`/payroll/cycles/${cycle.id}/status`}
                  hx-vals='{"status":"draft"}'
                  hx-target="body"
                  hx-swap="outerHTML"
                >
                  Reopen
                </button>
                <button
                  class={btn.primary}
                  hx-post={`/payroll/cycles/${cycle.id}/status`}
                  hx-vals='{"status":"paid"}'
                  hx-target="body"
                  hx-swap="outerHTML"
                  hx-confirm="Mark this cycle paid? This is final — later corrections go on the next cycle."
                >
                  Mark paid
                </button>
              </>
            ) : null}
            {editable ? (
              <button
                class={btn.danger}
                hx-delete={`/payroll/cycles/${cycle.id}`}
                hx-target="body"
                hx-swap="outerHTML"
                hx-confirm={`Delete the ${cycle.period_month} cycle and its draft payslips?`}
              >
                Delete
              </button>
            ) : null}
          </>
        }
      />

      {message ? (
        <p class="mb-3 rounded-md border border-hairline bg-surface p-3 text-sm text-status-critical" role="alert">
          {message}
        </p>
      ) : null}

      {skipped && skipped.length > 0 ? (
        <div class="mb-3 rounded-md border border-hairline bg-surface p-3 text-sm">
          <p class="font-medium text-ink">Skipped {skipped.length}</p>
          <ul class="mt-1 space-y-0.5 text-ink-2">
            {skipped.map((s) => (
              <li>
                {s.name} — {s.reason}.{" "}
                <a href="/employees" class="text-accent hover:underline">
                  Fix
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!editable ? (
        <p class="mb-3 rounded-md border border-hairline bg-plane p-3 text-sm text-ink-2">
          This cycle is {cycle.status}. Its payslips are frozen — reopen it to make changes.
        </p>
      ) : null}

      <div class="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ["People", String(cycle.payslip_count)],
          ["Gross", fmtMoney(cycle.gross_minor, cycle.currency)],
          ["Deductions", fmtMoney(cycle.deductions_minor, cycle.currency)],
          ["Net payable", fmtMoney(cycle.net_minor, cycle.currency)],
        ].map(([label, value]) => (
          <div class="rounded-lg border border-hairline bg-surface p-4">
            <div class="text-sm text-ink-2">{label}</div>
            <div class="mt-1 text-xl font-semibold text-ink">{value}</div>
          </div>
        ))}
      </div>

      {payslips.length === 0 ? (
        <EmptyState
          title="No payslips yet"
          body="Generate them from each person's compensation record in force for this month."
        />
      ) : (
        <Table head={["Person", "Base", "Days", "Gross", "Deductions", "Net", ""]}>
          {payslips.map((p) => (
            <tr class="border-t border-hairline">
              <td class="py-2 pr-3">
                <a href={`/payslips/${p.id}`} class="text-accent hover:underline">
                  {p.employee_name}
                </a>
                <span class="ml-2 text-xs text-ink-muted">{p.employee_code}</span>
                {p.status === "excluded" ? <Badge label="excluded" /> : null}
              </td>
              <td class="py-2 pr-3 text-ink-2">
                <Money minor={p.base_monthly_minor} currency={p.currency} />
              </td>
              <td class="py-2 pr-3 tabular-nums text-ink-2">
                {p.payable_days}/{p.period_days}
              </td>
              <td class="py-2 pr-3 text-ink-2">
                <Money minor={p.gross_minor} currency={p.currency} />
              </td>
              <td class="py-2 pr-3 text-ink-2">
                <Money minor={p.deductions_minor} currency={p.currency} />
              </td>
              <td class="py-2 pr-3 font-medium text-ink">
                <Money minor={p.net_minor} currency={p.currency} />
              </td>
              <td class="whitespace-nowrap py-2 text-right">
                <a href={`/payslips/${p.id}`} class={btn.small}>
                  Open
                </a>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

export function PayslipPage({
  payslip,
  items,
  error,
}: {
  payslip: PayslipRow;
  items: PayslipItemRow[];
  error?: string | undefined;
}) {
  const editable = payslip.cycle_status === "draft";
  const proratedBase = Math.round((payslip.base_monthly_minor * payslip.payable_days) / payslip.period_days);
  const blank = { kind: "earning", code: "other", label: "", amount_minor: 0 };
  const rows = editable ? [...items, blank, blank] : items;

  return (
    <div>
      <PageHeader
        title={payslip.employee_name}
        subtitle={`Payslip · ${payslip.period_month} · ${payslip.employee_code}`}
        actions={
          <>
            <a href={`/payslips/${payslip.id}/print`} class={btn.secondary} target="_blank" rel="noopener">
              Print
            </a>
            <a href={`/payroll/cycles/${payslip.cycle_id}`} class={btn.secondary}>
              Back to cycle
            </a>
          </>
        }
      />

      {error ? (
        <p class="mb-3 rounded-md border border-hairline bg-surface p-3 text-sm text-status-critical" role="alert">
          {error}
        </p>
      ) : null}

      {!editable ? (
        <p class="mb-3 rounded-md border border-hairline bg-plane p-3 text-sm text-ink-2">
          This payslip belongs to a {payslip.cycle_status} cycle and is read-only.
        </p>
      ) : null}

      <div class="grid gap-4 lg:grid-cols-3">
        <div class="space-y-4 lg:col-span-2">
          <Card title="Lines" subtitle="Earnings add to gross; deductions come off the net.">
            <form hx-post={`/payslips/${payslip.id}/items`} hx-target="body" hx-swap="outerHTML">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-xs text-ink-2">
                    <th class="py-2 pr-3 font-medium">Type</th>
                    <th class="py-2 pr-3 font-medium">Label</th>
                    <th class="py-2 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr class="border-t border-hairline">
                    <td class="py-2 pr-3 text-ink-2">earning</td>
                    <td class="py-2 pr-3 text-ink">
                      Base salary
                      {payslip.payable_days < payslip.period_days ? (
                        <span class="ml-2 text-xs text-ink-2">
                          pro-rated {payslip.payable_days}/{payslip.period_days}
                        </span>
                      ) : null}
                    </td>
                    <td class="py-2 tabular-nums text-ink">
                      <Money minor={proratedBase} currency={payslip.currency} />
                    </td>
                  </tr>
                  {rows.map((item) => (
                    <tr class="border-t border-hairline">
                      <td class="py-2 pr-3">
                        {editable ? (
                          <select name="item_kind" class="rounded-md border border-hairline bg-surface px-2 py-1 text-xs text-ink">
                            <option value="earning" selected={item.kind === "earning"}>
                              earning
                            </option>
                            <option value="deduction" selected={item.kind === "deduction"}>
                              deduction
                            </option>
                          </select>
                        ) : (
                          <span class="text-ink-2">{item.kind}</span>
                        )}
                      </td>
                      <td class="py-2 pr-3">
                        {editable ? (
                          <>
                            <input type="hidden" name="item_code" value={item.code} />
                            <input
                              type="text"
                              name="item_label"
                              value={item.label}
                              placeholder="Bonus, advance, tax…"
                              aria-label="Line label"
                              class="w-full rounded-md border border-hairline bg-surface px-2 py-1 text-sm text-ink"
                            />
                          </>
                        ) : (
                          <span class="text-ink">{item.label}</span>
                        )}
                      </td>
                      <td class="py-2">
                        {editable ? (
                          <input
                            type="text"
                            name="item_amount"
                            value={item.amount_minor ? (item.amount_minor / 100).toFixed(2) : ""}
                            placeholder="0.00"
                            aria-label="Line amount"
                            class="w-32 rounded-md border border-hairline bg-surface px-2 py-1 text-sm text-ink tabular-nums"
                          />
                        ) : (
                          <span class="tabular-nums text-ink">
                            <Money minor={item.amount_minor} currency={payslip.currency} />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {editable ? (
                <div class="mt-3 flex items-center gap-2">
                  <button type="submit" class={btn.primary}>
                    Save lines
                  </button>
                  <span class="text-xs text-ink-2">Empty rows are ignored. Saving replaces every line.</span>
                </div>
              ) : null}
            </form>
          </Card>
        </div>

        <div class="space-y-4">
          <Card title="Totals">
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between">
                <dt class="text-ink-2">Gross</dt>
                <dd class="tabular-nums text-ink">
                  <Money minor={payslip.gross_minor} currency={payslip.currency} />
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-ink-2">Deductions</dt>
                <dd class="tabular-nums text-ink">
                  <Money minor={payslip.deductions_minor} currency={payslip.currency} />
                </dd>
              </div>
              <div class="flex justify-between border-t border-hairline pt-2">
                <dt class="font-medium text-ink">Net pay</dt>
                <dd class="tabular-nums font-semibold text-ink">
                  <Money minor={payslip.net_minor} currency={payslip.currency} />
                </dd>
              </div>
            </dl>
            {payslip.net_minor < 0 ? (
              <p class="mt-2 text-xs text-status-critical">
                Net is negative — deductions exceed gross this month.
              </p>
            ) : null}
          </Card>

          {editable ? (
            <Card title="Adjust days" subtitle="Unpaid leave is handled by reducing payable days.">
              <form hx-post={`/payslips/${payslip.id}`} hx-target="body" hx-swap="outerHTML" class="space-y-3">
                <Field name="payable_days" label={`Payable days (of ${payslip.period_days})`}>
                  <TextInput
                    name="payable_days"
                    type="number"
                    value={String(payslip.payable_days)}
                    min="0"
                    max={String(payslip.period_days)}
                  />
                </Field>
                <Field name="note" label="Note">
                  <TextInput name="note" value={payslip.note ?? ""} placeholder="2 days unpaid leave" />
                </Field>
                <button type="submit" class={btn.small}>
                  Save
                </button>
              </form>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function PayslipPrint({
  payslip,
  items,
  company,
}: {
  payslip: PayslipRow;
  items: PayslipItemRow[];
  company: string;
}) {
  const proratedBase = Math.round((payslip.base_monthly_minor * payslip.payable_days) / payslip.period_days);
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>{`Payslip ${payslip.period_month} — ${payslip.employee_name}`}</title>
        <link rel="stylesheet" href="/app.css" />
      </head>
      <body class="bg-surface text-ink">
        <main class="mx-auto max-w-2xl px-6 py-10">
          <div class="mb-6 flex items-start justify-between">
            <div>
              <h1 class="text-lg font-semibold">{company}</h1>
              <p class="text-sm text-ink-2">Payslip for {payslip.period_month}</p>
            </div>
            <button class="no-print rounded-md border border-hairline px-3 py-1.5 text-sm" onclick="window.print()">
              Print
            </button>
          </div>

          <dl class="mb-6 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt class="text-xs text-ink-2">Employee</dt>
              <dd>{payslip.employee_name}</dd>
            </div>
            <div>
              <dt class="text-xs text-ink-2">Code</dt>
              <dd>{payslip.employee_code}</dd>
            </div>
            <div>
              <dt class="text-xs text-ink-2">Designation</dt>
              <dd>{payslip.designation ?? "—"}</dd>
            </div>
            <div>
              <dt class="text-xs text-ink-2">Days paid</dt>
              <dd>
                {payslip.payable_days} of {payslip.period_days}
              </dd>
            </div>
          </dl>

          <table class="w-full border-collapse text-sm">
            <thead>
              <tr class="border-b border-hairline text-left">
                <th class="py-2">Description</th>
                <th class="py-2 text-right">Earnings</th>
                <th class="py-2 text-right">Deductions</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b border-hairline">
                <td class="py-2">Base salary</td>
                <td class="py-2 text-right tabular-nums">{fmtMoney(proratedBase, payslip.currency)}</td>
                <td class="py-2 text-right">—</td>
              </tr>
              {items.map((item) => (
                <tr class="border-b border-hairline">
                  <td class="py-2">{item.label}</td>
                  <td class="py-2 text-right tabular-nums">
                    {item.kind === "earning" ? fmtMoney(item.amount_minor, payslip.currency) : "—"}
                  </td>
                  <td class="py-2 text-right tabular-nums">
                    {item.kind === "deduction" ? fmtMoney(item.amount_minor, payslip.currency) : "—"}
                  </td>
                </tr>
              ))}
              <tr class="border-b-2 border-hairline font-medium">
                <td class="py-2">Total</td>
                <td class="py-2 text-right tabular-nums">{fmtMoney(payslip.gross_minor, payslip.currency)}</td>
                <td class="py-2 text-right tabular-nums">{fmtMoney(payslip.deductions_minor, payslip.currency)}</td>
              </tr>
            </tbody>
          </table>

          <p class="mt-6 text-right text-lg font-semibold">
            Net pay: {fmtMoney(payslip.net_minor, payslip.currency)}
          </p>
          {payslip.note ? <p class="mt-4 text-sm text-ink-2">{payslip.note}</p> : null}
          <p class="mt-10 text-xs text-ink-muted">
            Computer generated — no signature required. Generated by GitHub OC Tracker.
          </p>
        </main>
      </body>
    </html>
  );
}

export function TaxSlabsPage({
  slabs,
  fiscalYear,
  years,
  currency,
  error,
}: {
  slabs: TaxSlabRow[];
  fiscalYear: string;
  years: string[];
  currency: string;
  error?: string | undefined;
}) {
  return (
    <div>
      <PageHeader
        title="Tax slabs"
        subtitle="Your brackets, entered by you. With none configured, tax is simply a manual deduction line."
      />

      <p class="mb-4 rounded-md border border-hairline bg-surface p-3 text-sm text-ink-2">
        This is not tax advice. Enter the slabs your accountant gives you — each row means “from this annual
        income, pay the fixed amount plus the rate on the excess above it”. Payroll then computes the monthly
        deduction and pro-rates it.
      </p>

      {error ? (
        <p class="mb-3 rounded-md border border-hairline bg-surface p-3 text-sm text-status-critical" role="alert">
          {error}
        </p>
      ) : null}

      <div class="grid gap-4 lg:grid-cols-3">
        <div class="lg:col-span-2">
          {slabs.length === 0 ? (
            <EmptyState title={`No slabs for ${fiscalYear}`} body="Add the first bracket to switch tax on." />
          ) : (
            <Table head={["Annual income from", "Fixed amount", "Rate on excess", ""]}>
              {slabs.map((s) => (
                <tr class="border-t border-hairline">
                  <td class="py-2 pr-3 tabular-nums text-ink">{fmtMoney(s.lower_annual_minor, currency)}</td>
                  <td class="py-2 pr-3 tabular-nums text-ink-2">{fmtMoney(s.fixed_annual_minor, currency)}</td>
                  <td class="py-2 pr-3 tabular-nums text-ink-2">{(s.rate_bp / 100).toFixed(2)}%</td>
                  <td class="whitespace-nowrap py-2 text-right">
                    <button
                      class={btn.smallDanger}
                      hx-delete={`/settings/tax-slabs/${s.id}`}
                      hx-target="body"
                      hx-swap="outerHTML"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
          {years.length > 1 ? (
            <p class="mt-3 text-xs text-ink-2">
              Other years:{" "}
              {years.map((y) => (
                <a href={`/settings/tax-slabs?year=${y}`} class="mr-2 text-accent hover:underline">
                  {y}
                </a>
              ))}
            </p>
          ) : null}
        </div>

        <Card title="Add a slab">
          <form hx-post="/settings/tax-slabs" hx-target="body" hx-swap="outerHTML" class="space-y-3">
            <Field name="fiscal_year" label="Fiscal year">
              <TextInput name="fiscal_year" value={fiscalYear} required />
            </Field>
            <Field name="lower_annual_minor" label="Annual income from">
              <TextInput name="lower_annual_minor" placeholder="600,000" required />
            </Field>
            <Field name="fixed_annual_minor" label="Fixed amount">
              <TextInput name="fixed_annual_minor" placeholder="0" />
            </Field>
            <Field name="rate_pct" label="Rate on excess (%)">
              <TextInput name="rate_pct" placeholder="5" />
            </Field>
            <button type="submit" class={btn.primary}>
              Add slab
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}
