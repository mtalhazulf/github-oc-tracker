import type { OrgRow } from "../../db/store.ts";
import { compact, fmtDateTime, timeAgo } from "../format.ts";
import { SyncBadge } from "./components/SyncBadge.tsx";

export function OrgRowView({ org }: { org: OrgRow }) {
  const polling = org.sync_status === "syncing";
  return (
    <tr
      id={`org-row-${org.id}`}
      class="border-t border-hairline"
      {...(polling
        ? {
            "hx-get": `/orgs/${org.id}/row`,
            "hx-trigger": "load delay:3s",
            "hx-swap": "outerHTML",
            "data-quiet": "1",
          }
        : {})}
    >
      <td class="py-2 pr-3">
        <span class="flex items-center gap-2">
          {org.avatar_url ? (
            <img src={org.avatar_url} alt="" width="24" height="24" class="rounded" loading="lazy" />
          ) : null}
          {org.html_url ? (
            <a href={org.html_url} target="_blank" rel="noopener" class="text-accent hover:underline">
              {org.login}
            </a>
          ) : (
            <span class="text-ink">{org.login}</span>
          )}
          <span class="rounded bg-plane px-1.5 py-0.5 text-[10px] text-ink-muted">
            {org.kind === "org" ? "organization" : "user"}
          </span>
          {org.installation_id !== null ? (
            <span
              class="rounded bg-plane px-1.5 py-0.5 text-[10px] text-ink-muted"
              title="Access via GitHub App installation"
            >
              app
            </span>
          ) : null}
        </span>
      </td>
      <td class="whitespace-nowrap py-2 pr-3 tabular-nums text-ink-2">{org.repo_count}</td>
      <td class="whitespace-nowrap py-2 pr-3 tabular-nums text-ink-2">{compact(org.commit_count)}</td>
      <td class="whitespace-nowrap py-2 pr-3 text-ink-2">
        {org.last_synced_at ? (
          <span title={fmtDateTime(org.last_synced_at)}>{timeAgo(org.last_synced_at)}</span>
        ) : (
          "never"
        )}
      </td>
      <td class="whitespace-nowrap py-2 pr-3">
        <SyncBadge status={org.sync_status} error={org.sync_error} />
      </td>
      <td class="whitespace-nowrap py-2 text-right">
        <button
          class="rounded-md border border-hairline px-3 py-1.5 text-xs text-ink-2 hover:text-ink"
          hx-post={`/orgs/${org.id}/sync`}
          hx-target={`#org-row-${org.id}`}
          hx-swap="outerHTML"
        >
          Sync now
        </button>
        <button
          class="ml-1 rounded-md border border-hairline px-3 py-1.5 text-xs text-status-critical"
          hx-delete={`/orgs/${org.id}`}
          hx-confirm={`Remove ${org.login}, its repositories, and all tracked commits?`}
          hx-target={`#org-row-${org.id}`}
          hx-swap="delete"
        >
          Remove
        </button>
      </td>
    </tr>
  );
}

export function OrgsPage({ orgs }: { orgs: OrgRow[] }) {
  return (
    <div>
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-xl font-semibold text-ink">Organizations</h1>
        <form
          hx-post="/orgs"
          hx-target="#org-form-error"
          hx-swap="innerHTML"
          hx-disabled-elt="find button"
          class="flex items-center gap-2"
        >
          <label for="org-input" class="sr-only">
            Organization or user to add
          </label>
          <input
            id="org-input"
            type="text"
            name="login"
            required
            title="Organization or user login — a GitHub URL works too"
            placeholder="Org or user login, or GitHub URL"
            class="w-72 rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted"
          />
          <button type="submit" class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">
            Add organization
          </button>
          <span class="htmx-indicator text-xs text-ink-2" role="status">
            Adding…
          </span>
        </form>
      </div>
      <div id="org-form-error" class="mb-3 text-sm text-status-critical" aria-live="polite"></div>
      <p class="mb-3 text-xs text-ink-2">
        Adding an organization discovers all of its repositories and starts tracking their commits. New
        repositories created later are picked up automatically — instantly with webhooks, otherwise on
        scheduled syncs.
      </p>

      <div class="overflow-x-auto rounded-lg border border-hairline bg-surface px-4 pb-2">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs text-ink-2">
              <th class="py-2 pr-3 font-medium">Organization</th>
              <th class="py-2 pr-3 font-medium">Repositories</th>
              <th class="py-2 pr-3 font-medium">Commits</th>
              <th class="py-2 pr-3 font-medium">Last discovery</th>
              <th class="py-2 pr-3 font-medium">Status</th>
              <th class="py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orgs.length === 0 ? (
              <tr class="border-t border-hairline">
                <td colspan={6} class="py-6 text-center text-ink-2">
                  No organizations yet. Add one above to track every repository it owns.
                </td>
              </tr>
            ) : (
              orgs.map((org) => <OrgRowView org={org} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
