import type { AuditRow, UserRow } from "../../db/stores/auth.ts";
import type { EmployeeRow } from "../../db/store.ts";
import type { FieldErrors } from "../../domain/errors.ts";
import { ROLES } from "../../domain/rbac.ts";
import { Badge, Card, Field, FormError, PageHeader, Select, Table, TextInput, When, btn } from "./ui/kit.tsx";

/** Standalone shell for pages shown before a session exists. */
function AuthShell({ title, children }: { title: string; children: unknown }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · GitHub OC Tracker</title>
        <link rel="stylesheet" href="/app.css" />
      </head>
      <body class="min-h-screen bg-plane text-ink">
        <main class="mx-auto max-w-md px-4 py-20">
          <div class="mb-6 flex items-center gap-2 font-semibold text-ink">
            <span class="inline-flex h-7 w-7 items-center justify-center rounded bg-accent text-xs font-bold text-white">
              OC
            </span>
            GitHub OC Tracker
          </div>
          {children}
        </main>
      </body>
    </html>
  );
}

export function LoginPage({ error, email, next }: { error?: string; email?: string; next?: string }) {
  return (
    <AuthShell title="Sign in">
      <div class="rounded-lg border border-hairline bg-surface p-6">
        <h1 class="text-lg font-semibold text-ink">Sign in</h1>
        <p class="mb-4 mt-1 text-sm text-ink-2">Use your work account.</p>
        {error ? (
          <p class="mb-3 rounded-md bg-plane p-2 text-sm text-status-critical" role="alert">
            {error}
          </p>
        ) : null}
        <form method="post" action="/login" class="space-y-3">
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <Field name="email" label="Email" required>
            <TextInput name="email" type="email" value={email} required autofocus />
          </Field>
          <Field name="password" label="Password" required>
            <TextInput name="password" type="password" required />
          </Field>
          <button type="submit" class={`${btn.primary} w-full`}>
            Sign in
          </button>
        </form>
      </div>
    </AuthShell>
  );
}

export function SetupPage({ errors, values }: { errors: FieldErrors; values: Record<string, string> }) {
  return (
    <AuthShell title="Set up">
      <div class="rounded-lg border border-hairline bg-surface p-6">
        <h1 class="text-lg font-semibold text-ink">Create the owner account</h1>
        <p class="mb-4 mt-1 text-sm text-ink-2">
          This is the first and only setup step. The owner can create everyone else and is the only role
          that can change roles.
        </p>
        <form method="post" action="/setup" class="space-y-3">
          <Field name="name" label="Your name" required error={errors.name}>
            <TextInput name="name" value={values.name} error={errors.name} required autofocus />
          </Field>
          <Field name="email" label="Email" required error={errors.email}>
            <TextInput name="email" type="email" value={values.email} error={errors.email} required />
          </Field>
          <Field name="password" label="Password" required error={errors.password} hint="At least 10 characters">
            <TextInput name="password" type="password" error={errors.password} required />
          </Field>
          <button type="submit" class={`${btn.primary} w-full`}>
            Create account
          </button>
        </form>
      </div>
    </AuthShell>
  );
}

const ROLE_NOTES: Record<string, string> = {
  owner: "Everything, including managing accounts",
  admin: "Everything except managing accounts",
  manager: "Delivery and people, but no salaries",
  member: "Read-only, plus their own payslip",
};

