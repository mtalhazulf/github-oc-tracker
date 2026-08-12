# GitHub OC Tracker

Self-hosted tracker for **all GitHub commits — and when they happen — across every
repository in an organization**, plus any individual repositories you add. Point it
at an org (or user account), and it discovers every repo, pulls the full commit
history into SQLite, keeps it up to date in the background, and gives you a
dashboard of commit times, trends, and contributors.

Built with **Hono + Bun + HTMX + Tailwind CSS + SQLite**, shipped as a single
container via **Docker Compose**.

## Features

- **Organizations & codebases** — add a GitHub organization (or user) to track *all*
  of its repositories, or add individual `owner/repo` codebases. New repos created
  in a tracked org are picked up automatically on scheduled syncs.
- **Commit times** — day-of-week × hour-of-day heatmap, commits by hour, by weekday,
  and per-day trend, all in a configurable display timezone.
- **Dashboard** — KPI tiles (total commits, 7-day delta, repos, contributors), top
  contributors, recent activity; scopeable to a single org or repo.
- **Commit explorer** — filter by repository, author, message/SHA, date range, and
  merge commits, with infinite "load more" pagination.
- **Incremental sync** — first sync backfills history; subsequent syncs fetch only
  new commits (with an overlap window and SHA-level dedupe). Manual "Sync now" per
  repo/org, plus a background scheduler.
- **Installable GitHub App (Dokploy-style)** — one click on the Settings page
  creates a private GitHub App via GitHub's app-manifest flow (read-only
  `contents`/`metadata`, webhook pre-wired). Install it on any organization or
  personal account — all repositories or a hand-picked selection — and tracking
  starts automatically, authenticated with per-installation tokens instead of a
  personal token. Multiple installations across different orgs work side by side.
- **Real-time webhooks** — pushes trigger an immediate incremental sync, renames
  and transfers are tracked, repos added to (or removed from) an installation are
  picked up live, and new repos in a tracked org start syncing on creation. Also
  works without the App: point a repo or org webhook at `/webhooks/github` with
  `WEBHOOK_SECRET`. All deliveries are HMAC-verified and logged on the Settings
  page.
- **Accessible, responsive UI** — keyboard navigable with visible focus states and
  a skip link, screen-reader summaries for every chart, WCAG-conscious text
  contrast, reduced-motion support, first-run onboarding, a global request
  progress indicator, and forgiving inputs (paste a GitHub URL anywhere a name is
  asked).
- **Enterprise ready**
  - GitHub Enterprise Server support via `GITHUB_API_URL`
  - Optional HTTP basic auth in front of the UI (`BASIC_AUTH_USER`/`PASS`)
  - Rate-limit aware GitHub client (waits out small windows, backs off, resumes on
    the next scheduled run when exhausted)
  - Structured JSON logging, `/healthz` liveness endpoint, Docker healthchecks
  - SQLite in WAL mode with migrations; data persisted in a named Docker volume
  - Strict Content-Security-Policy, no CDN dependencies (HTMX + CSS served locally)
  - Graceful shutdown, non-root container user, CI with tests + container smoke test

## Quick start (Docker Compose)

```sh
cp .env.example .env         # set GITHUB_TOKEN (recommended)
docker compose up -d --build
open http://localhost:3000
```

Add an organization on the **Organizations** page or a single `owner/repo` on the
**Repositories** page — syncing starts immediately in the background.

Commit data persists in the `tracker-data` volume; `docker compose down` and
rebuilds won't lose history.

## GitHub App setup (recommended)

1. Set `APP_BASE_URL` to your public URL (GitHub must be able to reach
   `${APP_BASE_URL}/webhooks/github`).
2. Open **Settings → GitHub App**, optionally enter an organization to own the
   app, and click **Create GitHub App**. You'll confirm on GitHub and land back
   here — credentials (app id, private key, webhook secret) are stored
   automatically via the app-manifest conversion API.
3. Click **Install on an organization or account**, pick the account and either
   *All repositories* or a selection. Discovery and backfill start immediately;
   webhooks keep everything current from then on.

Repeat step 3 for as many organizations or personal accounts as you like — each
installation authenticates independently. Removing an installation on GitHub
stops syncing but keeps the tracked history.

### Manual webhooks (without the App)

Using only a PAT? You can still get real-time updates: on any repository or
organization, add a webhook with payload URL `${APP_BASE_URL}/webhooks/github`,
content type `application/json`, secret equal to your `WEBHOOK_SECRET`, and the
**push** + **repository** events. Deliveries are rejected unless the HMAC
signature matches.

