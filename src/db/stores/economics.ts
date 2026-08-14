import type { Database } from "bun:sqlite";

export interface InvoiceRow {
  id: number;
  number: string;
  client_id: number;
  project_id: number | null;
  currency: string;
  amount_minor: number;
  issued_on: string;
  due_on: string;
  paid_on: string | null;
  status: "draft" | "sent" | "paid" | "void";
  note: string | null;
  created_at: number;
  updated_at: number;
  client_name: string;
  project_name: string | null;
}

export interface AgingBucket {
  bucket: string;
  currency: string;
  n: number;
  amount_minor: number;
}

export interface CapacityCell {
  id: number;
  full_name: string;
  week: number;
  pct: number;
}

export function createEconomicsStore(db: Database) {
  return {
    listInvoices(opts: { status?: string; clientId?: number } = {}): InvoiceRow[] {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (opts.status) {
        where.push("i.status = ?");
        params.push(opts.status);
      }
      if (opts.clientId !== undefined) {
        where.push("i.client_id = ?");
        params.push(opts.clientId);
      }
      const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      return db
        .query(
          `SELECT i.*, cl.name AS client_name, p.name AS project_name
           FROM invoices i
           JOIN clients cl ON cl.id = i.client_id
           LEFT JOIN projects p ON p.id = i.project_id
           ${clause} ORDER BY i.issued_on DESC, i.id DESC`,
        )
        .all(...params) as InvoiceRow[];
    },

    getInvoice(id: number): InvoiceRow | null {
      return (
        (db
          .query(
            `SELECT i.*, cl.name AS client_name, p.name AS project_name
             FROM invoices i
             JOIN clients cl ON cl.id = i.client_id
             LEFT JOIN projects p ON p.id = i.project_id
             WHERE i.id = ?`,
          )
          .get(id) as InvoiceRow | undefined) ?? null
      );
    },

    getInvoiceByNumber(number: string): InvoiceRow | null {
      return (
        (db
          .query(
            `SELECT i.*, cl.name AS client_name, NULL AS project_name
             FROM invoices i JOIN clients cl ON cl.id = i.client_id WHERE i.number = ?`,
          )
          .get(number) as InvoiceRow | undefined) ?? null
      );
    },

    insertInvoice(input: {
      number: string;
      clientId: number;
      projectId: number | null;
      currency: string;
      amountMinor: number;
      issuedOn: string;
      dueOn: string;
      status: InvoiceRow["status"];
      note: string | null;
    }): number {
      const res = db
        .query(
          `INSERT INTO invoices (number, client_id, project_id, currency, amount_minor, issued_on, due_on, status, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.number,
          input.clientId,
          input.projectId,
          input.currency,
          input.amountMinor,
          input.issuedOn,
          input.dueOn,
          input.status,
          input.note,
        );
      return Number(res.lastInsertRowid);
    },

    updateInvoice(
      id: number,
      input: {
        number: string;
        clientId: number;
        projectId: number | null;
        currency: string;
        amountMinor: number;
        issuedOn: string;
        dueOn: string;
        note: string | null;
      },
    ): void {
      db.query(
        `UPDATE invoices SET number = ?, client_id = ?, project_id = ?, currency = ?, amount_minor = ?,
           issued_on = ?, due_on = ?, note = ?, updated_at = unixepoch()
         WHERE id = ?`,
      ).run(
        input.number,
        input.clientId,
        input.projectId,
        input.currency,
        input.amountMinor,
        input.issuedOn,
        input.dueOn,
        input.note,
        id,
      );
    },

    setInvoiceStatus(id: number, status: InvoiceRow["status"], paidOn: string | null): void {
      db.query("UPDATE invoices SET status = ?, paid_on = ?, updated_at = unixepoch() WHERE id = ?").run(
        status,
        paidOn,
        id,
      );
    },

    deleteInvoice(id: number): void {
      db.query("DELETE FROM invoices WHERE id = ?").run(id);
    },

    arAging(today: string): AgingBucket[] {
      return db
        .query(
          `SELECT CASE
                    WHEN i.due_on >= ? THEN 'current'
                    WHEN julianday(?) - julianday(i.due_on) <= 30 THEN '1-30'
                    WHEN julianday(?) - julianday(i.due_on) <= 60 THEN '31-60'
                    ELSE '60+'
                  END AS bucket,
                  i.currency, COUNT(*) AS n, SUM(i.amount_minor) AS amount_minor
           FROM invoices i
           WHERE i.status = 'sent'
           GROUP BY bucket, i.currency
           ORDER BY i.currency, bucket`,
        )
        .all(today, today, today) as AgingBucket[];
    },

    projectRevenue(projectId: number): { invoiced_minor: number; collected_minor: number } {
      return db
        .query(
          `SELECT COALESCE(SUM(CASE WHEN status IN ('sent','paid') THEN amount_minor ELSE 0 END), 0) AS invoiced_minor,
                  COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_minor ELSE 0 END), 0) AS collected_minor
           FROM invoices WHERE project_id = ?`,
        )
        .get(projectId) as { invoiced_minor: number; collected_minor: number };
    },

    capacityGrid(monday: string): CapacityCell[] {
      return db
        .query(
          `WITH RECURSIVE weeks(n, w0, w1) AS (
             SELECT 0, date(?), date(?, '+6 days')
             UNION ALL SELECT n+1, date(w0,'+7 days'), date(w1,'+7 days') FROM weeks WHERE n < 7)
           SELECT e.id, e.full_name, w.n AS week,
                  COALESCE(SUM(pa.allocation_pct), 0) AS pct
           FROM employees e
           CROSS JOIN weeks w
           LEFT JOIN project_assignments pa
             ON pa.employee_id = e.id AND pa.start_on <= w.w1 AND (pa.end_on IS NULL OR pa.end_on >= w.w0)
           WHERE e.archived_at IS NULL AND e.status <> 'exited'
           GROUP BY e.id, w.n
           ORDER BY e.full_name, w.n`,
        )
        .all(monday, monday) as CapacityCell[];
    },

    benchPct(today: string): number {
      const row = db
        .query(
          `WITH cur AS (
             SELECT e.id, COALESCE(SUM(pa.allocation_pct), 0) AS pct
             FROM employees e
             LEFT JOIN project_assignments pa ON pa.employee_id = e.id
                  AND pa.start_on <= ? AND (pa.end_on IS NULL OR pa.end_on >= ?)
             WHERE e.archived_at IS NULL AND e.status = 'active'
             GROUP BY e.id)
           SELECT ROUND(100.0 * SUM(MAX(0, 100 - MIN(100, pct))) / (100.0 * COUNT(*)), 1) AS bench_pct
           FROM cur`,
        )
        .get(today, today) as { bench_pct: number | null };
      return row.bench_pct ?? 0;
    },

    benchList(today: string): { id: number; full_name: string; pct: number }[] {
      return db
        .query(
          `SELECT e.id, e.full_name, COALESCE(SUM(pa.allocation_pct), 0) AS pct
           FROM employees e
           LEFT JOIN project_assignments pa ON pa.employee_id = e.id
                AND pa.start_on <= ? AND (pa.end_on IS NULL OR pa.end_on >= ?)
           WHERE e.archived_at IS NULL AND e.status = 'active'
           GROUP BY e.id
           HAVING pct < 100
           ORDER BY pct, e.full_name`,
        )
        .all(today, today) as { id: number; full_name: string; pct: number }[];
    },
  };
}
