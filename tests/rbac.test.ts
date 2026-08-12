import { describe, expect, test } from "bun:test";
import { CAPABILITIES, ROLES, can, isRole } from "../src/domain/rbac.ts";

describe("rbac", () => {
  test("owner holds every capability", () => {
    for (const cap of CAPABILITIES) expect(can("owner", cap)).toBe(true);
  });

  test("only owner and admin see money", () => {
    expect(can("owner", "compensation.view")).toBe(true);
    expect(can("admin", "compensation.view")).toBe(true);
    expect(can("manager", "compensation.view")).toBe(false);
    expect(can("member", "compensation.view")).toBe(false);

    expect(can("manager", "payroll.manage")).toBe(false);
    expect(can("member", "payroll.manage")).toBe(false);
  });

  test("everyone can see their own payslip", () => {
    for (const role of ROLES) expect(can(role, "payslip.viewOwn")).toBe(true);
  });

  test("member is read-only", () => {
    expect(can("member", "code.view")).toBe(true);
    expect(can("member", "delivery.view")).toBe(true);
    expect(can("member", "people.view")).toBe(true);
    expect(can("member", "code.manage")).toBe(false);
    expect(can("member", "delivery.manage")).toBe(false);
    expect(can("member", "people.manage")).toBe(false);
    expect(can("member", "invoice.view")).toBe(false);
    expect(can("member", "capacity.view")).toBe(false);
  });

  test("only the owner manages users", () => {
    expect(can("owner", "users.manage")).toBe(true);
    expect(can("admin", "users.manage")).toBe(false);
  });

  test("manager runs delivery but not billing", () => {
    expect(can("manager", "delivery.manage")).toBe(true);
    expect(can("manager", "capacity.view")).toBe(true);
    expect(can("manager", "invoice.view")).toBe(true);
    expect(can("manager", "invoice.manage")).toBe(false);
    expect(can("manager", "settings.manage")).toBe(false);
  });

  test("isRole guards untrusted input", () => {
    expect(isRole("owner")).toBe(true);
    expect(isRole("superuser")).toBe(false);
  });
});
