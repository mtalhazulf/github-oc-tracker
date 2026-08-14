import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "hono/bun";
import { config } from "./config.ts";
import { log } from "./logger.ts";
import type { Store } from "./db/store.ts";
import type { GitHubAppService } from "./github/app.ts";
import type { SyncService } from "./sync/service.ts";
import { createRoutes } from "./web/routes.tsx";
import { createWebhookRoutes } from "./web/webhooks.ts";
import { createAuthRoutes } from "./web/routes/auth.tsx";
import { createAuthService } from "./services/auth.ts";
import { csrfMiddleware, sessionMiddleware } from "./web/middleware/auth.ts";
import { rbacMiddleware } from "./web/middleware/rbac.ts";
import { AppError } from "./domain/errors.ts";
import { apiAuth, createApiRoutes } from "./api/v1.ts";

function errorPage(title: string, detail: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title} · GitHub OC Tracker</title><link rel="stylesheet" href="/app.css"/></head>
<body class="min-h-screen bg-plane text-ink">
<main class="mx-auto max-w-lg px-4 py-24 text-center">
<h1 class="text-xl font-semibold">${title}</h1>
<p class="mt-2 text-sm text-ink-2">${detail}</p>
<a href="/" class="mt-6 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">Back to dashboard</a>
</main></body></html>`;
}

export function buildApp(store: Store, sync: SyncService, appSvc: GitHubAppService): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const start = performance.now();
    await next();
    const ms = Math.round(performance.now() - start);
    const path = c.req.path;
    const quiet = path === "/healthz" || path.endsWith("/row") || path.startsWith("/app.css") || path.startsWith("/htmx");
    const entry = { method: c.req.method, path, status: c.res.status, ms };
    if (quiet) log.debug("request", entry);
    else log.info("request", entry);
  });

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "https://avatars.githubusercontent.com", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: "no-referrer",
    }),
  );

  app.get("/healthz", (c) => {
    let dbOk = true;
    try {
      store.countCommits({ repoId: -1 });
    } catch {
      dbOk = false;
    }
    return c.json(
      {
        status: dbOk ? "ok" : "degraded",
        db: dbOk ? "ok" : "error",
        pendingSyncs: sync.pendingCount,
        uptimeSeconds: Math.floor(process.uptime()),
        authenticatedGitHub: config.githubToken !== undefined,
      },
      dbOk ? 200 : 503,
    );
  });

  app.route("/", createWebhookRoutes(store, sync, appSvc));

  if (config.basicAuthUser && config.basicAuthPass) {
    app.use(
      "*",
      basicAuth({ username: config.basicAuthUser, password: config.basicAuthPass, realm: "GitHub OC Tracker" }),
    );
    log.info("basic auth enabled (outer gate)");
  }

  app.use("/app.css", serveStatic({ path: "./public/app.css" }));
  app.use("/app.js", serveStatic({ path: "./public/app.js" }));
  app.use("/htmx.min.js", serveStatic({ path: "./public/htmx.min.js" }));

  const auth = createAuthService(store);
  app.use("*", sessionMiddleware(auth));
  app.use("/api/*", apiAuth(store));
  app.use("*", csrfMiddleware());
  app.use("*", rbacMiddleware());

  app.route("/", createApiRoutes(store));
  app.route("/", createAuthRoutes(store, auth));
  app.route("/", createRoutes(store, sync, appSvc, auth));

  app.notFound((c) =>
    c.html(errorPage("Page not found", "That page doesn't exist — it may have been moved or removed."), 404),
  );
  app.onError((err, c) => {
    if (err instanceof AppError) {
      if (c.req.header("HX-Request")) return c.text(err.message, err.status as 403);
      return c.html(errorPage(err.status === 403 ? "Not allowed" : "That did not work", err.message), err.status as 403);
    }
    log.error("unhandled error", { path: c.req.path, err: err.message, stack: err.stack });
    return c.html(
      errorPage("Something went wrong", "The error has been logged. Try again, or head back to the dashboard."),
      500,
    );
  });

  return app;
}
