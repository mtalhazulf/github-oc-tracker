import { describe, expect, test } from "bun:test";
import { createDb } from "../src/db/index.ts";
import { createStore, type Store } from "../src/db/store.ts";
import { ConflictError } from "../src/domain/errors.ts";
import { computeAnnualTax } from "../src/domain/tax.ts";
import { createEmployeeService } from "../src/services/employees.ts";
import { createPayrollService, csvCell, fiscalYearFor } from "../src/services/payroll.ts";

function setup() {
  const store = createStore(createDb(":memory:"));
  return { store, payroll: createPayrollService(store), employees: createEmployeeService(store) };
}

function hire(
  employees: ReturnType<typeof createEmployeeService>,
  over: Record<string, string> = {},
): { id: number } {
  return employees.create({
    code: over.code ?? "EMP-001",
    full_name: over.full_name ?? "Ayesha Khan",
    joined_on: over.joined_on ?? "2024-01-01",
    exited_on: over.exited_on ?? "",
    status: over.status ?? "active",
    employment_type: over.employment_type ?? "full_time",
    designation: over.designation ?? "Engineer",
  });
}

function pay(
  employees: ReturnType<typeof createEmployeeService>,
  id: number,
  amount: string,
  from = "2024-01-01",
) {
  employees.addCompensation(id, {
    effective_from: from,
    base_monthly_minor: amount,
    currency: "PKR",
  });
}

function generateJuly(store: Store, payroll: ReturnType<typeof createPayrollService>) {
  const cycle = payroll.createCycle({ period_month: "2026-07" });
  const result = payroll.generate(cycle.id);
  return { cycle: store.getCycle(cycle.id), result, cycleId: cycle.id };
}

describe("payslip generation", () => {
  test("a full month pays the full base", () => {
    const { store, payroll, employees } = setup();
    const emp = hire(employees);
    pay(employees, emp.id, "300,000");
    const { cycleId } = generateJuly(store, payroll);

    const slip = store.listPayslips(cycleId)[0];
    expect(slip?.period_days).toBe(31);
    expect(slip?.payable_days).toBe(31);
    expect(slip?.base_monthly_minor).toBe(30_000_000);
    expect(slip?.gross_minor).toBe(30_000_000);
    expect(slip?.net_minor).toBe(30_000_000);
  });

  test("a mid-month joiner is pro-rated 16/31", () => {
    const { store, payroll, employees } = setup();
    const emp = hire(employees, { joined_on: "2026-07-16" });
    pay(employees, emp.id, "300,000", "2026-07-16");
    const { cycleId } = generateJuly(store, payroll);

    const slip = store.listPayslips(cycleId)[0];
    expect(slip?.payable_days).toBe(16);
    expect(slip?.gross_minor).toBe(15_483_871);
  });

  test("a mid-month leaver is pro-rated to their last day", () => {
    const { store, payroll, employees } = setup();
    const emp = hire(employees, { joined_on: "2024-01-01", exited_on: "2026-07-10", status: "exited" });
    pay(employees, emp.id, "310,000");
    const { cycleId } = generateJuly(store, payroll);

    const slip = store.listPayslips(cycleId)[0];
    expect(slip?.payable_days).toBe(10);
  });

  test("someone who left before the period is excluded entirely", () => {
    const { store, payroll, employees } = setup();
    const emp = hire(employees, { exited_on: "2026-06-30", status: "exited" });
    pay(employees, emp.id, "300,000");
    const { cycleId } = generateJuly(store, payroll);
    expect(store.listPayslips(cycleId)).toHaveLength(0);
  });

  test("no compensation on file means skipped, and says so", () => {
    const { store, payroll, employees } = setup();
    hire(employees);
    const { result, cycleId } = generateJuly(store, payroll);
    expect(store.listPayslips(cycleId)).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ name: "Ayesha Khan", reason: "no compensation on file" });
  });

  test("a contractor with no salary is included at zero, for a per-deliverable line", () => {
    const { store, payroll, employees } = setup();
    hire(employees, { employment_type: "contract", full_name: "Kamran Freelance" });
    const { result, cycleId } = generateJuly(store, payroll);
    expect(result.created).toBe(1);
    const slip = store.listPayslips(cycleId)[0];
    expect(slip?.base_monthly_minor).toBe(0);
    expect(slip?.payable_days).toBe(31);
  });

  test("uses the compensation IN FORCE for the period, not the newest record", () => {
    const { store, payroll, employees } = setup();
    const emp = hire(employees);
    pay(employees, emp.id, "200,000", "2024-01-01");
    pay(employees, emp.id, "300,000", "2026-08-01");
    const { cycleId } = generateJuly(store, payroll);
    expect(store.listPayslips(cycleId)[0]?.base_monthly_minor).toBe(20_000_000);
  });

  test("regenerating a draft replaces rather than duplicates", () => {
    const { store, payroll, employees } = setup();
    const emp = hire(employees);
    pay(employees, emp.id, "300,000");
    const { cycleId } = generateJuly(store, payroll);
    payroll.generate(cycleId);
    expect(store.listPayslips(cycleId)).toHaveLength(1);
  });
});

