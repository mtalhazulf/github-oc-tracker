import { Hono } from "hono";
import type { Context } from "hono";
import { mintToken } from "../../api/v1.ts";
import type { Store } from "../../db/store.ts";
import type { AuthService } from "../../services/auth.ts";
import { currentPrincipal } from "../request-context.ts";
import { page } from "../http.tsx";
import { requireCapability } from "../middleware/auth.ts";
import { Layout } from "../views/Layout.tsx";
import { TokensPage } from "../views/TokensPage.tsx";

export function createTokenRoutes(store: Store, auth: AuthService): Hono {
  const app = new Hono();
  app.use("/settings/tokens", requireCapability("settings.manage"));
  app.use("/settings/tokens/*", requireCapability("settings.manage"));

  function render(c: Context, created?: string) {
    return page(
      c,
      <Layout title="API tokens" active="settings">
        <TokensPage tokens={store.listApiTokens()} created={created} />
      </Layout>,
    );
  }

  app.get("/settings/tokens", (c) => render(c));

  app.post("/settings/tokens", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    const name = String(body.name ?? "").trim() || "Unnamed token";
    const { token, hash, prefix } = mintToken();
    const principal = currentPrincipal();
    const id = store.insertApiToken({ name, tokenHash: hash, prefix, userId: principal?.id ?? null });
    auth.audit(principal, "token.create", "token", id, name);
    return render(c, token);
  });

  app.delete("/settings/tokens/:id", (c) => {
    const id = Number(c.req.param("id"));
    store.deleteApiToken(id);
    auth.audit(currentPrincipal(), "token.delete", "token", id, null);
    return render(c);
  });

  return app;
}
