import type { Database } from "bun:sqlite";
import type { Role } from "../../domain/rbac.ts";

export interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
  employee_id: number | null;
  status: "active" | "disabled";
  created_at: number;
  last_login_at: number | null;
  employee_name?: string | null;
}

export interface SessionRow {
  id: string;
  user_id: number;
  csrf_token: string;
  created_at: number;
  expires_at: number;
}

export interface AuditRow {
  id: number;
  user_id: number | null;
  user_email: string | null;
  action: string;
  entity: string | null;
  entity_id: number | null;
  summary: string | null;
  created_at: number;
}

export function createAuthStore(db: Database) {
  return {
    countUsers(): number {
      return (db.query("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
    },

    listUsers(): UserRow[] {
      return db
        .query(
          `SELECT u.*, e.full_name AS employee_name
           FROM users u LEFT JOIN employees e ON e.id = u.employee_id
           ORDER BY u.name`,
        )
        .all() as UserRow[];
    },

    getUser(id: number): UserRow | null {
      return (db.query("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined) ?? null;
    },

    getUserByEmail(email: string): UserRow | null {
      return (db.query("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined) ?? null;
    },

    insertUser(input: {
      email: string;
      name: string;
      passwordHash: string;
      role: Role;
      employeeId: number | null;
    }): number {
      const res = db
        .query("INSERT INTO users (email, name, password_hash, role, employee_id) VALUES (?, ?, ?, ?, ?)")
        .run(input.email, input.name, input.passwordHash, input.role, input.employeeId);
      return Number(res.lastInsertRowid);
    },

    updateUser(id: number, input: { name: string; role: Role; employeeId: number | null; status: "active" | "disabled" }): void {
      db.query("UPDATE users SET name = ?, role = ?, employee_id = ?, status = ? WHERE id = ?").run(
        input.name,
        input.role,
        input.employeeId,
        input.status,
        id,
      );
    },

    setPassword(id: number, passwordHash: string): void {
      db.query("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
    },

    deleteUser(id: number): void {
      db.query("DELETE FROM users WHERE id = ?").run(id);
    },

    touchLogin(id: number): void {
      db.query("UPDATE users SET last_login_at = unixepoch() WHERE id = ?").run(id);
    },

    insertSession(input: { id: string; userId: number; csrfToken: string; expiresAt: number }): void {
      db.query("INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)").run(
        input.id,
        input.userId,
        input.csrfToken,
        input.expiresAt,
      );
    },

    getSession(id: string): (SessionRow & { user: UserRow }) | null {
      const row = db
        .query(
          `SELECT s.*, u.id AS u_id, u.email, u.name, u.password_hash, u.role, u.employee_id,
                  u.status, u.created_at AS u_created_at, u.last_login_at
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.id = ? AND s.expires_at > unixepoch()`,
        )
        .get(id) as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        id: String(row.id),
        user_id: Number(row.user_id),
        csrf_token: String(row.csrf_token),
        created_at: Number(row.created_at),
        expires_at: Number(row.expires_at),
        user: {
          id: Number(row.u_id),
          email: String(row.email),
          name: String(row.name),
          password_hash: String(row.password_hash),
          role: row.role as Role,
          employee_id: row.employee_id === null ? null : Number(row.employee_id),
          status: row.status as "active" | "disabled",
          created_at: Number(row.u_created_at),
          last_login_at: row.last_login_at === null ? null : Number(row.last_login_at),
        },
      };
    },

    deleteSession(id: string): void {
      db.query("DELETE FROM sessions WHERE id = ?").run(id);
    },

    deleteSessionsForUser(userId: number): void {
      db.query("DELETE FROM sessions WHERE user_id = ?").run(userId);
    },

    pruneSessions(): void {
      db.query("DELETE FROM sessions WHERE expires_at <= unixepoch()").run();
    },

    insertAudit(input: {
      userId: number | null;
      userEmail: string | null;
      action: string;
      entity: string | null;
      entityId: number | null;
      summary: string | null;
    }): void {
      db.query(
        "INSERT INTO audit_log (user_id, user_email, action, entity, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(input.userId, input.userEmail, input.action, input.entity, input.entityId, input.summary);
    },

    listAudit(opts: { entity?: string; limit?: number } = {}): AuditRow[] {
      const where = opts.entity ? "WHERE entity = ?" : "";
      const params: (string | number)[] = opts.entity ? [opts.entity] : [];
      return db
        .query(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ?`)
        .all(...params, opts.limit ?? 100) as AuditRow[];
    },

    auditEntities(): string[] {
      return (
        db
          .query("SELECT DISTINCT entity FROM audit_log WHERE entity IS NOT NULL ORDER BY entity")
          .all() as { entity: string }[]
      ).map((r) => r.entity);
    },

    hasPayrollData(): boolean {
      const exists = db
        .query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='payslips'")
        .get() as { n: number };
      if (exists.n === 0) return false;
      const rows = db.query("SELECT COUNT(*) AS n FROM payslips").get() as { n: number };
      return rows.n > 0;
    },
  };
}

export interface ApiTokenRow {
  id: number;
  name: string;
  token_hash: string;
  prefix: string;
  user_id: number | null;
  created_at: number;
  last_used_at: number | null;
}

export function createApiTokenStore(db: Database) {
  return {
    listApiTokens(): ApiTokenRow[] {
      return db.query("SELECT * FROM api_tokens ORDER BY created_at DESC").all() as ApiTokenRow[];
    },

    findApiToken(tokenHash: string): ApiTokenRow | null {
      return (
        (db.query("SELECT * FROM api_tokens WHERE token_hash = ?").get(tokenHash) as ApiTokenRow | undefined) ??
        null
      );
    },

    insertApiToken(input: { name: string; tokenHash: string; prefix: string; userId: number | null }): number {
      const res = db
        .query("INSERT INTO api_tokens (name, token_hash, prefix, user_id) VALUES (?, ?, ?, ?)")
        .run(input.name, input.tokenHash, input.prefix, input.userId);
      return Number(res.lastInsertRowid);
    },

    touchApiToken(id: number): void {
      db.query("UPDATE api_tokens SET last_used_at = unixepoch() WHERE id = ?").run(id);
    },

    deleteApiToken(id: number): void {
      db.query("DELETE FROM api_tokens WHERE id = ?").run(id);
    },
  };
}
