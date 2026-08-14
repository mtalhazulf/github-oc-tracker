import type { Store } from "../db/store.ts";
import type { ClientInput, ClientRow, ProjectInput, ProjectRow } from "../db/store.ts";
import { ConflictError, NotFoundError, ValidationError } from "../domain/errors.ts";
import { validator } from "../domain/validate.ts";

const CLIENT_STATUSES = ["prospect", "active", "paused", "churned"] as const;
const PROJECT_KINDS = ["client", "internal_product", "internal_ops"] as const;
const PROJECT_STATUSES = ["discovery", "active", "paused", "completed", "cancelled"] as const;
const BILLING_MODELS = ["fixed_price", "time_materials", "retainer", "none"] as const;

export function parseClient(body: Record<string, unknown>, fallbackCurrency: string): ClientInput {
  const v = validator(body);
  const name = v.text("name", { label: "Client name", required: true, max: 120 });
  const code = v.code("code", { label: "Client code", required: true });
  return v.done({
    name,
    code,
    status: v.enum("status", CLIENT_STATUSES, { label: "Status", fallback: "active" }),
    currency: v.currency("currency", { label: "Currency", fallback: fallbackCurrency }),
    country: v.optionalText("country", { label: "Country", max: 60 }),
    website: v.optionalText("website", { label: "Website", max: 200 }),
    contactName: v.optionalText("contact_name", { label: "Contact name", max: 120 }),
    contactEmail: v.email("contact_email", { label: "Contact email" }),
    billingEmail: v.email("billing_email", { label: "Billing email" }),
    billingAddress: v.optionalText("billing_address", { label: "Billing address", max: 500 }),
    taxId: v.optionalText("tax_id", { label: "Tax id", max: 60 }),
    paymentTermsDays: v.int("payment_terms_days", { label: "Payment terms", min: 0, max: 365 }) ?? 30,
    notes: v.optionalText("notes", { label: "Notes", max: 2000 }),
  });
}

export function parseProject(body: Record<string, unknown>, fallbackCurrency: string): ProjectInput {
  const v = validator(body);
  const code = v.code("code", { label: "Project code", required: true });
  const name = v.text("name", { label: "Project name", required: true, max: 120 });
  const kind = v.enum("kind", PROJECT_KINDS, { label: "Project type", fallback: "client" });
  const clientId = v.int("client_id", { label: "Client", required: false });
  const billingModel = v.enum("billing_model", BILLING_MODELS, {
    label: "Billing model",
    fallback: kind === "client" ? "time_materials" : "none",
  });
  const startOn = v.date("start_on", { label: "Start date", required: false });
  const endOn = v.date("end_on", { label: "End date", required: false });

  v.check(
    kind !== "client" || (clientId !== null && clientId > 0),
    "client_id",
    "A client project needs a client.",
  );
  v.check(
    kind === "client" || clientId === null || clientId === 0,
    "client_id",
    "Internal work cannot belong to a client.",
  );
  v.check(
    kind === "client" || billingModel === "none",
    "billing_model",
    "Internal work is not billed, so its billing model must be “none”.",
  );
  v.check(!endOn || !startOn || endOn >= startOn, "end_on", "End date cannot be before the start date.");

  return v.done({
    code,
    name,
    kind,
    clientId: kind === "client" ? clientId : null,
    status: v.enum("status", PROJECT_STATUSES, { label: "Status", fallback: "active" }),
    billingModel,
    currency: v.currency("currency", { label: "Currency", fallback: fallbackCurrency }),
    budgetMinor: v.money("budget_minor", { label: "Budget", min: 0 }),
    rateHourlyMinor: v.money("rate_hourly_minor", { label: "Hourly rate", min: 0 }),
    retainerMonthlyMinor: v.money("retainer_monthly_minor", { label: "Monthly retainer", min: 0 }),
    startOn,
    endOn,
    managerId: v.int("manager_id", { label: "Project manager", required: false }) || null,
    notes: v.optionalText("notes", { label: "Notes", max: 2000 }),
  });
}

