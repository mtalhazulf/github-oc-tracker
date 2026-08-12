import { ValidationError, type FieldErrors } from "./errors.ts";
import { isIsoDate } from "./period.ts";
import { toMinor } from "./money.ts";

/**
 * A ~120-line validation kernel, deliberately not zod.
 *
 * It collects *every* field error in one pass rather than throwing on the first,
 * because both surfaces need the whole set at once: the JSON API returns them as
 * `error.fields`, and the HTMX form re-renders with a message under each input.
 */
export class Validator {
  private readonly errors: FieldErrors = {};

  constructor(private readonly input: Record<string, unknown>) {}

  private raw(field: string): string {
    const value = this.input[field];
    if (value === undefined || value === null) return "";
    return String(value).trim();
  }

  private fail(field: string, message: string): void {
    // First error per field wins — it is the most specific one.
    if (!(field in this.errors)) this.errors[field] = message;
  }

  text(field: string, opts: { label: string; required?: boolean; max?: number; min?: number } = { label: field }): string {
    const value = this.raw(field);
    const { label, required = false, max = 500, min = 0 } = opts;
    if (value === "") {
      if (required) this.fail(field, `${label} is required.`);
      return "";
    }
    if (value.length > max) this.fail(field, `${label} must be ${max} characters or fewer.`);
    if (value.length < min) this.fail(field, `${label} must be at least ${min} characters.`);
    return value;
  }

  optionalText(field: string, opts: { label: string; max?: number } = { label: field }): string | null {
    const value = this.text(field, { ...opts, required: false });
    return value === "" ? null : value;
  }

  /** A URL-safe short code (employee/client/project identifiers). */
  code(field: string, opts: { label: string; required?: boolean } = { label: field }): string {
    const value = this.text(field, { ...opts, max: 32 });
    if (value !== "" && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
      this.fail(field, `${opts.label} may use letters, numbers, dot, dash and underscore only.`);
    }
    return value;
  }

  email(field: string, opts: { label: string; required?: boolean } = { label: field }): string | null {
    const value = this.text(field, opts);
    if (value === "") return null;
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value)) this.fail(field, `${opts.label} must be a valid email address.`);
    return value;
  }

  enum<T extends string>(field: string, allowed: readonly T[], opts: { label: string; fallback?: T }): T {
    const value = this.raw(field);
    if (value === "") {
      if (opts.fallback !== undefined) return opts.fallback;
      this.fail(field, `${opts.label} is required.`);
      return (opts.fallback ?? allowed[0]) as T;
    }
    if (!(allowed as readonly string[]).includes(value)) {
      this.fail(field, `${opts.label} must be one of: ${allowed.join(", ")}.`);
      return (opts.fallback ?? allowed[0]) as T;
    }
    return value as T;
  }

  int(field: string, opts: { label: string; required?: boolean; min?: number; max?: number }): number | null {
    const value = this.raw(field);
    if (value === "") {
      if (opts.required) this.fail(field, `${opts.label} is required.`);
      return null;
    }
    if (!/^-?\d+$/.test(value)) {
      this.fail(field, `${opts.label} must be a whole number.`);
      return null;
    }
    const n = Number(value);
    if (opts.min !== undefined && n < opts.min) this.fail(field, `${opts.label} must be at least ${opts.min}.`);
    if (opts.max !== undefined && n > opts.max) this.fail(field, `${opts.label} must be at most ${opts.max}.`);
    return n;
  }

  date(field: string, opts: { label: string; required?: boolean }): string | null {
    const value = this.raw(field);
    if (value === "") {
      if (opts.required) this.fail(field, `${opts.label} is required.`);
      return null;
    }
    if (!isIsoDate(value)) {
      this.fail(field, `${opts.label} must be a valid date.`);
      return null;
    }
    return value;
  }

  /** Money in minor units. Re-uses the string parser so 0.1 never becomes 10.000000000000002. */
  money(field: string, opts: { label: string; required?: boolean; min?: number }): number | null {
    const value = this.raw(field);
    if (value === "") {
      if (opts.required) this.fail(field, `${opts.label} is required.`);
      return null;
    }
    try {
      const minor = toMinor(value);
      if (opts.min !== undefined && minor < opts.min) {
        this.fail(field, `${opts.label} cannot be negative.`);
      }
      return minor;
    } catch {
      this.fail(field, `${opts.label} must be an amount like 45,000.00.`);
      return null;
    }
  }

  currency(field: string, opts: { label: string; fallback: string }): string {
    const value = this.raw(field).toUpperCase();
    if (value === "") return opts.fallback;
    if (!/^[A-Z]{3}$/.test(value)) {
      this.fail(field, `${opts.label} must be a 3-letter code such as PKR.`);
      return opts.fallback;
    }
    return value;
  }

  bool(field: string): boolean {
    const value = this.raw(field).toLowerCase();
    return value === "1" || value === "true" || value === "on" || value === "yes";
  }

  /** Record a rule that spans several fields (e.g. exit date before join date). */
  check(condition: boolean, field: string, message: string): void {
    if (!condition) this.fail(field, message);
  }

  get invalid(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  get fieldErrors(): FieldErrors {
    return { ...this.errors };
  }

  /** Throw everything collected so far, or return `value` unchanged. */
  done<T>(value: T): T {
    if (this.invalid) throw new ValidationError(undefined, this.fieldErrors);
    return value;
  }
}

export function validator(input: Record<string, unknown>): Validator {
  return new Validator(input);
}
