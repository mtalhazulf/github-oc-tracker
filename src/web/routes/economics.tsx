import { Hono } from "hono";
import type { Context } from "hono";
import { config } from "../../config.ts";
import type { Store } from "../../db/store.ts";
import { ValidationError } from "../../domain/errors.ts";
import { currentPeriod, todayIso } from "../../domain/period.ts";
import type { AuthService } from "../../services/auth.ts";
import { mondayOf, type EconomicsService } from "../../services/economics.ts";
import { currentPrincipal } from "../request-context.ts";
import { friendlyError, page } from "../http.tsx";
import { requireCapability } from "../middleware/auth.ts";
import { Layout } from "../views/Layout.tsx";
import { AgingPage, CapacityPage, InvoicesPage } from "../views/EconomicsPage.tsx";

export function createEconomicsRoutes(store: Store, economics: EconomicsService, auth: AuthService): Hono {
  const app = new Hono();

  app.use("/invoices", requireCapability("invoice.view"));
  app.use("/invoices/*", requireCapability("invoice.view"));
  app.use("/capacity", requireCapability("capacity.view"));

  const today = () => todayIso(config.tzOffsetMinutes);

  function invoicesPage(c: Context, errors = {}, message?: string) {
    const status = c.req.query("status") ?? "";
    return page(
      c,
      <Layout title="Invoices" active="invoices">
        <InvoicesPage
          invoices={store.listInvoices({ status: status || undefined })}
          clients={store.listClients()}
          projects={store.listProjects({ kind: "client" })}
          aging={store.arAging(today())}
          filters={{ status }}
          errors={errors}
          message={message}
        />
      </Layout>,
    );
  }

  app.get("/invoices", (c) => invoicesPage(c));

  app.get("/invoices/aging", (c) =>
    page(
      c,
      <Layout title="AR aging" active="invoices">
        <AgingPage aging={store.arAging(today())} today={today()} />
      </Layout>,
    ),
  );

  app.post("/invoices", requireCapability("invoice.manage"), async (c) => {
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    try {
      const created = economics.createInvoice(body);
      auth.audit(currentPrincipal(), "invoice.create", "invoice", created.id, created.number);
      return invoicesPage(c);
    } catch (err) {
      return invoicesPage(
        c,
        err instanceof ValidationError ? err.fields : {},
        err instanceof ValidationError ? undefined : friendlyError(err),
      );
    }
  });

  app.post("/invoices/:id/status", requireCapability("invoice.manage"), async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    try {
      economics.setStatus(id, String(body.status ?? ""), today());
      auth.audit(currentPrincipal(), "invoice.status", "invoice", id, String(body.status ?? ""));
      return invoicesPage(c);
    } catch (err) {
      return invoicesPage(c, {}, friendlyError(err));
    }
  });

  app.delete("/invoices/:id", requireCapability("invoice.manage"), (c) => {
    try {
      economics.removeInvoice(Number(c.req.param("id")));
      return invoicesPage(c);
    } catch (err) {
      return invoicesPage(c, {}, friendlyError(err));
    }
  });

  app.get("/capacity", (c) => {
    const monday = mondayOf(today());
    return page(
      c,
      <Layout title="Capacity" active="capacity">
        <CapacityPage
          cells={store.capacityGrid(monday)}
          monday={monday}
          benchPct={store.benchPct(today())}
          bench={store.benchList(today())}
        />
      </Layout>,
    );
  });

  return app;
}

export function currentPeriodFor(): string {
  return currentPeriod(config.tzOffsetMinutes);
}
