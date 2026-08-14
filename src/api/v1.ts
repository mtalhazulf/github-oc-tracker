import { Hono } from "hono";
import type { Context } from "hono";
import { createHash, randomBytes } from "node:crypto";
import type { Store } from "../db/store.ts";
import { AppError } from "../domain/errors.ts";
import type { Role } from "../domain/rbac.ts";
import { setPrincipal } from "../web/request-context.ts";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintToken(): { token: string; hash: string; prefix: string } {
  const token = `oct_${randomBytes(24).toString("base64url")}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, 12) };
}

function paging(c: Context): { limit: number; offset: number } {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(c.req.query("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);
  return { limit, offset };
}

function ok(c: Context, data: unknown, meta?: Record<string, unknown>) {
  return c.json(meta ? { data, meta } : { data });
}

function fail(c: Context, status: number, code: string, message: string, fields?: Record<string, string>) {
  return c.json({ error: { code, message, ...(fields ? { fields } : {}) } }, status as 400);
}

export function apiAuth(store: Store) {
  return async (c: Context, next: () => Promise<void>) => {
    const header = c.req.header("Authorization") ?? "";
    if (!header.startsWith("Bearer ")) return next();

    const token = header.slice(7).trim();
    const row = store.findApiToken(hashToken(token));
    if (!row) return fail(c, 401, "unauthorized", "Unknown or revoked API token.");
    store.touchApiToken(row.id);

    const user = row.user_id === null ? null : store.getUser(row.user_id);
    if (user && user.status === "disabled") {
      return fail(c, 401, "unauthorized", "The account behind this token is disabled.");
    }
    const principal = {
      id: user?.id ?? 0,
      email: user?.email ?? `token:${row.prefix}`,
      name: user?.name ?? row.name,
      role: (user?.role ?? "admin") as Role,
      employeeId: user?.employee_id ?? null,
    };
    c.set("user", principal);
    setPrincipal(principal);
    return next();
  };
}

export function createApiRoutes(store: Store): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return fail(
        c,
        err.status,
        err.code,
        err.message,
        "fields" in err ? (err as { fields: Record<string, string> }).fields : undefined,
      );
    }
    return fail(c, 500, "internal", "Something went wrong.");
  });

  app.get("/api/v1/clients", (c) => {
    const { limit, offset } = paging(c);
    const all = store.listClients({ q: c.req.query("q") ?? undefined, status: c.req.query("status") ?? undefined });
    return ok(c, all.slice(offset, offset + limit), { limit, offset, total: all.length });
  });

  app.get("/api/v1/projects", (c) => {
    const { limit, offset } = paging(c);
    const clientId = c.req.query("client_id");
    const all = store.listProjects({
      status: c.req.query("status") ?? undefined,
      kind: c.req.query("kind") ?? undefined,
      clientId: clientId && /^\d+$/.test(clientId) ? Number(clientId) : undefined,
    });
    return ok(c, all.slice(offset, offset + limit), { limit, offset, total: all.length });
  });

  app.get("/api/v1/projects/:id", (c) => {
    const id = Number(c.req.param("id"));
    const project = store.getProject(id);
    if (!project) return fail(c, 404, "not_found", "No such project.");
    return ok(c, {
      ...project,
      repos: store.listProjectRepos(id),
      team: store.listAssignments(id),
    });
  });

  app.get("/api/v1/projects/:id/activity", (c) => {
    const id = Number(c.req.param("id"));
    if (!store.getProject(id)) return fail(c, 404, "not_found", "No such project.");
    const days = Math.min(365, Math.max(1, Number(c.req.query("days") ?? 90) || 90));
    const sinceTs = Math.floor(Date.now() / 1000) - days * 86_400;
    return ok(c, {
      contributors: store.projectContributors(id, sinceTs),
      points: store.projectCommitsPerDay(id, sinceTs, 0),
    });
  });

  app.get("/api/v1/employees", (c) => {
    const { limit, offset } = paging(c);
    const all = store.listEmployees({
      status: c.req.query("status") ?? undefined,
      department: c.req.query("department") ?? undefined,
      q: c.req.query("q") ?? undefined,
    });
    return ok(c, all.slice(offset, offset + limit), { limit, offset, total: all.length });
  });

  app.get("/api/v1/employees/:id/contribution", (c) => {
    const id = Number(c.req.param("id"));
    if (!store.getEmployee(id)) return fail(c, 404, "not_found", "No such employee.");
    const months = Math.min(60, Math.max(1, Number(c.req.query("months") ?? 12) || 12));
    const sinceTs = Math.floor(Date.now() / 1000) - months * 30 * 86_400;
    return ok(c, store.employeeContribution(id, sinceTs));
  });

  app.get("/api/v1/commits", (c) => {
    const { limit, offset } = paging(c);
    const repo = c.req.query("repo");
    const filters = {
      repoId: repo && /^\d+$/.test(repo) ? Number(repo) : undefined,
      author: c.req.query("author") ?? undefined,
      q: c.req.query("q") ?? undefined,
    };
    return ok(c, store.listCommits(filters, limit, offset), {
      limit,
      offset,
      total: store.countCommits(filters),
    });
  });

  app.get("/api/v1/payroll/cycles", (c) => {
    return ok(c, store.listCycles());
  });

  app.get("/api/v1/payroll/cycles/:id/payslips", (c) => {
    const id = Number(c.req.param("id"));
    if (!store.getCycle(id)) return fail(c, 404, "not_found", "No such cycle.");
    return ok(c, store.listPayslips(id));
  });

  app.get("/api/v1/invoices", (c) => {
    return ok(c, store.listInvoices({ status: c.req.query("status") ?? undefined }));
  });

  app.notFound((c) => fail(c, 404, "not_found", "No such endpoint."));

  return app;
}
