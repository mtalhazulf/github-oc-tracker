import type { CompensationRow, EmployeeRow, IdentityRow, UnmappedAuthor } from "../../db/store.ts";
import type { ContributionRow } from "../../db/store.ts";
import type { FieldErrors } from "../../domain/errors.ts";
import { firstLine, shortSha, timeAgo } from "../format.ts";
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
  When,
  btn,
  inputCls,
} from "./ui/kit.tsx";

const EMPLOYMENT_LABELS: Record<string, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  intern: "Intern",
};

const STATUS_TONES: Record<string, "neutral" | "good" | "warn" | "critical"> = {
  active: "good",
  on_leave: "warn",
  notice: "warn",
  exited: "critical",
};

function statusLabel(status: string): string {
  return status.replace("_", " ");
}

export function EmployeesPage({
  employees,
  departments,
  filters,
  unmappedCount,
}: {
  employees: EmployeeRow[];
  departments: string[];
  filters: { status: string; department: string; q: string; archived: boolean };
  unmappedCount: number;
}) {
  return (
    <div>
      <PageHeader
        title="People"
        subtitle={`${employees.length} ${employees.length === 1 ? "person" : "people"}`}
        actions={
          <>
            {unmappedCount > 0 ? (
              <a href="/people/unmapped" class={btn.secondary}>
                {unmappedCount} unmapped {unmappedCount === 1 ? "author" : "authors"}
              </a>
            ) : null}
            <a href="/employees/new" class={btn.primary}>
              Add person
            </a>
          </>
        }
      />

      <form
        hx-get="/employees/table"
        hx-target="#employees-table"
        hx-swap="outerHTML"
        hx-trigger="change, submit, keyup changed delay:400ms from:input"
        class="mb-4 flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="f" value="1" />
        <input
          type="search"
          name="q"
          value={filters.q}
          placeholder="Search name, code, email"
          aria-label="Search people"
          class="w-56 rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted"
        />
        <select name="status" aria-label="Status" class="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink">
          <option value="">All statuses</option>
          {["active", "on_leave", "notice", "exited"].map((s) => (
            <option value={s} selected={filters.status === s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <select name="department" aria-label="Department" class="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink">
          <option value="">All departments</option>
          {departments.map((d) => (
            <option value={d} selected={filters.department === d}>
              {d}
            </option>
          ))}
        </select>
        <label class="flex items-center gap-1.5 py-2 text-sm text-ink-2">
          <input type="checkbox" name="archived" value="1" checked={filters.archived} />
          Show archived
        </label>
        <a href="/employees" class={btn.small}>
          Reset
        </a>
      </form>

      <EmployeesTable employees={employees} />
    </div>
  );
}

export function EmployeesTable({ employees }: { employees: EmployeeRow[] }) {
  if (employees.length === 0) {
    return (
      <div id="employees-table">
        <EmptyState
          title="No people yet"
          body="Add your team so commits can be attributed to real people, and payroll has someone to pay."
          action={
            <a href="/employees/new" class={btn.primary}>
              Add the first person
            </a>
          }
        />
      </div>
    );
  }
  return (
    <div id="employees-table">
      <Table head={["Name", "Role", "Department", "Type", "Joined", "Commits", "Status", ""]}>
        {employees.map((e) => (
          <tr class="border-t border-hairline">
            <td class="py-2 pr-3">
              <a href={`/employees/${e.id}`} class="flex items-center gap-2 text-accent hover:underline">
                {e.avatar_url ? (
                  <img src={e.avatar_url} alt="" width="24" height="24" class="rounded-full" loading="lazy" />
                ) : (
                  <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-plane text-[10px] text-ink-2">
                    {e.full_name.slice(0, 2).toUpperCase()}
                  </span>
                )}
                {e.full_name}
              </a>
              {e.archived_at !== null ? <Badge label="archived" /> : null}
            </td>
            <td class="py-2 pr-3 text-ink-2">{e.designation ?? "—"}</td>
            <td class="py-2 pr-3 text-ink-2">{e.department ?? "—"}</td>
            <td class="py-2 pr-3 text-ink-2">{EMPLOYMENT_LABELS[e.employment_type] ?? e.employment_type}</td>
            <td class="whitespace-nowrap py-2 pr-3 text-ink-2 tabular-nums">{e.joined_on}</td>
            <td class="py-2 pr-3 text-ink-2 tabular-nums">{e.commit_count.toLocaleString("en-US")}</td>
            <td class="py-2 pr-3">
              <Badge label={statusLabel(e.status)} tone={STATUS_TONES[e.status] ?? "neutral"} />
            </td>
            <td class="whitespace-nowrap py-2 text-right">
              <a href={`/employees/${e.id}/edit`} class={btn.small}>
                Edit
              </a>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

export function EmployeeForm({
  employee,
  values,
  errors,
  message,
}: {
  employee?: EmployeeRow | undefined;
  values: Record<string, string>;
  errors: FieldErrors;
  message?: string | undefined;
}) {
  const editing = employee !== undefined;
  const action = editing ? `/employees/${employee.id}` : "/employees";
  return (
    <div>
      <PageHeader
        title={editing ? `Edit ${employee.full_name}` : "Add person"}
        subtitle={editing ? employee.code : "A new team member"}
        actions={
          <a href={editing ? `/employees/${employee.id}` : "/employees"} class={btn.secondary}>
            Cancel
          </a>
        }
      />
      <form hx-post={action} hx-target="#employee-form" hx-swap="outerHTML" id="employee-form">
        <FormError message={message} />
        <Card>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field name="full_name" label="Full name" required error={errors.full_name}>
              <TextInput name="full_name" value={values.full_name} error={errors.full_name} required />
            </Field>
            <Field name="code" label="Employee code" required error={errors.code} hint="Short unique id, e.g. EMP-001">
              <TextInput name="code" value={values.code} error={errors.code} required />
            </Field>
            <Field name="work_email" label="Work email" error={errors.work_email} hint="Also mapped as a commit identity">
              <TextInput name="work_email" type="email" value={values.work_email} error={errors.work_email} />
            </Field>
            <Field name="phone" label="Phone" error={errors.phone}>
              <TextInput name="phone" value={values.phone} error={errors.phone} />
            </Field>
            <Field name="designation" label="Designation" error={errors.designation}>
              <TextInput name="designation" value={values.designation} error={errors.designation} placeholder="Senior Engineer" />
            </Field>
            <Field name="department" label="Department" error={errors.department}>
              <TextInput name="department" value={values.department} error={errors.department} placeholder="Engineering" />
            </Field>
            <Field name="employment_type" label="Employment type" error={errors.employment_type}>
              <Select
                name="employment_type"
                value={values.employment_type}
                error={errors.employment_type}
                options={Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field name="status" label="Status" error={errors.status}>
              <Select
                name="status"
                value={values.status}
                error={errors.status}
                options={["active", "on_leave", "notice", "exited"].map((s) => ({ value: s, label: statusLabel(s) }))}
              />
            </Field>
            <Field name="joined_on" label="Join date" required error={errors.joined_on}>
              <TextInput name="joined_on" type="date" value={values.joined_on} error={errors.joined_on} required />
            </Field>
            <Field name="exited_on" label="Exit date" error={errors.exited_on} hint="Leave empty while they are with you">
              <TextInput name="exited_on" type="date" value={values.exited_on} error={errors.exited_on} />
            </Field>
            <Field name="notes" label="Notes" error={errors.notes} wide>
              <textarea id="notes" name="notes" rows={3} class={inputCls}>
                {values.notes ?? ""}
              </textarea>
            </Field>
          </div>
          <div class="mt-4 flex items-center gap-2">
            <button type="submit" class={btn.primary}>
              {editing ? "Save changes" : "Add person"}
            </button>
            <span class="htmx-indicator text-xs text-ink-2" role="status">
              Saving…
            </span>
          </div>
        </Card>
      </form>
    </div>
  );
}

export function IdentityPanel({
  employee,
  identities,
  error,
}: {
  employee: EmployeeRow;
  identities: IdentityRow[];
  error?: string | undefined;
}) {
  return (
    <div id="identity-panel">
      <Card
        title="GitHub identities"
        subtitle="Commits are attributed by GitHub username and by the email in the commit itself."
      >
        {error ? (
          <p class="mb-3 rounded-md bg-plane p-2 text-xs text-status-critical" role="alert">
            {error}
          </p>
        ) : null}
        {identities.length === 0 ? (
          <p class="mb-3 text-sm text-ink-2">
            No identities yet — this person's commits are not being counted.
          </p>
        ) : (
          <ul class="mb-3 space-y-1.5">
            {identities.map((i) => (
              <li class="flex items-center gap-2 text-sm">
                <Badge label={i.kind} />
                <span class="font-mono text-xs text-ink">{i.value}</span>
                {i.source !== "manual" ? <Badge label={i.source} /> : null}
                <button
                  class="ml-auto rounded-md border border-hairline px-2 py-1 text-[11px] text-status-critical"
                  hx-delete={`/employees/${employee.id}/identities/${i.id}`}
                  hx-target="#identity-panel"
                  hx-swap="outerHTML"
                  hx-confirm={`Unmap ${i.value} from ${employee.full_name}?`}
                >
                  Unmap
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          hx-post={`/employees/${employee.id}/identities`}
          hx-target="#identity-panel"
          hx-swap="outerHTML"
          class="flex flex-wrap items-center gap-2"
        >
          <select name="kind" aria-label="Identity type" class="rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm text-ink">
            <option value="login">GitHub username</option>
            <option value="email">Commit email</option>
          </select>
          <input
            type="text"
            name="value"
            required
            placeholder="ayeshak or ayesha@house.pk"
            aria-label="Identity value"
            class="w-56 rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted"
          />
          <button type="submit" class={btn.small}>
            Map
          </button>
        </form>
      </Card>
    </div>
  );
}

export function EmployeeDetailPage({
  employee,
  identities,
  compensation,
  contribution,
  commits,
  canSeeMoney,
}: {
  employee: EmployeeRow;
  identities: IdentityRow[];
  compensation: CompensationRow[];
  contribution: ContributionRow[];
  commits: { sha: string; message: string; author_ts: number; html_url: string | null; repo_full_name: string }[];
  canSeeMoney: boolean;
}) {
  return (
    <div>
      <PageHeader
        title={employee.full_name}
        subtitle={[employee.designation, employee.department].filter(Boolean).join(" · ") || employee.code}
        actions={
          <>
            <a href={`/employees/${employee.id}/edit`} class={btn.secondary}>
              Edit
            </a>
            {employee.archived_at === null ? (
              <button
                class={btn.danger}
                hx-post={`/employees/${employee.id}/archive`}
                hx-confirm={`Archive ${employee.full_name}? Their history and payslips are kept.`}
              >
                Archive
              </button>
            ) : (
              <button class={btn.secondary} hx-post={`/employees/${employee.id}/restore`}>
                Restore
              </button>
            )}
          </>
        }
      />

      <div class="grid gap-4 lg:grid-cols-3">
        <div class="space-y-4 lg:col-span-2">
          <Card title="Profile">
            <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              {[
                ["Code", employee.code],
                ["Status", statusLabel(employee.status)],
                ["Type", EMPLOYMENT_LABELS[employee.employment_type] ?? employee.employment_type],
                ["Joined", employee.joined_on],
                ["Exited", employee.exited_on ?? "—"],
                ["Work email", employee.work_email ?? "—"],
                ["Phone", employee.phone ?? "—"],
                ["Commits", employee.commit_count.toLocaleString("en-US")],
              ].map(([label, value]) => (
                <div>
                  <dt class="text-xs text-ink-2">{label}</dt>
                  <dd class="text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            {employee.notes ? <p class="mt-3 whitespace-pre-line text-sm text-ink-2">{employee.notes}</p> : null}
          </Card>

          <Card title="Contribution" subtitle="Commits attributed to this person in the last 12 months">
            {contribution.length === 0 ? (
              <p class="text-sm text-ink-2">
                No commits attributed yet. Map a GitHub username or commit email to start counting.
              </p>
            ) : (
              <ul class="space-y-1.5 text-sm">
                {contribution.map((row) => (
                  <li class="flex items-center gap-2">
                    <span class="text-ink">
                      {row.project_name ?? <span class="text-ink-2">Not linked to a project</span>}
                    </span>
                    <span class="ml-auto tabular-nums text-ink-2">{row.commits.toLocaleString("en-US")}</span>
                    <span class="w-20 text-right text-xs text-ink-muted">{timeAgo(row.last_ts)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent commits">
            {commits.length === 0 ? (
              <p class="text-sm text-ink-2">Nothing yet.</p>
            ) : (
              <ul class="space-y-2 text-sm">
                {commits.map((c) => (
                  <li>
                    <div class="flex items-baseline gap-2">
                      {c.html_url ? (
                        <a href={c.html_url} target="_blank" rel="noopener" class="font-mono text-xs text-accent hover:underline">
                          {shortSha(c.sha)}
                        </a>
                      ) : (
                        <span class="font-mono text-xs text-ink-muted">{shortSha(c.sha)}</span>
                      )}
                      <span class="truncate text-ink">{firstLine(c.message)}</span>
                    </div>
                    <div class="mt-0.5 text-xs text-ink-2">
                      {c.repo_full_name} · <When ts={c.author_ts} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div class="space-y-4">
          <IdentityPanel employee={employee} identities={identities} />

          {canSeeMoney ? (
            <div id="compensation-panel">
              <CompensationPanel employee={employee} compensation={compensation} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function CompensationPanel({
  employee,
  compensation,
  error,
}: {
  employee: EmployeeRow;
  compensation: CompensationRow[];
  error?: string | undefined;
}) {
  return (
    <Card title="Compensation" subtitle="Effective-dated. Payroll uses the record in force for the period.">
      {error ? (
        <p class="mb-3 rounded-md bg-plane p-2 text-xs text-status-critical" role="alert">
          {error}
        </p>
      ) : null}
      {compensation.length === 0 ? (
        <p class="mb-3 text-sm text-ink-2">No salary on file — payroll will skip this person.</p>
      ) : (
        <ul class="mb-3 space-y-1.5 text-sm">
          {compensation.map((row, index) => (
            <li class="flex items-center gap-2">
              <span class="tabular-nums text-ink">
                <Money minor={row.base_monthly_minor} currency={row.currency} />
              </span>
              <span class="text-xs text-ink-2">from {row.effective_from}</span>
              {index === 0 ? <Badge label="current" tone="good" /> : null}
              <button
                class="ml-auto rounded-md border border-hairline px-2 py-1 text-[11px] text-status-critical"
                hx-delete={`/employees/${employee.id}/compensation/${row.id}`}
                hx-target="#compensation-panel"
                hx-swap="innerHTML"
                hx-confirm="Remove this salary record?"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        hx-post={`/employees/${employee.id}/compensation`}
        hx-target="#compensation-panel"
        hx-swap="innerHTML"
        class="grid grid-cols-2 gap-2"
      >
        <Field name="base_monthly_minor" label="Monthly salary">
          <TextInput name="base_monthly_minor" placeholder="300,000" required />
        </Field>
        <Field name="effective_from" label="Effective from">
          <TextInput name="effective_from" type="date" required />
        </Field>
        <div class="col-span-2">
          <button type="submit" class={btn.small}>
            Add salary record
          </button>
        </div>
      </form>
    </Card>
  );
}

export function UnmappedAuthorsPage({
  authors,
  employees,
  ignored,
  suggested,
}: {
  authors: UnmappedAuthor[];
  employees: EmployeeRow[];
  ignored: { id: number; kind: string; value: string; note: string | null }[];
  suggested?: number | undefined;
}) {
  return (
    <div>
      <PageHeader
        title="Author mapping"
        subtitle="Commit authors not yet linked to a person. Map them, or ignore bots and outside contributors."
        actions={
          <button class={btn.secondary} hx-post="/people/unmapped/suggest" hx-target="body" hx-swap="outerHTML">
            Suggest matches
          </button>
        }
      />

      {suggested !== undefined ? (
        <p class="mb-3 rounded-md border border-hairline bg-surface p-3 text-sm text-ink-2" role="status">
          {suggested === 0
            ? "No new matches found — the remaining authors need mapping by hand."
            : `Mapped ${suggested} ${suggested === 1 ? "author" : "authors"} automatically.`}
        </p>
      ) : null}

      {authors.length === 0 ? (
        <EmptyState
          title="Everyone is mapped"
          body="Every commit author in the last 12 months is either linked to a person or on the ignore list."
          action={
            <a href="/employees" class={btn.secondary}>
              Back to people
            </a>
          }
        />
      ) : (
        <Table head={["Author", "Email", "Commits", "Last seen", "Map to", ""]}>
          {authors.map((a) => (
            <tr class="border-t border-hairline" id={`author-${encodeURIComponent(a.author)}`}>
              <td class="py-2 pr-3">
                <span class="flex items-center gap-2">
                  {a.avatar ? (
                    <img src={a.avatar} alt="" width="24" height="24" class="rounded-full" loading="lazy" />
                  ) : null}
                  <span class="text-ink">{a.login ?? a.author}</span>
                </span>
              </td>
              <td class="py-2 pr-3 font-mono text-xs text-ink-2">{a.email ?? "—"}</td>
              <td class="py-2 pr-3 tabular-nums text-ink-2">{a.n.toLocaleString("en-US")}</td>
              <td class="py-2 pr-3 text-ink-2">
                <When ts={a.last_ts} />
              </td>
              <td class="py-2 pr-3">
                <form hx-post="/people/unmapped/map" hx-target="body" hx-swap="outerHTML" class="flex items-center gap-1">
                  <input type="hidden" name="login" value={a.login ?? ""} />
                  <input type="hidden" name="email" value={a.email ?? ""} />
                  <select name="employee_id" aria-label={`Map ${a.author} to`} class="rounded-md border border-hairline bg-surface px-2 py-1 text-xs text-ink">
                    <option value="">Choose…</option>
                    {employees.map((e) => (
                      <option value={String(e.id)}>{e.full_name}</option>
                    ))}
                  </select>
                  <button type="submit" class={btn.small}>
                    Map
                  </button>
                </form>
              </td>
              <td class="whitespace-nowrap py-2 text-right">
                <form hx-post="/people/unmapped/ignore" hx-target="body" hx-swap="outerHTML" class="inline">
                  <input type="hidden" name="login" value={a.login ?? ""} />
                  <input type="hidden" name="email" value={a.email ?? ""} />
                  <button type="submit" class={btn.small}>
                    Ignore
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <h2 class="mb-2 mt-8 text-sm font-semibold text-ink">Ignored authors</h2>
      <Table head={["Type", "Value", "Note", ""]}>
        {ignored.map((row) => (
          <tr class="border-t border-hairline">
            <td class="py-2 pr-3">
              <Badge label={row.kind} />
            </td>
            <td class="py-2 pr-3 font-mono text-xs text-ink">{row.value}</td>
            <td class="py-2 pr-3 text-ink-2">{row.note ?? "—"}</td>
            <td class="whitespace-nowrap py-2 text-right">
              <button
                class={btn.small}
                hx-delete={`/people/ignored/${row.id}`}
                hx-target="body"
                hx-swap="outerHTML"
              >
                Remove
              </button>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
