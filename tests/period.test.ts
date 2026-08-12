import { describe, expect, test } from "bun:test";
import { ValidationError } from "../src/domain/errors.ts";
import {
  addMonths,
  currentPeriod,
  isIsoDate,
  isPeriod,
  periodBounds,
  periodEpochRange,
  todayIso,
} from "../src/domain/period.ts";

describe("date shapes", () => {
  test("accepts real dates and rejects lookalikes", () => {
    expect(isIsoDate("2024-02-01")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true); // leap year
    expect(isIsoDate("2026-02-29")).toBe(false); // not a leap year
    expect(isIsoDate("2024-13-01")).toBe(false);
    expect(isIsoDate("01/02/2024")).toBe(false);
    expect(isIsoDate("2024-2-1")).toBe(false);
    expect(isIsoDate("abcd-ef-gh")).toBe(false);
  });

  test("period shape", () => {
    expect(isPeriod("2026-07")).toBe(true);
    expect(isPeriod("2026-13")).toBe(false);
    expect(isPeriod("2026-7")).toBe(false);
  });
});

describe("timezone-aware today", () => {
  const lateJulyUtc = Date.parse("2026-07-31T20:00:00Z");

  test("UTC+05:00 has already rolled into August", () => {
    expect(todayIso(300, lateJulyUtc)).toBe("2026-08-01");
    expect(currentPeriod(300, lateJulyUtc)).toBe("2026-08");
  });

  test("UTC is still in July", () => {
    expect(todayIso(0, lateJulyUtc)).toBe("2026-07-31");
    expect(currentPeriod(0, lateJulyUtc)).toBe("2026-07");
  });

  test("a negative offset can still be on the previous day", () => {
    const earlyUtc = Date.parse("2026-08-01T03:00:00Z");
    expect(todayIso(-420, earlyUtc)).toBe("2026-07-31");
    expect(currentPeriod(-420, earlyUtc)).toBe("2026-07");
  });
});

describe("periodBounds", () => {
  test("month lengths", () => {
    expect(periodBounds("2026-07")).toEqual({ start: "2026-07-01", end: "2026-07-31", days: 31 });
    expect(periodBounds("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28", days: 28 });
    expect(periodBounds("2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29", days: 29 });
    expect(periodBounds("2026-04")).toEqual({ start: "2026-04-01", end: "2026-04-30", days: 30 });
  });

  test("rejects a malformed period", () => {
    expect(() => periodBounds("2026-13")).toThrow(ValidationError);
  });
});

describe("addMonths", () => {
  test("crosses year boundaries in both directions", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-07", 0)).toBe("2026-07");
    expect(addMonths("2026-07", -12)).toBe("2025-07");
  });
});

describe("periodEpochRange", () => {
  test("covers exactly the period's days in the display timezone", () => {
    const { from, to } = periodEpochRange("2026-07", 0);
    expect(from).toBe(Math.floor(Date.parse("2026-07-01T00:00:00Z") / 1000));
    expect(to - from).toBe(31 * 86_400);
  });

  test("shifts with the offset", () => {
    const utc = periodEpochRange("2026-07", 0);
    const pkt = periodEpochRange("2026-07", 300);
    expect(utc.from - pkt.from).toBe(300 * 60);
  });
});
