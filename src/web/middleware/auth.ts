import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { config } from "../../config.ts";
import { can, type Capability } from "../../domain/rbac.ts";
import { ForbiddenError } from "../../domain/errors.ts";
import { SESSION_COOKIE, tokensMatch, type AuthService, type Principal } from "../../services/auth.ts";
import { runWithContext } from "../request-context.ts";

const PUBLIC_PATHS = new Set(["/login", "/logout", "/setup", "/healthz"]);
const PUBLIC_PREFIXES = ["/webhooks/", "/api/", "/app.css", "/app.js", "/htmx.min.js"];

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

export function sessionMiddleware(auth: AuthService): MiddlewareHandler {
  return async (c, next) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    let principal: Principal | null = null;
    let csrfToken: string | null = null;

    if (sessionId) {
      const resolved = auth.resolveSession(sessionId);
      if (resolved) {
        principal = resolved.principal;
        csrfToken = resolved.csrfToken;
        c.set("user", resolved.principal);
        c.set("csrfToken", resolved.csrfToken);
        c.set("sessionId", sessionId);
      }
    }

    const path = c.req.path;

    if (auth.needsSetup) {
      if (path === "/setup" || isPublic(path)) {
        return runWithContext({ principal, csrfToken }, () => next());
      }
      return c.redirect("/setup");
    }

    if (!principal && !isPublic(path)) {
      if (c.req.header("HX-Request")) {
        c.header("HX-Redirect", "/login");
        return c.text("", 401);
      }
      return c.redirect(`/login?next=${encodeURIComponent(path)}`);
    }

    return runWithContext({ principal, csrfToken }, () => next());
  };
}

export function csrfMiddleware(): MiddlewareHandler {
  const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  return async (c, next) => {
    if (!UNSAFE.has(c.req.method)) return next();
    const path = c.req.path;
    if (path.startsWith("/webhooks/")) return next();
    if (path.startsWith("/api/") && (c.req.header("Authorization") ?? "").startsWith("Bearer ")) {
      return next();
    }

    const expected = c.get("csrfToken") as string | undefined;
    if (!expected) return next();

    const header = c.req.header("X-CSRF-Token");
    let supplied = header ?? "";
    if (!supplied) {
      const contentType = c.req.header("content-type") ?? "";
      if (contentType.includes("form")) {
        const body = await c.req.parseBody({ all: false });
        supplied = String((body as Record<string, unknown>)._csrf ?? "");
      }
    }
    if (!supplied || !tokensMatch(supplied, expected)) {
      return c.text("Your session expired or the request could not be verified. Reload and try again.", 403);
    }
    return next();
  };
}

export function requireCapability(capability: Capability): MiddlewareHandler {
  return async (c, next) => {
    const principal = c.get("user") as Principal | undefined;
    if (!principal || !can(principal.role, capability)) {
      throw new ForbiddenError("Your role does not have access to that.");
    }
    return next();
  };
}

export function principalOf(c: Context): Principal | null {
  return (c.get("user") as Principal | undefined) ?? null;
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "Lax" as const,
  path: "/",
  secure: config.baseUrl.startsWith("https"),
};
