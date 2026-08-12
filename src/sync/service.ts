import { config } from "../config.ts";
import { log } from "../logger.ts";
import type { RepoRow, Store } from "../db/store.ts";
import { GitHubClient, NotFoundError, RateLimitError } from "../github/client.ts";
import type { GitHubAppService } from "../github/app.ts";

/**
 * Coordinates GitHub → SQLite synchronization with a bounded worker pool.
 * A repo is only ever queued once at a time; org syncs re-discover repos first.
 * Repositories granted through a GitHub App installation authenticate with
 * installation tokens; everything else uses the configured PAT.
 */
export class SyncService {
  private readonly queue: number[] = [];
  private readonly queued = new Set<number>();
  private running = 0;
  private stopped = false;

  constructor(
    private readonly store: Store,
    private readonly github: GitHubClient,
    private readonly app?: GitHubAppService,
  ) {}

  /** Pick the client that can actually see this repo. */
  private clientFor(repo: Pick<RepoRow, "installation_id">): GitHubClient {
    if (repo.installation_id !== null && this.app?.isConfigured) {
      return this.app.clientFor(repo.installation_id);
    }
    return this.github;
  }

  /** Add a single repository by "owner/name" and queue its first sync. */
  async addRepo(fullName: string): Promise<{ id: number; inserted: boolean }> {
    const [owner, name] = splitFullName(fullName);
    // Prefer an app installation covering this owner; fall back to the PAT.
    const installation = this.app?.isConfigured
      ? this.store.findInstallationByLogin(owner)
      : null;
    const client = installation ? this.app!.clientFor(installation.id) : this.github;
    const ghRepo = await client.getRepo(owner, name);
    const existingOrg = this.store.getOrgByLogin(ghRepo.owner);
    const result = this.store.upsertRepo({
      githubId: ghRepo.githubId,
      orgId: existingOrg?.id ?? null,
      owner: ghRepo.owner,
      name: ghRepo.name,
      fullName: ghRepo.fullName,
      description: ghRepo.description,
      defaultBranch: ghRepo.defaultBranch,
      isPrivate: ghRepo.isPrivate,
      isFork: ghRepo.isFork,
      isArchived: ghRepo.isArchived,
      htmlUrl: ghRepo.htmlUrl,
      installationId: installation?.id ?? null,
    });
    this.queueRepoSync(result.id);
    return result;
  }

  /**
   * Validate and register an organization (or user account). Repo discovery is
   * kicked off in the background so large orgs don't block the request.
   */
  async addOrg(login: string): Promise<{ id: number }> {
    const installation = this.app?.isConfigured ? this.store.findInstallationByLogin(login) : null;
    const client = installation ? this.app!.clientFor(installation.id) : this.github;
    const account = await client.getAccount(login);
    const orgId = this.store.insertOrg({
      login: account.login,
      name: account.name,
      kind: account.kind,
      avatarUrl: account.avatarUrl,
      htmlUrl: account.htmlUrl,
    });
    if (installation) this.store.setOrgInstallation(orgId, installation.id);
    this.store.setOrgSync(orgId, "syncing");
    this.discoverOrgRepos(orgId).catch((err) =>
      log.error("org discovery failed", { org: account.login, err: errMessage(err) }),
    );
    return { id: orgId };
  }

  /**
   * Register a GitHub App installation (from a webhook or reconciliation):
   * store it, ensure an organization row exists for the account, and start
   * tracking the granted repositories.
   */
  registerInstallation(inst: {
    id: number;
    accountLogin: string;
    accountType: string;
    repos: { githubId: number; fullName: string; isPrivate: boolean }[];
  }): void {
    this.store.upsertInstallation({
      id: inst.id,
      accountLogin: inst.accountLogin,
      accountType: inst.accountType,
    });
    const orgId = this.store.insertOrg({
      login: inst.accountLogin,
      name: null,
      kind: inst.accountType === "User" ? "user" : "org",
      avatarUrl: null,
      htmlUrl: `${config.githubWebUrl}/${inst.accountLogin}`,
    });
    this.store.setOrgInstallation(orgId, inst.id);
    this.addInstallationRepos(inst.id, orgId, inst.repos);
    // Fill in avatar/name/description details in the background.
    this.discoverOrgRepos(orgId).catch((err) =>
      log.error("installation discovery failed", { installation: inst.id, err: errMessage(err) }),
    );
  }

  /** Track repos granted to an installation (webhook payloads carry minimal repo info). */
  addInstallationRepos(
    installationId: number,
    orgId: number | null,
    repos: { githubId: number; fullName: string; isPrivate: boolean }[],
  ): void {
    for (const r of repos) {
      const [owner, name] = splitFullName(r.fullName);
      const { id } = this.store.upsertRepo({
        githubId: r.githubId,
        orgId,
        owner,
        name,
        fullName: r.fullName,
        description: null,
        defaultBranch: null,
        isPrivate: r.isPrivate,
        isFork: false,
        isArchived: false,
        htmlUrl: `${config.githubWebUrl}/${r.fullName}`,
        installationId,
      });
      this.queueRepoSync(id);
    }
  }

