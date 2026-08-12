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
  {
    version: 2,
    name: "github app, installations, webhooks",
    sql: `
      ALTER TABLE repositories ADD COLUMN installation_id INTEGER;
      ALTER TABLE organizations ADD COLUMN installation_id INTEGER;

      -- Single-row table holding this deployment's GitHub App credentials
      -- (created via the app-manifest flow, Dokploy-style).
      CREATE TABLE github_app (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        app_id INTEGER NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        client_id TEXT,
        client_secret TEXT,
        private_key TEXT NOT NULL,
        webhook_secret TEXT NOT NULL,
        html_url TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE installations (
        id INTEGER PRIMARY KEY,
        account_login TEXT NOT NULL,
        account_type TEXT NOT NULL DEFAULT 'Organization',
        suspended INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_event_at INTEGER
      );

      CREATE TABLE webhook_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        delivery_id TEXT,
        event TEXT NOT NULL,
        action TEXT,
        repo_full_name TEXT,
        status TEXT NOT NULL,
        note TEXT,
        received_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX idx_webhook_events_received ON webhook_events(received_at DESC);
    `,
  },
  {
    version: 3,
    name: "people, identities, settings",
    sql: `
      CREATE TABLE app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        company_name TEXT NOT NULL DEFAULT 'My Software House',
        base_currency TEXT NOT NULL DEFAULT 'PKR'
          CHECK (length(base_currency) = 3 AND base_currency = upper(base_currency)),
        payroll_currency TEXT NOT NULL DEFAULT 'PKR'
          CHECK (length(payroll_currency) = 3 AND payroll_currency = upper(payroll_currency)),
        fiscal_year_start_month INTEGER NOT NULL DEFAULT 7 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO app_settings (id) VALUES (1);

      CREATE TABLE employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        full_name TEXT NOT NULL COLLATE NOCASE,
        work_email TEXT UNIQUE COLLATE NOCASE,
        phone TEXT,
        designation TEXT,
        department TEXT,
        employment_type TEXT NOT NULL DEFAULT 'full_time'
          CHECK (employment_type IN ('full_time','part_time','contract','intern')),
        joined_on TEXT NOT NULL CHECK (joined_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        exited_on TEXT CHECK (exited_on IS NULL OR exited_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_leave','notice','exited')),
        avatar_url TEXT,
        notes TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        archived_at INTEGER,
        CHECK (exited_on IS NULL OR exited_on >= joined_on)
      );
      CREATE INDEX idx_employees_status ON employees(status, archived_at);

      -- Append-only. A row is in force from effective_from until the next row starts.
      -- No effective_to: one boundary per row means gaps and overlaps are unrepresentable.
      CREATE TABLE employee_compensation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        effective_from TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        currency TEXT NOT NULL DEFAULT 'PKR' CHECK (length(currency) = 3 AND currency = upper(currency)),
        base_monthly_minor INTEGER NOT NULL CHECK (base_monthly_minor >= 0),
        reason TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE (employee_id, effective_from)
      );

      -- One identity belongs to exactly one employee. That UNIQUE is what guarantees
      -- the commit->employee join can never fan out, so COUNT(*) over it is a true count.
      CREATE TABLE employee_identities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('login','email')),
        value TEXT NOT NULL COLLATE NOCASE,
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','suggested','import')),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE (kind, value)
      );
      CREATE INDEX idx_employee_identities_employee ON employee_identities(employee_id, kind);

      -- Bots and one-off outside contributors. Without this the mapping inbox never
      -- reaches zero and the whole identity feature is abandoned in week one.
      CREATE TABLE ignored_authors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('login','email','pattern')),
        value TEXT NOT NULL COLLATE NOCASE,
        note TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE (kind, value)
      );
      INSERT INTO ignored_authors (kind, value, note) VALUES
        ('pattern','%[bot]','GitHub bot accounts'),
        ('login','dependabot','Dependabot'),
        ('login','github-actions','GitHub Actions'),
        ('login','renovate','Renovate');

      -- GitHub logins and git emails are case-insensitive; the v1 indexes are BINARY.
      CREATE INDEX idx_commits_author_login_ci ON commits(author_login COLLATE NOCASE);
      CREATE INDEX idx_commits_author_email_ci ON commits(author_email COLLATE NOCASE);

      -- Commit -> employee. Login wins over email. NULL = unmapped.
      -- Emits exactly one row per commit (UNIQUE(kind,value) prevents fan-out).
      CREATE VIEW v_commit_employee AS
      SELECT c.id AS commit_id, c.repo_id AS repo_id, c.author_ts AS author_ts,
             COALESCE(il.employee_id, ie.employee_id) AS employee_id
      FROM commits c
      LEFT JOIN employee_identities il ON il.kind = 'login' AND il.value = c.author_login
      LEFT JOIN employee_identities ie ON ie.kind = 'email' AND ie.value = c.author_email;
    `,
  },
];
