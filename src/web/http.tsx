import type { Context } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import { AppError } from "../domain/errors.ts";
import {
  GitHubError,
  NotFoundError as GitHubNotFoundError,
  RateLimitError,
} from "../github/client.ts";

export const PER_PAGE = 50;

export function page(c: Context, el: { toString(): string | Promise<string> }) {
  const body = el.toString();
  if (typeof body === "string") return c.html(`<!DOCTYPE html>${body}`);
  return body.then((s) => c.html(`<!DOCTYPE html>${s}`));
}

export function partial(c: Context, el: Parameters<Context["html"]>[0], status = 200) {
  if (status !== 200) c.status(status as StatusCode);
  return c.html(el);
}

const CONSTRAINT_MESSAGES: [needle: string, message: string][] = [
  ["project_repositories.repo_id", "That repository is already the primary repo for another project."],
  ["employee_identities.kind", "That GitHub login or email is already mapped to someone else."],
  ["CHECK constraint failed: (kind", "Client projects need a client; internal projects cannot have one."],
  ["payslips.cycle_id", "This employee already has a payslip in this cycle."],
  ["invoices.number", "That invoice number is already used."],
  ["employees.code", "That employee code is already used."],
  ["employees.work_email", "That work email is already used."],
  ["clients.code", "That client code is already used."],
  ["projects.code", "That project code is already used."],
  ["employee_compensation", "This employee already has a compensation record effective that date."],
];

export function friendlyError(err: unknown): string {
  if (err instanceof AppError) return err.message;

  if (err instanceof GitHubNotFoundError) {
    return "Not found on GitHub — check the name, or set GITHUB_TOKEN to access private resources.";
  }
  if (err instanceof RateLimitError) return err.message;
  if (err instanceof GitHubError) return `GitHub API error (${err.status}).`;

  const raw = err instanceof Error ? err.message : String(err);
  for (const [needle, message] of CONSTRAINT_MESSAGES) {
    if (raw.includes(needle)) return message;
  }
  if (raw.includes("UNIQUE constraint failed")) return "That value is already used.";
  if (raw.includes("FOREIGN KEY constraint failed")) {
    return "That record is still referenced by something else and cannot be removed.";
  }
  if (raw.includes("CHECK constraint failed")) return "Some of those values are not allowed together.";
  return raw;
}

export function errorStatus(err: unknown): number {
  if (err instanceof AppError) return err.status;
  if (err instanceof GitHubNotFoundError) return 404;
  return 400;
}
