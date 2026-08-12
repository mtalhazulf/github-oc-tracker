import type { Database } from "bun:sqlite";

export interface OrgRow {
  id: number;
  login: string;
  name: string | null;
  kind: "org" | "user";
  avatar_url: string | null;
  html_url: string | null;
  added_at: number;
  last_synced_at: number | null;
  sync_status: "idle" | "syncing" | "error";
  sync_error: string | null;
  installation_id: number | null;
  repo_count: number;
  commit_count: number;
}

export interface RepoRow {
  id: number;
  github_id: number | null;
  org_id: number | null;
  owner: string;
  name: string;
  full_name: string;
  description: string | null;
  default_branch: string | null;
  private: number;
  fork: number;
  archived: number;
  html_url: string | null;
  added_at: number;
  last_synced_at: number | null;
  sync_status: "pending" | "syncing" | "idle" | "error";
  sync_error: string | null;
  tracked: number;
  installation_id: number | null;
  org_login: string | null;
  commit_count: number;
}

export interface GithubAppRow {
  id: number;
  app_id: number;
  slug: string;
  name: string;
  client_id: string | null;
  client_secret: string | null;
  private_key: string;
  webhook_secret: string;
  html_url: string;
  created_at: number;
}

export interface InstallationRow {
  id: number;
  account_login: string;
  account_type: string;
  suspended: number;
  created_at: number;
  last_event_at: number | null;
  repo_count: number;
}

export interface WebhookEventRow {
  id: number;
  delivery_id: string | null;
  event: string;
  action: string | null;
  repo_full_name: string | null;
  status: string;
  note: string | null;
  received_at: number;
}

export interface CommitRow {
  id: number;
  repo_id: number;
  sha: string;
  message: string;
  author_name: string | null;
  author_email: string | null;
  author_login: string | null;
  author_avatar_url: string | null;
  author_ts: number;
  committer_name: string | null;
  committer_email: string | null;
  committer_ts: number | null;
  is_merge: number;
  html_url: string | null;
  repo_full_name: string;
}

export interface NewCommit {
  sha: string;
  message: string;
  authorName: string | null;
  authorEmail: string | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  authorTs: number;
  committerName: string | null;
  committerEmail: string | null;
  committerTs: number | null;
  isMerge: boolean;
  htmlUrl: string | null;
}

export interface NewRepo {
  githubId: number | null;
  orgId: number | null;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  defaultBranch: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  htmlUrl: string | null;
  installationId?: number | null;
}

export interface CommitFilters {
  repoId?: number;
  orgId?: number;
  author?: string;
  q?: string;
  sinceTs?: number;
  untilTs?: number;
  includeMerges?: boolean;
}

export interface SyncRunRow {
  id: number;
  repo_id: number;
  started_at: number;
  finished_at: number | null;
  status: "running" | "success" | "error";
  commits_added: number;
  error: string | null;
  repo_full_name: string;
}

function commitWhere(filters: CommitFilters): { clause: string; params: (string | number)[] } {
  const parts: string[] = [];
  const params: (string | number)[] = [];
  if (filters.repoId !== undefined) {
    parts.push("c.repo_id = ?");
    params.push(filters.repoId);
  }
  if (filters.orgId !== undefined) {
    parts.push("r.org_id = ?");
    params.push(filters.orgId);
  }
  if (filters.author) {
    parts.push(
      "(c.author_login LIKE ? OR c.author_name LIKE ? OR c.author_email LIKE ?)",
    );
    const like = `%${filters.author}%`;
    params.push(like, like, like);
  }
  if (filters.q) {
    parts.push("(c.message LIKE ? OR c.sha LIKE ?)");
    params.push(`%${filters.q}%`, `${filters.q}%`);
  }
  if (filters.sinceTs !== undefined) {
    parts.push("c.author_ts >= ?");
    params.push(filters.sinceTs);
  }
  if (filters.untilTs !== undefined) {
    parts.push("c.author_ts < ?");
    params.push(filters.untilTs);
  }
  if (filters.includeMerges === false) {
    parts.push("c.is_merge = 0");
  }
  return { clause: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "", params };
}

const AUTHOR_KEY =
  "COALESCE(NULLIF(c.author_login, ''), NULLIF(c.author_name, ''), NULLIF(c.author_email, ''), 'unknown')";

