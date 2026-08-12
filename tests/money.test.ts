import { describe, expect, test } from "bun:test";
import { ValidationError } from "../src/domain/errors.ts";
import { fmtMoney, prorate, toInput, toMinor } from "../src/domain/money.ts";

describe("toMinor", () => {
  test("parses formatted input without float error", () => {
    expect(toMinor("45,000.00")).toBe(4_500_000);
    expect(toMinor("0.1")).toBe(10); // 0.1 * 100 === 10.000000000000002 in floats
    expect(toMinor("0.01")).toBe(1);
    expect(toMinor("300000")).toBe(30_000_000);
    expect(toMinor(" 2 500.50 ")).toBe(250_050);
    expect(toMinor("-1,000")).toBe(-100_000);
  });

  test("rejects junk and over-precise input rather than truncating", () => {
    expect(() => toMinor("")).toThrow(ValidationError);
    expect(() => toMinor("abc")).toThrow(ValidationError);
    expect(() => toMinor("45.000,00")).toThrow(ValidationError);
    expect(() => toMinor("1.005")).toThrow(ValidationError); // silent truncation would lose money
  });

  test("round-trips through toInput", () => {
    for (const minor of [0, 1, 10, 4_500_000, -100_000]) {
      expect(toMinor(toInput(minor))).toBe(minor);
    }
  });
});

describe("fmtMoney", () => {
  test("display digits vary by currency, storage scale never does", () => {
    expect(fmtMoney(30_000_000, "PKR")).toBe("PKR 300,000");
    expect(fmtMoney(30_000_000, "USD")).toBe("USD 300,000.00");
    expect(fmtMoney(1, "USD")).toBe("USD 0.01");
    expect(fmtMoney(0, "PKR")).toBe("PKR 0");
  });
});

describe("prorate", () => {
  test("mid-month joiner", () => {
    expect(prorate(30_000_000, 16, 31)).toBe(15_483_871);
  });

  test("a full period returns the amount exactly", () => {
    expect(prorate(30_000_000, 31, 31)).toBe(30_000_000);
    expect(prorate(1_234_567, 28, 28)).toBe(1_234_567);
  });

  test("zero payable days pays nothing", () => {
    expect(prorate(30_000_000, 0, 31)).toBe(0);
  });

  test("rejects an impossible period", () => {
    expect(() => prorate(100, 1, 0)).toThrow(RangeError);
    expect(() => prorate(100, -1, 30)).toThrow(RangeError);
  });
});
