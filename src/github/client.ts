import { config } from "../config.ts";
import { log } from "../logger.ts";

export class GitHubError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export class NotFoundError extends GitHubError {
  constructor(path: string) {
    super(`GitHub resource not found: ${path}`, 404, path);
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends GitHubError {
  constructor(
    path: string,
    public readonly resetAt: number,
  ) {
    super(
      `GitHub rate limit exhausted (resets ${new Date(resetAt * 1000).toISOString()})`,
      403,
      path,
    );
    this.name = "RateLimitError";
  }
}

export interface GitHubAccount {
  login: string;
  name: string | null;
  kind: "org" | "user";
  avatarUrl: string | null;
  htmlUrl: string | null;
}

export interface GitHubRepo {
  githubId: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  defaultBranch: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  htmlUrl: string | null;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  authorName: string | null;
  authorEmail: string | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  authorTs: number;
  committerName: string | null;
  committerEmail: string | null;
  committerTs: number | null;
  isMerge: boolean;
  htmlUrl: string | null;
}

interface ClientOptions {
  apiUrl?: string;
  token?: string;
  /** Max seconds to sleep waiting for a rate-limit window before giving up. */
  maxRateLimitWaitSeconds?: number;
  fetchFn?: typeof fetch;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toEpoch(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

export class GitHubClient {
  private readonly apiUrl: string;
  private readonly token: string | undefined;
  private readonly maxWait: number;
  private readonly fetchFn: typeof fetch;

  constructor(opts: ClientOptions = {}) {
    this.apiUrl = (opts.apiUrl ?? config.githubApiUrl).replace(/\/+$/, "");
    this.token = opts.token ?? config.githubToken;
    this.maxWait = opts.maxRateLimitWaitSeconds ?? 120;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  get authenticated(): boolean {
    return this.token !== undefined;
  }

  private async request(path: string, searchParams?: Record<string, string>): Promise<Response> {
    const url = new URL(this.apiUrl + path);
    for (const [k, v] of Object.entries(searchParams ?? {})) {
      url.searchParams.set(k, v);
    }
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "github-oc-tracker",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    let attempt = 0;
    // Up to 3 retries for transient failures, plus at most one rate-limit wait.
    for (;;) {
      attempt += 1;
      let res: Response;
      try {
        res = await this.fetchFn(url, { headers });
      } catch (err) {
        if (attempt <= 3) {
          const backoff = 1000 * 2 ** attempt;
          log.warn("github request failed, retrying", { path, attempt, err: String(err) });
          await sleep(backoff);
          continue;
        }
        throw err;
      }

      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get("x-ratelimit-remaining");
        const reset = Number.parseInt(res.headers.get("x-ratelimit-reset") ?? "", 10);
        const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
        let waitSeconds: number | null = null;
        if (!Number.isNaN(retryAfter)) {
          waitSeconds = retryAfter;
        } else if (remaining === "0" && !Number.isNaN(reset)) {
          waitSeconds = Math.max(0, reset - Math.floor(Date.now() / 1000)) + 2;
        }
        if (waitSeconds !== null && waitSeconds <= this.maxWait) {
          log.warn("github rate limited, waiting", { path, waitSeconds });
          await sleep(waitSeconds * 1000);
          continue;
        }
        if (remaining === "0") {
          throw new RateLimitError(path, Number.isNaN(reset) ? 0 : reset);
        }
        const body = await res.text();
        throw new GitHubError(`GitHub API ${res.status} for ${path}: ${body.slice(0, 300)}`, res.status, path);
      }

      if (res.status >= 500 && attempt <= 3) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }

      return res;
    }
  }

  private async getJson<T>(path: string, searchParams?: Record<string, string>): Promise<T> {
    const res = await this.request(path, searchParams);
    if (res.status === 404) throw new NotFoundError(path);
    if (!res.ok) {
      const body = await res.text();
      throw new GitHubError(`GitHub API ${res.status} for ${path}: ${body.slice(0, 300)}`, res.status, path);
    }
    return (await res.json()) as T;
  }

  /** Resolve a login as an organization, falling back to a user account. */
  async getAccount(login: string): Promise<GitHubAccount> {
    const enc = encodeURIComponent(login);
    try {
      const org = await this.getJson<Record<string, unknown>>(`/orgs/${enc}`);
      return {
        login: String(org.login ?? login),
        name: (org.name as string | null) ?? null,
        kind: "org",
        avatarUrl: (org.avatar_url as string | null) ?? null,
        htmlUrl: (org.html_url as string | null) ?? `https://github.com/${login}`,
      };
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
    const user = await this.getJson<Record<string, unknown>>(`/users/${enc}`);
    return {
      login: String(user.login ?? login),
      name: (user.name as string | null) ?? null,
      kind: "user",
      avatarUrl: (user.avatar_url as string | null) ?? null,
      htmlUrl: (user.html_url as string | null) ?? `https://github.com/${login}`,
    };
  }

  async getRepo(owner: string, name: string): Promise<GitHubRepo> {
    const raw = await this.getJson<Record<string, unknown>>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    );
    return mapRepo(raw);
  }

  /** List all repositories of an org (or user), paginated. */
  async *listRepos(login: string, kind: "org" | "user"): AsyncGenerator<GitHubRepo[]> {
    const enc = encodeURIComponent(login);
    const base = kind === "org" ? `/orgs/${enc}/repos` : `/users/${enc}/repos`;
    let page = 1;
    for (;;) {
      const raw = await this.getJson<Record<string, unknown>[]>(base, {
        per_page: "100",
        page: String(page),
        type: "all",
        sort: "full_name",
      });
      if (raw.length === 0) return;
      yield raw.map(mapRepo);
      if (raw.length < 100) return;
      page += 1;
    }
  }

  /**
   * List commits on the default branch, newest first, paginated.
   * `since` is an ISO timestamp lower bound (inclusive-ish; GitHub filters by committer date).
   */
  async *listCommits(
    owner: string,
    name: string,
    opts: { since?: string } = {},
  ): AsyncGenerator<GitHubCommit[]> {
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits`;
    let page = 1;
    for (;;) {
      const params: Record<string, string> = { per_page: "100", page: String(page) };
      if (opts.since) params.since = opts.since;
      const res = await this.request(base, params);
      if (res.status === 404) throw new NotFoundError(base);
      // 409 = repository is empty (no commits yet)
      if (res.status === 409) return;
      if (!res.ok) {
        const body = await res.text();
        throw new GitHubError(`GitHub API ${res.status} for ${base}: ${body.slice(0, 300)}`, res.status, base);
      }
      const raw = (await res.json()) as Record<string, unknown>[];
      if (raw.length === 0) return;
      yield raw.map(mapCommit).filter((c): c is GitHubCommit => c !== null);
      if (raw.length < 100) return;
      page += 1;
    }
  }
}

function mapRepo(raw: Record<string, unknown>): GitHubRepo {
  const ownerObj = raw.owner as Record<string, unknown> | undefined;
  return {
    githubId: Number(raw.id),
    owner: String(ownerObj?.login ?? ""),
    name: String(raw.name ?? ""),
    fullName: String(raw.full_name ?? ""),
    description: (raw.description as string | null) ?? null,
    defaultBranch: (raw.default_branch as string | null) ?? null,
    isPrivate: Boolean(raw.private),
    isFork: Boolean(raw.fork),
    isArchived: Boolean(raw.archived),
    htmlUrl: (raw.html_url as string | null) ?? null,
  };
}

function mapCommit(raw: Record<string, unknown>): GitHubCommit | null {
  const commit = raw.commit as Record<string, unknown> | undefined;
  if (!commit) return null;
  const author = commit.author as Record<string, string | undefined> | undefined;
  const committer = commit.committer as Record<string, string | undefined> | undefined;
  const ghAuthor = raw.author as Record<string, unknown> | null | undefined;
  const parents = raw.parents as unknown[] | undefined;
  const authorTs = toEpoch(author?.date) ?? toEpoch(committer?.date);
  if (authorTs === null) return null;
  const message = String(commit.message ?? "");
  return {
    sha: String(raw.sha ?? ""),
    message: message.length > 4000 ? `${message.slice(0, 4000)}…` : message,
    authorName: author?.name ?? null,
    authorEmail: author?.email ?? null,
    authorLogin: ghAuthor ? ((ghAuthor.login as string | undefined) ?? null) : null,
    authorAvatarUrl: ghAuthor ? ((ghAuthor.avatar_url as string | undefined) ?? null) : null,
    authorTs,
    committerName: committer?.name ?? null,
    committerEmail: committer?.email ?? null,
    committerTs: toEpoch(committer?.date),
    isMerge: (parents?.length ?? 0) > 1,
    htmlUrl: (raw.html_url as string | null) ?? null,
  };
}
