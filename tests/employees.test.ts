import { describe, expect, test } from "bun:test";
import { createDb } from "../src/db/index.ts";
import { createStore } from "../src/db/store.ts";
import { ConflictError, ValidationError } from "../src/domain/errors.ts";
import { createEmployeeService } from "../src/services/employees.ts";

function setup() {
  const store = createStore(createDb(":memory:"));
  return { store, employees: createEmployeeService(store) };
}

const BASE = {
  code: "EMP-001",
  full_name: "Ayesha Khan",
  joined_on: "2024-01-01",
  status: "active",
  employment_type: "full_time",
};

describe("employee CRUD", () => {
  test("creates with sensible defaults", () => {
    const { employees } = setup();
    const created = employees.create(BASE);
    expect(created.full_name).toBe("Ayesha Khan");
    expect(created.status).toBe("active");
    expect(created.archived_at).toBeNull();
  });

  test("a work email is mapped as a commit identity automatically", () => {
    const { store, employees } = setup();
    const created = employees.create({ ...BASE, work_email: "ayesha@house.pk" });
    const identities = store.listIdentities(created.id);
    expect(identities).toHaveLength(1);
    expect(identities[0]).toMatchObject({ kind: "email", value: "ayesha@house.pk", source: "suggested" });
  });

  test("requires the fields payroll cannot work without", () => {
    const { employees } = setup();
    try {
      employees.create({ code: "", full_name: "", joined_on: "" });
      throw new Error("expected a ValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const fields = (err as ValidationError).fields;
      expect(Object.keys(fields).sort()).toEqual(["code", "full_name", "joined_on"]);
    }
  });

  test("rejects an exit date before the join date", () => {
    const { employees } = setup();
    expect(() => employees.create({ ...BASE, exited_on: "2023-01-01" })).toThrow(ValidationError);
  });

  test("an exited employee needs an exit date", () => {
    const { employees } = setup();
    try {
      employees.create({ ...BASE, status: "exited" });
      throw new Error("expected a ValidationError");
    } catch (err) {
      expect((err as ValidationError).fields.exited_on).toContain("exit date");
    }
  });

  test("duplicate codes are refused by name", () => {
    const { employees } = setup();
    employees.create(BASE);
    expect(() => employees.create({ ...BASE, full_name: "Someone Else" })).toThrow(ConflictError);
    expect(() => employees.create({ ...BASE, full_name: "Someone Else" })).toThrow(/Ayesha Khan/);
  });

  test("an archived employee still holds its code, and says so", () => {
    const { employees } = setup();
    const created = employees.create(BASE);
    employees.archive(created.id, true);
    expect(() => employees.create({ ...BASE, full_name: "New Person" })).toThrow(/archived/);
  });

  test("archive hides from the default list, restore brings it back", () => {
    const { store, employees } = setup();
    const created = employees.create(BASE);
    employees.archive(created.id, true);
    expect(store.listEmployees()).toHaveLength(0);
    expect(store.listEmployees({ includeArchived: true })).toHaveLength(1);
    employees.archive(created.id, false);
    expect(store.listEmployees()).toHaveLength(1);
  });

  test("updating keeps the same row", () => {
    const { store, employees } = setup();
    const created = employees.create(BASE);
    employees.update(created.id, { ...BASE, full_name: "Ayesha K.", designation: "Tech Lead" });
    const updated = store.getEmployee(created.id);
    expect(updated?.full_name).toBe("Ayesha K.");
    expect(updated?.designation).toBe("Tech Lead");
    expect(store.listEmployees()).toHaveLength(1);
  });

  test("filters by status, department and free text", () => {
    const { store, employees } = setup();
    employees.create({ ...BASE, department: "Engineering" });
    employees.create({
      ...BASE,
      code: "EMP-002",
      full_name: "Bilal Ahmed",
      department: "Design",
      status: "on_leave",
    });
    expect(store.listEmployees({ department: "Design" })).toHaveLength(1);
    expect(store.listEmployees({ status: "on_leave" })).toHaveLength(1);
    expect(store.listEmployees({ q: "Bilal" })).toHaveLength(1);
    expect(store.listEmployees({ q: "nobody" })).toHaveLength(0);
    expect(store.listDepartments().sort()).toEqual(["Design", "Engineering"]);
  });
});

describe("effective-dated compensation", () => {
  test("returns the record in force, not the newest", () => {
    const { store, employees } = setup();
    const emp = employees.create(BASE);
    employees.addCompensation(emp.id, {
      effective_from: "2024-01-01",
      base_monthly_minor: "200,000",
      currency: "PKR",
    });
    employees.addCompensation(emp.id, {
      effective_from: "2026-08-01",
      base_monthly_minor: "300,000",
      currency: "PKR",
      reason: "raise",
    });

    expect(store.compensationAsOf(emp.id, "2026-07-31")?.base_monthly_minor).toBe(20_000_000);
    expect(store.compensationAsOf(emp.id, "2026-08-01")?.base_monthly_minor).toBe(30_000_000);
    expect(store.compensationAsOf(emp.id, "2023-12-31")).toBeNull();
  });

  test("money is parsed to minor units", () => {
    const { store, employees } = setup();
    const emp = employees.create(BASE);
    employees.addCompensation(emp.id, {
      effective_from: "2024-01-01",
      base_monthly_minor: "45,000.50",
      currency: "PKR",
    });
    expect(store.listCompensation(emp.id)[0]?.base_monthly_minor).toBe(4_500_050);
  });

  test("two records cannot share an effective date", () => {
    const { employees } = setup();
    const emp = employees.create(BASE);
    employees.addCompensation(emp.id, { effective_from: "2024-01-01", base_monthly_minor: "100" });
    expect(() =>
      employees.addCompensation(emp.id, { effective_from: "2024-01-01", base_monthly_minor: "200" }),
    ).toThrow(ConflictError);
  });

  test("rejects junk amounts", () => {
    const { employees } = setup();
    const emp = employees.create(BASE);
    expect(() =>
      employees.addCompensation(emp.id, { effective_from: "2024-01-01", base_monthly_minor: "abc" }),
    ).toThrow(ValidationError);
  });

  test("deleting an employee removes their compensation", () => {
    const { store, employees } = setup();
    const emp = employees.create(BASE);
    employees.addCompensation(emp.id, { effective_from: "2024-01-01", base_monthly_minor: "100" });
    employees.remove(emp.id);
    expect(store.listCompensation(emp.id)).toHaveLength(0);
    expect(store.getEmployee(emp.id)).toBeNull();
  });
});
