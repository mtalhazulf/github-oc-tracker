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
  {
    version: 4,
    name: "delivery: clients, projects, repo links",
    sql: `
      CREATE TABLE clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL COLLATE NOCASE,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('prospect','active','paused','churned')),
        currency TEXT NOT NULL DEFAULT 'PKR' CHECK (length(currency) = 3 AND currency = upper(currency)),
        country TEXT,
        website TEXT,
        contact_name TEXT,
        contact_email TEXT,
        billing_email TEXT,
        billing_address TEXT,
        tax_id TEXT,
        payment_terms_days INTEGER NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
        notes TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        archived_at INTEGER
      );

      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL COLLATE NOCASE,
        kind TEXT NOT NULL DEFAULT 'client'
          CHECK (kind IN ('client','internal_product','internal_ops')),
        client_id INTEGER REFERENCES clients(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('discovery','active','paused','completed','cancelled')),
        billing_model TEXT NOT NULL DEFAULT 'time_materials'
          CHECK (billing_model IN ('fixed_price','time_materials','retainer','none')),
        currency TEXT NOT NULL DEFAULT 'PKR' CHECK (length(currency) = 3 AND currency = upper(currency)),
        budget_minor INTEGER CHECK (budget_minor IS NULL OR budget_minor >= 0),
        rate_hourly_minor INTEGER CHECK (rate_hourly_minor IS NULL OR rate_hourly_minor >= 0),
        retainer_monthly_minor INTEGER CHECK (retainer_monthly_minor IS NULL OR retainer_monthly_minor >= 0),
        start_on TEXT CHECK (start_on IS NULL OR start_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        end_on TEXT CHECK (end_on IS NULL OR end_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        notes TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        archived_at INTEGER,
        -- Client work names its client; internal work cannot have one.
        CHECK ((kind = 'client') = (client_id IS NOT NULL)),
        -- Internal work is never invoiced.
        CHECK (kind = 'client' OR billing_model = 'none'),
        CHECK (end_on IS NULL OR start_on IS NULL OR end_on >= start_on)
      );
      CREATE INDEX idx_projects_client ON projects(client_id);
      CREATE INDEX idx_projects_status ON projects(status, archived_at);

      -- A project spans N repositories, and a shared library legitimately serves
      -- two engagements. Exactly one project may hold the PRIMARY link for a repo,
      -- which is what makes cross-project rollups count each commit once.
      CREATE TABLE project_repositories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE (project_id, repo_id)
      );
      CREATE UNIQUE INDEX idx_project_repos_primary ON project_repositories(repo_id) WHERE is_primary = 1;
      CREATE INDEX idx_project_repos_repo ON project_repositories(repo_id);

      CREATE TABLE project_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        role TEXT,
        allocation_pct INTEGER NOT NULL DEFAULT 100
          CHECK (allocation_pct > 0 AND allocation_pct <= 100),
        start_on TEXT NOT NULL CHECK (start_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        end_on TEXT CHECK (end_on IS NULL OR end_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        CHECK (end_on IS NULL OR end_on >= start_on)
      );
      CREATE INDEX idx_assignments_project ON project_assignments(project_id);
      CREATE INDEX idx_assignments_employee ON project_assignments(employee_id);

      -- Denormalised so the clients list does not run a correlated MAX() per row.
      ALTER TABLE repositories ADD COLUMN last_commit_ts INTEGER;
      UPDATE repositories SET last_commit_ts =
        (SELECT MAX(c.author_ts) FROM commits c WHERE c.repo_id = repositories.id);

      -- Exactly one project per repo for rollups: the primary link, else the oldest.
      CREATE VIEW v_repo_project AS
      SELECT pr.repo_id AS repo_id, pr.project_id AS project_id
      FROM project_repositories pr
      WHERE pr.id = (
        SELECT p2.id FROM project_repositories p2
        WHERE p2.repo_id = pr.repo_id
        ORDER BY p2.is_primary DESC, p2.id ASC LIMIT 1);
    `,
  },
];
