import { Hono } from "hono";
import type { Context } from "hono";
import { randomBytes } from "node:crypto";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import type { CommitFilters, Store } from "../db/store.ts";
import { GitHubError, NotFoundError, RateLimitError } from "../github/client.ts";
import type { GitHubAppService } from "../github/app.ts";
import type { SyncService } from "../sync/service.ts";
import { tzOffsetSeconds } from "./format.ts";
import { Layout } from "./views/Layout.tsx";
import { DashboardContent, DashboardPage, type DashboardData } from "./views/DashboardPage.tsx";
import { CommitRows, CommitsPage, CommitsTable, type CommitsQuery } from "./views/CommitsPage.tsx";
import { RepoRowView, ReposPage } from "./views/ReposPage.tsx";
import { OrgRowView, OrgsPage } from "./views/OrgsPage.tsx";
import { ManifestForm, SettingsPage, type SettingsData } from "./views/SettingsPage.tsx";

const PER_PAGE = 50;

function page(c: Context, el: { toString(): string | Promise<string> }) {
  const body = el.toString();
  if (typeof body === "string") return c.html(`<!DOCTYPE html>${body}`);
  return body.then((s) => c.html(`<!DOCTYPE html>${s}`));
}

/** HTMX fragment responses — no doctype. */
function partial(c: Context, el: Parameters<Context["html"]>[0]) {
  return c.html(el);
}

function friendlyError(err: unknown): string {
  if (err instanceof NotFoundError) {
    return "Not found on GitHub — check the name, or set GITHUB_TOKEN to access private resources.";
  }
  if (err instanceof RateLimitError) return err.message;
  if (err instanceof GitHubError) return `GitHub API error (${err.status}).`;
  return err instanceof Error ? err.message : "Unexpected error.";
}

function parseScope(scope: string): { filters: CommitFilters; orgId?: number; repoId?: number } {
  const m = /^([or]):(\d+)$/.exec(scope);
  if (!m) return { filters: {} };
  const id = Number(m[2]);
  if (m[1] === "o") return { filters: { orgId: id }, orgId: id };
  return { filters: { repoId: id }, repoId: id };
}

