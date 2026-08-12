import type { Database } from "bun:sqlite";

export interface EmployeeRow {
  id: number;
  code: string;
  full_name: string;
  work_email: string | null;
  phone: string | null;
  designation: string | null;
  department: string | null;
  employment_type: "full_time" | "part_time" | "contract" | "intern";
  joined_on: string;
  exited_on: string | null;
  status: "active" | "on_leave" | "notice" | "exited";
  avatar_url: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  identity_count: number;
  commit_count: number;
}

export interface CompensationRow {
  id: number;
  employee_id: number;
  effective_from: string;
  currency: string;
  base_monthly_minor: number;
  reason: string | null;
  created_at: number;
}

export interface IdentityRow {
  id: number;
  employee_id: number;
  kind: "login" | "email";
  value: string;
  source: "manual" | "suggested" | "import";
  created_at: number;
  employee_name?: string;
}

export interface EmployeeInput {
  code: string;
  fullName: string;
  workEmail: string | null;
  phone: string | null;
  designation: string | null;
  department: string | null;
  employmentType: EmployeeRow["employment_type"];
  joinedOn: string;
  exitedOn: string | null;
  status: EmployeeRow["status"];
  notes: string | null;
}

export interface EmployeeFilters {
  status?: string;
  department?: string;
  q?: string;
  includeArchived?: boolean;
}

const SELECT_EMPLOYEE = `
  SELECT e.*,
    (SELECT COUNT(*) FROM employee_identities i WHERE i.employee_id = e.id) AS identity_count,
    (SELECT COUNT(*) FROM v_commit_employee v WHERE v.employee_id = e.id) AS commit_count
  FROM employees e`;

export function createEmployeeStore(db: Database) {
  return {
    listEmployees(filters: EmployeeFilters = {}): EmployeeRow[] {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (!filters.includeArchived) where.push("e.archived_at IS NULL");
      if (filters.status) {
        where.push("e.status = ?");
        params.push(filters.status);
      }
      if (filters.department) {
        where.push("e.department = ?");
        params.push(filters.department);
      }
      if (filters.q) {
        where.push("(e.full_name LIKE ? OR e.code LIKE ? OR e.work_email LIKE ? OR e.designation LIKE ?)");
        const like = `%${filters.q}%`;
        params.push(like, like, like, like);
      }
      const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      return db
        .query(`${SELECT_EMPLOYEE} ${clause} ORDER BY e.archived_at IS NOT NULL, e.full_name`)
        .all(...params) as EmployeeRow[];
    },

    getEmployee(id: number): EmployeeRow | null {
      return (db.query(`${SELECT_EMPLOYEE} WHERE e.id = ?`).get(id) as EmployeeRow | undefined) ?? null;
    },

    getEmployeeByCode(code: string): EmployeeRow | null {
      return (db.query(`${SELECT_EMPLOYEE} WHERE e.code = ?`).get(code) as EmployeeRow | undefined) ?? null;
    },

    listDepartments(): string[] {
      return (
        db
          .query(
            "SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND department <> '' ORDER BY department",
          )
          .all() as { department: string }[]
      ).map((r) => r.department);
    },

    insertEmployee(input: EmployeeInput): number {
      const res = db
        .query(
          `INSERT INTO employees (code, full_name, work_email, phone, designation, department,
             employment_type, joined_on, exited_on, status, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.code,
          input.fullName,
          input.workEmail,
          input.phone,
          input.designation,
          input.department,
          input.employmentType,
          input.joinedOn,
          input.exitedOn,
          input.status,
          input.notes,
        );
      return Number(res.lastInsertRowid);
    },

    updateEmployee(id: number, input: EmployeeInput): void {
      db.query(
        `UPDATE employees SET code = ?, full_name = ?, work_email = ?, phone = ?, designation = ?,
           department = ?, employment_type = ?, joined_on = ?, exited_on = ?, status = ?, notes = ?,
           updated_at = unixepoch()
         WHERE id = ?`,
      ).run(
        input.code,
        input.fullName,
        input.workEmail,
        input.phone,
        input.designation,
        input.department,
        input.employmentType,
        input.joinedOn,
        input.exitedOn,
        input.status,
        input.notes,
        id,
      );
    },

    setEmployeeAvatar(id: number, avatarUrl: string): void {
      db.query("UPDATE employees SET avatar_url = ? WHERE id = ? AND avatar_url IS NULL").run(avatarUrl, id);
    },

    archiveEmployee(id: number, archived: boolean): void {
      db.query(
        `UPDATE employees SET archived_at = ${archived ? "unixepoch()" : "NULL"}, updated_at = unixepoch() WHERE id = ?`,
      ).run(id);
    },

    deleteEmployee(id: number): void {
      db.query("DELETE FROM employees WHERE id = ?").run(id);
    },

    // ---- compensation (append-only, effective-dated) ----

    listCompensation(employeeId: number): CompensationRow[] {
      return db
        .query("SELECT * FROM employee_compensation WHERE employee_id = ? ORDER BY effective_from DESC")
        .all(employeeId) as CompensationRow[];
    },

    /** The row in force on `onDate` — not the newest row. */
    compensationAsOf(employeeId: number, onDate: string): CompensationRow | null {
      return (
        (db
          .query(
            `SELECT * FROM employee_compensation
             WHERE employee_id = ? AND effective_from <= ?
             ORDER BY effective_from DESC LIMIT 1`,
          )
          .get(employeeId, onDate) as CompensationRow | undefined) ?? null
      );
    },

    insertCompensation(input: {
      employeeId: number;
      effectiveFrom: string;
      currency: string;
      baseMonthlyMinor: number;
      reason: string | null;
    }): number {
      const res = db
        .query(
          `INSERT INTO employee_compensation (employee_id, effective_from, currency, base_monthly_minor, reason)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          input.employeeId,
          input.effectiveFrom,
          input.currency,
          input.baseMonthlyMinor,
          input.reason,
        );
      return Number(res.lastInsertRowid);
    },

    deleteCompensation(id: number): void {
      db.query("DELETE FROM employee_compensation WHERE id = ?").run(id);
    },

    // ---- settings ----

    getSettings(): {
      company_name: string;
      base_currency: string;
      payroll_currency: string;
      fiscal_year_start_month: number;
    } {
      // INSERT OR IGNORE first: db.exec() does not throw when a data statement
      // inside a migration batch fails, so the singleton row self-heals here.
      db.query("INSERT OR IGNORE INTO app_settings (id) VALUES (1)").run();
      return db.query("SELECT * FROM app_settings WHERE id = 1").get() as {
        company_name: string;
        base_currency: string;
        payroll_currency: string;
        fiscal_year_start_month: number;
      };
    },

    updateSettings(input: {
      companyName: string;
      baseCurrency: string;
      payrollCurrency: string;
      fiscalYearStartMonth: number;
    }): void {
      db.query(
        `UPDATE app_settings SET company_name = ?, base_currency = ?, payroll_currency = ?,
           fiscal_year_start_month = ?, updated_at = unixepoch() WHERE id = 1`,
      ).run(input.companyName, input.baseCurrency, input.payrollCurrency, input.fiscalYearStartMonth);
    },
  };
}
