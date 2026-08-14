import type { Store } from "../db/store.ts";
import type { InvoiceRow } from "../db/stores/economics.ts";
import { ConflictError, NotFoundError, ValidationError } from "../domain/errors.ts";
import { periodBounds } from "../domain/period.ts";
import { validator } from "../domain/validate.ts";

const STATUSES = ["draft", "sent", "paid", "void"] as const;

export function mondayOf(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const day = date.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function createEconomicsService(store: Store) {
  return {
    createInvoice(body: Record<string, unknown>): InvoiceRow {
      const input = this.parseInvoice(body);
      if (store.getInvoiceByNumber(input.number)) {
        throw new ConflictError(`Invoice number "${input.number}" is already used.`);
      }
      const id = store.insertInvoice({ ...input, status: "draft" });
      const created = store.getInvoice(id);
      if (!created) throw new NotFoundError("The invoice");
      return created;
    },

    updateInvoice(id: number, body: Record<string, unknown>): InvoiceRow {
      const existing = store.getInvoice(id);
      if (!existing) throw new NotFoundError("That invoice");
      if (existing.status === "paid") {
        throw new ConflictError("A paid invoice cannot be edited. Void it and raise a credit instead.");
      }
      const input = this.parseInvoice(body);
      const clash = store.getInvoiceByNumber(input.number);
      if (clash && clash.id !== id) {
        throw new ConflictError(`Invoice number "${input.number}" is already used.`);
      }
      store.updateInvoice(id, input);
      const updated = store.getInvoice(id);
      if (!updated) throw new NotFoundError("That invoice");
      return updated;
    },

    parseInvoice(body: Record<string, unknown>) {
      const v = validator(body);
      const number = v.text("number", { label: "Invoice number", required: true, max: 40 });
      const clientId = v.int("client_id", { label: "Client", required: true, min: 1 });
      const amountMinor = v.money("amount_minor", { label: "Amount", required: true, min: 0 });
      const issuedOn = v.date("issued_on", { label: "Issue date", required: true });
      const dueOn = v.date("due_on", { label: "Due date", required: true });
      const projectIdRaw = v.int("project_id", { label: "Project", required: false });
      v.check(!dueOn || !issuedOn || dueOn >= issuedOn, "due_on", "Due date cannot be before the issue date.");

      const client = clientId === null ? null : store.getClient(clientId);
      v.check(client !== null, "client_id", "Choose a client that exists.");

      const currency = v.currency("currency", {
        label: "Currency",
        fallback: client?.currency ?? store.getSettings().base_currency,
      });
      const note = v.optionalText("note", { label: "Note", max: 500 });
      v.done(null);

      let projectId: number | null = projectIdRaw && projectIdRaw > 0 ? projectIdRaw : null;
      if (projectId !== null) {
        const project = store.getProject(projectId);
        if (!project || project.client_id !== clientId) {
          throw new ValidationError("That project does not belong to this client.", {
            project_id: "That project does not belong to this client.",
          });
        }
      }

      return {
        number,
        clientId: clientId ?? 0,
        projectId,
        currency,
        amountMinor: amountMinor ?? 0,
        issuedOn: issuedOn ?? "",
        dueOn: dueOn ?? "",
        note,
      };
    },

    setStatus(id: number, status: string, today: string): void {
      const invoice = store.getInvoice(id);
      if (!invoice) throw new NotFoundError("That invoice");
      if (!(STATUSES as readonly string[]).includes(status)) {
        throw new ValidationError("Unknown invoice status.");
      }
      const next = status as InvoiceRow["status"];
      if (invoice.status === "paid" && next !== "void") {
        throw new ConflictError("A paid invoice can only be voided.");
      }
      store.setInvoiceStatus(id, next, next === "paid" ? today : null);
    },

    removeInvoice(id: number): void {
      const invoice = store.getInvoice(id);
      if (!invoice) throw new NotFoundError("That invoice");
      if (invoice.status !== "draft") {
        throw new ConflictError("Only a draft invoice can be deleted — void it instead to keep the record.");
      }
      store.deleteInvoice(id);
    },

    projectPnl(
      projectId: number,
      period: string,
    ): {
      currency: string;
      budgetMinor: number | null;
      invoicedMinor: number;
      collectedMinor: number;
      costMinor: number;
      costCurrency: string | null;
      marginMinor: number | null;
      marginPct: number | null;
    } {
      const project = store.getProject(projectId);
      if (!project) throw new NotFoundError("That project");
      const revenue = store.projectRevenue(projectId);
      const { start, end } = periodBounds(period);
      const costs = store.projectCostForPeriod(period, start, end).filter((c) => c.project_id === projectId);

      const cost = costs.reduce((sum, c) => sum + c.actual_cost_minor, 0);
      const costCurrency = costs[0]?.currency ?? null;
      const comparable = costCurrency === null || costCurrency === project.currency;
      const margin = comparable ? revenue.invoiced_minor - cost : null;

      return {
        currency: project.currency,
        budgetMinor: project.budget_minor,
        invoicedMinor: revenue.invoiced_minor,
        collectedMinor: revenue.collected_minor,
        costMinor: cost,
        costCurrency,
        marginMinor: margin,
        marginPct:
          margin !== null && revenue.invoiced_minor > 0
            ? Math.round((margin / revenue.invoiced_minor) * 1000) / 10
            : null,
      };
    },
  };
}

export type EconomicsService = ReturnType<typeof createEconomicsService>;
