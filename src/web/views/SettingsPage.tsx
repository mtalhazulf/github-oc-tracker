import type { GithubAppRow, InstallationRow, WebhookEventRow } from "../../db/store.ts";
import { timeAgo } from "../format.ts";

export interface SettingsData {
  app: GithubAppRow | null;
  installations: InstallationRow[];
  events: WebhookEventRow[];
  webhookUrl: string;
  baseUrl: string;
  baseUrlIsLocal: boolean;
  manualSecretSet: boolean;
  patSet: boolean;
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: unknown }) {
  return (
    <section class="rounded-lg border border-hairline bg-surface p-4">
      <h2 class="text-sm font-semibold text-ink">{title}</h2>
      {subtitle ? <p class="mb-3 mt-0.5 text-xs text-ink-muted">{subtitle}</p> : <div class="mb-3"></div>}
      {children}
    </section>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span class={`inline-flex items-center gap-1.5 text-xs ${ok ? "text-up" : "text-ink-muted"}`}>
      {ok ? "✓" : "○"} {label}
    </span>
  );
}

/** The manifest hand-off form returned by GET /settings/github-app/new. */
export function ManifestForm({
  targetUrl,
  manifestJson,
  org,
}: {
  targetUrl: string;
  manifestJson: string;
  org: string;
}) {
  return (
    <div id="manifest-slot" class="mt-3 rounded-md border border-hairline bg-plane p-3">
      <p class="mb-2 text-xs text-ink-2">
        GitHub will ask you to confirm creating the app{org ? ` in the ${org} organization` : " on your account"}
        , then redirect back here automatically.
      </p>
      <form action={targetUrl} method="post" hx-boost="false">
        <input type="hidden" name="manifest" value={manifestJson} />
        <button type="submit" class="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white">
          Continue to GitHub →
        </button>
      </form>
    </div>
  );
}

