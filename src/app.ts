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

  // Liveness/readiness probe — intentionally unauthenticated for orchestrators.
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

  // Webhooks authenticate with HMAC signatures, not basic auth — mount first.
  app.route("/", createWebhookRoutes(store, sync, appSvc));

  if (config.basicAuthUser && config.basicAuthPass) {
    app.use(
      "*",
      basicAuth({ username: config.basicAuthUser, password: config.basicAuthPass, realm: "GitHub OC Tracker" }),
    );
    log.info("basic auth enabled");
  }

  app.use("/app.css", serveStatic({ path: "./public/app.css" }));
  app.use("/htmx.min.js", serveStatic({ path: "./public/htmx.min.js" }));

  app.route("/", createRoutes(store, sync, appSvc));

  app.notFound((c) => c.text("Not found", 404));
  app.onError((err, c) => {
    log.error("unhandled error", { path: c.req.path, err: err.message, stack: err.stack });
    return c.text("Internal server error", 500);
  });

  return app;
}
