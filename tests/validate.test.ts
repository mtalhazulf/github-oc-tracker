import { describe, expect, test } from "bun:test";
import { ValidationError } from "../src/domain/errors.ts";
import { validator } from "../src/domain/validate.ts";

describe("Validator", () => {
  test("collects every field error in one pass, not just the first", () => {
    const v = validator({ full_name: "", code: "bad code!", joined_on: "01/02/2024" });
    v.text("full_name", { label: "Name", required: true });
    v.code("code", { label: "Code", required: true });
    v.date("joined_on", { label: "Join date", required: true });

    expect(v.invalid).toBe(true);
    expect(Object.keys(v.fieldErrors).sort()).toEqual(["code", "full_name", "joined_on"]);
    expect(v.fieldErrors.full_name).toBe("Name is required.");
  });

  test("done() returns the value when everything is valid", () => {
    const v = validator({ full_name: "Ayesha Khan", code: "emp-001" });
    const name = v.text("full_name", { label: "Name", required: true });
    const code = v.code("code", { label: "Code", required: true });
    expect(v.done({ name, code })).toEqual({ name: "Ayesha Khan", code: "emp-001" });
  });

  test("done() throws a ValidationError carrying the fields", () => {
    const v = validator({});
    v.text("full_name", { label: "Name", required: true });
    try {
      v.done({});
      throw new Error("expected done() to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).status).toBe(422);
      expect((err as ValidationError).fields.full_name).toBe("Name is required.");
    }
  });

  test("money parses through the string parser", () => {
    const v = validator({ salary: "45,000.00", bad: "1.005" });
    expect(v.money("salary", { label: "Salary", required: true })).toBe(4_500_000);
    v.money("bad", { label: "Bad", required: true });
    expect(v.fieldErrors.bad).toContain("amount");
  });

  test("money rejects a negative when a floor is set", () => {
    const v = validator({ salary: "-100" });
    v.money("salary", { label: "Salary", required: true, min: 0 });
    expect(v.fieldErrors.salary).toContain("cannot be negative");
  });

  test("enum falls back rather than throwing on empty input", () => {
    const v = validator({});
    expect(v.enum("status", ["active", "exited"] as const, { label: "Status", fallback: "active" })).toBe(
      "active",
    );
    expect(v.invalid).toBe(false);
  });

  test("enum rejects a value outside the set", () => {
    const v = validator({ status: "deleted" });
    v.enum("status", ["active", "exited"] as const, { label: "Status", fallback: "active" });
    expect(v.fieldErrors.status).toContain("must be one of");
  });

  test("optional fields stay null rather than empty string", () => {
    const v = validator({ phone: "  " });
    expect(v.optionalText("phone", { label: "Phone" })).toBeNull();
    expect(v.invalid).toBe(false);
  });

  test("email shape", () => {
    const v = validator({ good: "a@b.co", bad: "not-an-email" });
    expect(v.email("good", { label: "Email" })).toBe("a@b.co");
    v.email("bad", { label: "Email" });
    expect(v.fieldErrors.bad).toContain("valid email");
  });

  test("int honours bounds", () => {
    const v = validator({ pct: "150" });
    v.int("pct", { label: "Allocation", min: 0, max: 100 });
    expect(v.fieldErrors.pct).toContain("at most 100");
  });

  test("currency normalises case and falls back", () => {
    const v = validator({ currency: "usd" });
    expect(v.currency("currency", { label: "Currency", fallback: "PKR" })).toBe("USD");
    expect(validator({}).currency("currency", { label: "Currency", fallback: "PKR" })).toBe("PKR");
  });

  test("bool reads the values a checkbox actually sends", () => {
    expect(validator({ x: "on" }).bool("x")).toBe(true);
    expect(validator({ x: "1" }).bool("x")).toBe(true);
    expect(validator({}).bool("x")).toBe(false);
  });

  test("check() records cross-field rules", () => {
    const v = validator({ joined_on: "2026-01-01", exited_on: "2025-01-01" });
    const joined = v.date("joined_on", { label: "Join date", required: true });
    const exited = v.date("exited_on", { label: "Exit date", required: false });
    v.check(!exited || !joined || exited >= joined, "exited_on", "Exit date cannot be before the join date.");
    expect(v.fieldErrors.exited_on).toBe("Exit date cannot be before the join date.");
  });

  test("the first error per field wins", () => {
    const v = validator({ code: "" });
    v.code("code", { label: "Code", required: true });
    v.check(false, "code", "some later rule");
    expect(v.fieldErrors.code).toBe("Code is required.");
  });
});
