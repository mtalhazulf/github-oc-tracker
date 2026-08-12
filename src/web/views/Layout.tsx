import type { Child } from "hono/jsx";

interface Props {
  title: string;
  active?: "dashboard" | "commits" | "repos" | "orgs" | "settings";
  children: Child;
}

const NAV = [
  { key: "dashboard", href: "/", label: "Dashboard" },
  { key: "commits", href: "/commits", label: "Commits" },
  { key: "repos", href: "/repos", label: "Repositories" },
  { key: "orgs", href: "/orgs", label: "Organizations" },
  { key: "settings", href: "/settings", label: "Settings" },
] as const;

export function Layout({ title, active, children }: Props) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · GitHub OC Tracker</title>
        <link rel="stylesheet" href="/app.css" />
        <link
          rel="icon"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='0.9em' font-size='90'>📊</text></svg>"
        />
        <script src="/htmx.min.js" defer></script>
        <script src="/app.js" defer></script>
      </head>
      <body class="min-h-screen bg-plane text-ink" hx-boost="true">
        <a
          href="#main"
          class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-ink"
        >
          Skip to content
        </a>
        <div id="loading-bar" aria-hidden="true"></div>
        <header class="border-b border-hairline bg-surface">
          <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3">
            <a href="/" class="flex items-center gap-2 font-semibold text-ink">
              <span class="inline-flex h-6 w-6 items-center justify-center rounded bg-accent text-xs font-bold text-white">
                OC
              </span>
              GitHub OC Tracker
            </a>
            <nav aria-label="Main" class="flex flex-wrap gap-1 text-sm">
              {NAV.map((item) => (
                <a
                  href={item.href}
                  aria-current={item.key === active ? "page" : undefined}
                  class={
                    item.key === active
                      ? "rounded-md bg-plane px-3 py-2 font-medium text-ink"
                      : "rounded-md px-3 py-2 text-ink-2 hover:bg-plane hover:text-ink"
                  }
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </header>
        <main id="main" class="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer class="mx-auto max-w-6xl px-4 py-8 text-xs text-ink-muted">
          GitHub OC Tracker — self-hosted commit analytics for organizations &amp; repositories.
        </footer>
      </body>
    </html>
  );
}