export function createStore(db: Database) {
  return {
    // ---- organizations ----

    insertOrg(o: {
      login: string;
      name: string | null;
      kind: "org" | "user";
      avatarUrl: string | null;
      htmlUrl: string | null;
    }): number {
      db.query(
        `INSERT INTO organizations (login, name, kind, avatar_url, html_url)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(login) DO UPDATE SET name = excluded.name, avatar_url = excluded.avatar_url, html_url = excluded.html_url`,
      ).run(o.login, o.name, o.kind, o.avatarUrl, o.htmlUrl);
      const row = db
        .query("SELECT id FROM organizations WHERE login = ?")
        .get(o.login) as { id: number };
      return row.id;
    },

    getOrg(id: number): OrgRow | null {
      return (db
        .query(
          `SELECT o.*,
             (SELECT COUNT(*) FROM repositories r WHERE r.org_id = o.id) AS repo_count,
             (SELECT COUNT(*) FROM commits c JOIN repositories r ON r.id = c.repo_id WHERE r.org_id = o.id) AS commit_count
           FROM organizations o WHERE o.id = ?`,
        )
        .get(id) as OrgRow | undefined) ?? null;
    },

    getOrgByLogin(login: string): OrgRow | null {
      return (db
        .query(
          `SELECT o.*, 0 AS repo_count, 0 AS commit_count FROM organizations o WHERE o.login = ?`,
        )
        .get(login) as OrgRow | undefined) ?? null;
    },

    listOrgs(): OrgRow[] {
      return db
        .query(
          `SELECT o.*,
             (SELECT COUNT(*) FROM repositories r WHERE r.org_id = o.id) AS repo_count,
             (SELECT COUNT(*) FROM commits c JOIN repositories r ON r.id = c.repo_id WHERE r.org_id = o.id) AS commit_count
           FROM organizations o ORDER BY o.login`,
        )
        .all() as OrgRow[];
    },

    deleteOrg(id: number): void {
      db.query("DELETE FROM organizations WHERE id = ?").run(id);
    },

    setOrgSync(id: number, status: "idle" | "syncing" | "error", error: string | null = null): void {
      db.query("UPDATE organizations SET sync_status = ?, sync_error = ? WHERE id = ?").run(
        status,
        error,
        id,
      );
    },

    markOrgSynced(id: number): void {
      db.query(
        "UPDATE organizations SET last_synced_at = unixepoch(), sync_status = 'idle', sync_error = NULL WHERE id = ?",
      ).run(id);
    },

    // ---- repositories ----

    upsertRepo(r: NewRepo): { id: number; inserted: boolean } {
      // Match by immutable GitHub id first so renames/transfers update in place.
      const existing = (r.githubId !== null
        ? (db
            .query("SELECT id FROM repositories WHERE github_id = ?")
            .get(r.githubId) as { id: number } | undefined)
        : undefined) ??
        (db
          .query("SELECT id FROM repositories WHERE full_name = ?")
          .get(r.fullName) as { id: number } | undefined);
      if (existing) {
        db.query(
          `UPDATE repositories SET github_id = COALESCE(?, github_id), org_id = COALESCE(?, org_id),
             owner = ?, name = ?, full_name = ?,
             description = ?, default_branch = ?, private = ?, fork = ?, archived = ?, html_url = ?,
             installation_id = COALESCE(?, installation_id)
           WHERE id = ?`,
        ).run(
          r.githubId,
          r.orgId,
          r.owner,
          r.name,
          r.fullName,
          r.description,
          r.defaultBranch,
          r.isPrivate ? 1 : 0,
          r.isFork ? 1 : 0,
          r.isArchived ? 1 : 0,
          r.htmlUrl,
          r.installationId ?? null,
          existing.id,
        );
        return { id: existing.id, inserted: false };
      }
      const res = db
        .query(
          `INSERT INTO repositories (github_id, org_id, owner, name, full_name, description, default_branch, private, fork, archived, html_url, installation_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          r.githubId,
          r.orgId,
          r.owner,
          r.name,
          r.fullName,
          r.description,
          r.defaultBranch,
          r.isPrivate ? 1 : 0,
          r.isFork ? 1 : 0,
          r.isArchived ? 1 : 0,
          r.htmlUrl,
          r.installationId ?? null,
        );
      return { id: Number(res.lastInsertRowid), inserted: true };
    },

    getRepoByGithubId(githubId: number): RepoRow | null {
      return (db
        .query(
          `SELECT r.*, NULL AS org_login, 0 AS commit_count FROM repositories r WHERE r.github_id = ?`,
        )
        .get(githubId) as RepoRow | undefined) ?? null;
    },

    getRepo(id: number): RepoRow | null {
      return (db
        .query(
          `SELECT r.*, o.login AS org_login,
             (SELECT COUNT(*) FROM commits c WHERE c.repo_id = r.id) AS commit_count
           FROM repositories r LEFT JOIN organizations o ON o.id = r.org_id WHERE r.id = ?`,
        )
        .get(id) as RepoRow | undefined) ?? null;
    },

    getRepoByFullName(fullName: string): RepoRow | null {
      return (db
        .query(
          `SELECT r.*, NULL AS org_login, 0 AS commit_count FROM repositories r WHERE r.full_name = ?`,
        )
        .get(fullName) as RepoRow | undefined) ?? null;
    },

    listRepos(orgId?: number): RepoRow[] {
      const where = orgId !== undefined ? "WHERE r.org_id = ?" : "";
      const params = orgId !== undefined ? [orgId] : [];
      return db
        .query(
          `SELECT r.*, o.login AS org_login,
             (SELECT COUNT(*) FROM commits c WHERE c.repo_id = r.id) AS commit_count
           FROM repositories r LEFT JOIN organizations o ON o.id = r.org_id
           ${where} ORDER BY r.full_name`,
        )
        .all(...params) as RepoRow[];
    },

    listTrackedRepos(): RepoRow[] {
      return db
        .query(
          `SELECT r.*, NULL AS org_login, 0 AS commit_count FROM repositories r WHERE r.tracked = 1 ORDER BY r.last_synced_at ASC NULLS FIRST`,
        )
        .all() as RepoRow[];
    },

    deleteRepo(id: number): void {
      db.query("DELETE FROM repositories WHERE id = ?").run(id);
    },

    setRepoSync(
      id: number,
      status: "pending" | "syncing" | "idle" | "error",
      error: string | null = null,
    ): void {
      db.query("UPDATE repositories SET sync_status = ?, sync_error = ? WHERE id = ?").run(
        status,
        error,
        id,
      );
    },

    markRepoSynced(id: number): void {
      db.query(
        "UPDATE repositories SET last_synced_at = unixepoch(), sync_status = 'idle', sync_error = NULL WHERE id = ?",
      ).run(id);
    },

    maxCommitterTs(repoId: number): number | null {
      const row = db
        .query("SELECT MAX(COALESCE(committer_ts, author_ts)) AS m FROM commits WHERE repo_id = ?")
        .get(repoId) as { m: number | null };
      return row.m;
    },

    // ---- commits ----

    insertCommits(repoId: number, commits: NewCommit[]): number {
      if (commits.length === 0) return 0;
      const stmt = db.query(
        `INSERT INTO commits (repo_id, sha, message, author_name, author_email, author_login, author_avatar_url,
           author_ts, committer_name, committer_email, committer_ts, is_merge, html_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, sha) DO NOTHING`,
      );
      let inserted = 0;
      const insertAll = db.transaction((batch: NewCommit[]) => {
        for (const c of batch) {
          const res = stmt.run(
            repoId,
            c.sha,
            c.message,
            c.authorName,
            c.authorEmail,
            c.authorLogin,
            c.authorAvatarUrl,
            c.authorTs,
            c.committerName,
            c.committerEmail,
            c.committerTs,
            c.isMerge ? 1 : 0,
            c.htmlUrl,
          );
          inserted += res.changes;
        }
      });
      insertAll(commits);
      return inserted;
    },

    countCommits(filters: CommitFilters = {}): number {
      const { clause, params } = commitWhere(filters);
      const row = db
        .query(
          `SELECT COUNT(*) AS n FROM commits c JOIN repositories r ON r.id = c.repo_id ${clause}`,
        )
        .get(...params) as { n: number };
      return row.n;
    },

    listCommits(filters: CommitFilters = {}, limit = 50, offset = 0): CommitRow[] {
      const { clause, params } = commitWhere(filters);
      return db
        .query(
          `SELECT c.*, r.full_name AS repo_full_name
           FROM commits c JOIN repositories r ON r.id = c.repo_id
           ${clause} ORDER BY c.author_ts DESC, c.id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as CommitRow[];
    },

    distinctAuthorCount(filters: CommitFilters = {}): number {
      const { clause, params } = commitWhere(filters);
      const row = db
        .query(
          `SELECT COUNT(DISTINCT ${AUTHOR_KEY}) AS n
           FROM commits c JOIN repositories r ON r.id = c.repo_id ${clause}`,
        )
        .get(...params) as { n: number };
      return row.n;
    },

    // ---- analytics (tz-aware via a fixed offset in seconds) ----

    commitsPerDay(
      filters: CommitFilters,
      days: number,
      tzOffsetSeconds: number,
      nowTs: number,
    ): { day: string; n: number }[] {
      const sinceTs = nowTs - days * 86400;
      const { clause, params } = commitWhere({ ...filters, sinceTs });
      return db
        .query(
          `SELECT date(c.author_ts + ?, 'unixepoch') AS day, COUNT(*) AS n
           FROM commits c JOIN repositories r ON r.id = c.repo_id
           ${clause} GROUP BY day ORDER BY day`,
        )
        .all(tzOffsetSeconds, ...params) as { day: string; n: number }[];
    },

    commitsByHour(filters: CommitFilters, tzOffsetSeconds: number): { hour: number; n: number }[] {
      const { clause, params } = commitWhere(filters);
      return db
        .query(
          `SELECT CAST(strftime('%H', c.author_ts + ?, 'unixepoch') AS INTEGER) AS hour, COUNT(*) AS n
           FROM commits c JOIN repositories r ON r.id = c.repo_id
           ${clause} GROUP BY hour ORDER BY hour`,
        )
        .all(tzOffsetSeconds, ...params) as { hour: number; n: number }[];
    },

    commitsByWeekday(
      filters: CommitFilters,
      tzOffsetSeconds: number,
    ): { weekday: number; n: number }[] {
      // weekday: 0 = Sunday … 6 = Saturday (SQLite %w)
      const { clause, params } = commitWhere(filters);
      return db
        .query(
          `SELECT CAST(strftime('%w', c.author_ts + ?, 'unixepoch') AS INTEGER) AS weekday, COUNT(*) AS n
           FROM commits c JOIN repositories r ON r.id = c.repo_id
           ${clause} GROUP BY weekday ORDER BY weekday`,
        )
        .all(tzOffsetSeconds, ...params) as { weekday: number; n: number }[];
    },

    punchcard(
      filters: CommitFilters,
      tzOffsetSeconds: number,
    ): { weekday: number; hour: number; n: number }[] {
      const { clause, params } = commitWhere(filters);
      return db
        .query(
          `SELECT CAST(strftime('%w', c.author_ts + ?, 'unixepoch') AS INTEGER) AS weekday,
                  CAST(strftime('%H', c.author_ts + ?, 'unixepoch') AS INTEGER) AS hour,
                  COUNT(*) AS n
           FROM commits c JOIN repositories r ON r.id = c.repo_id
           ${clause} GROUP BY weekday, hour`,
        )
        .all(tzOffsetSeconds, tzOffsetSeconds, ...params) as {
        weekday: number;
        hour: number;
        n: number;
      }[];
    },

    topAuthors(
      filters: CommitFilters,
      limit = 10,
    ): { author: string; login: string | null; avatar: string | null; n: number; last_ts: number }[] {
      const { clause, params } = commitWhere(filters);
      return db
        .query(
          `SELECT ${AUTHOR_KEY} AS author,
                  MAX(c.author_login) AS login,
                  MAX(c.author_avatar_url) AS avatar,
                  COUNT(*) AS n,
                  MAX(c.author_ts) AS last_ts
           FROM commits c JOIN repositories r ON r.id = c.repo_id
           ${clause} GROUP BY author ORDER BY n DESC LIMIT ?`,
        )
        .all(...params, limit) as {
        author: string;
        login: string | null;
        avatar: string | null;
        n: number;
        last_ts: number;
      }[];
    },

    // ---- github app / installations / webhooks ----

    getGithubApp(): GithubAppRow | null {
      return (db.query("SELECT * FROM github_app WHERE id = 1").get() as GithubAppRow | undefined) ?? null;
    },

    saveGithubApp(a: {
      appId: number;
      slug: string;
      name: string;
      clientId: string | null;
      clientSecret: string | null;
      privateKey: string;
      webhookSecret: string;
      htmlUrl: string;
    }): void {
      db.query(
        `INSERT INTO github_app (id, app_id, slug, name, client_id, client_secret, private_key, webhook_secret, html_url)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET app_id = excluded.app_id, slug = excluded.slug, name = excluded.name,
           client_id = excluded.client_id, client_secret = excluded.client_secret,
           private_key = excluded.private_key, webhook_secret = excluded.webhook_secret, html_url = excluded.html_url`,
      ).run(a.appId, a.slug, a.name, a.clientId, a.clientSecret, a.privateKey, a.webhookSecret, a.htmlUrl);
    },

    deleteGithubApp(): void {
      db.query("DELETE FROM github_app WHERE id = 1").run();
    },

    upsertInstallation(i: { id: number; accountLogin: string; accountType: string }): void {
      db.query(
        `INSERT INTO installations (id, account_login, account_type, last_event_at)
         VALUES (?, ?, ?, unixepoch())
         ON CONFLICT(id) DO UPDATE SET account_login = excluded.account_login,
           account_type = excluded.account_type, suspended = 0, last_event_at = unixepoch()`,
      ).run(i.id, i.accountLogin, i.accountType);
    },

    getInstallation(id: number): InstallationRow | null {
      return (db
        .query(
          `SELECT i.*, (SELECT COUNT(*) FROM repositories r WHERE r.installation_id = i.id) AS repo_count
           FROM installations i WHERE i.id = ?`,
        )
        .get(id) as InstallationRow | undefined) ?? null;
    },

    findInstallationByLogin(login: string): InstallationRow | null {
      return (db
        .query(
          `SELECT i.*, 0 AS repo_count FROM installations i WHERE i.account_login = ? COLLATE NOCASE`,
        )
        .get(login) as InstallationRow | undefined) ?? null;
    },

    listInstallations(): InstallationRow[] {
      return db
        .query(
          `SELECT i.*, (SELECT COUNT(*) FROM repositories r WHERE r.installation_id = i.id) AS repo_count
           FROM installations i ORDER BY i.account_login`,
        )
        .all() as InstallationRow[];
    },

    setInstallationSuspended(id: number, suspended: boolean): void {
      db.query("UPDATE installations SET suspended = ?, last_event_at = unixepoch() WHERE id = ?").run(
        suspended ? 1 : 0,
        id,
      );
    },

    touchInstallation(id: number): void {
      db.query("UPDATE installations SET last_event_at = unixepoch() WHERE id = ?").run(id);
    },

    /** Installation uninstalled: keep tracked history, but detach and flag repos. */
    removeInstallation(id: number): void {
      const detach = db.transaction(() => {
        db.query(
          `UPDATE repositories SET installation_id = NULL, sync_status = 'error',
             sync_error = 'GitHub App installation was removed'
           WHERE installation_id = ?`,
        ).run(id);
        db.query("UPDATE organizations SET installation_id = NULL WHERE installation_id = ?").run(id);
        db.query("DELETE FROM installations WHERE id = ?").run(id);
      });
      detach();
    },

    detachRepoFromInstallation(githubId: number): void {
      db.query(
        `UPDATE repositories SET installation_id = NULL, sync_status = 'error',
           sync_error = 'Repository was removed from the GitHub App installation'
         WHERE github_id = ?`,
      ).run(githubId);
    },

    setOrgInstallation(orgId: number, installationId: number | null): void {
      db.query("UPDATE organizations SET installation_id = ? WHERE id = ?").run(installationId, orgId);
    },

    insertWebhookEvent(e: {
      deliveryId: string | null;
      event: string;
      action: string | null;
      repoFullName: string | null;
      status: string;
      note: string | null;
    }): void {
      db.query(
        `INSERT INTO webhook_events (delivery_id, event, action, repo_full_name, status, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(e.deliveryId, e.event, e.action, e.repoFullName, e.status, e.note);
      // Keep the log bounded.
      db.query(
        `DELETE FROM webhook_events WHERE id NOT IN (SELECT id FROM webhook_events ORDER BY id DESC LIMIT 500)`,
      ).run();
    },

    recentWebhookEvents(limit = 20): WebhookEventRow[] {
      return db
        .query("SELECT * FROM webhook_events ORDER BY id DESC LIMIT ?")
        .all(limit) as WebhookEventRow[];
    },

    // ---- sync runs ----

    startSyncRun(repoId: number): number {
      const res = db.query("INSERT INTO sync_runs (repo_id) VALUES (?)").run(repoId);
      return Number(res.lastInsertRowid);
    },

    finishSyncRun(
      id: number,
      status: "success" | "error",
      commitsAdded: number,
      error: string | null = null,
    ): void {
      db.query(
        "UPDATE sync_runs SET finished_at = unixepoch(), status = ?, commits_added = ?, error = ? WHERE id = ?",
      ).run(status, commitsAdded, error, id);
    },

    recentSyncRuns(limit = 20): SyncRunRow[] {
      return db
        .query(
          `SELECT s.*, r.full_name AS repo_full_name
           FROM sync_runs s JOIN repositories r ON r.id = s.repo_id
           ORDER BY s.started_at DESC, s.id DESC LIMIT ?`,
        )
        .all(limit) as SyncRunRow[];
    },
  };
}

export type Store = ReturnType<typeof createStore>;