describe("the payslip is a document", () => {
  test("renaming an employee afterwards does not rewrite the payslip", () => {
    const { store, payroll, employees } = setup();
    const emp = hire(employees);
    pay(employees, emp.id, "300,000");
    const { cycleId } = generateJuly(store, payroll);
    payroll.setStatus(cycleId, "approved");

    employees.update(emp.id, {
      code: "EMP-001",
      full_name: "Ayesha Something-Else",
      joined_on: "2024-01-01",
      status: "active",
      employment_type: "full_time",
      designation: "Principal Engineer",
    });

    const slip = store.listPayslips(cycleId)[0];
    expect(slip?.employee_name).toBe("Ayesha Khan");
    expect(slip?.designation).toBe("Engineer");
  });

  test("an employee with payslips cannot be hard-deleted", () => {
    const { store, payroll, employees } = setup();
    const emp = hire(employees);
    pay(employees, emp.id, "300,000");
    generateJuly(store, payroll);
    expect(() => employees.remove(emp.id)).toThrow(/payroll history/);
  });
});

describe("cycle lifecycle", () => {
  function approvedCycle() {
    const ctx = setup();
    const emp = hire(ctx.employees);
    pay(ctx.employees, emp.id, "300,000");
    const { cycleId } = generateJuly(ctx.store, ctx.payroll);
    ctx.payroll.setStatus(cycleId, "approved");
    return { ...ctx, cycleId };
  }

  test("approving finalises every payslip", () => {
    const { store, cycleId } = approvedCycle();
    expect(store.listPayslips(cycleId).every((p) => p.status === "final")).toBe(true);
  });

  test("approved can reopen to draft (the 29th-of-the-month correction)", () => {
    const { store, payroll, cycleId } = approvedCycle();
    payroll.setStatus(cycleId, "draft");
    expect(store.getCycle(cycleId)?.status).toBe("draft");
  });

  test("paid is terminal", () => {
    const { store, payroll, cycleId } = approvedCycle();
    payroll.setStatus(cycleId, "paid");
    expect(store.getCycle(cycleId)?.status).toBe("paid");
    expect(() => payroll.setStatus(cycleId, "draft")).toThrow(/final/);
  });

  test("a paid cycle cannot be deleted — the cascade would erase the month", () => {
    const { store, payroll, cycleId } = approvedCycle();
    payroll.setStatus(cycleId, "paid");
    expect(() => payroll.removeCycle(cycleId)).toThrow(ConflictError);
    expect(store.getCycle(cycleId)).not.toBeNull();
    expect(store.listPayslips(cycleId)).toHaveLength(1);
  });

  test("a draft cycle can be deleted", () => {
    const { store, payroll, employees } = setup();
    const emp = hire(employees);
    pay(employees, emp.id, "300,000");
    const { cycleId } = generateJuly(store, payroll);
    payroll.removeCycle(cycleId);
    expect(store.getCycle(cycleId)).toBeNull();
  });

  test("an approved cycle cannot be regenerated", () => {
    const { payroll, cycleId } = approvedCycle();
    expect(() => payroll.generate(cycleId)).toThrow(/draft/);
  });

  test("an empty cycle cannot be approved", () => {
    const { payroll } = setup();
    const cycle = payroll.createCycle({ period_month: "2026-07" });
    expect(() => payroll.setStatus(cycle.id, "approved")).toThrow(/Generate the payslips/);
  });

  test("two cycles cannot share a period", () => {
    const { payroll } = setup();
    payroll.createCycle({ period_month: "2026-07" });
    expect(() => payroll.createCycle({ period_month: "2026-07" })).toThrow(ConflictError);
  });
});

