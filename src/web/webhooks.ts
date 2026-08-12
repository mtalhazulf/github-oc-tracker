import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import type { Store } from "../db/store.ts";
import type { GitHubAppService } from "../github/app.ts";
import type { SyncService } from "../sync/service.ts";

interface WebhookRepo {
  id: number;
  name: string;
  full_name: string;
  private?: boolean;
  fork?: boolean;
  archived?: boolean;
  description?: string | null;
  default_branch?: string;
  html_url?: string;
  owner?: { login?: string };
}

function minimalRepos(list: unknown): { githubId: number; fullName: string; isPrivate: boolean }[] {
  if (!Array.isArray(list)) return [];
  return (list as WebhookRepo[])
    .filter((r) => r && typeof r.id === "number" && typeof r.full_name === "string")
    .map((r) => ({ githubId: r.id, fullName: r.full_name, isPrivate: Boolean(r.private) }));
}

export function verifySignature(body: string, signatureHeader: string | undefined, secrets: string[]): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const given = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  for (const secret of secrets) {
    const expected = createHmac("sha256", secret).update(body).digest();
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

export function createWebhookRoutes(
  store: Store,
  sync: SyncService,
  appSvc: GitHubAppService,
): Hono {
  const app = new Hono();

  app.post("/webhooks/github", async (c) => {
    const event = c.req.header("x-github-event") ?? "unknown";
    const deliveryId = c.req.header("x-github-delivery") ?? null;
    const body = await c.req.text();

    const secrets = [appSvc.app?.webhook_secret, config.webhookSecret].filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
    if (secrets.length === 0) {
      store.insertWebhookEvent({
        deliveryId,
        event,
        action: null,
        repoFullName: null,
        status: "rejected",
        note: "no webhook secret configured (set WEBHOOK_SECRET or create the GitHub App)",
      });
      return c.json({ error: "webhook secret not configured" }, 503);
    }
    if (!verifySignature(body, c.req.header("x-hub-signature-256"), secrets)) {
      store.insertWebhookEvent({
        deliveryId,
        event,
        action: null,
        repoFullName: null,
        status: "rejected",
        note: "invalid signature",
      });
      return c.json({ error: "invalid signature" }, 401);
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    const action = typeof payload.action === "string" ? payload.action : null;
    const repo = payload.repository as WebhookRepo | undefined;
    const record = (status: string, note: string | null = null) =>
      store.insertWebhookEvent({
        deliveryId,
        event,
        action,
        repoFullName: repo?.full_name ?? null,
        status,
        note,
      });

    try {
      switch (event) {
        case "ping":
          record("ok", "pong");
          return c.json({ ok: true });

        case "push":
          return c.json(handlePush(payload, record));

        case "installation":
          return c.json(handleInstallation(payload, action, record));

        case "installation_repositories":
          return c.json(handleInstallationRepos(payload, record));

        case "repository":
          return c.json(handleRepository(payload, action, record));

        default:
          record("ignored", "event not handled");
          return c.json({ ok: true, ignored: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("webhook handling failed", { event, action, err: msg });
      record("error", msg);
      return c.json({ error: "handler failed" }, 500);
    }
  });

  function knownInstallationId(payload: Record<string, unknown>): number | null {
    const inst = payload.installation as { id?: number } | undefined;
    if (typeof inst?.id !== "number") return null;
    return store.getInstallation(inst.id) ? inst.id : inst.id; // trust signed payloads
  }

  function refreshRepoFromPayload(
    r: WebhookRepo,
    installationId: number | null,
  ): { id: number; inserted: boolean } {
    const owner = r.owner?.login ?? r.full_name.split("/")[0] ?? "";
    const org = store.getOrgByLogin(owner);
    return store.upsertRepo({
      githubId: r.id,
      orgId: org?.id ?? null,
      owner,
      name: r.name,
      fullName: r.full_name,
      description: r.description ?? null,
      defaultBranch: r.default_branch ?? null,
      isPrivate: Boolean(r.private),
      isFork: Boolean(r.fork),
      isArchived: Boolean(r.archived),
      htmlUrl: r.html_url ?? null,
      installationId,
    });
  }

  function handlePush(
    payload: Record<string, unknown>,
    record: (status: string, note?: string | null) => void,
  ): Record<string, unknown> {
    if (!repoValid(payload.repository)) {
      record("ignored", "missing repository");
      return { ok: true };
    }
    const r = payload.repository as WebhookRepo;
    const ref = typeof payload.ref === "string" ? payload.ref : "";
    const installationId = knownInstallationId(payload);

    const tracked = store.getRepoByGithubId(r.id) ?? store.getRepoByFullName(r.full_name);
    if (!tracked) {
      const owner = r.owner?.login ?? r.full_name.split("/")[0] ?? "";
      const orgTracked = store.getOrgByLogin(owner) !== null;
      if (installationId === null && !(orgTracked && config.autoTrackNewRepos)) {
        record("ignored", "repository is not tracked");
        return { ok: true, ignored: true };
      }
      const { id } = refreshRepoFromPayload(r, installationId);
      sync.queueRepoSync(id);
      record("ok", "new repository tracked and queued");
      return { ok: true, queued: true };
    }

    const { id } = refreshRepoFromPayload(r, installationId ?? tracked.installation_id);
    const defaultBranch = r.default_branch ?? "main";
    if (ref && ref !== `refs/heads/${defaultBranch}`) {
      record("skipped", `push to ${ref}, tracking ${defaultBranch} only`);
      return { ok: true, skipped: true };
    }
    sync.queueRepoSync(id);
    record("ok", "sync queued");
    return { ok: true, queued: true };
  }

  function handleInstallation(
    payload: Record<string, unknown>,
    action: string | null,
    record: (status: string, note?: string | null) => void,
  ): Record<string, unknown> {
    const inst = payload.installation as
      | { id?: number; account?: { login?: string; type?: string } }
      | undefined;
    if (typeof inst?.id !== "number" || !inst.account?.login) {
      record("ignored", "missing installation");
      return { ok: true };
    }
    switch (action) {
      case "created":
      case "unsuspend":
      case "new_permissions_accepted":
        sync.registerInstallation({
          id: inst.id,
          accountLogin: inst.account.login,
          accountType: inst.account.type ?? "Organization",
          repos: minimalRepos(payload.repositories),
        });
        record("ok", `installation ${action} for ${inst.account.login}`);
        return { ok: true };
      case "deleted":
        store.removeInstallation(inst.id);
        record("ok", `installation removed for ${inst.account.login}`);
        return { ok: true };
      case "suspend":
        store.setInstallationSuspended(inst.id, true);
        record("ok", "installation suspended");
        return { ok: true };
      default:
        record("ignored", `installation action ${action ?? "?"}`);
        return { ok: true };
    }
  }

  function handleInstallationRepos(
    payload: Record<string, unknown>,
    record: (status: string, note?: string | null) => void,
  ): Record<string, unknown> {
    const inst = payload.installation as
      | { id?: number; account?: { login?: string; type?: string } }
      | undefined;
    if (typeof inst?.id !== "number") {
      record("ignored", "missing installation");
      return { ok: true };
    }
    store.upsertInstallation({
      id: inst.id,
      accountLogin: inst.account?.login ?? "",
      accountType: inst.account?.type ?? "Organization",
    });
    const org = inst.account?.login ? store.getOrgByLogin(inst.account.login) : null;
    const added = minimalRepos(payload.repositories_added);
    const removed = minimalRepos(payload.repositories_removed);
    if (added.length > 0) sync.addInstallationRepos(inst.id, org?.id ?? null, added);
    for (const r of removed) store.detachRepoFromInstallation(r.githubId);
    record("ok", `+${added.length} / -${removed.length} repositories`);
    return { ok: true, added: added.length, removed: removed.length };
  }

  function handleRepository(
    payload: Record<string, unknown>,
    action: string | null,
    record: (status: string, note?: string | null) => void,
  ): Record<string, unknown> {
    if (!repoValid(payload.repository)) {
      record("ignored", "missing repository");
      return { ok: true };
    }
    const r = payload.repository as WebhookRepo;
    const installationId = knownInstallationId(payload);
    const tracked = store.getRepoByGithubId(r.id) ?? store.getRepoByFullName(r.full_name);

    if (action === "deleted") {
      if (tracked) {
        store.setRepoSync(tracked.id, "error", "Repository was deleted on GitHub");
        record("ok", "repository marked deleted (history kept)");
      } else {
        record("ignored", "repository is not tracked");
      }
      return { ok: true };
    }

    if (action === "created") {
      const owner = r.owner?.login ?? r.full_name.split("/")[0] ?? "";
      const orgTracked = store.getOrgByLogin(owner) !== null;
      if ((orgTracked && config.autoTrackNewRepos) || installationId !== null) {
        const { id } = refreshRepoFromPayload(r, installationId);
        sync.queueRepoSync(id);
        record("ok", "new repository tracked");
      } else {
        record("ignored", "owner is not tracked");
      }
      return { ok: true };
    }

    // renamed / transferred / edited / archived / unarchived / (un)privatized
    if (tracked) {
      refreshRepoFromPayload(r, installationId ?? tracked.installation_id);
      record("ok", `repository ${action ?? "updated"}`);
    } else {
      record("ignored", "repository is not tracked");
    }
    return { ok: true };
  }

  return app;
}

function repoValid(candidate: unknown): boolean {
  const r = candidate as WebhookRepo | undefined;
  return Boolean(r && typeof r.id === "number" && typeof r.full_name === "string" && r.name);
}
