import type { Database } from "bun:sqlite";

export interface CycleRow {
  id: number;
  period_month: string;
  currency: string;
  status: "draft" | "approved" | "paid" | "cancelled";
  note: string | null;
  generated_at: number | null;
  approved_at: number | null;
  paid_at: number | null;
  created_at: number;
  updated_at: number;
  payslip_count: number;
  gross_minor: number;
  deductions_minor: number;
  net_minor: number;
}

export interface PayslipRow {
  id: number;
  cycle_id: number;
  employee_id: number;
  compensation_id: number | null;
  employee_name: string;
  employee_code: string;
  designation: string | null;
  department: string | null;
  currency: string;
  base_monthly_minor: number;
  period_days: number;
  payable_days: number;
  gross_minor: number;
  deductions_minor: number;
  net_minor: number;
  status: "draft" | "final" | "excluded";
  note: string | null;
  period_month?: string;
  cycle_status?: string;
}

export interface PayslipItemRow {
  id: number;
  payslip_id: number;
  kind: "earning" | "deduction";
  code: string;
  label: string;
  amount_minor: number;
  sort_order: number;
}

export interface TaxSlabRow {
  id: number;
  fiscal_year: string;
  lower_annual_minor: number;
  fixed_annual_minor: number;
  rate_bp: number;
}

/** One row per employee eligible for a period, with the compensation in force. */
export interface GenerationCandidate {
  employee_id: number;
  full_name: string;
  code: string;
  designation: string | null;
  department: string | null;
  employment_type: string;
  compensation_id: number | null;
  currency: string | null;
  base_monthly_minor: number | null;
  period_days: number;
  payable_days: number;
}

const SELECT_CYCLE = `
  SELECT c.*,
    (SELECT COUNT(*) FROM payslips p WHERE p.cycle_id = c.id AND p.status <> 'excluded') AS payslip_count,
    (SELECT COALESCE(SUM(p.gross_minor),0) FROM payslips p WHERE p.cycle_id = c.id AND p.status <> 'excluded') AS gross_minor,
    (SELECT COALESCE(SUM(p.deductions_minor),0) FROM payslips p WHERE p.cycle_id = c.id AND p.status <> 'excluded') AS deductions_minor,
    (SELECT COALESCE(SUM(p.net_minor),0) FROM payslips p WHERE p.cycle_id = c.id AND p.status <> 'excluded') AS net_minor
  FROM payroll_cycles c`;

