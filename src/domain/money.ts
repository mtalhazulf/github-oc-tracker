import { ValidationError } from "./errors.ts";

/**
 * Money is stored as INTEGER minor units and the scale is **always 100**,
 * for every currency. Only the *display* fraction digits vary by currency.
 * Never sum minor units across different currencies — group by currency.
 */
export const MONEY_SCALE = 100;

/** Currencies rendered without decimals. Everything else shows 2. */
const ZERO_DECIMAL_DISPLAY = new Set(["PKR", "JPY", "KRW", "VND", "IDR"]);

const AMOUNT_RE = /^-?\d+(\.\d{1,2})?$/;

export function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

/**
 * Parse user input ("45,000.00", "0.1", "-2 500") into minor units.
 * Done on strings, never via `Number(x) * 100` — `0.1 * 100` is 10.000000000000002.
 * More than two decimal places is rejected rather than silently truncated: in a
 * salary field that is a typo, and losing it quietly is worse than saying so.
 */
export function toMinor(input: string): number {
  const cleaned = input.trim().replace(/[,\s_]/g, "");
  if (cleaned === "") throw new ValidationError("Enter an amount.", { amount: "Enter an amount." });
  if (!AMOUNT_RE.test(cleaned)) {
    throw new ValidationError("Enter an amount like 45,000.00 (max 2 decimal places).", {
      amount: "Enter an amount like 45,000.00 (max 2 decimal places).",
    });
  }
  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const minorFraction = (fraction + "00").slice(0, 2);
  const minor = Number(whole) * MONEY_SCALE + Number(minorFraction);
  if (!Number.isSafeInteger(minor)) {
    throw new ValidationError("That amount is too large.", { amount: "That amount is too large." });
  }
  return negative ? -minor : minor;
}

/** Minor units back to a plain editable string ("300000.00"), for form values. */
export function toInput(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / MONEY_SCALE);
  const fraction = String(abs % MONEY_SCALE).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Display form: `fmtMoney(30000000, "PKR")` → "PKR 300,000". */
export function fmtMoney(minor: number, currency: string): string {
  const digits = ZERO_DECIMAL_DISPLAY.has(currency) ? 0 : 2;
  const value = minor / MONEY_SCALE;
  const formatted = value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${currency} ${formatted}`;
}

/**
 * Pro-rate an amount over a period: `prorate(30000000, 16, 31)` → 15483871.
 * Rounds half away from zero, so a full period always returns exactly `minor`.
 */
export function prorate(minor: number, payableDays: number, periodDays: number): number {
  if (!Number.isInteger(periodDays) || periodDays <= 0) {
    throw new RangeError("periodDays must be a positive integer");
  }
  if (!Number.isInteger(payableDays) || payableDays < 0) {
    throw new RangeError("payableDays must be a non-negative integer");
  }
  if (payableDays >= periodDays) return minor;
  return Math.round((minor * payableDays) / periodDays);
}
