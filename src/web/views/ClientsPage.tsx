import type { ClientRow, ProjectRow } from "../../db/store.ts";
import type { FieldErrors } from "../../domain/errors.ts";
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
  inputCls,
} from "./ui/kit.tsx";
import { Can } from "./ui/gate.tsx";

const STATUS_TONES: Record<string, "neutral" | "good" | "warn" | "critical"> = {
  prospect: "neutral",
  active: "good",
  paused: "warn",
  churned: "critical",
};

const STATUSES = ["prospect", "active", "paused", "churned"];

export function ClientsPage({
  clients,
  filters,
}: {
  clients: ClientRow[];
  filters: { q: string; status: string; archived: boolean };
}) {
  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle={`${clients.length} ${clients.length === 1 ? "client" : "clients"}`}
        actions={
          <Can do="delivery.manage">
            <a href="/clients/new" class={btn.primary}>
              Add client
            </a>
          </Can>
        }
      />

      <form
        hx-get="/clients/table"
        hx-target="#clients-table"
        hx-swap="outerHTML"
        hx-trigger="change, submit, keyup changed delay:400ms from:input"
        class="mb-4 flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="f" value="1" />
        <input
          type="search"
          name="q"
          value={filters.q}
          placeholder="Search clients"
          aria-label="Search clients"
          class="w-56 rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted"
        />
        <select name="status" aria-label="Status" class="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option value={s} selected={filters.status === s}>
              {s}
            </option>
          ))}
        </select>
        <label class="flex items-center gap-1.5 py-2 text-sm text-ink-2">
          <input type="checkbox" name="archived" value="1" checked={filters.archived} />
          Show archived
        </label>
        <a href="/clients" class={btn.small}>
          Reset
        </a>
      </form>

      <ClientsTable clients={clients} />
    </div>
  );
}

