import { describe, expect, test } from "bun:test";
import { createDb } from "../src/db/index.ts";
import { createStore, type Store } from "../src/db/store.ts";
import { ConflictError, ValidationError } from "../src/domain/errors.ts";
import { createDeliveryService } from "../src/services/delivery.ts";
import { createEconomicsService, mondayOf } from "../src/services/economics.ts";
import { createEmployeeService } from "../src/services/employees.ts";
import { createPayrollService } from "../src/services/payroll.ts";

function setup() {
  const store = createStore(createDb(":memory:"));
  return {
    store,
    economics: createEconomicsService(store),
    delivery: createDeliveryService(store),
    employees: createEmployeeService(store),
    payroll: createPayrollService(store),
  };
}

function clientAndProject(ctx: ReturnType<typeof setup>) {
  const client = ctx.delivery.createClient({ name: "Northwind", code: "NW", currency: "USD", status: "active" });
  const project = ctx.delivery.createProject({
    code: "NW-1",
    name: "Portal",
    kind: "client",
    client_id: String(client.id),
    billing_model: "fixed_price",
    currency: "USD",
    budget_minor: "120,000",
  });
  return { client, project };
}

const INVOICE = {
  number: "NW-2026-07",
  amount_minor: "30,000",
  issued_on: "2026-07-01",
  due_on: "2026-07-31",
  currency: "USD",
};

describe("invoices", () => {
  test("created as a draft against a client", () => {
    const ctx = setup();
    const { client } = clientAndProject(ctx);
    const invoice = ctx.economics.createInvoice({ ...INVOICE, client_id: String(client.id) });
    expect(invoice.status).toBe("draft");
    expect(invoice.amount_minor).toBe(3_000_000);
    expect(invoice.client_name).toBe("Northwind");
  });

  test("duplicate numbers are refused", () => {
    const ctx = setup();
    const { client } = clientAndProject(ctx);
    ctx.economics.createInvoice({ ...INVOICE, client_id: String(client.id) });
    expect(() => ctx.economics.createInvoice({ ...INVOICE, client_id: String(client.id) })).toThrow(
      ConflictError,
    );
  });

  test("a due date before the issue date is refused", () => {
    const ctx = setup();
    const { client } = clientAndProject(ctx);
    expect(() =>
      ctx.economics.createInvoice({
        ...INVOICE,
        client_id: String(client.id),
        issued_on: "2026-07-31",
        due_on: "2026-07-01",
      }),
    ).toThrow(ValidationError);
  });

  test("an invoice cannot point at another client's project", () => {
    const ctx = setup();
    const { project } = clientAndProject(ctx);
    const other = ctx.delivery.createClient({ name: "Other", code: "OTH", currency: "USD", status: "active" });
    expect(() =>
      ctx.economics.createInvoice({
        ...INVOICE,
        client_id: String(other.id),
        project_id: String(project.id),
      }),
    ).toThrow(/does not belong to this client/);
  });

  test("status flow draft → sent → paid stamps the paid date", () => {
    const ctx = setup();
    const { client } = clientAndProject(ctx);
    const invoice = ctx.economics.createInvoice({ ...INVOICE, client_id: String(client.id) });
    ctx.economics.setStatus(invoice.id, "sent", "2026-07-02");
    ctx.economics.setStatus(invoice.id, "paid", "2026-08-05");
    const paid = ctx.store.getInvoice(invoice.id);
    expect(paid?.status).toBe("paid");
    expect(paid?.paid_on).toBe("2026-08-05");
  });

  test("a paid invoice cannot be edited, only voided", () => {
    const ctx = setup();
    const { client } = clientAndProject(ctx);
    const invoice = ctx.economics.createInvoice({ ...INVOICE, client_id: String(client.id) });
    ctx.economics.setStatus(invoice.id, "paid", "2026-08-05");
    expect(() =>
      ctx.economics.updateInvoice(invoice.id, { ...INVOICE, client_id: String(client.id) }),
    ).toThrow(/cannot be edited/);
    expect(() => ctx.economics.setStatus(invoice.id, "sent", "2026-08-06")).toThrow(/only be voided/);
    ctx.economics.setStatus(invoice.id, "void", "2026-08-06");
    expect(ctx.store.getInvoice(invoice.id)?.status).toBe("void");
  });

  test("only a draft invoice can be deleted", () => {
    const ctx = setup();
    const { client } = clientAndProject(ctx);
    const invoice = ctx.economics.createInvoice({ ...INVOICE, client_id: String(client.id) });
    ctx.economics.setStatus(invoice.id, "sent", "2026-07-02");
    expect(() => ctx.economics.removeInvoice(invoice.id)).toThrow(/void it instead/);
  });
});

