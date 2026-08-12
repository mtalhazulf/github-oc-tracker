import type { Store } from "../db/store.ts";
import type { EmployeeInput, EmployeeRow } from "../db/store.ts";
import { ConflictError, NotFoundError, ValidationError } from "../domain/errors.ts";
import { validator } from "../domain/validate.ts";

const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern"] as const;
const STATUSES = ["active", "on_leave", "notice", "exited"] as const;

/** Parse and validate a create/edit form body into a storable employee. */
export function parseEmployee(body: Record<string, unknown>): EmployeeInput {
  const v = validator(body);
  const code = v.code("code", { label: "Employee code", required: true });
  const fullName = v.text("full_name", { label: "Full name", required: true, max: 120 });
  const workEmail = v.email("work_email", { label: "Work email" });
  const joinedOn = v.date("joined_on", { label: "Join date", required: true });
  const exitedOn = v.date("exited_on", { label: "Exit date", required: false });
  const status = v.enum("status", STATUSES, { label: "Status", fallback: "active" });
  const employmentType = v.enum("employment_type", EMPLOYMENT_TYPES, {
    label: "Employment type",
    fallback: "full_time",
  });

  v.check(
    !exitedOn || !joinedOn || exitedOn >= joinedOn,
    "exited_on",
    "Exit date cannot be before the join date.",
  );
  v.check(
    status !== "exited" || exitedOn !== null,
    "exited_on",
    "An exited employee needs an exit date.",
  );

  return v.done({
    code,
    fullName,
    workEmail,
    phone: v.optionalText("phone", { label: "Phone", max: 40 }),
    designation: v.optionalText("designation", { label: "Designation", max: 80 }),
    department: v.optionalText("department", { label: "Department", max: 80 }),
    employmentType,
    joinedOn: joinedOn ?? "",
    exitedOn,
    status,
    notes: v.optionalText("notes", { label: "Notes", max: 2000 }),
  });
}

export function createEmployeeService(store: Store) {
  function assertCodeFree(code: string, exceptId?: number): void {
    const existing = store.getEmployeeByCode(code);
    if (existing && existing.id !== exceptId) {
      const where = existing.archived_at !== null ? " (archived — restore it instead)" : "";
      throw new ConflictError(`Employee code "${code}" is already used by ${existing.full_name}${where}.`);
    }
  }

  return {
    create(body: Record<string, unknown>): EmployeeRow {
      const input = parseEmployee(body);
      assertCodeFree(input.code);
      const id = store.tx(() => {
        const newId = store.insertEmployee(input);
        // A work email is an identity: the person's commits almost certainly carry it.
        if (input.workEmail && !store.findIdentity("email", input.workEmail)) {
          store.insertIdentity({
            employeeId: newId,
            kind: "email",
            value: input.workEmail,
            source: "suggested",
          });
        }
        return newId;
      });
      this.refreshAvatar(id);
      const created = store.getEmployee(id);
      if (!created) throw new NotFoundError("The employee");
      return created;
    },

    update(id: number, body: Record<string, unknown>): EmployeeRow {
      const existing = store.getEmployee(id);
      if (!existing) throw new NotFoundError("That employee");
      const input = parseEmployee(body);
      assertCodeFree(input.code, id);
      store.updateEmployee(id, input);
      const updated = store.getEmployee(id);
      if (!updated) throw new NotFoundError("That employee");
      return updated;
    },

    archive(id: number, archived: boolean): EmployeeRow {
      const existing = store.getEmployee(id);
      if (!existing) throw new NotFoundError("That employee");
      store.archiveEmployee(id, archived);
      const updated = store.getEmployee(id);
      if (!updated) throw new NotFoundError("That employee");
      return updated;
    },

    /**
     * Hard delete, allowed only with no dependents. Payroll history must survive
     * an employee record being removed, so the schema RESTRICTs it and this
     * turns the raw constraint into an explanation.
     */
    remove(id: number): void {
      const existing = store.getEmployee(id);
      if (!existing) throw new NotFoundError("That employee");
      try {
        store.deleteEmployee(id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("FOREIGN KEY")) {
          throw new ConflictError(
            `${existing.full_name} has payroll history and cannot be deleted. Archive them instead.`,
          );
        }
        throw err;
      }
    },

    addCompensation(employeeId: number, body: Record<string, unknown>): void {
      const employee = store.getEmployee(employeeId);
      if (!employee) throw new NotFoundError("That employee");

      const v = validator(body);
      const effectiveFrom = v.date("effective_from", { label: "Effective from", required: true });
      const baseMonthlyMinor = v.money("base_monthly_minor", {
        label: "Monthly salary",
        required: true,
        min: 0,
      });
      const currency = v.currency("currency", {
        label: "Currency",
        fallback: store.getSettings().payroll_currency,
      });
      const reason = v.optionalText("reason", { label: "Reason", max: 200 });
      v.done(null);

      if (effectiveFrom === null || baseMonthlyMinor === null) {
        throw new ValidationError();
      }
      const clash = store
        .listCompensation(employeeId)
        .find((row) => row.effective_from === effectiveFrom);
      if (clash) {
        throw new ConflictError(`There is already a salary record effective ${effectiveFrom}.`);
      }

      store.insertCompensation({
        employeeId,
        effectiveFrom,
        currency,
        baseMonthlyMinor,
        reason,
      });
    },

    removeCompensation(employeeId: number, compensationId: number): void {
      const owned = store.listCompensation(employeeId).some((row) => row.id === compensationId);
      if (!owned) throw new NotFoundError("That salary record");
      store.deleteCompensation(compensationId);
    },

    /** Adopt an avatar already present on the employee's own commits. */
    refreshAvatar(employeeId: number): void {
      const employee = store.getEmployee(employeeId);
      if (!employee || employee.avatar_url) return;
      const url = store.avatarForEmployee(employeeId);
      if (url) store.setEmployeeAvatar(employeeId, url);
    },
  };
}

export type EmployeeService = ReturnType<typeof createEmployeeService>;
