import type { MiddlewareHandler } from "hono";
import { can } from "../../domain/rbac.ts";
import { log } from "../../logger.ts";
import { currentPrincipal } from "../request-context.ts";
import { resolveAccess } from "../policy.ts";

export function rbacMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const access = resolveAccess(c.req.method, c.req.path);
    const wantsJson = c.req.path.startsWith("/api/");

    if (access === null) {
      log.warn("denied: no policy entry", { method: c.req.method, path: c.req.path });
      return wantsJson
        ? c.json({ error: { code: "not_found", message: "No such endpoint." } }, 404)
        : c.text("Not found", 404);
    }

    if (access.kind === "public") return next();

    const principal = currentPrincipal();
    if (!principal) {
      if (wantsJson) {
        return c.json(
          { error: { code: "unauthorized", message: "Provide an API token, or sign in." } },
          401,
        );
      }
      if (c.req.header("HX-Request")) {
        c.header("HX-Redirect", "/login");
        return c.text("", 401);
      }
      return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
    }

    if (access.kind === "authenticated") return next();

    if (!can(principal.role, access.capability)) {
      log.warn("denied: capability", {
        method: c.req.method,
        path: c.req.path,
        role: principal.role,
        capability: access.capability,
      });
      const message = `Your role (${principal.role}) cannot do that.`;
      if (wantsJson) return c.json({ error: { code: "forbidden", message } }, 403);
      if (c.req.header("HX-Request")) return c.text(message, 403);
      return c.html(forbiddenPage(message), 403);
    }

    return next();
  };
}

function forbiddenPage(message: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Not allowed · GitHub OC Tracker</title><link rel="stylesheet" href="/app.css"/></head>
<body class="min-h-screen bg-plane text-ink">
<main class="mx-auto max-w-lg px-4 py-24 text-center">
<h1 class="text-xl font-semibold">Not allowed</h1>
<p class="mt-2 text-sm text-ink-2">${message}</p>
<p class="mt-1 text-sm text-ink-2">Ask an owner or admin if you need access.</p>
<a href="/" class="mt-6 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">Back to dashboard</a>
</main></body></html>`;
}