export function createDeliveryService(store: Store) {
  const currency = () => store.getSettings().base_currency;

  return {
    createClient(body: Record<string, unknown>): ClientRow {
      const input = parseClient(body, currency());
      const existing = store.getClientByCode(input.code);
      if (existing) {
        throw new ConflictError(
          `Client code "${input.code}" is already used by ${existing.name}${existing.archived_at !== null ? " (archived — restore it instead)" : ""}.`,
        );
      }
      const id = store.insertClient(input);
      const created = store.getClient(id);
      if (!created) throw new NotFoundError("The client");
      return created;
    },

    updateClient(id: number, body: Record<string, unknown>): ClientRow {
      const existing = store.getClient(id);
      if (!existing) throw new NotFoundError("That client");
      const input = parseClient(body, currency());
      const clash = store.getClientByCode(input.code);
      if (clash && clash.id !== id) {
        throw new ConflictError(`Client code "${input.code}" is already used by ${clash.name}.`);
      }
      store.updateClient(id, input);
      const updated = store.getClient(id);
      if (!updated) throw new NotFoundError("That client");
      return updated;
    },

    archiveClient(id: number, archived: boolean): void {
      if (!store.getClient(id)) throw new NotFoundError("That client");
      store.archiveClient(id, archived);
    },

    removeClient(id: number): void {
      const existing = store.getClient(id);
      if (!existing) throw new NotFoundError("That client");
      const projects = store.listProjects({ clientId: id, includeArchived: true });
      if (projects.length > 0) {
        throw new ConflictError(
          `${existing.name} still has ${projects.length} ${projects.length === 1 ? "project" : "projects"}. Archive the client instead, or move the projects first.`,
        );
      }
      store.deleteClient(id);
    },

    createProject(body: Record<string, unknown>): ProjectRow {
      const input = parseProject(body, currency());
      const existing = store.getProjectByCode(input.code);
      if (existing) {
        throw new ConflictError(
          `Project code "${input.code}" is already used by ${existing.name}${existing.archived_at !== null ? " (archived — restore it instead)" : ""}.`,
        );
      }
      if (input.clientId !== null && !store.getClient(input.clientId)) {
        throw new ValidationError("Choose a client that exists.", { client_id: "Choose a client that exists." });
      }
      const id = store.insertProject(input);
      const created = store.getProject(id);
      if (!created) throw new NotFoundError("The project");
      return created;
    },

    updateProject(id: number, body: Record<string, unknown>): ProjectRow {
      const existing = store.getProject(id);
      if (!existing) throw new NotFoundError("That project");
      const input = parseProject(body, currency());
      const clash = store.getProjectByCode(input.code);
      if (clash && clash.id !== id) {
        throw new ConflictError(`Project code "${input.code}" is already used by ${clash.name}.`);
      }
      store.updateProject(id, input);
      const updated = store.getProject(id);
      if (!updated) throw new NotFoundError("That project");
      return updated;
    },

    archiveProject(id: number, archived: boolean): void {
      if (!store.getProject(id)) throw new NotFoundError("That project");
      store.archiveProject(id, archived);
    },

    removeProject(id: number): void {
      if (!store.getProject(id)) throw new NotFoundError("That project");
      store.deleteProject(id);
    },

    linkRepo(projectId: number, repoId: number, makePrimary: boolean): void {
      const project = store.getProject(projectId);
      if (!project) throw new NotFoundError("That project");
      const repo = store.getRepo(repoId);
      if (!repo) throw new NotFoundError("That repository");

      const holders = store.projectsForRepo(repoId);
      const primaryHolder = holders.find((h) => h.is_primary === 1 && h.project_id !== projectId);
      const wantsPrimary = makePrimary || holders.length === 0;

      store.tx(() => {
        store.linkRepo(projectId, repoId, false);
        if (wantsPrimary && !primaryHolder) store.setPrimaryRepo(projectId, repoId);
      });

      if (makePrimary && primaryHolder) {
        throw new ConflictError(
          `${repo.full_name} is linked, but ${primaryHolder.name} still holds its primary link. Use “Make primary” to move it.`,
        );
      }
    },

    async linkRepoByName(
      projectId: number,
      fullName: string,
      addRepo: (fullName: string) => Promise<{ id: number }>,
    ): Promise<void> {
      const existing = store.getRepoByFullName(fullName.trim());
      const repoId = existing ? existing.id : (await addRepo(fullName)).id;
      this.linkRepo(projectId, repoId, false);
    },

    unlinkRepo(projectId: number, repoId: number): void {
      store.unlinkRepo(projectId, repoId);
    },

    setPrimaryRepo(projectId: number, repoId: number): void {
      const linked = store.listProjectRepos(projectId).some((r) => r.repo_id === repoId);
      if (!linked) throw new NotFoundError("That repository link");
      store.setPrimaryRepo(projectId, repoId);
    },

    addAssignment(projectId: number, body: Record<string, unknown>): void {
      const project = store.getProject(projectId);
      if (!project) throw new NotFoundError("That project");

      const v = validator(body);
      const employeeId = v.int("employee_id", { label: "Person", required: true, min: 1 });
      const allocationPct = v.int("allocation_pct", { label: "Allocation", min: 1, max: 100 }) ?? 100;
      const startOn = v.date("start_on", { label: "Start date", required: true });
      const endOn = v.date("end_on", { label: "End date", required: false });
      const role = v.optionalText("role", { label: "Role", max: 80 });
      v.check(!endOn || !startOn || endOn >= startOn, "end_on", "End date cannot be before the start date.");
      v.done(null);

      if (employeeId === null || startOn === null) throw new ValidationError();
      if (!store.getEmployee(employeeId)) {
        throw new ValidationError("Choose a person who exists.", { employee_id: "Choose a person who exists." });
      }

      store.insertAssignment({ projectId, employeeId, role, allocationPct, startOn, endOn });
    },

    removeAssignment(projectId: number, assignmentId: number): void {
      const owned = store.listAssignments(projectId).some((a) => a.id === assignmentId);
      if (!owned) throw new NotFoundError("That assignment");
      store.deleteAssignment(assignmentId);
    },
  };
}

export type DeliveryService = ReturnType<typeof createDeliveryService>;