export function UsersPage({
  users,
  employees,
  errors,
  message,
}: {
  users: UserRow[];
  employees: EmployeeRow[];
  errors: FieldErrors;
  message?: string | undefined;
}) {
  return (
    <div>
      <PageHeader title="Accounts" subtitle="Who can sign in, and what they can see." />

      <div class="grid gap-4 lg:grid-cols-3">
        <div class="lg:col-span-2">
          <Table head={["Name", "Email", "Role", "Linked person", "Last sign-in", "Status", ""]}>
            {users.map((u) => (
              <tr class="border-t border-hairline">
                <td class="py-2 pr-3 text-ink">{u.name}</td>
                <td class="py-2 pr-3 text-ink-2">{u.email}</td>
                <td class="py-2 pr-3">
                  <form hx-post={`/settings/users/${u.id}`} hx-target="body" hx-swap="outerHTML" class="flex items-center gap-1">
                    <input type="hidden" name="name" value={u.name} />
                    <input type="hidden" name="status" value={u.status} />
                    <input type="hidden" name="employee_id" value={u.employee_id ?? ""} />
                    <select
                      name="role"
                      aria-label={`Role for ${u.name}`}
                      class="rounded-md border border-hairline bg-surface px-2 py-1 text-xs text-ink"
                    >
                      {ROLES.map((r) => (
                        <option value={r} selected={u.role === r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <button type="submit" class={btn.small}>
                      Save
                    </button>
                  </form>
                </td>
                <td class="py-2 pr-3 text-ink-2">{u.employee_name ?? "—"}</td>
                <td class="py-2 pr-3 text-ink-2">
                  <When ts={u.last_login_at} />
                </td>
                <td class="py-2 pr-3">
                  <Badge label={u.status} tone={u.status === "active" ? "good" : "critical"} />
                </td>
                <td class="whitespace-nowrap py-2 text-right">
                  <button
                    class={btn.smallDanger}
                    hx-delete={`/settings/users/${u.id}`}
                    hx-target="body"
                    hx-swap="outerHTML"
                    hx-confirm={`Delete the account for ${u.email}?`}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </Table>

          <div class="mt-4 rounded-lg border border-hairline bg-surface p-4">
            <h2 class="mb-2 text-sm font-semibold text-ink">What each role can do</h2>
            <ul class="space-y-1 text-sm text-ink-2">
              {ROLES.map((r) => (
                <li>
                  <span class="font-medium text-ink">{r}</span> — {ROLE_NOTES[r]}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <Card title="Add an account">
          <form hx-post="/settings/users" hx-target="body" hx-swap="outerHTML" class="space-y-3">
            <FormError message={message} />
            <Field name="name" label="Name" required error={errors.name}>
              <TextInput name="name" error={errors.name} required />
            </Field>
            <Field name="email" label="Email" required error={errors.email}>
              <TextInput name="email" type="email" error={errors.email} required />
            </Field>
            <Field name="password" label="Password" required error={errors.password} hint="At least 10 characters">
              <TextInput name="password" type="password" error={errors.password} required />
            </Field>
            <Field name="role" label="Role" error={errors.role}>
              <Select name="role" value="member" error={errors.role} options={ROLES.map((r) => ({ value: r, label: r }))} />
            </Field>
            <Field name="employee_id" label="Linked person" hint="Lets them see their own payslip">
              <Select
                name="employee_id"
                placeholder="Not linked"
                options={employees.map((e) => ({ value: String(e.id), label: e.full_name }))}
              />
            </Field>
            <button type="submit" class={btn.primary}>
              Create account
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}

export function AuditPage({ rows, entities, entity }: { rows: AuditRow[]; entities: string[]; entity: string }) {
  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Who changed salaries, roles, payroll and deletions — the questions that need an answer later."
      />
      <form hx-get="/settings/audit" hx-target="body" hx-swap="outerHTML" class="mb-4 flex items-center gap-2">
        <select name="entity" aria-label="Filter by entity" class="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink">
          <option value="">All activity</option>
          {entities.map((e) => (
            <option value={e} selected={entity === e}>
              {e}
            </option>
          ))}
        </select>
        <button type="submit" class={btn.small}>
          Filter
        </button>
      </form>
      {rows.length === 0 ? (
        <p class="rounded-lg border border-hairline bg-surface p-6 text-center text-sm text-ink-2">
          Nothing recorded yet.
        </p>
      ) : (
        <Table head={["When", "Who", "Action", "Entity", "Detail"]}>
          {rows.map((r) => (
            <tr class="border-t border-hairline align-top">
              <td class="whitespace-nowrap py-2 pr-3 text-ink-2">
                <When ts={r.created_at} />
              </td>
              <td class="py-2 pr-3 text-ink-2">{r.user_email ?? "system"}</td>
              <td class="py-2 pr-3 font-mono text-xs text-ink">{r.action}</td>
              <td class="py-2 pr-3 text-ink-2">
                {r.entity ?? "—"}
                {r.entity_id !== null ? ` #${r.entity_id}` : ""}
              </td>
              <td class="py-2 text-ink-2">{r.summary ?? ""}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
