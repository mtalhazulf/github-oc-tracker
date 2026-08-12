const truthy = new Set(["1", "true", "yes", "on"]);

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return truthy.has(raw.toLowerCase());
}

function int(name: string, fallback: number, min?: number, max?: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) {
    throw new Error(`Invalid ${name}: expected an integer, got "${raw}"`);
  }
  if (min !== undefined && n < min) throw new Error(`Invalid ${name}: must be >= ${min}`);
  if (max !== undefined && n > max) throw new Error(`Invalid ${name}: must be <= ${max}`);
  return n;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  /** External base URL of this deployment (needed for webhooks / GitHub App). */
  baseUrl: string;
  githubToken: string | undefined;
  githubApiUrl: string;
  /** GitHub web UI base, derived from the API URL unless overridden. */
  githubWebUrl: string;
  /** Secret for manually configured webhooks (repo/org → Settings → Webhooks). */
  webhookSecret: string | undefined;
  syncIntervalMinutes: number;
  syncConcurrency: number;
  maxCommitsPerSync: number;
  autoTrackNewRepos: boolean;
  includeForks: boolean;
  includeArchived: boolean;
  tzOffsetMinutes: number;
  basicAuthUser: string | undefined;
  basicAuthPass: string | undefined;
  logLevel: "debug" | "info" | "warn" | "error";
  logFormat: "json" | "pretty";
  env: string;
}

export function loadConfig(): Config {
  const env = str("NODE_ENV", "development");
  const level = str("LOG_LEVEL", "info");
  if (!["debug", "info", "warn", "error"].includes(level)) {
    throw new Error(`Invalid LOG_LEVEL: "${level}" (expected debug|info|warn|error)`);
  }
  const format = str("LOG_FORMAT", env === "production" ? "json" : "pretty");
  if (!["json", "pretty"].includes(format)) {
    throw new Error(`Invalid LOG_FORMAT: "${format}" (expected json|pretty)`);
  }

  const basicAuthUser = process.env.BASIC_AUTH_USER || undefined;
  const basicAuthPass = process.env.BASIC_AUTH_PASS || undefined;
  if ((basicAuthUser && !basicAuthPass) || (!basicAuthUser && basicAuthPass)) {
    throw new Error("BASIC_AUTH_USER and BASIC_AUTH_PASS must be set together");
  }

  const port = int("PORT", 3000, 1, 65535);
  const githubApiUrl = str("GITHUB_API_URL", "https://api.github.com").replace(/\/+$/, "");
  // api.github.com → github.com; GHE https://host/api/v3 → https://host
  const derivedWebUrl = githubApiUrl === "https://api.github.com"
    ? "https://github.com"
    : githubApiUrl.replace(/\/api\/v3$/, "");

  return {
    port,
    host: str("HOST", "0.0.0.0"),
    dbPath: str("DB_PATH", "./data/tracker.db"),
    baseUrl: str("APP_BASE_URL", `http://localhost:${port}`).replace(/\/+$/, ""),
    githubToken: process.env.GITHUB_TOKEN || undefined,
    githubApiUrl,
    githubWebUrl: str("GITHUB_WEB_URL", derivedWebUrl).replace(/\/+$/, ""),
    webhookSecret: process.env.WEBHOOK_SECRET || undefined,
    syncIntervalMinutes: int("SYNC_INTERVAL_MINUTES", 30, 0),
    syncConcurrency: int("SYNC_CONCURRENCY", 2, 1, 16),
    maxCommitsPerSync: int("MAX_COMMITS_PER_SYNC", 10000, 0),
    autoTrackNewRepos: bool("AUTO_TRACK_NEW_REPOS", true),
    includeForks: bool("INCLUDE_FORKS", false),
    includeArchived: bool("INCLUDE_ARCHIVED", true),
    tzOffsetMinutes: int("TZ_OFFSET_MINUTES", 0, -840, 840),
    basicAuthUser,
    basicAuthPass,
    logLevel: level as Config["logLevel"],
    logFormat: format as Config["logFormat"],
    env,
  };
}

export const config = loadConfig();
