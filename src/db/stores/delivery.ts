import type { Database } from "bun:sqlite";

export interface ClientRow {
  id: number;
  name: string;
  code: string;
  status: "prospect" | "active" | "paused" | "churned";
  currency: string;
  country: string | null;
  website: string | null;
  contact_name: string | null;
  contact_email: string | null;
  billing_email: string | null;
  billing_address: string | null;
  tax_id: string | null;
  payment_terms_days: number;
  notes: string | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  project_count: number;
}

export interface ProjectRow {
  id: number;
  code: string;
  name: string;
  kind: "client" | "internal_product" | "internal_ops";
  client_id: number | null;
  status: "discovery" | "active" | "paused" | "completed" | "cancelled";
  billing_model: "fixed_price" | "time_materials" | "retainer" | "none";
  currency: string;
  budget_minor: number | null;
  rate_hourly_minor: number | null;
  retainer_monthly_minor: number | null;
  start_on: string | null;
  end_on: string | null;
  manager_id: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  client_name: string | null;
  manager_name: string | null;
  repo_count: number;
  team_count: number;
  commit_count: number;
  last_commit_ts: number | null;
}

export interface ProjectRepoRow {
  id: number;
  project_id: number;
  repo_id: number;
  is_primary: number;
  full_name: string;
  html_url: string | null;
  commit_count: number;
  last_commit_ts: number | null;
  shared_with: number;
}

export interface AssignmentRow {
  id: number;
  project_id: number;
  employee_id: number;
  role: string | null;
  allocation_pct: number;
  start_on: string;
  end_on: string | null;
  employee_name: string;
  employee_code: string;
  avatar_url: string | null;
}

export interface ClientInput {
  name: string;
  code: string;
  status: ClientRow["status"];
  currency: string;
  country: string | null;
  website: string | null;
  contactName: string | null;
  contactEmail: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
  taxId: string | null;
  paymentTermsDays: number;
  notes: string | null;
}

export interface ProjectInput {
  code: string;
  name: string;
  kind: ProjectRow["kind"];
  clientId: number | null;
  status: ProjectRow["status"];
  billingModel: ProjectRow["billing_model"];
  currency: string;
  budgetMinor: number | null;
  rateHourlyMinor: number | null;
  retainerMonthlyMinor: number | null;
  startOn: string | null;
  endOn: string | null;
  managerId: number | null;
  notes: string | null;
}

const SELECT_PROJECT = `
  SELECT p.*, cl.name AS client_name, e.full_name AS manager_name,
    (SELECT COUNT(*) FROM project_repositories pr WHERE pr.project_id = p.id) AS repo_count,
    (SELECT COUNT(*) FROM project_assignments pa WHERE pa.project_id = p.id
       AND (pa.end_on IS NULL OR pa.end_on >= date('now'))) AS team_count,
    (SELECT COUNT(*) FROM commits c
       JOIN project_repositories pr2 ON pr2.repo_id = c.repo_id
      WHERE pr2.project_id = p.id) AS commit_count,
    (SELECT MAX(r.last_commit_ts) FROM repositories r
       JOIN project_repositories pr3 ON pr3.repo_id = r.id
      WHERE pr3.project_id = p.id) AS last_commit_ts
  FROM projects p
  LEFT JOIN clients cl ON cl.id = p.client_id
  LEFT JOIN employees e ON e.id = p.manager_id`;