## Local development

```sh
bun install
cp .env.example .env
bun run dev          # builds CSS, then serves with hot reload on :3000
bun test             # unit tests
bun run typecheck    # strict TypeScript
```

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | — | PAT for the GitHub API (optional when using the GitHub App). Fine-grained: *Contents: read, Metadata: read*; classic: `repo`, `read:org`. |
| `GITHUB_API_URL` | `https://api.github.com` | Point at `https://<ghe-host>/api/v3` for GitHub Enterprise Server. |
| `GITHUB_WEB_URL` | derived | GitHub web UI base (auto-derived from the API URL). |
| `APP_BASE_URL` | `http://localhost:3000` | Public URL of this deployment; required for webhooks and the GitHub App. |
| `WEBHOOK_SECRET` | — | Secret for manually configured webhooks. The GitHub App provisions its own. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address. |
| `DB_PATH` | `./data/tracker.db` | SQLite file (`/data/tracker.db` in the container). |
| `SYNC_INTERVAL_MINUTES` | `30` | Background sync cadence; `0` disables. |
| `SYNC_CONCURRENCY` | `2` | Repos synced in parallel. |
| `MAX_COMMITS_PER_SYNC` | `10000` | Per-repo per-run fetch cap; `0` = unlimited. |
| `AUTO_TRACK_NEW_REPOS` | `true` | Track repos created in an org after it was added. |
| `INCLUDE_FORKS` / `INCLUDE_ARCHIVED` | `false` / `true` | Which org repos to track. |
| `TZ_OFFSET_MINUTES` | `0` | Display timezone for commit-time analytics, minutes east of UTC (GitHub normalizes commit dates to UTC). |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | — | Set both to require a login (except `/healthz`). |
| `LOG_LEVEL` / `LOG_FORMAT` | `info` / `json` in prod | Structured logging. |

## Architecture

```
Browser (HTMX + Tailwind, server-rendered JSX)        GitHub (push/repo/installation webhooks)
   │                                                     │ HMAC-verified
Hono on Bun ── / /commits /repos /orgs /settings ── /webhooks/github ── /healthz
   │                                                     │
SyncService ── bounded worker queue, incremental per-repo sync
   │                │
SQLite (WAL) ◄──────┘   GitHub REST API — PAT or GitHub App installation tokens
                        (RS256 app JWT → cached per-installation access tokens)
```

- **Sync model**: each repo stores its latest committer timestamp; syncs request
  commits `since` that point minus a 10-minute overlap, and the `(repo_id, sha)`
  unique index makes re-fetches idempotent. Empty repos (HTTP 409) are handled.
- **Commit times**: GitHub's REST API returns commit dates normalized to UTC, so
  hour/weekday analytics use a configurable fixed offset (`TZ_OFFSET_MINUTES`)
  applied at query time in SQL.
- **Scope**: commits are tracked on each repository's default branch (the GitHub
  commits API default). Pushes to other branches are received and logged but
  skipped.
- **GitHub App auth**: the app's private key signs a short-lived RS256 JWT, which
  mints per-installation access tokens (cached, auto-refreshed). Repositories
  remember which installation grants access; everything else falls back to the
  PAT. App credentials live in the `github_app` table inside the SQLite volume —
  protect backups accordingly.

## Operations

- **Health**: `GET /healthz` → `{status, db, pendingSyncs, uptimeSeconds}`; wired
  into the Docker/Compose healthchecks.
- **Backups**: the database is a single SQLite file in the `tracker-data` volume.
  Hot-backup with `docker compose exec tracker bun -e "const{Database}=require('bun:sqlite');new Database('/data/tracker.db').exec(\"VACUUM INTO '/data/backup.db'\")"`,
  then copy `backup.db` out of the volume.
- **Resetting a repo/org**: removing it deletes its commits (cascade); re-adding
  performs a fresh backfill.

## Prior art

Nothing lightweight appears to exist for exactly this ("add orgs + individual
repos, index all commits with timestamps, simple self-hosted dashboard"): the
close options are heavyweight analytics platforms (Apache DevLake, CHAOSS
GrimoireLab), public-repo-only SaaS (OSS Insight), or commercial engineering
analytics (LinearB, Swarmia, Waydev, GitClear). This project fills that gap with
a single small container.

## Limitations

- Tracks the default branch per repository (no per-branch breakdown yet).
- Commit-time analytics use a fixed UTC offset, not a DST-aware timezone.
- Author identity is grouped by GitHub login when available, else name/email.
