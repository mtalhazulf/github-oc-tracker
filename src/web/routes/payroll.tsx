import { Hono } from "hono";
import type { Context } from "hono";
import type { Store } from "../../db/store.ts";
import { ValidationError } from "../../domain/errors.ts";
import { currentPeriod } from "../../domain/period.ts";
import { config } from "../../config.ts";
import type { AuthService } from "../../services/auth.ts";
import { fiscalYearFor, type PayrollService } from "../../services/payroll.ts";
import { currentPrincipal } from "../request-context.ts";
import { can } from "../../domain/rbac.ts";
import { friendlyError, page } from "../http.tsx";
import { Layout } from "../views/Layout.tsx";
import {
  CycleDetailPage,
  PayrollPage,
  PayslipPage,
  PayslipPrint,
  TaxSlabsPage,
} from "../views/PayrollPage.tsx";

export function createPayrollRoutes(store: Store, payroll: PayrollService, auth: AuthService): Hono {
  const app = new Hono();

  function listPage(c: Context, message?: string) {
    const settings = store.getSettings();
    return page(
      c,
      <Layout title="Payroll" active="payroll">
        <PayrollPage
          cycles={store.listCycles()}
          currency={settings.payroll_currency}
          suggestedPeriod={currentPeriod(config.tzOffsetMinutes)}
          message={message}
        />
      </Layout>,
    );
  }

  function cyclePage(
    c: Context,
    cycleId: number,
    opts: { message?: string; skipped?: { name: string; reason: string }[] } = {},
  ) {
    const cycle = store.getCycle(cycleId);
    if (!cycle) return c.notFound();
    return page(
      c,
      <Layout title={`Payroll ${cycle.period_month}`} active="payroll">
        <CycleDetailPage
          cycle={cycle}
          payslips={store.listPayslips(cycleId)}
          skipped={opts.skipped}
          message={opts.message}
        />
      </Layout>,
    );
  }

  app.get("/payroll", (c) => listPage(c));

  app.post("/payroll/cycles", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    try {
      const cycle = payroll.createCycle(body);
      auth.audit(currentPrincipal(), "cycle.create", "payroll", cycle.id, cycle.period_month);
      return cyclePage(c, cycle.id);
    } catch (err) {
      return listPage(c, friendlyError(err));
    }
  });

  app.get("/payroll/cycles/:id", (c) => cyclePage(c, Number(c.req.param("id"))));

  app.post("/payroll/cycles/:id/generate", (c) => {
    const id = Number(c.req.param("id"));
    try {
      const { created, skipped } = payroll.generate(id);
      auth.audit(currentPrincipal(), "cycle.generate", "payroll", id, `${created} payslips`);
      return cyclePage(c, id, { skipped });
    } catch (err) {
      return cyclePage(c, id, { message: friendlyError(err) });
    }
  });

  app.post("/payroll/cycles/:id/status", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    const status = String(body.status ?? "");
    try {
      if (status !== "draft" && status !== "approved" && status !== "paid" && status !== "cancelled") {
        throw new ValidationError("Unknown status.");
      }
      payroll.setStatus(id, status);
      auth.audit(currentPrincipal(), "cycle.status", "payroll", id, `set to ${status}`);
      return cyclePage(c, id);
    } catch (err) {
      return cyclePage(c, id, { message: friendlyError(err) });
    }
  });

  app.delete("/payroll/cycles/:id", (c) => {
    const id = Number(c.req.param("id"));
    try {
      payroll.removeCycle(id);
      auth.audit(currentPrincipal(), "cycle.delete", "payroll", id, null);
      return listPage(c);
    } catch (err) {
      return cyclePage(c, id, { message: friendlyError(err) });
    }
  });

  app.get("/payroll/cycles/:id/export.csv", (c) => {
    const id = Number(c.req.param("id"));
    const cycle = store.getCycle(id);
    if (!cycle) return c.notFound();
    auth.audit(currentPrincipal(), "cycle.export", "payroll", id, null);
    return new Response(payroll.cycleCsv(id), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="payroll-${cycle.period_month}.csv"`,
      },
    });
  });

  function canRead(_c: Context, employeeId: number): boolean {
    const principal = currentPrincipal();
    if (!principal) return false;
    if (can(principal.role, "compensation.view")) return true;
    return principal.employeeId !== null && principal.employeeId === employeeId;
  }

  app.get("/payslips/:id", (c) => {
    const id = Number(c.req.param("id"));
    const payslip = store.getPayslip(id);
    if (!payslip) return c.notFound();
    if (!canRead(c, payslip.employee_id)) return c.text("Your role does not have access to that.", 403);
    return page(
      c,
      <Layout title={`Payslip ${payslip.period_month}`} active="payroll">
        <PayslipPage payslip={payslip} items={store.listItems(id)} />
      </Layout>,
    );
  });

  app.get("/payslips/:id/print", (c) => {
    const id = Number(c.req.param("id"));
    const payslip = store.getPayslip(id);
    if (!payslip) return c.notFound();
    if (!canRead(c, payslip.employee_id)) return c.text("Your role does not have access to that.", 403);
    return page(
      c,
      <PayslipPrint
        payslip={payslip}
        items={store.listItems(id)}
        company={store.getSettings().company_name}
      />,
    );
  });

  app.post("/payslips/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const payslip = store.getPayslip(id);
    if (!payslip) return c.notFound();
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    try {
      payroll.updatePayslip(id, body);
      auth.audit(currentPrincipal(), "payslip.edit", "payroll", payslip.cycle_id, `${payslip.employee_name} days`);
      return cyclePage(c, payslip.cycle_id);
    } catch (err) {
      return page(
        c,
        <Layout title="Payslip" active="payroll">
          <PayslipPage payslip={payslip} items={store.listItems(id)} error={friendlyError(err)} />
        </Layout>,
      );
    }
  });

  app.post("/payslips/:id/items", async (c) => {
    const id = Number(c.req.param("id"));
    const payslip = store.getPayslip(id);
    if (!payslip) return c.notFound();
    const body = (await c.req.parseBody({ all: true })) as Record<string, unknown>;
    try {
      payroll.replaceItems(id, body);
      auth.audit(currentPrincipal(), "payslip.edit", "payroll", payslip.cycle_id, `${payslip.employee_name} lines`);
      const fresh = store.getPayslip(id);
      return page(
        c,
        <Layout title="Payslip" active="payroll">
          <PayslipPage payslip={fresh ?? payslip} items={store.listItems(id)} />
        </Layout>,
      );
    } catch (err) {
      return page(
        c,
        <Layout title="Payslip" active="payroll">
          <PayslipPage payslip={payslip} items={store.listItems(id)} error={friendlyError(err)} />
        </Layout>,
      );
    }
  });

  function slabsPage(c: Context, error?: string) {
    const settings = store.getSettings();
    const year =
      c.req.query("year") ??
      fiscalYearFor(currentPeriod(config.tzOffsetMinutes), settings.fiscal_year_start_month);
    return page(
      c,
      <Layout title="Tax slabs" active="settings">
        <TaxSlabsPage
          slabs={store.listTaxSlabs(year)}
          fiscalYear={year}
          years={store.listTaxYears()}
          currency={settings.payroll_currency}
          error={error}
        />
      </Layout>,
    );
  }

  app.get("/settings/tax-slabs", (c) => slabsPage(c));

  app.post("/settings/tax-slabs", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    try {
      payroll.addTaxSlab(body);
      auth.audit(currentPrincipal(), "tax.slab", "payroll", null, String(body.fiscal_year ?? ""));
      return slabsPage(c);
    } catch (err) {
      return slabsPage(c, err instanceof ValidationError ? Object.values(err.fields)[0] : friendlyError(err));
    }
  });

  app.delete("/settings/tax-slabs/:id", (c) => {
    payroll.removeTaxSlab(Number(c.req.param("id")));
    return slabsPage(c);
  });

  return app;
}
