import { config } from "./config.ts";
import { log } from "./logger.ts";
import { createDb } from "./db/index.ts";
import { createStore } from "./db/store.ts";
import { GitHubClient } from "./github/client.ts";
import { SyncService } from "./sync/service.ts";
import { Scheduler } from "./sync/scheduler.ts";
import { buildApp } from "./app.ts";

const db = createDb();
const store = createStore(db);
const github = new GitHubClient();
const sync = new SyncService(store, github);
const scheduler = new Scheduler(store, sync);
const app = buildApp(store, sync);

const server = Bun.serve({
  fetch: app.fetch,
  port: config.port,
  hostname: config.host,
});

log.info("github-oc-tracker listening", {
  url: `http://${config.host}:${config.port}`,
  db: config.dbPath,
  env: config.env,
});

if (!config.githubToken) {
  log.warn(
    "GITHUB_TOKEN is not set — unauthenticated GitHub API access is limited to 60 requests/hour and cannot see private repositories",
  );
}

scheduler.start();

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down", { signal });
  scheduler.stop();
  sync.stop();
  server.stop(true);
  try {
    db.close();
  } catch {
    // best-effort close
  }
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
