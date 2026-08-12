import { ValidationError } from "./errors.ts";

/**
 * Business dates are `YYYY-MM-DD` strings and payroll periods are `YYYY-MM`,
 * both evaluated in the deployment's display timezone (`TZ_OFFSET_MINUTES`).
 *
 * This matters more than it looks: at 20:00 UTC on 31 July, a house running at
 * UTC+05:00 is already in August. Deriving the current period from raw UTC
 * generates payroll for the wrong month.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_RE = /^\d{4}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  // Reject impossible calendar dates (2026-02-31) that match the shape.
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export function isPeriod(value: string): boolean {
  if (!PERIOD_RE.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

export function assertIsoDate(value: string, field: string): string {
  if (!isIsoDate(value)) {
    throw new ValidationError("Enter a valid date.", { [field]: "Enter a valid date (YYYY-MM-DD)." });
  }
  return value;
}

/** Today in the display timezone, as `YYYY-MM-DD`. */
export function todayIso(tzOffsetMinutes: number, nowMs: number = Date.now()): string {
  return new Date(nowMs + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** The current payroll period in the display timezone, as `YYYY-MM`. */
export function currentPeriod(tzOffsetMinutes: number, nowMs: number = Date.now()): string {
  return todayIso(tzOffsetMinutes, nowMs).slice(0, 7);
}

/** First and last calendar day of a period, plus its length in days. */
export function periodBounds(period: string): { start: string; end: string; days: number } {
  if (!isPeriod(period)) {
    throw new ValidationError("Enter a period like 2026-07.", { period: "Enter a period like 2026-07." });
  }
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  // Day 0 of the next month is the last day of this one.
  const last = new Date(Date.UTC(year, month, 0));
  const days = last.getUTCDate();
  return {
    start: `${period}-01`,
    end: `${period}-${String(days).padStart(2, "0")}`,
    days,
  };
}

/** Shift a period by whole months: `addMonths("2026-01", -1)` → "2025-12". */
export function addMonths(period: string, delta: number): string {
  const { start } = periodBounds(period);
  const year = Number(start.slice(0, 4));
  const month = Number(start.slice(5, 7));
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return shifted.toISOString().slice(0, 7);
}

/** Unix-second bounds of a period, honouring the display offset. */
export function periodEpochRange(period: string, tzOffsetMinutes: number): { from: number; to: number } {
  const { start, days } = periodBounds(period);
  const offsetSeconds = tzOffsetMinutes * 60;
  const from = Math.floor(Date.parse(`${start}T00:00:00Z`) / 1000) - offsetSeconds;
  return { from, to: from + days * 86_400 };
}