export function ClientsTable({ clients }: { clients: ClientRow[] }) {
  if (clients.length === 0) {
    return (
      <div id="clients-table">
        <EmptyState
          title="No clients yet"
          body="Add the companies you deliver for. Projects hang off a client, and invoices follow from there."
          action={
            <Can do="delivery.manage">
              <a href="/clients/new" class={btn.primary}>
                Add the first client
              </a>
            </Can>
          }
        />
      </div>
    );
  }
  return (
    <div id="clients-table">
      <Table head={["Client", "Contact", "Projects", "Currency", "Terms", "Status", ""]}>
        {clients.map((cl) => (
          <tr class="border-t border-hairline">
            <td class="py-2 pr-3">
              <a href={`/clients/${cl.id}`} class="text-accent hover:underline">
                {cl.name}
              </a>
              <span class="ml-2 text-xs text-ink-muted">{cl.code}</span>
              {cl.archived_at !== null ? <Badge label="archived" /> : null}
            </td>
            <td class="py-2 pr-3 text-ink-2">{cl.contact_name ?? cl.contact_email ?? "—"}</td>
            <td class="py-2 pr-3 tabular-nums text-ink-2">{cl.project_count}</td>
            <td class="py-2 pr-3 text-ink-2">{cl.currency}</td>
            <td class="py-2 pr-3 text-ink-2">Net {cl.payment_terms_days}</td>
            <td class="py-2 pr-3">
              <Badge label={cl.status} tone={STATUS_TONES[cl.status] ?? "neutral"} />
            </td>
            <td class="whitespace-nowrap py-2 text-right">
              <Can do="delivery.manage">
                <a href={`/clients/${cl.id}/edit`} class={btn.small}>
                  Edit
                </a>
              </Can>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

export function ClientForm({
  client,
  values,
  errors,
  message,
}: {
  client?: ClientRow | undefined;
  values: Record<string, string>;
  errors: FieldErrors;
  message?: string | undefined;
}) {
  const editing = client !== undefined;
  return (
    <div>
      <PageHeader
        title={editing ? `Edit ${client.name}` : "Add client"}
        actions={
          <a href={editing ? `/clients/${client.id}` : "/clients"} class={btn.secondary}>
            Cancel
          </a>
        }
      />
      <form
        hx-post={editing ? `/clients/${client.id}` : "/clients"}
        hx-target="#client-form"
        hx-swap="outerHTML"
        id="client-form"
      >
        <FormError message={message} />
        <Card>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field name="name" label="Client name" required error={errors.name}>
              <TextInput name="name" value={values.name} error={errors.name} required />
            </Field>
            <Field name="code" label="Client code" required error={errors.code} hint="Short unique id, e.g. NW">
              <TextInput name="code" value={values.code} error={errors.code} required />
            </Field>
            <Field name="status" label="Status" error={errors.status}>
              <Select name="status" value={values.status} error={errors.status} options={STATUSES.map((s) => ({ value: s, label: s }))} />
            </Field>
            <Field name="currency" label="Billing currency" error={errors.currency} hint="They are billed in this; you are paid in yours">
              <TextInput name="currency" value={values.currency} error={errors.currency} placeholder="USD" />
            </Field>
            <Field name="contact_name" label="Contact name" error={errors.contact_name}>
              <TextInput name="contact_name" value={values.contact_name} error={errors.contact_name} />
            </Field>
            <Field name="contact_email" label="Contact email" error={errors.contact_email}>
              <TextInput name="contact_email" type="email" value={values.contact_email} error={errors.contact_email} />
            </Field>
            <Field name="country" label="Country" error={errors.country}>
              <TextInput name="country" value={values.country} error={errors.country} />
            </Field>
            <Field name="website" label="Website" error={errors.website}>
              <TextInput name="website" value={values.website} error={errors.website} placeholder="https://" />
            </Field>
            <Field name="billing_email" label="Billing email" error={errors.billing_email}>
              <TextInput name="billing_email" type="email" value={values.billing_email} error={errors.billing_email} />
            </Field>
            <Field name="payment_terms_days" label="Payment terms (days)" error={errors.payment_terms_days}>
              <TextInput name="payment_terms_days" type="number" value={values.payment_terms_days || "30"} error={errors.payment_terms_days} />
            </Field>
            <Field name="tax_id" label="Tax id" error={errors.tax_id}>
              <TextInput name="tax_id" value={values.tax_id} error={errors.tax_id} />
            </Field>
            <Field name="billing_address" label="Billing address" error={errors.billing_address}>
              <textarea id="billing_address" name="billing_address" rows={2} class={inputCls}>
                {values.billing_address ?? ""}
              </textarea>
            </Field>
            <Field name="notes" label="Notes" error={errors.notes} wide>
              <textarea id="notes" name="notes" rows={3} class={inputCls}>
                {values.notes ?? ""}
              </textarea>
            </Field>
          </div>
          <div class="mt-4 flex items-center gap-2">
            <button type="submit" class={btn.primary}>
              {editing ? "Save changes" : "Add client"}
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

export function ClientDetailPage({ client, projects }: { client: ClientRow; projects: ProjectRow[] }) {
  return (
    <div>
      <PageHeader
        title={client.name}
        subtitle={`${client.code} · ${client.currency} · Net ${client.payment_terms_days}`}
        actions={
          <Can do="delivery.manage">
            <a href={`/projects/new?client_id=${client.id}`} class={btn.secondary}>
              New project
            </a>
            <a href={`/clients/${client.id}/edit`} class={btn.secondary}>
              Edit
            </a>
            {client.archived_at === null ? (
              <button
                class={btn.danger}
                hx-post={`/clients/${client.id}/archive`}
                hx-confirm={`Archive ${client.name}? Their projects and history are kept.`}
              >
                Archive
              </button>
            ) : (
              <button class={btn.secondary} hx-post={`/clients/${client.id}/restore`}>
                Restore
              </button>
            )}
          </Can>
        }
      />

      <div class="grid gap-4 lg:grid-cols-3">
        <div class="lg:col-span-2">
          <Card title="Projects" subtitle="Everything delivered for this client">
            {projects.length === 0 ? (
              <p class="text-sm text-ink-2">
                No projects yet.{" "}
                <a href={`/projects/new?client_id=${client.id}`} class="text-accent hover:underline">
                  Create one
                </a>
                .
              </p>
            ) : (
              <ul class="space-y-2 text-sm">
                {projects.map((p) => (
                  <li class="flex flex-wrap items-center gap-2">
                    <a href={`/projects/${p.id}`} class="text-accent hover:underline">
                      {p.name}
                    </a>
                    <Badge label={p.status} />
                    <span class="text-xs text-ink-2">{p.repo_count} repos</span>
                    <span class="ml-auto tabular-nums text-ink-2">
                      {p.budget_minor === null ? "—" : <Money minor={p.budget_minor} currency={p.currency} />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title="Details">
          <dl class="space-y-2 text-sm">
            {[
              ["Contact", client.contact_name ?? "—"],
              ["Contact email", client.contact_email ?? "—"],
              ["Billing email", client.billing_email ?? "—"],
              ["Country", client.country ?? "—"],
              ["Tax id", client.tax_id ?? "—"],
              ["Website", client.website ?? "—"],
            ].map(([label, value]) => (
              <div>
                <dt class="text-xs text-ink-2">{label}</dt>
                <dd class="text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {client.notes ? <p class="mt-3 whitespace-pre-line text-sm text-ink-2">{client.notes}</p> : null}
        </Card>
      </div>
    </div>
  );
}