  /** Re-list an org's repositories from GitHub and upsert them locally. */
  async discoverOrgRepos(orgId: number): Promise<number> {
    const org = this.store.getOrg(orgId);
    if (!org) throw new Error(`Organization ${orgId} not found`);
    this.store.setOrgSync(orgId, "syncing");
    const installationId =
      org.installation_id !== null && this.app?.isConfigured ? org.installation_id : null;
    let count = 0;
    try {
      // Installation-backed orgs list exactly the repos the app was granted;
      // PAT-backed orgs list everything the token can see.
      const repoSource =
        installationId !== null
          ? this.app!.clientFor(installationId).listInstallationRepos()
          : this.github.listRepos(org.login, org.kind);
      for await (const batch of repoSource) {
        for (const ghRepo of batch) {
          if (ghRepo.isFork && !config.includeForks) continue;
          if (ghRepo.isArchived && !config.includeArchived) continue;
          const { id, inserted } = this.store.upsertRepo({
            githubId: ghRepo.githubId,
            orgId,
            owner: ghRepo.owner,
            name: ghRepo.name,
            fullName: ghRepo.fullName,
            description: ghRepo.description,
            defaultBranch: ghRepo.defaultBranch,
            isPrivate: ghRepo.isPrivate,
            isFork: ghRepo.isFork,
            isArchived: ghRepo.isArchived,
            htmlUrl: ghRepo.htmlUrl,
            installationId,
          });
          count += 1;
          if (inserted || config.autoTrackNewRepos) {
            this.queueRepoSync(id);
          }
        }
      }
      this.store.markOrgSynced(orgId);
      log.info("org repos discovered", { org: org.login, count });
      return count;
    } catch (err) {
      this.store.setOrgSync(orgId, "error", errMessage(err));
      throw err;
    }
  }

  /** Queue a repo sync; returns false if it was already queued or syncing. */
  queueRepoSync(repoId: number): boolean {
    if (this.queued.has(repoId)) return false;
    this.queued.add(repoId);
    this.queue.push(repoId);
    this.pump();
    return true;
  }

  /** Queue syncs for every tracked repository (used by the scheduler). */
  queueAll(): number {
    let n = 0;
    for (const repo of this.store.listTrackedRepos()) {
      if (this.queueRepoSync(repo.id)) n += 1;
    }
    return n;
  }

  /** Re-discover org repos then queue the org's repositories. */
  async syncOrg(orgId: number): Promise<void> {
    await this.discoverOrgRepos(orgId);
  }

  get pendingCount(): number {
    return this.queue.length + this.running;
  }

  stop(): void {
    this.stopped = true;
  }

  private pump(): void {
    while (!this.stopped && this.running < config.syncConcurrency && this.queue.length > 0) {
      const repoId = this.queue.shift();
      if (repoId === undefined) break;
      this.running += 1;
      this.syncRepo(repoId)
        .catch((err) => log.error("repo sync failed", { repoId, err: errMessage(err) }))
        .finally(() => {
          this.running -= 1;
          this.queued.delete(repoId);
          this.pump();
        });
    }
  }

  /** Incrementally sync one repository's commits (default branch). */
  async syncRepo(repoId: number): Promise<void> {
    const repo = this.store.getRepo(repoId);
    if (!repo) return;
    this.store.setRepoSync(repoId, "syncing");
    const runId = this.store.startSyncRun(repoId);
    let added = 0;
    try {
      // Overlap the window by 10 minutes so force-pushes / clock skew don't drop commits;
      // the (repo_id, sha) unique index dedupes anything re-fetched.
      const maxTs = this.store.maxCommitterTs(repoId);
      const since = maxTs !== null ? new Date((maxTs - 600) * 1000).toISOString() : undefined;
      const limit = config.maxCommitsPerSync;
      let fetched = 0;
      const client = this.clientFor(repo);
      outer: for await (const batch of client.listCommits(repo.owner, repo.name, { since })) {
        added += this.store.insertCommits(repoId, batch);
        fetched += batch.length;
        if (limit > 0 && fetched >= limit) {
          log.warn("sync hit MAX_COMMITS_PER_SYNC cap", { repo: repo.full_name, limit });
          break outer;
        }
      }
      this.store.markRepoSynced(repoId);
      this.store.finishSyncRun(runId, "success", added);
      log.info("repo synced", { repo: repo.full_name, added });
    } catch (err) {
      const msg = errMessage(err);
      this.store.setRepoSync(repoId, "error", msg);
      this.store.finishSyncRun(runId, "error", added, msg);
      if (err instanceof RateLimitError) {
        log.warn("rate limited during sync; will retry on next scheduled run", {
          repo: repo.full_name,
          resetAt: err.resetAt,
        });
        return;
      }
      if (err instanceof NotFoundError) {
        log.warn("repo not found on GitHub (deleted or token lacks access)", {
          repo: repo.full_name,
        });
        return;
      }
      throw err;
    }
  }
}

function splitFullName(fullName: string): [string, string] {
  const trimmed = fullName.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Expected "owner/name", got "${fullName}"`);
  }
  return [parts[0], parts[1]];
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