describe("AR aging", () => {
  function sentInvoice(ctx: ReturnType<typeof setup>, clientId: number, number: string, due: string) {
    const invoice = ctx.economics.createInvoice({
      ...INVOICE,
      number,
      client_id: String(clientId),
      issued_on: "2026-04-01",
      due_on: due,
    });
    ctx.economics.setStatus(invoice.id, "sent", "2026-06-01");
    return invoice;
  }

  test("buckets by how overdue each invoice is", () => {
    const ctx = setup();
    const { client } = clientAndProject(ctx);
    const today = "2026-08-01";
    sentInvoice(ctx, client.id, "A", "2026-09-01");
    sentInvoice(ctx, client.id, "B", "2026-07-20");
    sentInvoice(ctx, client.id, "C", "2026-06-20");
    sentInvoice(ctx, client.id, "D", "2026-05-01");

    const aging = ctx.store.arAging(today);
    const byBucket = Object.fromEntries(aging.map((b) => [b.bucket, b.n]));
    expect(byBucket.current).toBe(1);
    expect(byBucket["1-30"]).toBe(1);
    expect(byBucket["31-60"]).toBe(1);
    expect(byBucket["60+"]).toBe(1);
  });

  test("paid and draft invoices are not receivables", () => {
    const ctx = setup();
    const { client } = clientAndProject(ctx);
    ctx.economics.createInvoice({ ...INVOICE, number: "DRAFT", client_id: String(client.id) });
    const sent = sentInvoice(ctx, client.id, "SENT", "2026-07-01");
    expect(ctx.store.arAging("2026-08-01")).toHaveLength(1);
    ctx.economics.setStatus(sent.id, "paid", "2026-08-01");
    expect(ctx.store.arAging("2026-08-01")).toHaveLength(0);
  });

  test("currencies are grouped, never summed together", () => {
    const ctx = setup();
    const { client } = clientAndProject(ctx);
    const pkrClient = ctx.delivery.createClient({ name: "Local", code: "LOC", currency: "PKR", status: "active" });
    sentInvoice(ctx, client.id, "USD-1", "2026-07-01");
    const pkr = ctx.economics.createInvoice({
      ...INVOICE,
      number: "PKR-1",
      client_id: String(pkrClient.id),
      currency: "PKR",
      issued_on: "2026-04-01",
      due_on: "2026-07-01",
    });
    ctx.economics.setStatus(pkr.id, "sent", "2026-06-01");
    const aging = ctx.store.arAging("2026-08-01");
    expect(new Set(aging.map((b) => b.currency))).toEqual(new Set(["USD", "PKR"]));
  });
});

describe("capacity and bench", () => {
  function person(ctx: ReturnType<typeof setup>, code: string, name: string): number {
    return ctx.employees.create({
      code,
      full_name: name,
      joined_on: "2024-01-01",
      status: "active",
      employment_type: "full_time",
    }).id;
  }

  test("bench is the share of unbooked time", () => {
    const ctx = setup();
    const { project } = clientAndProject(ctx);
    const a = person(ctx, "E1", "Fully Booked");
    const b = person(ctx, "E2", "Half Booked");
    ctx.delivery.addAssignment(project.id, {
      employee_id: String(a),
      allocation_pct: "100",
      start_on: "2026-01-01",
    });
    ctx.delivery.addAssignment(project.id, {
      employee_id: String(b),
      allocation_pct: "50",
      start_on: "2026-01-01",
    });
    expect(ctx.store.benchPct("2026-07-01")).toBe(25);
  });

  test("over-allocation never produces negative bench", () => {
    const ctx = setup();
    const { project } = clientAndProject(ctx);
    const a = person(ctx, "E1", "Over Booked");
    ctx.delivery.addAssignment(project.id, {
      employee_id: String(a),
      allocation_pct: "100",
      start_on: "2026-01-01",
    });
    ctx.delivery.addAssignment(project.id, {
      employee_id: String(a),
      allocation_pct: "60",
      start_on: "2026-01-01",
    });
    expect(ctx.store.benchPct("2026-07-01")).toBe(0);
  });

  test("an unallocated person is fully on the bench and listed", () => {
    const ctx = setup();
    person(ctx, "E1", "Nobody Booked");
    expect(ctx.store.benchPct("2026-07-01")).toBe(100);
    expect(ctx.store.benchList("2026-07-01").map((b) => b.full_name)).toEqual(["Nobody Booked"]);
  });

  test("the grid covers eight weeks per person", () => {
    const ctx = setup();
    const { project } = clientAndProject(ctx);
    const a = person(ctx, "E1", "Someone");
    ctx.delivery.addAssignment(project.id, {
      employee_id: String(a),
      allocation_pct: "80",
      start_on: "2026-07-06",
      end_on: "2026-07-19",
    });
    const grid = ctx.store.capacityGrid("2026-07-06");
    expect(grid).toHaveLength(8);
    expect(grid[0]?.pct).toBe(80);
    expect(grid[1]?.pct).toBe(80);
    expect(grid[2]?.pct).toBe(0);
  });

  test("mondayOf normalises any day to its week start", () => {
    expect(mondayOf("2026-07-08")).toBe("2026-07-06");
    expect(mondayOf("2026-07-06")).toBe("2026-07-06");
    expect(mondayOf("2026-07-12")).toBe("2026-07-06");
  });
});