export function createPayrollStore(db: Database) {
  return {
    listCycles(): CycleRow[] {
      return db.query(`${SELECT_CYCLE} ORDER BY c.period_month DESC`).all() as CycleRow[];
    },

    getCycle(id: number): CycleRow | null {
      return (db.query(`${SELECT_CYCLE} WHERE c.id = ?`).get(id) as CycleRow | undefined) ?? null;
    },

    getCycleByPeriod(period: string): CycleRow | null {
      return (
        (db.query(`${SELECT_CYCLE} WHERE c.period_month = ?`).get(period) as CycleRow | undefined) ?? null
      );
    },

    insertCycle(period: string, currency: string, note: string | null): number {
      const res = db
        .query("INSERT INTO payroll_cycles (period_month, currency, note) VALUES (?, ?, ?)")
        .run(period, currency, note);
      return Number(res.lastInsertRowid);
    },

    setCycleStatus(id: number, status: CycleRow["status"]): void {
      const stamp =
        status === "approved"
          ? ", approved_at = unixepoch()"
          : status === "paid"
            ? ", paid_at = unixepoch()"
            : status === "draft"
              ? ", approved_at = NULL, paid_at = NULL"
              : "";
      db.query(`UPDATE payroll_cycles SET status = ?, updated_at = unixepoch()${stamp} WHERE id = ?`).run(
        status,
        id,
      );
    },

    markGenerated(id: number): void {
      db.query("UPDATE payroll_cycles SET generated_at = unixepoch(), updated_at = unixepoch() WHERE id = ?").run(id);
    },

    deleteCycle(id: number): void {
      db.query("DELETE FROM payroll_cycles WHERE id = ?").run(id);
    },

    /** Only draft cycles may be deleted; checked in the same statement as the delete. */
    deleteCycleIfDraft(id: number): number {
      const res = db.query("DELETE FROM payroll_cycles WHERE id = ? AND status = 'draft'").run(id);
      return res.changes;
    },

    // ---- generation ----

    /**
     * Eligible employees with the compensation record in force on the period end,
     * plus pro-rated payable days for mid-period joiners and leavers.
     */
    generationCandidates(periodStart: string, periodEnd: string): GenerationCandidate[] {
      return db
        .query(
          `SELECT e.id AS employee_id, e.full_name, e.code, e.designation, e.department,
                  e.employment_type,
                  ec.id AS compensation_id, ec.currency, ec.base_monthly_minor,
                  CAST(strftime('%d', ?) AS INTEGER) AS period_days,
                  MAX(0, CAST(julianday(MIN(?, COALESCE(e.exited_on, '9999-12-31')))
                            - julianday(MAX(?, e.joined_on)) AS INTEGER) + 1) AS payable_days
           FROM employees e
           LEFT JOIN employee_compensation ec ON ec.id = (
             SELECT c2.id FROM employee_compensation c2
             WHERE c2.employee_id = e.id AND c2.effective_from <= ?
             ORDER BY c2.effective_from DESC LIMIT 1)
           WHERE e.archived_at IS NULL
             AND e.joined_on <= ?
             AND (e.exited_on IS NULL OR e.exited_on >= ?)
           ORDER BY e.full_name`,
        )
        .all(periodEnd, periodEnd, periodStart, periodEnd, periodEnd, periodStart) as GenerationCandidate[];
    },

    deletePayslipsForCycle(cycleId: number): void {
      db.query("DELETE FROM payslips WHERE cycle_id = ?").run(cycleId);
    },

    insertPayslip(input: {
      cycleId: number;
      employeeId: number;
      compensationId: number | null;
      employeeName: string;
      employeeCode: string;
      designation: string | null;
      department: string | null;
      currency: string;
      baseMonthlyMinor: number;
      periodDays: number;
      payableDays: number;
      status: PayslipRow["status"];
    }): number {
      const res = db
        .query(
          `INSERT INTO payslips (cycle_id, employee_id, compensation_id, employee_name, employee_code,
             designation, department, currency, base_monthly_minor, period_days, payable_days, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.cycleId,
          input.employeeId,
          input.compensationId,
          input.employeeName,
          input.employeeCode,
          input.designation,
          input.department,
          input.currency,
          input.baseMonthlyMinor,
          input.periodDays,
          input.payableDays,
          input.status,
        );
      return Number(res.lastInsertRowid);
    },

    listPayslips(cycleId: number): PayslipRow[] {
      return db
        .query("SELECT * FROM payslips WHERE cycle_id = ? ORDER BY employee_name")
        .all(cycleId) as PayslipRow[];
    },

    getPayslip(id: number): PayslipRow | null {
      return (
        (db
          .query(
            `SELECT p.*, c.period_month, c.status AS cycle_status
             FROM payslips p JOIN payroll_cycles c ON c.id = p.cycle_id WHERE p.id = ?`,
          )
          .get(id) as PayslipRow | undefined) ?? null
      );
    },

    listPayslipsForEmployee(employeeId: number): PayslipRow[] {
      return db
        .query(
          `SELECT p.*, c.period_month, c.status AS cycle_status
           FROM payslips p JOIN payroll_cycles c ON c.id = p.cycle_id
           WHERE p.employee_id = ? ORDER BY c.period_month DESC`,
        )
        .all(employeeId) as PayslipRow[];
    },

    updatePayslipDays(id: number, payableDays: number, note: string | null): void {
      db.query("UPDATE payslips SET payable_days = ?, note = ?, updated_at = unixepoch() WHERE id = ?").run(
        payableDays,
        note,
        id,
      );
    },

    setPayslipStatus(id: number, status: PayslipRow["status"]): void {
      db.query("UPDATE payslips SET status = ?, updated_at = unixepoch() WHERE id = ?").run(status, id);
    },

    setPayslipTotals(id: number, gross: number, deductions: number, net: number): void {
      db.query(
        "UPDATE payslips SET gross_minor = ?, deductions_minor = ?, net_minor = ?, updated_at = unixepoch() WHERE id = ?",
      ).run(gross, deductions, net, id);
    },

    finalizePayslipsForCycle(cycleId: number): void {
      db.query("UPDATE payslips SET status = 'final', updated_at = unixepoch() WHERE cycle_id = ? AND status = 'draft'").run(
        cycleId,
      );
    },

    // ---- items ----

    listItems(payslipId: number): PayslipItemRow[] {
      return db
        .query("SELECT * FROM payslip_items WHERE payslip_id = ? ORDER BY kind, sort_order, id")
        .all(payslipId) as PayslipItemRow[];
    },

    replaceItems(
      payslipId: number,
      items: { kind: "earning" | "deduction"; code: string; label: string; amountMinor: number }[],
    ): void {
      db.query("DELETE FROM payslip_items WHERE payslip_id = ?").run(payslipId);
      const stmt = db.query(
        "INSERT INTO payslip_items (payslip_id, kind, code, label, amount_minor, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      );
      items.forEach((item, index) => {
        stmt.run(payslipId, item.kind, item.code, item.label, item.amountMinor, index);
      });
    },

    insertItem(
      payslipId: number,
      item: { kind: "earning" | "deduction"; code: string; label: string; amountMinor: number },
    ): void {
      db.query(
        "INSERT INTO payslip_items (payslip_id, kind, code, label, amount_minor, sort_order) VALUES (?, ?, ?, ?, ?, 0)",
      ).run(payslipId, item.kind, item.code, item.label, item.amountMinor);
    },

    deleteItem(id: number): void {
      db.query("DELETE FROM payslip_items WHERE id = ?").run(id);
    },

    itemTotals(payslipId: number): { earnings: number; deductions: number } {
      const row = db
        .query(
          `SELECT COALESCE(SUM(CASE WHEN kind = 'earning' THEN amount_minor ELSE 0 END), 0) AS earnings,
                  COALESCE(SUM(CASE WHEN kind = 'deduction' THEN amount_minor ELSE 0 END), 0) AS deductions
           FROM payslip_items WHERE payslip_id = ?`,
        )
        .get(payslipId) as { earnings: number; deductions: number };
      return row;
    },

    // ---- tax slabs ----

    listTaxSlabs(fiscalYear: string): TaxSlabRow[] {
      return db
        .query("SELECT * FROM tax_slabs WHERE fiscal_year = ? ORDER BY lower_annual_minor")
        .all(fiscalYear) as TaxSlabRow[];
    },

    listTaxYears(): string[] {
      return (
        db.query("SELECT DISTINCT fiscal_year FROM tax_slabs ORDER BY fiscal_year DESC").all() as {
          fiscal_year: string;
        }[]
      ).map((r) => r.fiscal_year);
    },

    insertTaxSlab(input: {
      fiscalYear: string;
      lowerAnnualMinor: number;
      fixedAnnualMinor: number;
      rateBp: number;
    }): void {
      db.query(
        `INSERT INTO tax_slabs (fiscal_year, lower_annual_minor, fixed_annual_minor, rate_bp)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(fiscal_year, lower_annual_minor)
         DO UPDATE SET fixed_annual_minor = excluded.fixed_annual_minor, rate_bp = excluded.rate_bp`,
      ).run(input.fiscalYear, input.lowerAnnualMinor, input.fixedAnnualMinor, input.rateBp);
    },

    deleteTaxSlab(id: number): void {
      db.query("DELETE FROM tax_slabs WHERE id = ?").run(id);
    },

    // ---- economics input ----

    /** Payslip gross allocated across the projects each person was assigned to. */
    projectCostForPeriod(
      period: string,
      periodStart: string,
      periodEnd: string,
    ): { project_id: number; currency: string; actual_cost_minor: number }[] {
      return db
        .query(
          `WITH alloc AS (
             SELECT pa.employee_id, pa.project_id, pa.allocation_pct
             FROM project_assignments pa
             WHERE pa.start_on <= ? AND (pa.end_on IS NULL OR pa.end_on >= ?)),
           tot AS (
             -- max(100, allocated) leaves a bench remainder when under-allocated
             -- and normalises instead of over-charging when over-allocated
             SELECT employee_id, MAX(100, SUM(allocation_pct)) AS denom FROM alloc GROUP BY employee_id)
           SELECT a.project_id, ps.currency,
                  CAST(SUM(ps.gross_minor * a.allocation_pct * 1.0 / t.denom) AS INTEGER) AS actual_cost_minor
           FROM payslips ps
           JOIN payroll_cycles pc ON pc.id = ps.cycle_id AND pc.period_month = ?
           JOIN alloc a ON a.employee_id = ps.employee_id
           JOIN tot   t ON t.employee_id = ps.employee_id
           WHERE ps.status = 'final'
           GROUP BY a.project_id, ps.currency`,
        )
        .all(periodEnd, periodStart, period) as {
        project_id: number;
        currency: string;
        actual_cost_minor: number;
      }[];
    },
  };
}