export function createRoutes(store: Store, sync: SyncService, appSvc: GitHubAppService): Hono {
  const app = new Hono();

  // One-time state tokens for the GitHub App manifest hand-off (15 min TTL).
  const manifestStates = new Map<string, number>();
  const pruneStates = () => {
    const now = Date.now();
    for (const [k, exp] of manifestStates) if (exp < now) manifestStates.delete(k);
  };

  // ---- dashboard ----

  app.get("/", (c) => {
    const rawScope = c.req.query("scope") ?? "";
    const { filters, orgId, repoId } = parseScope(rawScope);
    const scope = orgId !== undefined || repoId !== undefined ? rawScope : "";
    const now = Math.floor(Date.now() / 1000);
    const days = 30;
    const orgs = store.listOrgs();
    const repos = store.listRepos();

    const d: DashboardData = {
      scope,
      totalCommits: store.countCommits(filters),
      commits7d: store.countCommits({ ...filters, sinceTs: now - 7 * 86400 }),
      commitsPrev7d: store.countCommits({
        ...filters,
        sinceTs: now - 14 * 86400,
        untilTs: now - 7 * 86400,
      }),
      repoCount:
        repoId !== undefined
          ? 1
          : orgId !== undefined
            ? repos.filter((r) => r.org_id === orgId).length
            : repos.length,
      orgCount: orgs.length,
      authorCount: store.distinctAuthorCount(filters),
      perDay: store.commitsPerDay(filters, days, tzOffsetSeconds, now),
      days,
      byHour: store.commitsByHour(filters, tzOffsetSeconds),
      byWeekday: store.commitsByWeekday(filters, tzOffsetSeconds),
      punchcard: store.punchcard(filters, tzOffsetSeconds),
      topAuthors: store.topAuthors(filters, 10),
      recent: store.listCommits(filters, 10, 0),
      orgs,
      repos,
    };

    if (c.req.header("HX-Target") === "dashboard-content") {
      return partial(c, <DashboardContent d={d} />);
    }
    return page(
      c,
      <Layout title="Dashboard" active="dashboard">
        <DashboardPage d={d} />
      </Layout>,
    );
  });

  // ---- commits ----

  function parseCommitsQuery(c: Context): { filters: CommitFilters; q: CommitsQuery } {
    const repo = c.req.query("repo") ?? "";
    const author = (c.req.query("author") ?? "").trim();
    const q = (c.req.query("q") ?? "").trim();
    const from = c.req.query("from") ?? "";
    const to = c.req.query("to") ?? "";
    // "f" marks a real form submission: an unchecked checkbox sends nothing,
    // while the initial page load (no params) should default merges to on.
    const fromForm = c.req.query("f") !== undefined;
    const merges = fromForm ? c.req.query("merges") === "1" : true;
    const pageNum = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);

    const filters: CommitFilters = {};
    if (/^\d+$/.test(repo)) filters.repoId = Number(repo);
    if (author) filters.author = author;
    if (q) filters.q = q;
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      filters.sinceTs = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000) - tzOffsetSeconds;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      filters.untilTs = Math.floor(Date.parse(`${to}T00:00:00Z`) / 1000) - tzOffsetSeconds + 86400;
    }
    if (!merges) filters.includeMerges = false;
    return { filters, q: { repo, author, q, from, to, merges, page: pageNum } };
  }

  app.get("/commits", (c) => {
    const { filters, q } = parseCommitsQuery(c);
    const commits = store.listCommits(filters, PER_PAGE, (q.page - 1) * PER_PAGE);
    const total = store.countCommits(filters);
    return page(
      c,
      <Layout title="Commits" active="commits">
        <CommitsPage commits={commits} filters={q} total={total} perPage={PER_PAGE} repos={store.listRepos()} />
      </Layout>,
    );
  });

  app.get("/commits/table", (c) => {
    const { filters, q } = parseCommitsQuery(c);
    const commits = store.listCommits(filters, PER_PAGE, (q.page - 1) * PER_PAGE);
    const total = store.countCommits(filters);
    return partial(c, <CommitsTable commits={commits} filters={q} total={total} perPage={PER_PAGE} />);
  });

  app.get("/commits/rows", (c) => {
    const { filters, q } = parseCommitsQuery(c);
    const commits = store.listCommits(filters, PER_PAGE, (q.page - 1) * PER_PAGE);
    return partial(c, <CommitRows commits={commits} filters={q} perPage={PER_PAGE} />);
  });

  // ---- repositories ----

  app.get("/repos", (c) => {
    return page(
      c,
      <Layout title="Repositories" active="repos">
        <ReposPage repos={store.listRepos()} runs={store.recentSyncRuns(15)} />
      </Layout>,
    );
  });

  app.post("/repos", async (c) => {
    const form = await c.req.parseBody();
    const fullName = String(form.full_name ?? "").trim();
    try {
      await sync.addRepo(fullName);
      c.header("HX-Redirect", "/repos");
      return c.text("ok");
    } catch (err) {
      log.warn("add repo failed", { fullName, err: String(err) });
      return c.html(<span>{friendlyError(err)}</span>);
    }
  });

  app.get("/repos/:id/row", (c) => {
    const repo = store.getRepo(Number(c.req.param("id")));
    if (!repo) return c.notFound();
    return partial(c, <RepoRowView repo={repo} />);
  });

  app.post("/repos/:id/sync", (c) => {
    const id = Number(c.req.param("id"));
    const repo = store.getRepo(id);
    if (!repo) return c.notFound();
    if (repo.sync_status !== "syncing") {
      store.setRepoSync(id, "pending");
      sync.queueRepoSync(id);
    }
    const fresh = store.getRepo(id);
    return partial(c, <RepoRowView repo={fresh ?? repo} />);
  });

  app.delete("/repos/:id", (c) => {
    store.deleteRepo(Number(c.req.param("id")));
    return c.body(null, 200);
  });

  // ---- organizations ----

  app.get("/orgs", (c) => {
    return page(
      c,
      <Layout title="Organizations" active="orgs">
        <OrgsPage orgs={store.listOrgs()} />
      </Layout>,
    );
  });

  app.post("/orgs", async (c) => {
    const form = await c.req.parseBody();
    // Be liberal in what we accept: a login, "@login", or a pasted GitHub URL.
    const login = String(form.login ?? "")
      .trim()
      .replace(/^https?:\/\/[^/]+\//i, "")
      .replace(/^@/, "")
      .replace(/[/?#].*$/, "");
    if (!login || !/^[a-zA-Z0-9-]+$/.test(login)) {
      return c.html(
        <span>Enter a GitHub organization or user — a login like "vercel", or its GitHub URL.</span>,
      );
    }
    try {
      await sync.addOrg(login);
      c.header("HX-Redirect", "/orgs");
      return c.text("ok");
    } catch (err) {
      log.warn("add org failed", { login, err: String(err) });
      return c.html(<span>{friendlyError(err)}</span>);
    }
  });

  app.get("/orgs/:id/row", (c) => {
    const org = store.getOrg(Number(c.req.param("id")));
    if (!org) return c.notFound();
    return partial(c, <OrgRowView org={org} />);
  });

  app.post("/orgs/:id/sync", (c) => {
    const id = Number(c.req.param("id"));
    const org = store.getOrg(id);
    if (!org) return c.notFound();
    if (org.sync_status !== "syncing") {
      store.setOrgSync(id, "syncing");
      sync.discoverOrgRepos(id).catch((err) =>
        log.error("org discovery failed", { org: org.login, err: String(err) }),
      );
    }
    const fresh = store.getOrg(id);
    return partial(c, <OrgRowView org={fresh ?? org} />);
  });

  app.delete("/orgs/:id", (c) => {
    store.deleteOrg(Number(c.req.param("id")));
    return c.body(null, 200);
  });

  // ---- settings / github app ----

  app.get("/settings", (c) => {
    const d: SettingsData = {
      app: appSvc.app,
      installations: store.listInstallations(),
      events: store.recentWebhookEvents(20),
      webhookUrl: `${config.baseUrl}/webhooks/github`,
      baseUrl: config.baseUrl,
      baseUrlIsLocal: /localhost|127\.0\.0\.1/.test(config.baseUrl),
      manualSecretSet: config.webhookSecret !== undefined,
      patSet: config.githubToken !== undefined,
    };
    return page(
      c,
      <Layout title="Settings" active="settings">
        <SettingsPage d={d} />
      </Layout>,
    );
  });

  app.get("/settings/github-app/new", (c) => {
    pruneStates();
    const org = (c.req.query("org") ?? "").trim();
    const state = randomBytes(16).toString("hex");
    manifestStates.set(state, Date.now() + 15 * 60_000);
    return partial(
      c,
      <ManifestForm
        targetUrl={appSvc.manifestTargetUrl(org || undefined, state)}
        manifestJson={JSON.stringify(appSvc.buildManifest())}
        org={org}
      />,
    );
  });

  app.get("/settings/github-app/callback", async (c) => {
    pruneStates();
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!state || !manifestStates.delete(state)) {
      return c.text("Invalid or expired state — restart app creation from Settings.", 400);
    }
    if (!code) return c.text("Missing code parameter.", 400);
    try {
      await appSvc.convertManifestCode(code);
      return c.redirect("/settings");
    } catch (err) {
      log.error("manifest conversion failed", { err: String(err) });
      return c.text(`GitHub App creation failed: ${friendlyError(err)}`, 502);
    }
  });

  app.delete("/settings/github-app", (c) => {
    for (const inst of store.listInstallations()) {
      store.removeInstallation(inst.id);
    }
    appSvc.forget();
    c.header("HX-Redirect", "/settings");
    return c.text("ok");
  });

  return app;
}
