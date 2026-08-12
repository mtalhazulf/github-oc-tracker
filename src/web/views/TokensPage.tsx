import type { ApiTokenRow } from "../../db/store.ts";
import { Card, EmptyState, Field, PageHeader, Table, TextInput, When, btn } from "./ui/kit.tsx";

export function TokensPage({ tokens, created }: { tokens: ApiTokenRow[]; created?: string | undefined }) {
  return (
    <div>
      <PageHeader
        title="API tokens"
        subtitle="For your own scripts. Read-only endpoints under /api/v1, authenticated with a Bearer header."
      />

      {created ? (
        <div class="mb-4 rounded-lg border border-hairline bg-surface p-4" role="status">
          <p class="text-sm font-medium text-ink">Copy this token now — it is not shown again.</p>
          <code class="mt-2 block break-all rounded bg-plane p-2 font-mono text-xs text-ink">{created}</code>
          <p class="mt-2 text-xs text-ink-2">
            Use it as <code>Authorization: Bearer {"<token>"}</code>. Only its SHA-256 hash is stored.
          </p>
        </div>
      ) : null}

      <div class="grid gap-4 lg:grid-cols-3">
        <div class="lg:col-span-2">
          {tokens.length === 0 ? (
            <EmptyState title="No tokens yet" body="Create one to call the JSON API from a script." />
          ) : (
            <Table head={["Name", "Prefix", "Created", "Last used", ""]}>
              {tokens.map((t) => (
                <tr class="border-t border-hairline">
                  <td class="py-2 pr-3 text-ink">{t.name}</td>
                  <td class="py-2 pr-3 font-mono text-xs text-ink-2">{t.prefix}…</td>
                  <td class="py-2 pr-3 text-ink-2">
                    <When ts={t.created_at} />
                  </td>
                  <td class="py-2 pr-3 text-ink-2">
                    <When ts={t.last_used_at} />
                  </td>
                  <td class="whitespace-nowrap py-2 text-right">
                    <button
                      class={btn.smallDanger}
                      hx-delete={`/settings/tokens/${t.id}`}
                      hx-target="body"
                      hx-swap="outerHTML"
                      hx-confirm={`Revoke "${t.name}"? Anything using it stops working immediately.`}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </div>

        <Card title="Create a token">
          <form hx-post="/settings/tokens" hx-target="body" hx-swap="outerHTML" class="space-y-3">
            <Field name="name" label="Name" hint="What will use it">
              <TextInput name="name" placeholder="Reporting script" required />
            </Field>
            <button type="submit" class={btn.primary}>
              Create token
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}