export function SettingsPage({ d }: { d: SettingsData }) {
  return (
    <div class="space-y-4">
      <h1 class="text-xl font-semibold text-ink">Settings</h1>

      <Card
        title="GitHub App"
        subtitle="Install this tracker as a GitHub App — Dokploy-style — so repositories and webhooks are granted per organization or account, with no personal token required."
      >
        {d.app ? (
          <div class="space-y-3 text-sm">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium text-ink">{d.app.name}</span>
              <a href={d.app.html_url} target="_blank" rel="noopener" class="text-accent hover:underline">
                @{d.app.slug}
              </a>
              <span class="rounded bg-plane px-1.5 py-0.5 text-[10px] text-ink-muted">app id {d.app.app_id}</span>
              <StatusDot ok={true} label="webhook secret stored" />
            </div>
            <div class="flex flex-wrap gap-2">
              <a
                href={`${d.app.html_url}/installations/new`}
                target="_blank"
                rel="noopener"
                class="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white"
              >
                Install on an organization or account
              </a>
              <button
                class="rounded-md border border-hairline px-3 py-1.5 text-sm text-status-critical"
                hx-delete="/settings/github-app"
                hx-confirm="Remove the stored GitHub App credentials? Installations will stop syncing until reconfigured."
              >
                Remove app configuration
              </button>
            </div>
            <div>
              <h3 class="mb-1 mt-2 text-xs font-semibold text-ink">Installations</h3>
              {d.installations.length === 0 ? (
                <p class="text-xs text-ink-muted">
                  No installations yet — use the install button above. Each install (org or personal account,
                  all repos or a selection) starts syncing automatically.
                </p>
              ) : (
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-left text-xs text-ink-muted">
                      <th class="py-1.5 pr-3 font-medium">Account</th>
                      <th class="py-1.5 pr-3 font-medium">Type</th>
                      <th class="py-1.5 pr-3 font-medium">Repositories</th>
                      <th class="py-1.5 pr-3 font-medium">Last event</th>
                      <th class="py-1.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.installations.map((i) => (
                      <tr class="border-t border-hairline">
                        <td class="py-1.5 pr-3 text-ink">{i.account_login}</td>
                        <td class="py-1.5 pr-3 text-ink-2">{i.account_type}</td>
                        <td class="py-1.5 pr-3 tabular-nums text-ink-2">{i.repo_count}</td>
                        <td class="py-1.5 pr-3 text-ink-2">
                          {i.last_event_at ? timeAgo(i.last_event_at) : "—"}
                        </td>
                        <td class="py-1.5 text-xs">
                          {i.suspended ? (
                            <span class="text-status-critical">⏸ suspended</span>
                          ) : (
                            <span class="text-up">✓ active</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          <div class="text-sm">
            {d.baseUrlIsLocal ? (
              <p class="mb-3 rounded-md bg-plane p-2 text-xs text-ink-2">
                ⚠ <code>APP_BASE_URL</code> is currently <code>{d.baseUrl}</code>. GitHub must be able to
                reach this server to deliver webhooks — set <code>APP_BASE_URL</code> to your public URL
                before creating the app.
              </p>
            ) : null}
            <p class="mb-3 text-ink-2">
              One click creates a private GitHub App (via the app-manifest flow) with read-only
              <code> contents</code>/<code>metadata</code> permissions and push webhooks pre-wired to this
              deployment. You then install it on any organization or personal account — all repositories or
              just a selection.
            </p>
            <form
              hx-get="/settings/github-app/new"
              hx-target="#manifest-slot"
              hx-swap="outerHTML"
              class="flex flex-wrap items-center gap-2"
            >
              <input
                type="text"
                name="org"
                placeholder="Organization (leave blank for personal account)"
                class="w-80 rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted"
              />
              <button type="submit" class="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white">
                Create GitHub App
              </button>
            </form>
            <div id="manifest-slot"></div>
          </div>
        )}
      </Card>

      <Card
        title="Webhooks"
        subtitle="Real-time commit ingestion — pushes trigger an immediate incremental sync instead of waiting for the schedule."
      >
        <div class="space-y-2 text-sm">
          <p class="text-ink-2">
            Endpoint: <code class="rounded bg-plane px-1.5 py-0.5 text-xs">{d.webhookUrl}</code>
          </p>
          <div class="flex flex-wrap gap-4">
            <StatusDot ok={d.app !== null} label="GitHub App webhook (automatic)" />
            <StatusDot ok={d.manualSecretSet} label="Manual webhook secret (WEBHOOK_SECRET)" />
            <StatusDot ok={d.patSet} label="Personal access token (GITHUB_TOKEN)" />
          </div>
          <p class="text-xs text-ink-muted">
            Without the GitHub App you can still point a repository or organization webhook here manually:
            payload URL as above, content type <code>application/json</code>, events <code>push</code> +{" "}
            <code>repository</code>, and secret equal to <code>WEBHOOK_SECRET</code>. Pushes to untracked
            repositories of a tracked organization are picked up automatically.
          </p>
        </div>
      </Card>

      <Card title="Recent webhook deliveries" subtitle="Last 20 deliveries received by this deployment">
        {d.events.length === 0 ? (
          <p class="text-sm text-ink-muted">Nothing received yet.</p>
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-ink-muted">
                  <th class="py-1.5 pr-3 font-medium">Event</th>
                  <th class="py-1.5 pr-3 font-medium">Repository</th>
                  <th class="py-1.5 pr-3 font-medium">Result</th>
                  <th class="py-1.5 pr-3 font-medium">Note</th>
                  <th class="py-1.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {d.events.map((e) => (
                  <tr class="border-t border-hairline align-top">
                    <td class="whitespace-nowrap py-1.5 pr-3 text-ink">
                      {e.event}
                      {e.action ? <span class="text-ink-muted">/{e.action}</span> : null}
                    </td>
                    <td class="whitespace-nowrap py-1.5 pr-3 text-ink-2">{e.repo_full_name ?? "—"}</td>
                    <td class="whitespace-nowrap py-1.5 pr-3 text-xs">
                      {e.status === "ok" ? (
                        <span class="text-up">✓ ok</span>
                      ) : e.status === "rejected" || e.status === "error" ? (
                        <span class="text-status-critical">✕ {e.status}</span>
                      ) : (
                        <span class="text-ink-muted">– {e.status}</span>
                      )}
                    </td>
                    <td class="max-w-sm py-1.5 pr-3 text-xs text-ink-muted">{e.note ?? ""}</td>
                    <td class="whitespace-nowrap py-1.5 text-xs text-ink-muted">{timeAgo(e.received_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
