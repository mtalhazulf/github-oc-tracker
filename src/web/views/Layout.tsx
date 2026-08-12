import type { Child } from "hono/jsx";
import { currentCsrfToken, currentPrincipal, currentRole } from "../request-context.ts";
import { Sidebar, type NavKey } from "./Sidebar.tsx";

interface Props {
  title: string;
  active?: NavKey;
  children: Child;
}

export function Layout({ title, active, children }: Props) {
  const role = currentRole();
  const principal = currentPrincipal();
  const csrf = currentCsrfToken();
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
      <body
        class="min-h-screen bg-plane text-ink"
        hx-boost="true"
        {...(csrf ? { "hx-headers": JSON.stringify({ "X-CSRF-Token": csrf }) } : {})}
      >
        <a
          href="#main"
          class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-ink"
        >
          Skip to content
        </a>
        <div id="loading-bar" aria-hidden="true"></div>

        <div class="md:grid md:min-h-screen md:grid-cols-[220px_minmax(0,1fr)]">
          <Sidebar active={active} role={role} principal={principal} />
          <div class="min-w-0">
            <main id="main" class="mx-auto max-w-5xl px-4 py-6">
              {children}
            </main>
            <footer class="mx-auto max-w-5xl px-4 py-8 text-xs text-ink-muted">
              GitHub OC Tracker — self-hosted commit analytics for organizations &amp; repositories.
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
