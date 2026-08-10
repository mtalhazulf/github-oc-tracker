import type { CommitRow, OrgRow, RepoRow } from "../../db/store.ts";
import {
  fmtDay,
  firstLine,
  hourLabel,
  shortSha,
  timeAgo,
  tzLabel,
  tzOffsetSeconds,
  WEEKDAY_NAMES,
  WEEKDAY_ORDER,
} from "../format.ts";
import { ColumnChart } from "./components/ColumnChart.tsx";
import { Punchcard } from "./components/Punchcard.tsx";
import { StatTile } from "./components/StatTile.tsx";

export interface DashboardData {
  scope: string;
  totalCommits: number;
  commits7d: number;
  commitsPrev7d: number;
  repoCount: number;
  orgCount: number;
  authorCount: number;
  perDay: { day: string; n: number }[];
  days: number;
  byHour: { hour: number; n: number }[];
  byWeekday: { weekday: number; n: number }[];
  punchcard: { weekday: number; hour: number; n: number }[];
  topAuthors: { author: string; login: string | null; avatar: string | null; n: number; last_ts: number }[];
  recent: CommitRow[];
  orgs: OrgRow[];
  repos: RepoRow[];
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: unknown }) {
  return (
    <section class="rounded-lg border border-hairline bg-surface p-4">
      <h2 class="text-sm font-semibold text-ink">{title}</h2>
      {subtitle ? <p class="mb-3 mt-0.5 text-xs text-ink-muted">{subtitle}</p> : <div class="mb-3"></div>}
      {children}
    </section>
  );
}

export function DashboardContent({ d }: { d: DashboardData }) {
  const dayMap = new Map(d.perDay.map((p) => [p.day, p.n]));
  // Shift "now" by the display offset so day buckets line up with the SQL grouping.
  const now = Date.now() + tzOffsetSeconds * 1000;
  const perDayPoints = Array.from({ length: d.days }, (_, i) => {
    const dt = new Date(now - (d.days - 1 - i) * 86400_000);
    const iso = dt.toISOString().slice(0, 10);
    const n = dayMap.get(iso) ?? 0;
    return { label: fmtDay(iso), value: n, title: `${fmtDay(iso)} — ${n} commits` };
  });

  const hourMap = new Map(d.byHour.map((p) => [p.hour, p.n]));
  const hourPoints = Array.from({ length: 24 }, (_, h) => {
    const n = hourMap.get(h) ?? 0;
    return { label: String(h).padStart(2, "0"), value: n, title: `${hourLabel(h)} — ${n} commits` };
  });

  const wdMap = new Map(d.byWeekday.map((p) => [p.weekday, p.n]));
  const weekdayPoints = WEEKDAY_ORDER.map((wd) => {
    const n = wdMap.get(wd) ?? 0;
    return { label: WEEKDAY_NAMES[wd] ?? "", value: n, title: `${WEEKDAY_NAMES[wd]} — ${n} commits` };
  });

  const maxAuthor = Math.max(1, ...d.topAuthors.map((a) => a.n));

  return (
    <div id="dashboard-content" class="space-y-4">
      <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Total commits" value={d.totalCommits} />
        <StatTile
          label="Commits, last 7 days"
          value={d.commits7d}
          delta={{ value: d.commits7d - d.commitsPrev7d, period: "prior 7 days" }}
        />
        <StatTile label="Repositories" value={d.repoCount} />
        <StatTile label="Contributors" value={d.authorCount} />
      </div>

      <Card title={`Commits per day — last ${d.days} days`} subtitle={`Author dates, ${tzLabel}`}>
        <ColumnChart points={perDayPoints} slot={22} labelEvery={5} />
      </Card>

      <Card title="Commit times" subtitle={`All commits in scope by day of week and hour, ${tzLabel}`}>
        <Punchcard cells={d.punchcard} />
      </Card>

      <div class="grid gap-4 lg:grid-cols-2">
        <Card title="Commits by hour of day" subtitle={tzLabel}>
          <ColumnChart points={hourPoints} slot={24} labelEvery={3} height={150} />
        </Card>
        <Card title="Commits by day of week" subtitle={tzLabel}>
          <ColumnChart points={weekdayPoints} slot={44} height={150} />
        </Card>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <Card title="Top contributors" subtitle="By commit count, all time in scope">
          {d.topAuthors.length === 0 ? (
            <p class="text-sm text-ink-muted">No commits yet.</p>
          ) : (
            <ul class="space-y-2">
              {d.topAuthors.map((a) => (
                <li class="flex items-center gap-3 text-sm">
                  {a.avatar ? (
                    <img src={a.avatar} alt="" width="24" height="24" class="rounded-full" loading="lazy" />
                  ) : (
                    <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-plane text-[10px] text-ink-muted">
                      {a.author.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span class="w-40 truncate text-ink" title={a.author}>
                    {a.author}
                  </span>
                  <span class="h-2 rounded-full bg-accent" style={`width: ${Math.max(1, (a.n / maxAuthor) * 40)}%`}></span>
                  <span class="text-ink-2">{a.n.toLocaleString("en-US")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent commits" subtitle="Latest activity in scope">
          {d.recent.length === 0 ? (
            <p class="text-sm text-ink-muted">
              No commits yet. Add an organization or repository to start tracking.
            </p>
          ) : (
            <ul class="space-y-2">
              {d.recent.map((commit) => (
                <li class="text-sm">
                  <div class="flex items-baseline gap-2">
                    {commit.html_url ? (
                      <a href={commit.html_url} target="_blank" rel="noopener" class="font-mono text-xs text-accent hover:underline">
                        {shortSha(commit.sha)}
                      </a>
                    ) : (
                      <span class="font-mono text-xs text-ink-muted">{shortSha(commit.sha)}</span>
                    )}
                    <span class="truncate text-ink" title={firstLine(commit.message)}>
                      {firstLine(commit.message)}
                    </span>
                  </div>
                  <div class="mt-0.5 text-xs text-ink-muted">
                    {commit.author_login ?? commit.author_name ?? "unknown"} · {commit.repo_full_name} ·{" "}
                    {timeAgo(commit.author_ts)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export function DashboardPage({ d }: { d: DashboardData }) {
  return (
    <div>
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-xl font-semibold text-ink">Dashboard</h1>
        <select
          name="scope"
          class="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink"
          hx-get="/"
          hx-target="#dashboard-content"
          hx-swap="outerHTML"
          hx-push-url="true"
          aria-label="Scope"
        >
          <option value="" selected={d.scope === ""}>
            All activity
          </option>
          {d.orgs.length > 0 ? (
            <optgroup label="Organizations">
              {d.orgs.map((o) => (
                <option value={`o:${o.id}`} selected={d.scope === `o:${o.id}`}>
                  {o.login}
                </option>
              ))}
            </optgroup>
          ) : null}
          {d.repos.length > 0 ? (
            <optgroup label="Repositories">
              {d.repos.map((r) => (
                <option value={`r:${r.id}`} selected={d.scope === `r:${r.id}`}>
                  {r.full_name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </div>
      <DashboardContent d={d} />
    </div>
  );
}
