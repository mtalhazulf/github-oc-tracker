import type {
  AssignmentRow,
  ClientRow,
  EmployeeRow,
  ProjectRepoRow,
  ProjectRow,
} from "../../db/store.ts";
import type { FieldErrors } from "../../domain/errors.ts";
import { firstLine, shortSha } from "../format.ts";
import { ColumnChart } from "./components/ColumnChart.tsx";
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

const KIND_LABELS: Record<string, string> = {
  client: "Client project",
  internal_product: "Internal product",
  internal_ops: "Internal ops",
};

const BILLING_LABELS: Record<string, string> = {
  fixed_price: "Fixed price",
  time_materials: "Time & materials",
  retainer: "Retainer",
  none: "Not billed",
};

const STATUS_TONES: Record<string, "neutral" | "good" | "warn" | "critical"> = {
  discovery: "neutral",
  active: "good",
  paused: "warn",
  completed: "neutral",
  cancelled: "critical",
};

const STATUSES = ["discovery", "active", "paused", "completed", "cancelled"];

export function ProjectsPage({
  projects,
  clients,
  filters,
}: {
  projects: ProjectRow[];
  clients: ClientRow[];
  filters: { q: string; status: string; kind: string; clientId: string; archived: boolean };
}) {
  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={`${projects.length} ${projects.length === 1 ? "project" : "projects"}`}
        actions={
          <a href="/projects/new" class={btn.primary}>
            New project
          </a>
        }
      />

      <form
        hx-get="/projects/table"
        hx-target="#projects-table"
        hx-swap="outerHTML"
        hx-trigger="change, submit, keyup changed delay:400ms from:input"
        class="mb-4 flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="f" value="1" />
        <input
          type="search"
          name="q"
          value={filters.q}
          placeholder="Search projects"
          aria-label="Search projects"
          class="w-52 rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted"
        />
        <select name="kind" aria-label="Type" class="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink">
          <option value="">All types</option>
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <option value={value} selected={filters.kind === value}>
              {label}
            </option>
          ))}
        </select>
        <select name="status" aria-label="Status" class="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option value={s} selected={filters.status === s}>
              {s}
            </option>
          ))}
        </select>
        <select name="client_id" aria-label="Client" class="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink">
          <option value="">All clients</option>
          {clients.map((cl) => (
            <option value={String(cl.id)} selected={filters.clientId === String(cl.id)}>
              {cl.name}
            </option>
          ))}
        </select>
        <label class="flex items-center gap-1.5 py-2 text-sm text-ink-2">
          <input type="checkbox" name="archived" value="1" checked={filters.archived} />
          Show archived
        </label>
        <a href="/projects" class={btn.small}>
          Reset
        </a>
      </form>

      <ProjectsTable projects={projects} />
    </div>
  );
}