describe("project economics", () => {
  test("cost comes from final payslips, allocated by assignment", () => {
    const ctx = setup();
    const { project } = clientAndProject(ctx);
    const emp = ctx.employees.create({
      code: "E1",
      full_name: "Ayesha",
      joined_on: "2024-01-01",
      status: "active",
      employment_type: "full_time",
    });
    ctx.employees.addCompensation(emp.id, {
      effective_from: "2024-01-01",
      base_monthly_minor: "100,000",
      currency: "USD",
    });
    ctx.delivery.addAssignment(project.id, {
      employee_id: String(emp.id),
      allocation_pct: "50",
      start_on: "2026-01-01",
    });

    const cycle = ctx.payroll.createCycle({ period_month: "2026-07" });
    ctx.payroll.generate(cycle.id);
    ctx.payroll.setStatus(cycle.id, "approved");

    const pnl = ctx.economics.projectPnl(project.id, "2026-07");
    expect(pnl.costMinor).toBe(5_000_000);
  });

  test("draft payslips do not count as cost", () => {
    const ctx = setup();
    const { project } = clientAndProject(ctx);
    const emp = ctx.employees.create({
      code: "E1",
      full_name: "Ayesha",
      joined_on: "2024-01-01",
      status: "active",
      employment_type: "full_time",
    });
    ctx.employees.addCompensation(emp.id, {
      effective_from: "2024-01-01",
      base_monthly_minor: "100,000",
      currency: "USD",
    });
    ctx.delivery.addAssignment(project.id, {
      employee_id: String(emp.id),
      allocation_pct: "100",
      start_on: "2026-01-01",
    });
    const cycle = ctx.payroll.createCycle({ period_month: "2026-07" });
    ctx.payroll.generate(cycle.id);
    expect(ctx.economics.projectPnl(project.id, "2026-07").costMinor).toBe(0);
  });

  test("margin is invoiced minus cost when currencies match", () => {
    const ctx = setup();
    const { client, project } = clientAndProject(ctx);
    const invoice = ctx.economics.createInvoice({
      ...INVOICE,
      client_id: String(client.id),
      project_id: String(project.id),
    });
    ctx.economics.setStatus(invoice.id, "sent", "2026-07-02");

    const pnl = ctx.economics.projectPnl(project.id, "2026-07");
    expect(pnl.invoicedMinor).toBe(3_000_000);
    expect(pnl.collectedMinor).toBe(0);
    expect(pnl.marginMinor).toBe(3_000_000);
    expect(pnl.marginPct).toBe(100);
  });

  test("margin is withheld rather than fabricated across currencies", () => {
    const ctx = setup();
    const { client, project } = clientAndProject(ctx);
    const emp = ctx.employees.create({
      code: "E1",
      full_name: "Ayesha",
      joined_on: "2024-01-01",
      status: "active",
      employment_type: "full_time",
    });
    ctx.employees.addCompensation(emp.id, {
      effective_from: "2024-01-01",
      base_monthly_minor: "300,000",
      currency: "PKR",
    });
    ctx.delivery.addAssignment(project.id, {
      employee_id: String(emp.id),
      allocation_pct: "100",
      start_on: "2026-01-01",
    });
    const invoice = ctx.economics.createInvoice({
      ...INVOICE,
      client_id: String(client.id),
      project_id: String(project.id),
    });
    ctx.economics.setStatus(invoice.id, "sent", "2026-07-02");
    const cycle = ctx.payroll.createCycle({ period_month: "2026-07" });
    ctx.payroll.generate(cycle.id);
    ctx.payroll.setStatus(cycle.id, "approved");

    const pnl = ctx.economics.projectPnl(project.id, "2026-07");
    expect(pnl.costCurrency).toBe("PKR");
    expect(pnl.marginMinor).toBeNull();
  });

  test("collected only counts paid invoices", () => {
    const ctx = setup();
    const { client, project } = clientAndProject(ctx);
    const invoice = ctx.economics.createInvoice({
      ...INVOICE,
      client_id: String(client.id),
      project_id: String(project.id),
    });
    ctx.economics.setStatus(invoice.id, "paid", "2026-08-01");
    const pnl = ctx.economics.projectPnl(project.id, "2026-07");
    expect(pnl.collectedMinor).toBe(3_000_000);
  });
});
