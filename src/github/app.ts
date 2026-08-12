import { createSign, randomBytes } from "node:crypto";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import type { GithubAppRow, Store } from "../db/store.ts";
import { GitHubClient, GitHubError } from "./client.ts";

function b64url(input: Buffer | string): string {
  return (typeof input === "string" ? Buffer.from(input) : input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface ManifestAppResult {
  appId: number;
  slug: string;
  name: string;
  clientId: string | null;
  clientSecret: string | null;
  privateKey: string;
  webhookSecret: string;
  htmlUrl: string;
}

/**
 * GitHub App integration: created via the app-manifest flow, authenticated with
 * an RS256 app JWT, acting on repositories through per-installation tokens.
 */
export class GitHubAppService {
  private tokenCache = new Map<number, { token: string; expiresAt: number }>();
  private clients = new Map<number, GitHubClient>();
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly store: Store,
    fetchFn: typeof fetch = fetch,
  ) {
    this.fetchFn = fetchFn;
  }

  get app(): GithubAppRow | null {
    return this.store.getGithubApp();
  }

  get isConfigured(): boolean {
    return this.app !== null;
  }

  /** Short-lived RS256 JWT identifying the app itself. */
  appJwt(app: GithubAppRow = this.mustApp()): string {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = b64url(
      JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: String(app.app_id) }),
    );
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${payload}`);
    const signature = b64url(signer.sign(app.private_key));
    return `${header}.${payload}.${signature}`;
  }

  /** Exchange an app-manifest `code` for permanent app credentials and store them. */
  async convertManifestCode(code: string): Promise<ManifestAppResult> {
    const res = await this.fetchFn(
      `${config.githubApiUrl}/app-manifests/${encodeURIComponent(code)}/conversions`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "github-oc-tracker",
        },
      },
    );
    if (res.status !== 201) {
      const body = await res.text();
      throw new GitHubError(
        `Manifest conversion failed (${res.status}): ${body.slice(0, 300)}`,
        res.status,
        "/app-manifests",
      );
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const result: ManifestAppResult = {
      appId: Number(raw.id),
      slug: String(raw.slug ?? ""),
      name: String(raw.name ?? ""),
      clientId: (raw.client_id as string | undefined) ?? null,
      clientSecret: (raw.client_secret as string | undefined) ?? null,
      privateKey: String(raw.pem ?? ""),
      webhookSecret: String(raw.webhook_secret ?? ""),
      htmlUrl: String(raw.html_url ?? ""),
    };
    if (!result.appId || !result.privateKey || !result.webhookSecret) {
      throw new Error("Manifest conversion returned an incomplete app");
    }
    this.store.saveGithubApp(result);
    this.tokenCache.clear();
    this.clients.clear();
    log.info("github app configured", { slug: result.slug, appId: result.appId });
    return result;
  }

  /** The app-manifest JSON posted to GitHub's "create app from manifest" endpoint. */
  buildManifest(): Record<string, unknown> {
    return {
      name: `oc-tracker-${randomBytes(3).toString("hex")}`,
      url: config.baseUrl,
      hook_attributes: { url: `${config.baseUrl}/webhooks/github`, active: true },
      redirect_url: `${config.baseUrl}/settings/github-app/callback`,
      public: false,
      default_permissions: { contents: "read", metadata: "read" },
      default_events: ["push", "repository"],
    };
  }

  /** Where the manifest form must POST: personal account or organization scope. */
  manifestTargetUrl(org: string | undefined, state: string): string {
    const base = org
      ? `${config.githubWebUrl}/organizations/${encodeURIComponent(org)}/settings/apps/new`
      : `${config.githubWebUrl}/settings/apps/new`;
    return `${base}?state=${encodeURIComponent(state)}`;
  }

  /** Cached installation access token (~1h lifetime, refreshed 60s early). */
  async installationToken(installationId: number): Promise<string> {
    const cached = this.tokenCache.get(installationId);
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.expiresAt - 60 > now) return cached.token;

    const res = await this.fetchFn(
      `${config.githubApiUrl}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "github-oc-tracker",
          Authorization: `Bearer ${this.appJwt()}`,
        },
      },
    );
    if (res.status !== 201) {
      const body = await res.text();
      throw new GitHubError(
        `Failed to create installation token (${res.status}): ${body.slice(0, 300)}`,
        res.status,
        `/app/installations/${installationId}/access_tokens`,
      );
    }
    const raw = (await res.json()) as { token: string; expires_at: string };
    const expiresAt = Math.floor(Date.parse(raw.expires_at) / 1000) || now + 3000;
    this.tokenCache.set(installationId, { token: raw.token, expiresAt });
    return raw.token;
  }

  /** A GitHubClient that authenticates as the given installation. */
  clientFor(installationId: number): GitHubClient {
    let client = this.clients.get(installationId);
    if (!client) {
      client = new GitHubClient({
        tokenProvider: () => this.installationToken(installationId),
        fetchFn: this.fetchFn,
      });
      this.clients.set(installationId, client);
    }
    return client;
  }

  /** All installations of this app, straight from GitHub (JWT auth). */
  async listAppInstallations(): Promise<
    { id: number; accountLogin: string; accountType: string; suspended: boolean }[]
  > {
    const jwtClient = new GitHubClient({
      tokenProvider: async () => this.appJwt(),
      fetchFn: this.fetchFn,
    });
    const raw = await jwtClient.json<Record<string, unknown>[]>("/app/installations", {
      per_page: "100",
    });
    return raw.map((i) => {
      const account = i.account as Record<string, unknown> | undefined;
      return {
        id: Number(i.id),
        accountLogin: String(account?.login ?? ""),
        accountType: String(account?.type ?? "Organization"),
        suspended: i.suspended_at != null,
      };
    });
  }

  forget(): void {
    this.store.deleteGithubApp();
    this.tokenCache.clear();
    this.clients.clear();
  }

  private mustApp(): GithubAppRow {
    const app = this.app;
    if (!app) throw new Error("GitHub App is not configured");
    return app;
  }
}
