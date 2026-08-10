export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial schema",
    sql: `
      CREATE TABLE organizations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT,
        kind TEXT NOT NULL DEFAULT 'org' CHECK (kind IN ('org', 'user')),
        avatar_url TEXT,
        html_url TEXT,
        added_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_synced_at INTEGER,
        sync_status TEXT NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'error')),
        sync_error TEXT
      );

      CREATE TABLE repositories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        github_id INTEGER UNIQUE,
        org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        owner TEXT NOT NULL COLLATE NOCASE,
        name TEXT NOT NULL COLLATE NOCASE,
        full_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        description TEXT,
        default_branch TEXT,
        private INTEGER NOT NULL DEFAULT 0,
        fork INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        html_url TEXT,
        added_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_synced_at INTEGER,
        sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'syncing', 'idle', 'error')),
        sync_error TEXT,
        tracked INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX idx_repositories_org ON repositories(org_id);

      CREATE TABLE commits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        sha TEXT NOT NULL,
        message TEXT NOT NULL,
        author_name TEXT,
        author_email TEXT,
        author_login TEXT,
        author_avatar_url TEXT,
        author_ts INTEGER NOT NULL,
        committer_name TEXT,
        committer_email TEXT,
        committer_ts INTEGER,
        is_merge INTEGER NOT NULL DEFAULT 0,
        html_url TEXT,
        UNIQUE (repo_id, sha)
      );
      CREATE INDEX idx_commits_repo_ts ON commits(repo_id, author_ts DESC);
      CREATE INDEX idx_commits_ts ON commits(author_ts DESC);
      CREATE INDEX idx_commits_author_login ON commits(author_login);

      CREATE TABLE sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        started_at INTEGER NOT NULL DEFAULT (unixepoch()),
        finished_at INTEGER,
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
        commits_added INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE INDEX idx_sync_runs_repo ON sync_runs(repo_id, started_at DESC);
    `,
  },
];