describe("payslip editing", () => {
  function draftSlip() {
    const ctx = setup();
    const emp = hire(ctx.employees);
    pay(ctx.employees, emp.id, "300,000");
    const { cycleId } = generateJuly(ctx.store, ctx.payroll);
    const slip = ctx.store.listPayslips(cycleId)[0];
    return { ...ctx, cycleId, slipId: slip?.id ?? 0 };
  }

  test("adding an earning raises gross and net", () => {
    const { store, payroll, slipId } = draftSlip();
    payroll.replaceItems(slipId, {
      item_kind: ["earning"],
      item_label: ["Eid bonus"],
      item_amount: ["50,000"],
      item_code: ["bonus"],
    });
    const slip = store.getPayslip(slipId);
    expect(slip?.gross_minor).toBe(35_000_000);
    expect(slip?.net_minor).toBe(35_000_000);
  });

  test("a deduction reduces net but not gross", () => {
    const { store, payroll, slipId } = draftSlip();
    payroll.replaceItems(slipId, {
      item_kind: ["deduction"],
      item_label: ["Advance recovery"],
      item_amount: ["20,000"],
      item_code: ["advance"],
    });
    const slip = store.getPayslip(slipId);
    expect(slip?.gross_minor).toBe(30_000_000);
    expect(slip?.deductions_minor).toBe(2_000_000);
    expect(slip?.net_minor).toBe(28_000_000);
  });

  test("net may go negative when an advance exceeds the month", () => {
    const { store, payroll, slipId } = draftSlip();
    payroll.replaceItems(slipId, {
      item_kind: ["deduction"],
      item_label: ["Large advance"],
      item_amount: ["400,000"],
      item_code: ["advance"],
    });
    expect(store.getPayslip(slipId)?.net_minor).toBe(-10_000_000);
  });

  test("saving replaces the whole set, and blank rows are ignored", () => {
    const { store, payroll, slipId } = draftSlip();
    payroll.replaceItems(slipId, {
      item_kind: ["earning", "earning"],
      item_label: ["Bonus", ""],
      item_amount: ["10,000", ""],
      item_code: ["bonus", "other"],
    });
    expect(store.listItems(slipId)).toHaveLength(1);
    payroll.replaceItems(slipId, { item_kind: [], item_label: [], item_amount: [], item_code: [] });
    expect(store.listItems(slipId)).toHaveLength(0);
  });

  test("reducing payable days re-prorates the base", () => {
    const { store, payroll, slipId } = draftSlip();
    payroll.updatePayslip(slipId, { payable_days: "29", note: "2 days unpaid leave" });
    const slip = store.getPayslip(slipId);
    expect(slip?.payable_days).toBe(29);
    expect(slip?.gross_minor).toBe(Math.round((30_000_000 * 29) / 31));
  });

  test("payable days cannot exceed the month", () => {
    const { payroll, slipId } = draftSlip();
    expect(() => payroll.updatePayslip(slipId, { payable_days: "45" })).toThrow();
  });

  test("an approved cycle's payslip is read-only", () => {
    const { payroll, cycleId, slipId } = draftSlip();
    payroll.setStatus(cycleId, "approved");
    expect(() => payroll.updatePayslip(slipId, { payable_days: "20" })).toThrow(/can no longer be edited/);
  });
});

describe("tax slabs", () => {
  test("no slabs configured means no tax line at all", () => {
    const { store, payroll, employees } = setup();
    const emp = hire(employees);
    pay(employees, emp.id, "300,000");
    const { cycleId } = generateJuly(store, payroll);
    const slip = store.listPayslips(cycleId)[0];
    expect(store.listItems(slip?.id ?? 0)).toHaveLength(0);
    expect(slip?.deductions_minor).toBe(0);
  });

  test("slabs produce a pro-rated monthly tax deduction", () => {
    const { store, payroll, employees } = setup();
    store.insertTaxSlab({ fiscalYear: "2026-27", lowerAnnualMinor: 0, fixedAnnualMinor: 0, rateBp: 0 });
    store.insertTaxSlab({
      fiscalYear: "2026-27",
      lowerAnnualMinor: 60_000_000,
      fixedAnnualMinor: 0,
      rateBp: 1000,
    });
    const emp = hire(employees);
    pay(employees, emp.id, "100,000");
    const { cycleId } = generateJuly(store, payroll);
    const slip = store.listPayslips(cycleId)[0];
    const items = store.listItems(slip?.id ?? 0);
    expect(items).toHaveLength(1);
    expect(items[0]?.code).toBe("tax");
    expect(items[0]?.amount_minor).toBe(500_000);
    expect(slip?.net_minor).toBe(10_000_000 - 500_000);
  });

  test("the slab function itself", () => {
    const slabs = [
      { lower_annual_minor: 0, fixed_annual_minor: 0, rate_bp: 0 },
      { lower_annual_minor: 60_000_000, fixed_annual_minor: 0, rate_bp: 500 },
      { lower_annual_minor: 120_000_000, fixed_annual_minor: 3_000_000, rate_bp: 1500 },
    ];
    expect(computeAnnualTax(50_000_000, slabs)).toBe(0);
    expect(computeAnnualTax(100_000_000, slabs)).toBe(2_000_000);
    expect(computeAnnualTax(120_000_000, slabs)).toBe(3_000_000);
    expect(computeAnnualTax(200_000_000, slabs)).toBe(3_000_000 + 12_000_000);
    expect(computeAnnualTax(100_000_000, [])).toBe(0);
    expect(computeAnnualTax(0, slabs)).toBe(0);
  });

  test("fiscal year mapping honours the start month", () => {
    expect(fiscalYearFor("2026-07", 7)).toBe("2026-27");
    expect(fiscalYearFor("2026-06", 7)).toBe("2025-26");
    expect(fiscalYearFor("2026-03", 1)).toBe("2026-27");
  });
});

describe("csv export", () => {
  test("includes a row per payslip with plain decimal amounts", () => {
    const { store, payroll, employees } = setup();
    const emp = hire(employees);
    pay(employees, emp.id, "300,000");
    const { cycleId } = generateJuly(store, payroll);
    const csv = payroll.cycleCsv(cycleId);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("code,name");
    expect(lines[1]).toContain("Ayesha Khan");
    expect(lines[1]).toContain("300000.00");
  });

  test("neutralises formula injection and quotes commas", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("Khan, Ayesha")).toBe('"Khan, Ayesha"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("plain")).toBe("plain");
  });
});