export function ProjectsTable({ projects }: { projects: ProjectRow[] }) {
  if (projects.length === 0) {
    return (
      <div id="projects-table">
        <EmptyState
          title="No projects yet"
          body="A project links a client to the repositories the work happens in — that link is what turns commits into delivery data."
          action={
            <a href="/projects/new" class={btn.primary}>
              Create the first project
            </a>
          }
        />
      </div>
    );
  }
  return (
    <div id="projects-table">
      <Table head={["Project", "Client", "Type", "Repos", "Team", "Commits", "Last activity", "Status", ""]}>
        {projects.map((p) => (
          <tr class="border-t border-hairline">
            <td class="py-2 pr-3">
              <a href={`/projects/${p.id}`} class="text-accent hover:underline">
                {p.name}
              </a>
              <span class="ml-2 text-xs text-ink-muted">{p.code}</span>
              {p.archived_at !== null ? <Badge label="archived" /> : null}
            </td>
            <td class="py-2 pr-3 text-ink-2">{p.client_name ?? <span class="text-ink-muted">internal</span>}</td>
            <td class="py-2 pr-3 text-ink-2">{KIND_LABELS[p.kind] ?? p.kind}</td>
            <td class="py-2 pr-3 tabular-nums text-ink-2">{p.repo_count}</td>
            <td class="py-2 pr-3 tabular-nums text-ink-2">{p.team_count}</td>
            <td class="py-2 pr-3 tabular-nums text-ink-2">{p.commit_count.toLocaleString("en-US")}</td>
            <td class="whitespace-nowrap py-2 pr-3 text-ink-2">
              <When ts={p.last_commit_ts} />
            </td>
            <td class="py-2 pr-3">
              <Badge label={p.status} tone={STATUS_TONES[p.status] ?? "neutral"} />
            </td>
            <td class="whitespace-nowrap py-2 text-right">
              <a href={`/projects/${p.id}/edit`} class={btn.small}>
                Edit
              </a>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

export function ProjectForm({
  project,
  clients,
  managers,
  values,
  errors,
  message,
}: {
  project?: ProjectRow | undefined;
  clients: ClientRow[];
  managers: EmployeeRow[];
  values: Record<string, string>;
  errors: FieldErrors;
  message?: string | undefined;
}) {
  const editing = project !== undefined;
  return (
    <div>
      <PageHeader
        title={editing ? `Edit ${project.name}` : "New project"}
        actions={
          <a href={editing ? `/projects/${project.id}` : "/projects"} class={btn.secondary}>
            Cancel
          </a>
        }
      />
      <form
        hx-post={editing ? `/projects/${project.id}` : "/projects"}
        hx-target="#project-form"
        hx-swap="outerHTML"
        id="project-form"
      >
        <FormError message={message} />
        <Card>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field name="name" label="Project name" required error={errors.name}>
              <TextInput name="name" value={values.name} error={errors.name} required />
            </Field>
            <Field name="code" label="Project code" required error={errors.code} hint="Short unique id, e.g. NW-PORTAL">
              <TextInput name="code" value={values.code} error={errors.code} required />
            </Field>
            <Field
              name="kind"
              label="Type"
              error={errors.kind}
              hint="Internal work has no client and is never billed"
            >
              <Select
                name="kind"
                value={values.kind}
                error={errors.kind}
                options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field name="client_id" label="Client" error={errors.client_id} hint="Required for client projects">
              <Select
                name="client_id"
                value={values.client_id}
                error={errors.client_id}
                placeholder="No client (internal)"
                options={clients.map((cl) => ({ value: String(cl.id), label: cl.name }))}
              />
            </Field>
            <Field name="status" label="Status" error={errors.status}>
              <Select name="status" value={values.status} error={errors.status} options={STATUSES.map((s) => ({ value: s, label: s }))} />
            </Field>
            <Field name="billing_model" label="Billing model" error={errors.billing_model}>
              <Select
                name="billing_model"
                value={values.billing_model}
                error={errors.billing_model}
                options={Object.entries(BILLING_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field name="currency" label="Currency" error={errors.currency}>
              <TextInput name="currency" value={values.currency} error={errors.currency} placeholder="USD" />
            </Field>
            <Field name="budget_minor" label="Budget" error={errors.budget_minor} hint="Total contracted value">
              <TextInput name="budget_minor" value={values.budget_minor} error={errors.budget_minor} placeholder="120,000" />
            </Field>
            <Field name="rate_hourly_minor" label="Hourly rate" error={errors.rate_hourly_minor}>
              <TextInput name="rate_hourly_minor" value={values.rate_hourly_minor} error={errors.rate_hourly_minor} />
            </Field>
            <Field name="retainer_monthly_minor" label="Monthly retainer" error={errors.retainer_monthly_minor}>
              <TextInput name="retainer_monthly_minor" value={values.retainer_monthly_minor} error={errors.retainer_monthly_minor} />
            </Field>
            <Field name="start_on" label="Start date" error={errors.start_on}>
              <TextInput name="start_on" type="date" value={values.start_on} error={errors.start_on} />
            </Field>
            <Field name="end_on" label="End date" error={errors.end_on}>
              <TextInput name="end_on" type="date" value={values.end_on} error={errors.end_on} />
            </Field>
            <Field name="manager_id" label="Project manager" error={errors.manager_id}>
              <Select
                name="manager_id"
                value={values.manager_id}
                error={errors.manager_id}
                placeholder="Unassigned"
                options={managers.map((e) => ({ value: String(e.id), label: e.full_name }))}
              />
            </Field>
            <Field name="notes" label="Notes" error={errors.notes} wide>
              <textarea id="notes" name="notes" rows={3} class={inputCls}>
                {values.notes ?? ""}
              </textarea>
            </Field>
          </div>
          <div class="mt-4 flex items-center gap-2">
            <button type="submit" class={btn.primary}>
              {editing ? "Save changes" : "Create project"}
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

export function RepoPanel({
  project,
  repos,
  linkable,
  error,
}: {
  project: ProjectRow;
  repos: ProjectRepoRow[];
  linkable: { id: number; full_name: string; linked_elsewhere: number }[];
  error?: string | undefined;
}) {
  return (
    <div id="repo-panel">
      <Card
        title="Repositories"
        subtitle="A project can span any number of repositories. Commits from all of them roll up here."
      >
        {error ? (
          <p class="mb-3 rounded-md bg-plane p-2 text-xs text-status-critical" role="alert">
            {error}
          </p>
        ) : null}

        {repos.length === 0 ? (
          <p class="mb-3 text-sm text-ink-2">
            No repositories linked yet — this project has no activity feed until one is.
          </p>
        ) : (
          <ul class="mb-3 space-y-1.5">
            {repos.map((r) => (
              <li class="flex flex-wrap items-center gap-2 text-sm">
                {r.html_url ? (
                  <a href={r.html_url} target="_blank" rel="noopener" class="text-accent hover:underline">
                    {r.full_name}
                  </a>
                ) : (
                  <span class="text-ink">{r.full_name}</span>
                )}
                {r.is_primary === 1 ? (
                  <Badge label="primary" tone="good" title="Company rollups count this repo here" />
                ) : null}
                {r.shared_with > 0 ? (
                  <Badge
                    label={`shared with ${r.shared_with}`}
                    title="Also linked to another project. Rollups count it once, under the primary."
                  />
                ) : null}
                <span class="text-xs text-ink-2">{r.commit_count.toLocaleString("en-US")} commits</span>
                <span class="ml-auto flex items-center gap-1">
                  {r.is_primary === 0 ? (
                    <button
                      class="rounded-md border border-hairline px-2 py-1 text-[11px] text-ink-2 hover:text-ink"
                      hx-post={`/projects/${project.id}/repos/${r.repo_id}/primary`}
                      hx-target="#repo-panel"
                      hx-swap="outerHTML"
                    >
                      Make primary
                    </button>
                  ) : null}
                  <button
                    class="rounded-md border border-hairline px-2 py-1 text-[11px] text-status-critical"
                    hx-delete={`/projects/${project.id}/repos/${r.repo_id}`}
                    hx-target="#repo-panel"
                    hx-swap="outerHTML"
                    hx-confirm={`Unlink ${r.full_name} from ${project.name}? The repository and its commits are kept.`}
                  >
                    Unlink
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <form
          hx-post={`/projects/${project.id}/repos`}
          hx-target="#repo-panel"
          hx-swap="outerHTML"
          class="flex flex-wrap items-center gap-2"
        >
          <select name="repo_id" aria-label="Repository to link" class="w-64 rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm text-ink">
            <option value="">Choose a tracked repository…</option>
            {linkable.map((r) => (
              <option value={String(r.id)}>
                {r.full_name}
                {r.linked_elsewhere > 0 ? " (already on another project)" : ""}
              </option>
            ))}
          </select>
          <span class="text-xs text-ink-muted">or</span>
          <input
            type="text"
            name="full_name"
            placeholder="owner/repository"
            aria-label="Add a new repository by name"
            class="w-52 rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted"
          />
          <button type="submit" class={btn.small}>
            Link repository
          </button>
          <span class="htmx-indicator text-xs text-ink-2" role="status">
            Linking…
          </span>
        </form>
      </Card>
    </div>
  );
}

export function TeamPanel({
  project,
  assignments,
  employees,
  error,
}: {
  project: ProjectRow;
  assignments: AssignmentRow[];
  employees: EmployeeRow[];
  error?: string | undefined;
}) {
  return (
    <div id="team-panel">
      <Card title="Team" subtitle="Who is allocated, and how much of their time this project holds.">
        {error ? (
          <p class="mb-3 rounded-md bg-plane p-2 text-xs text-status-critical" role="alert">
            {error}
          </p>
        ) : null}

        {assignments.length === 0 ? (
          <p class="mb-3 text-sm text-ink-2">Nobody allocated yet.</p>
        ) : (
          <ul class="mb-3 space-y-1.5">
            {assignments.map((a) => (
              <li class="flex flex-wrap items-center gap-2 text-sm">
                <a href={`/employees/${a.employee_id}`} class="text-accent hover:underline">
                  {a.employee_name}
                </a>
                {a.role ? <span class="text-xs text-ink-2">{a.role}</span> : null}
                <Badge label={`${a.allocation_pct}%`} />
                <span class="text-xs text-ink-muted">
                  {a.start_on}
                  {a.end_on ? ` → ${a.end_on}` : " → open"}
                </span>
                <button
                  class="ml-auto rounded-md border border-hairline px-2 py-1 text-[11px] text-status-critical"
                  hx-delete={`/projects/${project.id}/assignments/${a.id}`}
                  hx-target="#team-panel"
                  hx-swap="outerHTML"
                  hx-confirm={`Remove ${a.employee_name} from ${project.name}?`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          hx-post={`/projects/${project.id}/assignments`}
          hx-target="#team-panel"
          hx-swap="outerHTML"
          class="grid gap-2 sm:grid-cols-4"
        >
          <div class="sm:col-span-2">
            <Field name="employee_id" label="Person">
              <Select
                name="employee_id"
                placeholder="Choose…"
                options={employees.map((e) => ({ value: String(e.id), label: e.full_name }))}
              />
            </Field>
          </div>
          <Field name="allocation_pct" label="Allocation %">
            <TextInput name="allocation_pct" type="number" value="100" />
          </Field>
          <Field name="start_on" label="From">
            <TextInput name="start_on" type="date" required />
          </Field>
          <div class="sm:col-span-4">
            <button type="submit" class={btn.small}>
              Add to team
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export function ProjectDetailPage({
  project,
  repos,
  linkable,
  assignments,
  employees,
  activity,
  contributors,
  perDay,
  days,
}: {
  project: ProjectRow;
  repos: ProjectRepoRow[];
  linkable: { id: number; full_name: string; linked_elsewhere: number }[];
  assignments: AssignmentRow[];
  employees: EmployeeRow[];
  activity: {
    sha: string;
    message: string;
    author_ts: number;
    html_url: string | null;
    repo_full_name: string;
    employee_id: number | null;
    employee_name: string | null;
    author_login: string | null;
    author_name: string | null;
  }[];
  contributors: { employee_id: number | null; name: string; commits: number }[];
  perDay: { day: string; n: number }[];
  days: number;
}) {
  const dayMap = new Map(perDay.map((p) => [p.day, p.n]));
  const now = Date.now();
  const points = Array.from({ length: days }, (_, i) => {
    const iso = new Date(now - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    const n = dayMap.get(iso) ?? 0;
    return { label: iso.slice(5), value: n, title: `${iso} — ${n} commits` };
  });
  const maxContributor = Math.max(1, ...contributors.map((c) => c.commits));

  return (
    <div>
      <PageHeader
        title={project.name}
        subtitle={[
          KIND_LABELS[project.kind],
          project.client_name,
          BILLING_LABELS[project.billing_model],
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <a href={`/projects/${project.id}/edit`} class={btn.secondary}>
              Edit
            </a>
            {project.archived_at === null ? (
              <button
                class={btn.danger}
                hx-post={`/projects/${project.id}/archive`}
                hx-confirm={`Archive ${project.name}? Repository links and history are kept.`}
              >
                Archive
              </button>
            ) : (
              <button class={btn.secondary} hx-post={`/projects/${project.id}/restore`}>
                Restore
              </button>
            )}
          </>
        }
      />

      <div class="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ["Commits", project.commit_count.toLocaleString("en-US")],
          ["Repositories", String(project.repo_count)],
          ["Team", String(project.team_count)],
          ["Budget", project.budget_minor === null ? "—" : ""],
        ].map(([label, value], i) => (
          <div class="rounded-lg border border-hairline bg-surface p-4">
            <div class="text-sm text-ink-2">{label}</div>
            <div class="mt-1 text-2xl font-semibold text-ink">
              {i === 3 && project.budget_minor !== null ? (
                <Money minor={project.budget_minor} currency={project.currency} />
              ) : (
                value
              )}
            </div>
          </div>
        ))}
      </div>

      <div class="grid gap-4 lg:grid-cols-3">
        <div class="space-y-4 lg:col-span-2">
          <Card title={`Activity — last ${days} days`} subtitle="Commits across every linked repository">
            {project.repo_count === 0 ? (
              <p class="text-sm text-ink-2">Link a repository to see activity here.</p>
            ) : (
              <ColumnChart points={points} slot={14} labelEvery={7} height={140} ariaLabel="Project commits per day" />
            )}
          </Card>

          <Card title="Recent commits">
            {activity.length === 0 ? (
              <p class="text-sm text-ink-2">No commits in this window.</p>
            ) : (
              <ul class="space-y-2 text-sm">
                {activity.map((c) => (
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
                      {c.employee_id !== null ? (
                        <a href={`/employees/${c.employee_id}`} class="hover:underline">
                          {c.employee_name}
                        </a>
                      ) : (
                        <span title="Not mapped to a person yet">{c.author_login ?? c.author_name ?? "unknown"}</span>
                      )}{" "}
                      · {c.repo_full_name} · <When ts={c.author_ts} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <RepoPanel project={project} repos={repos} linkable={linkable} />
        </div>

        <div class="space-y-4">
          <Card title="Contributors" subtitle={`Commits in the last ${days} days`}>
            {contributors.length === 0 ? (
              <p class="text-sm text-ink-2">No contributors yet.</p>
            ) : (
              <ul class="space-y-2 text-sm">
                {contributors.map((cn) => (
                  <li class="flex items-center gap-2">
                    {cn.employee_id !== null ? (
                      <a href={`/employees/${cn.employee_id}`} class="truncate text-accent hover:underline">
                        {cn.name}
                      </a>
                    ) : (
                      <span class="truncate text-ink-2" title="Not mapped to a person yet">
                        {cn.name}
                      </span>
                    )}
                    <span
                      class="ml-auto h-2 rounded-full bg-accent"
                      style={`width: ${Math.max(4, (cn.commits / maxContributor) * 60)}px`}
                    ></span>
                    <span class="w-10 text-right tabular-nums text-ink-2">{cn.commits}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <TeamPanel project={project} assignments={assignments} employees={employees} />

          <Card title="Details">
            <dl class="space-y-2 text-sm">
              {[
                ["Code", project.code],
                ["Status", project.status],
                ["Billing", BILLING_LABELS[project.billing_model] ?? project.billing_model],
                ["Manager", project.manager_name ?? "—"],
                ["Start", project.start_on ?? "—"],
                ["End", project.end_on ?? "—"],
              ].map(([label, value]) => (
                <div>
                  <dt class="text-xs text-ink-2">{label}</dt>
                  <dd class="text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            {project.notes ? <p class="mt-3 whitespace-pre-line text-sm text-ink-2">{project.notes}</p> : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