export function createDeliveryStore(db: Database) {
  return {
    // ---- clients ----

    listClients(opts: { q?: string; status?: string; includeArchived?: boolean } = {}): ClientRow[] {
      const where: string[] = [];
      const params: string[] = [];
      if (!opts.includeArchived) where.push("cl.archived_at IS NULL");
      if (opts.status) {
        where.push("cl.status = ?");
        params.push(opts.status);
      }
      if (opts.q) {
        where.push("(cl.name LIKE ? OR cl.code LIKE ? OR cl.contact_name LIKE ?)");
        const like = `%${opts.q}%`;
        params.push(like, like, like);
      }
      const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      return db
        .query(
          `SELECT cl.*, (SELECT COUNT(*) FROM projects p WHERE p.client_id = cl.id AND p.archived_at IS NULL) AS project_count
           FROM clients cl ${clause} ORDER BY cl.archived_at IS NOT NULL, cl.name`,
        )
        .all(...params) as ClientRow[];
    },

    getClient(id: number): ClientRow | null {
      return (
        (db
          .query(
            `SELECT cl.*, (SELECT COUNT(*) FROM projects p WHERE p.client_id = cl.id AND p.archived_at IS NULL) AS project_count
             FROM clients cl WHERE cl.id = ?`,
          )
          .get(id) as ClientRow | undefined) ?? null
      );
    },

    getClientByCode(code: string): ClientRow | null {
      return (
        (db
          .query("SELECT cl.*, 0 AS project_count FROM clients cl WHERE cl.code = ?")
          .get(code) as ClientRow | undefined) ?? null
      );
    },

    insertClient(input: ClientInput): number {
      const res = db
        .query(
          `INSERT INTO clients (name, code, status, currency, country, website, contact_name, contact_email,
             billing_email, billing_address, tax_id, payment_terms_days, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name,
          input.code,
          input.status,
          input.currency,
          input.country,
          input.website,
          input.contactName,
          input.contactEmail,
          input.billingEmail,
          input.billingAddress,
          input.taxId,
          input.paymentTermsDays,
          input.notes,
        );
      return Number(res.lastInsertRowid);
    },

    updateClient(id: number, input: ClientInput): void {
      db.query(
        `UPDATE clients SET name = ?, code = ?, status = ?, currency = ?, country = ?, website = ?,
           contact_name = ?, contact_email = ?, billing_email = ?, billing_address = ?, tax_id = ?,
           payment_terms_days = ?, notes = ?, updated_at = unixepoch()
         WHERE id = ?`,
      ).run(
        input.name,
        input.code,
        input.status,
        input.currency,
        input.country,
        input.website,
        input.contactName,
        input.contactEmail,
        input.billingEmail,
        input.billingAddress,
        input.taxId,
        input.paymentTermsDays,
        input.notes,
        id,
      );
    },

    archiveClient(id: number, archived: boolean): void {
      db.query(
        `UPDATE clients SET archived_at = ${archived ? "unixepoch()" : "NULL"}, updated_at = unixepoch() WHERE id = ?`,
      ).run(id);
    },

    deleteClient(id: number): void {
      db.query("DELETE FROM clients WHERE id = ?").run(id);
    },

    // ---- projects ----

    listProjects(
      opts: { q?: string; status?: string; kind?: string; clientId?: number; includeArchived?: boolean } = {},
    ): ProjectRow[] {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (!opts.includeArchived) where.push("p.archived_at IS NULL");
      if (opts.status) {
        where.push("p.status = ?");
        params.push(opts.status);
      }
      if (opts.kind) {
        where.push("p.kind = ?");
        params.push(opts.kind);
      }
      if (opts.clientId !== undefined) {
        where.push("p.client_id = ?");
        params.push(opts.clientId);
      }
      if (opts.q) {
        where.push("(p.name LIKE ? OR p.code LIKE ?)");
        const like = `%${opts.q}%`;
        params.push(like, like);
      }
      const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      return db
        .query(`${SELECT_PROJECT} ${clause} ORDER BY p.archived_at IS NOT NULL, p.name`)
        .all(...params) as ProjectRow[];
    },

    getProject(id: number): ProjectRow | null {
      return (db.query(`${SELECT_PROJECT} WHERE p.id = ?`).get(id) as ProjectRow | undefined) ?? null;
    },

    getProjectByCode(code: string): ProjectRow | null {
      return (db.query(`${SELECT_PROJECT} WHERE p.code = ?`).get(code) as ProjectRow | undefined) ?? null;
    },

    insertProject(input: ProjectInput): number {
      const res = db
        .query(
          `INSERT INTO projects (code, name, kind, client_id, status, billing_model, currency,
             budget_minor, rate_hourly_minor, retainer_monthly_minor, start_on, end_on, manager_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.code,
          input.name,
          input.kind,
          input.clientId,
          input.status,
          input.billingModel,
          input.currency,
          input.budgetMinor,
          input.rateHourlyMinor,
          input.retainerMonthlyMinor,
          input.startOn,
          input.endOn,
          input.managerId,
          input.notes,
        );
      return Number(res.lastInsertRowid);
    },

    updateProject(id: number, input: ProjectInput): void {
      db.query(
        `UPDATE projects SET code = ?, name = ?, kind = ?, client_id = ?, status = ?, billing_model = ?,
           currency = ?, budget_minor = ?, rate_hourly_minor = ?, retainer_monthly_minor = ?,
           start_on = ?, end_on = ?, manager_id = ?, notes = ?, updated_at = unixepoch()
         WHERE id = ?`,
      ).run(
        input.code,
        input.name,
        input.kind,
        input.clientId,
        input.status,
        input.billingModel,
        input.currency,
        input.budgetMinor,
        input.rateHourlyMinor,
        input.retainerMonthlyMinor,
        input.startOn,
        input.endOn,
        input.managerId,
        input.notes,
        id,
      );
    },

    archiveProject(id: number, archived: boolean): void {
      db.query(
        `UPDATE projects SET archived_at = ${archived ? "unixepoch()" : "NULL"}, updated_at = unixepoch() WHERE id = ?`,
      ).run(id);
    },

    deleteProject(id: number): void {
      db.query("DELETE FROM projects WHERE id = ?").run(id);
    },

    // ---- project ↔ repositories (many-to-many) ----

    listProjectRepos(projectId: number): ProjectRepoRow[] {
      return db
        .query(
          `SELECT pr.*, r.full_name, r.html_url, r.last_commit_ts,
             (SELECT COUNT(*) FROM commits c WHERE c.repo_id = r.id) AS commit_count,
             (SELECT COUNT(*) FROM project_repositories o WHERE o.repo_id = r.id) - 1 AS shared_with
           FROM project_repositories pr
           JOIN repositories r ON r.id = pr.repo_id
           WHERE pr.project_id = ?
           ORDER BY pr.is_primary DESC, r.full_name`,
        )
        .all(projectId) as ProjectRepoRow[];
    },

    /** Which other projects hold this repo — powers the "shared with" chip. */
    projectsForRepo(repoId: number): { project_id: number; code: string; name: string; is_primary: number }[] {
      return db
        .query(
          `SELECT p.id AS project_id, p.code, p.name, pr.is_primary
           FROM project_repositories pr JOIN projects p ON p.id = pr.project_id
           WHERE pr.repo_id = ? ORDER BY pr.is_primary DESC, p.name`,
        )
        .all(repoId) as { project_id: number; code: string; name: string; is_primary: number }[];
    },

    linkRepo(projectId: number, repoId: number, isPrimary: boolean): void {
      db.query(
        "INSERT INTO project_repositories (project_id, repo_id, is_primary) VALUES (?, ?, ?) ON CONFLICT(project_id, repo_id) DO NOTHING",
      ).run(projectId, repoId, isPrimary ? 1 : 0);
    },

    unlinkRepo(projectId: number, repoId: number): void {
      db.query("DELETE FROM project_repositories WHERE project_id = ? AND repo_id = ?").run(projectId, repoId);
    },

    /** Move the single primary link for a repo to this project. */
    setPrimaryRepo(projectId: number, repoId: number): void {
      db.query("UPDATE project_repositories SET is_primary = 0 WHERE repo_id = ?").run(repoId);
      db.query("UPDATE project_repositories SET is_primary = 1 WHERE repo_id = ? AND project_id = ?").run(
        repoId,
        projectId,
      );
    },

    /** Tracked repositories not yet linked to this project — the attach picker. */
    linkableRepos(projectId: number): { id: number; full_name: string; linked_elsewhere: number }[] {
      return db
        .query(
          `SELECT r.id, r.full_name,
             (SELECT COUNT(*) FROM project_repositories o WHERE o.repo_id = r.id) AS linked_elsewhere
           FROM repositories r
           WHERE NOT EXISTS (SELECT 1 FROM project_repositories pr WHERE pr.repo_id = r.id AND pr.project_id = ?)
           ORDER BY r.full_name`,
        )
        .all(projectId) as { id: number; full_name: string; linked_elsewhere: number }[];
    },

    /** Repos with commits but no project — activity silently missing from rollups. */
    unlinkedRepoStats(): { repos: number; commits: number } {
      return db
        .query(
          `SELECT COUNT(*) AS repos, COALESCE(SUM(n), 0) AS commits FROM (
             SELECT r.id, (SELECT COUNT(*) FROM commits c WHERE c.repo_id = r.id) AS n
             FROM repositories r
             WHERE r.tracked = 1
               AND NOT EXISTS (SELECT 1 FROM project_repositories pr WHERE pr.repo_id = r.id))`,
        )
        .get() as { repos: number; commits: number };
    },

    // ---- team ----

    listAssignments(projectId: number): AssignmentRow[] {
      return db
        .query(
          `SELECT pa.*, e.full_name AS employee_name, e.code AS employee_code, e.avatar_url
           FROM project_assignments pa JOIN employees e ON e.id = pa.employee_id
           WHERE pa.project_id = ?
           ORDER BY pa.end_on IS NOT NULL, e.full_name`,
        )
        .all(projectId) as AssignmentRow[];
    },

    listAssignmentsForEmployee(employeeId: number): (AssignmentRow & { project_name: string; project_code: string })[] {
      return db
        .query(
          `SELECT pa.*, e.full_name AS employee_name, e.code AS employee_code, e.avatar_url,
                  p.name AS project_name, p.code AS project_code
           FROM project_assignments pa
           JOIN employees e ON e.id = pa.employee_id
           JOIN projects p ON p.id = pa.project_id
           WHERE pa.employee_id = ? AND p.archived_at IS NULL
           ORDER BY pa.end_on IS NOT NULL, p.name`,
        )
        .all(employeeId) as (AssignmentRow & { project_name: string; project_code: string })[];
    },

    insertAssignment(input: {
      projectId: number;
      employeeId: number;
      role: string | null;
      allocationPct: number;
      startOn: string;
      endOn: string | null;
    }): number {
      const res = db
        .query(
          `INSERT INTO project_assignments (project_id, employee_id, role, allocation_pct, start_on, end_on)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.projectId,
          input.employeeId,
          input.role,
          input.allocationPct,
          input.startOn,
          input.endOn,
        );
      return Number(res.lastInsertRowid);
    },

    deleteAssignment(id: number): void {
      db.query("DELETE FROM project_assignments WHERE id = ?").run(id);
    },

    // ---- activity ----

    /**
     * Commits across every repo of a project, newest first.
     * Keyset (`before`), never OFFSET: a project spans several repos, so the
     * per-repo index cannot satisfy the global ORDER BY and OFFSET would rebuild
     * a temp B-tree over the whole history on every page.
     */
    projectActivity(
      projectId: number,
      opts: { sinceTs: number; beforeTs: number; limit?: number },
    ): {
      id: number;
      sha: string;
      message: string;
      author_ts: number;
      html_url: string | null;
      repo_full_name: string;
      employee_id: number | null;
      employee_name: string | null;
      author_login: string | null;
      author_name: string | null;
    }[] {
      return db
        .query(
          `SELECT c.id, c.sha, c.message, c.author_ts, c.html_url, c.author_login, c.author_name,
                  r.full_name AS repo_full_name,
                  ve.employee_id, e.full_name AS employee_name
           FROM project_repositories pr
           JOIN commits c ON c.repo_id = pr.repo_id AND c.author_ts >= ? AND c.author_ts < ?
           JOIN repositories r ON r.id = c.repo_id
           JOIN v_commit_employee ve ON ve.commit_id = c.id
           LEFT JOIN employees e ON e.id = ve.employee_id
           WHERE pr.project_id = ?
           ORDER BY c.author_ts DESC LIMIT ?`,
        )
        .all(opts.sinceTs, opts.beforeTs, projectId, opts.limit ?? 50) as {
        id: number;
        sha: string;
        message: string;
        author_ts: number;
        html_url: string | null;
        repo_full_name: string;
        employee_id: number | null;
        employee_name: string | null;
        author_login: string | null;
        author_name: string | null;
      }[];
    },

    /** Contributor breakdown for a project over a window. */
    projectContributors(
      projectId: number,
      sinceTs: number,
    ): { employee_id: number | null; name: string; commits: number }[] {
      return db
        .query(
          `SELECT ve.employee_id,
                  COALESCE(e.full_name, NULLIF(c.author_login,''), NULLIF(c.author_name,''), 'Unknown') AS name,
                  COUNT(*) AS commits
           FROM project_repositories pr
           JOIN commits c ON c.repo_id = pr.repo_id AND c.author_ts >= ?
           JOIN v_commit_employee ve ON ve.commit_id = c.id
           LEFT JOIN employees e ON e.id = ve.employee_id
           WHERE pr.project_id = ?
           GROUP BY COALESCE(ve.employee_id, name)
           ORDER BY commits DESC LIMIT 12`,
        )
        .all(sinceTs, projectId) as { employee_id: number | null; name: string; commits: number }[];
    },

    /** Commits per day for a project, for the sparkline on project detail. */
    projectCommitsPerDay(
      projectId: number,
      sinceTs: number,
      tzOffsetSeconds: number,
    ): { day: string; n: number }[] {
      return db
        .query(
          `SELECT date(c.author_ts + ?, 'unixepoch') AS day, COUNT(*) AS n
           FROM project_repositories pr
           JOIN commits c ON c.repo_id = pr.repo_id AND c.author_ts >= ?
           WHERE pr.project_id = ?
           GROUP BY day ORDER BY day`,
        )
        .all(tzOffsetSeconds, sinceTs, projectId) as { day: string; n: number }[];
    },

    /** Company-wide rollup with each commit counted exactly once. */
    commitsByProject(sinceTs: number): { project_id: number; code: string; name: string; commits: number }[] {
      return db
        .query(
          `SELECT p.id AS project_id, p.code, p.name, COUNT(*) AS commits
           FROM commits c
           JOIN v_repo_project vp ON vp.repo_id = c.repo_id
           JOIN projects p ON p.id = vp.project_id
           WHERE c.author_ts >= ?
           GROUP BY p.id ORDER BY commits DESC`,
        )
        .all(sinceTs) as { project_id: number; code: string; name: string; commits: number }[];
    },
  };
}
