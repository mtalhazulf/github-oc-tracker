import type { RepoRow, SyncRunRow } from "../../db/store.ts";
import { compact, timeAgo } from "../format.ts";
import { SyncBadge } from "./components/SyncBadge.tsx";

export function RepoRowView({ repo }: { repo: RepoRow }) {
  const polling = repo.sync_status === "syncing" || repo.sync_status === "pending";
  return (
    <tr
      id={`repo-row-${repo.id}`}
      class="border-t border-hairline"
      {...(polling
        ? { "hx-get": `/repos/${repo.id}/row`, "hx-trigger": "load delay:3s", "hx-swap": "outerHTML" }
        : {})}
    >
      <td class="py-2 pr-3">
        {repo.html_url ? (
          <a href={repo.html_url} target="_blank" rel="noopener" class="text-accent hover:underline">
            {repo.full_name}
          </a>
        ) : (
          <span class="text-ink">{repo.full_name}</span>
        )}
        <span class="ml-2 space-x-1 text-[10px] text-ink-muted">
          {repo.private ? <span class="rounded bg-plane px-1.5 py-0.5">private</span> : null}
          {repo.fork ? <span class="rounded bg-plane px-1.5 py-0.5">fork</span> : null}
          {repo.archived ? <span class="rounded bg-plane px-1.5 py-0.5">archived</span> : null}
          {repo.installation_id !== null ? (
            <span class="rounded bg-plane px-1.5 py-0.5" title="Access via GitHub App installation">
              app
            </span>
          ) : null}
        </span>
      </td>
      <td class="whitespace-nowrap py-2 pr-3 text-ink-2">{repo.org_login ?? "—"}</td>
      <td class="whitespace-nowrap py-2 pr-3 tabular-nums text-ink-2">{compact(repo.commit_count)}</td>
      <td class="whitespace-nowrap py-2 pr-3 text-ink-2">
        {repo.last_synced_at ? timeAgo(repo.last_synced_at) : "never"}
      </td>
      <td class="whitespace-nowrap py-2 pr-3">
        <SyncBadge status={repo.sync_status} error={repo.sync_error} />
      </td>
      <td class="whitespace-nowrap py-2 text-right">
        <button
          class="rounded-md border border-hairline px-2.5 py-1 text-xs text-ink-2 hover:text-ink"
          hx-post={`/repos/${repo.id}/sync`}
          hx-target={`#repo-row-${repo.id}`}
          hx-swap="outerHTML"
        >
          Sync now
        </button>
        <button
          class="ml-1 rounded-md border border-hairline px-2.5 py-1 text-xs text-status-critical"
          hx-delete={`/repos/${repo.id}`}
          hx-confirm={`Remove ${repo.full_name} and all its tracked commits?`}
          hx-target={`#repo-row-${repo.id}`}
          hx-swap="delete"
        >
          Remove
        </button>
      </td>
    </tr>
  );
}

export function ReposPage({ repos, runs }: { repos: RepoRow[]; runs: SyncRunRow[] }) {
  return (
    <div>
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-xl font-semibold text-ink">Repositories</h1>
        <form hx-post="/repos" hx-target="#repo-form-error" hx-swap="innerHTML" class="flex items-center gap-2">
          <input
            type="text"
            name="full_name"
            required
            placeholder="owner/repository"
            class="w-64 rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted"
          />
          <button type="submit" class="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white">
            Add repository
          </button>
          <span class="htmx-indicator text-xs text-ink-muted">Adding…</span>
        </form>
      </div>
      <div id="repo-form-error" class="mb-3 text-sm text-status-critical"></div>

      <div class="overflow-x-auto rounded-lg border border-hairline bg-surface px-4 pb-2">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs text-ink-muted">
              <th class="py-2 pr-3 font-medium">Repository</th>
              <th class="py-2 pr-3 font-medium">Organization</th>
              <th class="py-2 pr-3 font-medium">Commits</th>
              <th class="py-2 pr-3 font-medium">Last synced</th>
              <th class="py-2 pr-3 font-medium">Status</th>
              <th class="py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {repos.length === 0 ? (
              <tr class="border-t border-hairline">
                <td colspan={6} class="py-6 text-center text-ink-muted">
                  No repositories tracked yet. Add one above, or add a whole organization.
                </td>
              </tr>
            ) : (
              repos.map((repo) => <RepoRowView repo={repo} />)
            )}
          </tbody>
        </table>
      </div>

      <h2 class="mb-2 mt-8 text-sm font-semibold text-ink">Recent sync runs</h2>
      <div class="overflow-x-auto rounded-lg border border-hairline bg-surface px-4 pb-2">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs text-ink-muted">
              <th class="py-2 pr-3 font-medium">Repository</th>
              <th class="py-2 pr-3 font-medium">Started</th>
              <th class="py-2 pr-3 font-medium">Duration</th>
              <th class="py-2 pr-3 font-medium">Commits added</th>
              <th class="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr class="border-t border-hairline">
                <td colspan={5} class="py-4 text-center text-ink-muted">
                  No sync runs yet.
                </td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr class="border-t border-hairline">
                  <td class="py-2 pr-3 text-ink">{run.repo_full_name}</td>
                  <td class="whitespace-nowrap py-2 pr-3 text-ink-2">{timeAgo(run.started_at)}</td>
                  <td class="whitespace-nowrap py-2 pr-3 tabular-nums text-ink-2">
                    {run.finished_at ? `${run.finished_at - run.started_at}s` : "—"}
                  </td>
                  <td class="whitespace-nowrap py-2 pr-3 tabular-nums text-ink-2">{run.commits_added}</td>
                  <td class="py-2">
                    <SyncBadge
                      status={run.status === "running" ? "syncing" : run.status === "success" ? "idle" : "error"}
                      error={run.error}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
