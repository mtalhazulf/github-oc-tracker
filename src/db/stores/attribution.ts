import type { Database } from "bun:sqlite";
import type { IdentityRow } from "./employees.ts";

export interface UnmappedAuthor {
  author: string;
  login: string | null;
  email: string | null;
  avatar: string | null;
  n: number;
  last_ts: number;
}

export interface ContributionRow {
  project_id: number | null;
  project_code: string | null;
  project_name: string | null;
  commits: number;
  last_ts: number;
}

export function createAttributionStore(db: Database) {
  return {
    listIdentities(employeeId: number): IdentityRow[] {
      return db
        .query("SELECT * FROM employee_identities WHERE employee_id = ? ORDER BY kind, value")
        .all(employeeId) as IdentityRow[];
    },

    findIdentity(kind: "login" | "email", value: string): (IdentityRow & { employee_name: string }) | null {
      return (
        (db
          .query(
            `SELECT i.*, e.full_name AS employee_name
             FROM employee_identities i JOIN employees e ON e.id = i.employee_id
             WHERE i.kind = ? AND i.value = ?`,
          )
          .get(kind, value) as (IdentityRow & { employee_name: string }) | undefined) ?? null
      );
    },

    insertIdentity(input: {
      employeeId: number;
      kind: "login" | "email";
      value: string;
      source?: "manual" | "suggested" | "import";
    }): number {
      const res = db
        .query("INSERT INTO employee_identities (employee_id, kind, value, source) VALUES (?, ?, ?, ?)")
        .run(input.employeeId, input.kind, input.value, input.source ?? "manual");
      return Number(res.lastInsertRowid);
    },

    moveIdentity(kind: "login" | "email", value: string, employeeId: number): void {
      db.query("UPDATE employee_identities SET employee_id = ?, source = 'manual' WHERE kind = ? AND value = ?").run(
        employeeId,
        kind,
        value,
      );
    },

    deleteIdentity(id: number): void {
      db.query("DELETE FROM employee_identities WHERE id = ?").run(id);
    },

    avatarForEmployee(employeeId: number): string | null {
      const row = db
        .query(
          `SELECT c.author_avatar_url AS url
           FROM employee_identities ei
           JOIN commits c ON ((ei.kind = 'login' AND ei.value = c.author_login)
                           OR (ei.kind = 'email' AND ei.value = c.author_email))
           WHERE ei.employee_id = ? AND c.author_avatar_url IS NOT NULL
           ORDER BY c.author_ts DESC LIMIT 1`,
        )
        .get(employeeId) as { url: string } | undefined;
      return row?.url ?? null;
    },

    listIgnoredAuthors(): { id: number; kind: string; value: string; note: string | null }[] {
      return db.query("SELECT * FROM ignored_authors ORDER BY kind, value").all() as {
        id: number;
        kind: string;
        value: string;
        note: string | null;
      }[];
    },

    insertIgnoredAuthor(kind: "login" | "email" | "pattern", value: string, note: string | null): void {
      db.query("INSERT OR IGNORE INTO ignored_authors (kind, value, note) VALUES (?, ?, ?)").run(
        kind,
        value,
        note,
      );
    },

    deleteIgnoredAuthor(id: number): void {
      db.query("DELETE FROM ignored_authors WHERE id = ?").run(id);
    },

    unmappedAuthors(sinceTs: number, limit = 50): UnmappedAuthor[] {
      return db
        .query(
          `WITH agg AS (
             SELECT COALESCE(NULLIF(author_login,''), NULLIF(author_name,''),
                             NULLIF(author_email,''), 'unknown') AS author,
                    MAX(author_login) AS login, MAX(author_email) AS email,
                    MAX(author_avatar_url) AS avatar,
                    COUNT(*) AS n, MAX(author_ts) AS last_ts
             FROM commits WHERE author_ts >= ? GROUP BY 1)
           SELECT a.* FROM agg a
           WHERE NOT EXISTS (
                   SELECT 1 FROM employee_identities ei
                   WHERE (ei.kind = 'login' AND ei.value = a.login)
                      OR (ei.kind = 'email' AND ei.value = a.email))
             AND NOT EXISTS (
                   SELECT 1 FROM ignored_authors ia
                   WHERE (ia.kind = 'login'   AND ia.value = a.login)
                      OR (ia.kind = 'email'   AND ia.value = a.email)
                      OR (ia.kind = 'pattern' AND COALESCE(a.login, a.author) LIKE ia.value))
           ORDER BY a.n DESC LIMIT ?`,
        )
        .all(sinceTs, limit) as UnmappedAuthor[];
    },

    countUnmappedAuthors(sinceTs: number): number {
      const row = db
        .query(
          `WITH agg AS (
             SELECT COALESCE(NULLIF(author_login,''), NULLIF(author_name,''),
                             NULLIF(author_email,''), 'unknown') AS author,
                    MAX(author_login) AS login, MAX(author_email) AS email
             FROM commits WHERE author_ts >= ? GROUP BY 1)
           SELECT COUNT(*) AS n FROM agg a
           WHERE NOT EXISTS (
                   SELECT 1 FROM employee_identities ei
                   WHERE (ei.kind = 'login' AND ei.value = a.login)
                      OR (ei.kind = 'email' AND ei.value = a.email))
             AND NOT EXISTS (
                   SELECT 1 FROM ignored_authors ia
                   WHERE (ia.kind = 'login'   AND ia.value = a.login)
                      OR (ia.kind = 'email'   AND ia.value = a.email)
                      OR (ia.kind = 'pattern' AND COALESCE(a.login, a.author) LIKE ia.value))`,
        )
        .get(sinceTs) as { n: number };
      return row.n;
    },

    suggestEmailMatches(): { employee_id: number; value: string }[] {
      return db
        .query(
          `SELECT DISTINCT e.id AS employee_id, c.author_email AS value
           FROM commits c JOIN employees e ON e.work_email = c.author_email
           WHERE e.archived_at IS NULL AND c.author_email IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM employee_identities ei
                             WHERE ei.kind = 'email' AND ei.value = c.author_email)`,
        )
        .all() as { employee_id: number; value: string }[];
    },

    unmappedEmails(sinceTs: number): string[] {
      return (
        db
          .query(
            `SELECT DISTINCT c.author_email AS email FROM commits c
             WHERE c.author_email IS NOT NULL AND c.author_ts >= ?
               AND NOT EXISTS (SELECT 1 FROM employee_identities ei
                               WHERE ei.kind = 'email' AND ei.value = c.author_email)`,
          )
          .all(sinceTs) as { email: string }[]
      ).map((r) => r.email);
    },

    employeeContribution(employeeId: number, sinceTs: number): ContributionRow[] {
      const hasProjects = db
        .query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'view' AND name = 'v_repo_project'")
        .get() as { n: number };

      if (hasProjects.n === 0) {
        return db
          .query(
            `SELECT NULL AS project_id, NULL AS project_code, NULL AS project_name,
                    COUNT(*) AS commits, MAX(c.author_ts) AS last_ts
             FROM employee_identities ei
             JOIN commits c ON ((ei.kind = 'login' AND ei.value = c.author_login)
                             OR (ei.kind = 'email' AND ei.value = c.author_email))
                           AND c.author_ts >= ?
             WHERE ei.employee_id = ?
             HAVING COUNT(*) > 0`,
          )
          .all(sinceTs, employeeId) as ContributionRow[];
      }

      return db
        .query(
          `SELECT p.id AS project_id, p.code AS project_code, p.name AS project_name,
                  COUNT(*) AS commits, MAX(c.author_ts) AS last_ts
           FROM employee_identities ei
           JOIN commits c ON ((ei.kind = 'login' AND ei.value = c.author_login)
                           OR (ei.kind = 'email' AND ei.value = c.author_email))
                         AND c.author_ts >= ?
           LEFT JOIN v_repo_project vp ON vp.repo_id = c.repo_id
           LEFT JOIN projects p ON p.id = vp.project_id
           WHERE ei.employee_id = ?
           GROUP BY p.id ORDER BY commits DESC`,
        )
        .all(sinceTs, employeeId) as ContributionRow[];
    },

    employeeCommits(employeeId: number, limit = 20): {
      sha: string;
      message: string;
      author_ts: number;
      html_url: string | null;
      repo_full_name: string;
    }[] {
      return db
        .query(
          `SELECT c.sha, c.message, c.author_ts, c.html_url, r.full_name AS repo_full_name
           FROM employee_identities ei
           JOIN commits c ON ((ei.kind = 'login' AND ei.value = c.author_login)
                           OR (ei.kind = 'email' AND ei.value = c.author_email))
           JOIN repositories r ON r.id = c.repo_id
           WHERE ei.employee_id = ?
           ORDER BY c.author_ts DESC LIMIT ?`,
        )
        .all(employeeId, limit) as {
        sha: string;
        message: string;
        author_ts: number;
        html_url: string | null;
        repo_full_name: string;
      }[];
    },

    attributionRowCount(): { view_rows: number; commit_rows: number } {
      return db
        .query(
          "SELECT (SELECT COUNT(*) FROM v_commit_employee) AS view_rows, (SELECT COUNT(*) FROM commits) AS commit_rows",
        )
        .get() as { view_rows: number; commit_rows: number };
    },
  };
}
