import { ValidationError } from "./errors.ts";

export const MONEY_SCALE = 100;

const ZERO_DECIMAL_DISPLAY = new Set(["PKR", "JPY", "KRW", "VND", "IDR"]);

const AMOUNT_RE = /^-?\d+(\.\d{1,2})?$/;

export function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

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

export function toInput(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / MONEY_SCALE);
  const fraction = String(abs % MONEY_SCALE).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function fmtMoney(minor: number, currency: string): string {
  const digits = ZERO_DECIMAL_DISPLAY.has(currency) ? 0 : 2;
  const value = minor / MONEY_SCALE;
  const formatted = value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${currency} ${formatted}`;
}

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
