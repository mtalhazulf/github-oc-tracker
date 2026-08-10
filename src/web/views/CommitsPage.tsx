import type { CommitRow, RepoRow } from "../../db/store.ts";
import { firstLine, fmtDateTime, shortSha } from "../format.ts";

export interface CommitsQuery {
  repo: string;
  author: string;
  q: string;
  from: string;
  to: string;
  merges: boolean;
  page: number;
}

function queryString(f: CommitsQuery, page: number): string {
  const params = new URLSearchParams();
  params.set("f", "1");
  if (f.repo) params.set("repo", f.repo);
  if (f.author) params.set("author", f.author);
  if (f.q) params.set("q", f.q);
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  if (!f.merges) params.set("merges", "0");
  if (page > 1) params.set("page", String(page));
  return params.toString();
}

export function CommitRows({
  commits,
  filters,
  perPage,
}: {
  commits: CommitRow[];
  filters: CommitsQuery;
  perPage: number;
}) {
  return (
    <>
      {commits.map((c) => (
        <tr class="border-t border-hairline align-top">
          <td class="py-2 pr-3 font-mono text-xs">
            {c.html_url ? (
              <a href={c.html_url} target="_blank" rel="noopener" class="text-accent hover:underline">
                {shortSha(c.sha)}
              </a>
            ) : (
              shortSha(c.sha)
            )}
          </td>
          <td class="max-w-md py-2 pr-3">
            <span class="text-ink" title={c.message}>
              {firstLine(c.message)}
            </span>
            {c.is_merge ? <span class="ml-2 rounded bg-plane px-1.5 text-[10px] text-ink-muted">merge</span> : null}
          </td>
          <td class="whitespace-nowrap py-2 pr-3 text-ink-2">{c.repo_full_name}</td>
          <td class="whitespace-nowrap py-2 pr-3 text-ink-2">
            {c.author_login ?? c.author_name ?? "unknown"}
          </td>
          <td class="whitespace-nowrap py-2 tabular-nums text-ink-2">{fmtDateTime(c.author_ts)}</td>
        </tr>
      ))}
      {commits.length === perPage ? (
        <tr>
          <td colspan={5} class="py-2 text-center">
            <button
              class="rounded-md border border-hairline bg-surface px-4 py-1.5 text-sm text-ink-2 hover:text-ink"
              hx-get={`/commits/rows?${queryString(filters, filters.page + 1)}`}
              hx-target="closest tr"
              hx-swap="outerHTML"
            >
              Load more
            </button>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function CommitsTable({
  commits,
  filters,
  total,
  perPage,
}: {
  commits: CommitRow[];
  filters: CommitsQuery;
  total: number;
  perPage: number;
}) {
  return (
    <div id="commits-table">
      <p class="mb-2 text-xs text-ink-muted">{total.toLocaleString("en-US")} commits match</p>
      <div class="overflow-x-auto rounded-lg border border-hairline bg-surface px-4 pb-2">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs text-ink-muted">
              <th class="py-2 pr-3 font-medium">SHA</th>
              <th class="py-2 pr-3 font-medium">Message</th>
              <th class="py-2 pr-3 font-medium">Repository</th>
              <th class="py-2 pr-3 font-medium">Author</th>
              <th class="py-2 font-medium">Authored</th>
            </tr>
          </thead>
          <tbody>
            {commits.length === 0 ? (
              <tr class="border-t border-hairline">
                <td colspan={5} class="py-6 text-center text-ink-muted">
                  No commits match these filters.
                </td>
              </tr>
            ) : (
              <CommitRows commits={commits} filters={filters} perPage={perPage} />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CommitsPage({
  commits,
  filters,
  total,
  perPage,
  repos,
}: {
  commits: CommitRow[];
  filters: CommitsQuery;
  total: number;
  perPage: number;
  repos: RepoRow[];
}) {
  const inputCls =
    "rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted";
  return (
    <div>
      <h1 class="mb-4 text-xl font-semibold text-ink">Commits</h1>
      <form
        hx-get="/commits/table"
        hx-target="#commits-table"
        hx-swap="outerHTML"
        hx-trigger="change, submit, keyup changed delay:400ms from:input"
        class="mb-4 flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="f" value="1" />
        <select name="repo" class={inputCls} aria-label="Repository">
          <option value="">All repositories</option>
          {repos.map((r) => (
            <option value={String(r.id)} selected={filters.repo === String(r.id)}>
              {r.full_name}
            </option>
          ))}
        </select>
        <input type="text" name="author" value={filters.author} placeholder="Author" class={inputCls} />
        <input type="text" name="q" value={filters.q} placeholder="Message or SHA" class={inputCls} />
        <label class="flex flex-col text-xs text-ink-muted">
          From
          <input type="date" name="from" value={filters.from} class={inputCls} />
        </label>
        <label class="flex flex-col text-xs text-ink-muted">
          To
          <input type="date" name="to" value={filters.to} class={inputCls} />
        </label>
        <label class="flex items-center gap-1.5 py-2 text-sm text-ink-2">
          <input type="checkbox" name="merges" value="1" checked={filters.merges} />
          Merges
        </label>
        <button type="submit" class="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white">
          Filter
        </button>
      </form>
      <CommitsTable commits={commits} filters={filters} total={total} perPage={perPage} />
    </div>
  );
}
