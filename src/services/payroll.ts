import type { Store } from "../db/store.ts";
import type { CycleRow, PayslipRow, TaxSlabRow } from "../db/stores/payroll.ts";
import { ConflictError, NotFoundError, ValidationError } from "../domain/errors.ts";
import { prorate, toMinor } from "../domain/money.ts";
import { isPeriod, periodBounds } from "../domain/period.ts";
import { computeAnnualTax } from "../domain/tax.ts";
import { validator } from "../domain/validate.ts";

/** Which fiscal year a period belongs to, given the year's starting month. */
export function fiscalYearFor(period: string, startMonth: number): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const startYear = month >= startMonth ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function createPayrollService(store: Store) {
  function mustCycle(id: number): CycleRow {
    const cycle = store.getCycle(id);
    if (!cycle) throw new NotFoundError("That payroll cycle");
    return cycle;
  }

  function recalc(payslipId: number): void {
    const payslip = store.getPayslip(payslipId);
    if (!payslip) return;
    const base = prorate(payslip.base_monthly_minor, payslip.payable_days, payslip.period_days);
    const totals = store.itemTotals(payslipId);
    const gross = base + totals.earnings;
    const net = gross - totals.deductions;
    store.setPayslipTotals(payslipId, gross, totals.deductions, net);
  }

  return {
    createCycle(body: Record<string, unknown>): CycleRow {
      const period = String(body.period_month ?? "").trim();
      if (!isPeriod(period)) {
        throw new ValidationError("Enter a period like 2026-07.", {
          period_month: "Enter a period like 2026-07.",
        });
      }
      if (store.getCycleByPeriod(period)) {
        throw new ConflictError(`A payroll cycle for ${period} already exists.`);
      }
      const currency = store.getSettings().payroll_currency;
      const id = store.insertCycle(period, currency, null);
      return mustCycle(id);
    },

    /**
     * Snapshot payslips for the cycle. Idempotent on a draft (replaces), refused
     * on anything else — regenerating an approved or paid month would rewrite
     * history that has already left the building.
     */
    generate(cycleId: number): { created: number; skipped: { name: string; reason: string }[] } {
      const cycle = mustCycle(cycleId);
      if (cycle.status !== "draft") {
        throw new ConflictError(`Only a draft cycle can be generated — this one is ${cycle.status}.`);
      }
      const { start, end } = periodBounds(cycle.period_month);
      const candidates = store.generationCandidates(start, end);
      const settings = store.getSettings();
      const fiscalYear = fiscalYearFor(cycle.period_month, settings.fiscal_year_start_month);
      const slabs: TaxSlabRow[] = store.listTaxSlabs(fiscalYear);
      const skipped: { name: string; reason: string }[] = [];
      let created = 0;

      store.tx(() => {
        store.deletePayslipsForCycle(cycleId);

        for (const candidate of candidates) {
          const isContract = candidate.employment_type === "contract";
          if (candidate.compensation_id === null && !isContract) {
            skipped.push({ name: candidate.full_name, reason: "no compensation on file" });
            continue;
          }
          const base = candidate.base_monthly_minor ?? 0;
          const currency = candidate.currency ?? cycle.currency;
          // A contractor is paid per deliverable: base 0, then an earning line.
          const payableDays = isContract && candidate.compensation_id === null
            ? candidate.period_days
            : candidate.payable_days;

          const payslipId = store.insertPayslip({
            cycleId,
            employeeId: candidate.employee_id,
            compensationId: candidate.compensation_id,
            employeeName: candidate.full_name,
            employeeCode: candidate.code,
            designation: candidate.designation,
            department: candidate.department,
            currency,
            baseMonthlyMinor: base,
            periodDays: candidate.period_days,
            payableDays,
            status: "draft",
          });

          // Tax only when the owner has entered slabs for this fiscal year.
          if (slabs.length > 0 && base > 0) {
            const annualTax = computeAnnualTax(base * 12, slabs);
            const monthly = Math.round(annualTax / 12);
            const prorated = prorate(monthly, payableDays, candidate.period_days);
            if (prorated > 0) {
              store.insertItem(payslipId, {
                kind: "deduction",
                code: "tax",
                label: "Income tax",
                amountMinor: prorated,
              });
            }
          }

          recalc(payslipId);
          created += 1;
        }
        store.markGenerated(cycleId);
      });

      return { created, skipped };
    },

    setStatus(cycleId: number, status: CycleRow["status"]): void {
      const cycle = mustCycle(cycleId);
      const allowed: Record<string, string[]> = {
        draft: ["approved", "cancelled"],
        // Real payroll gets approved on the 28th and corrected on the 29th.
        approved: ["draft", "paid", "cancelled"],
        paid: [],
        cancelled: ["draft"],
      };
      if (!(allowed[cycle.status] ?? []).includes(status)) {
        throw new ConflictError(
          cycle.status === "paid"
            ? "A paid cycle is final. Post a correction as an adjustment on the next cycle."
            : `A ${cycle.status} cycle cannot become ${status}.`,
        );
      }
      if (status === "approved" && cycle.payslip_count === 0) {
        throw new ConflictError("Generate the payslips before approving this cycle.");
      }
      store.tx(() => {
        store.setCycleStatus(cycleId, status);
        // Approving freezes the payslips as documents.
        if (status === "approved") store.finalizePayslipsForCycle(cycleId);
      });
    },

    removeCycle(cycleId: number): void {
      const cycle = mustCycle(cycleId);
      // Checked inside the delete statement itself: the CASCADE to payslips
      // would otherwise erase a paid month with no error.
      const deleted = store.deleteCycleIfDraft(cycleId);
      if (deleted === 0) {
        throw new ConflictError(`Only a draft cycle can be deleted — this one is ${cycle.status}.`);
      }
    },

    updatePayslip(payslipId: number, body: Record<string, unknown>): PayslipRow {
      const payslip = store.getPayslip(payslipId);
      if (!payslip) throw new NotFoundError("That payslip");
      this.assertEditable(payslip);

      const v = validator(body);
      const payableDays = v.int("payable_days", {
        label: "Payable days",
        required: true,
        min: 0,
        max: payslip.period_days,
      });
      const note = v.optionalText("note", { label: "Note", max: 500 });
      v.done(null);

      store.updatePayslipDays(payslipId, payableDays ?? payslip.payable_days, note);
      recalc(payslipId);
      const updated = store.getPayslip(payslipId);
      if (!updated) throw new NotFoundError("That payslip");
      return updated;
    },

    /** Replace the whole item set in one transaction — how a human edits a payslip. */
    replaceItems(payslipId: number, body: Record<string, unknown>): void {
      const payslip = store.getPayslip(payslipId);
      if (!payslip) throw new NotFoundError("That payslip");
      this.assertEditable(payslip);

      const kinds = toArray(body["item_kind"]);
      const labels = toArray(body["item_label"]);
      const amounts = toArray(body["item_amount"]);
      const codes = toArray(body["item_code"]);

      const items: { kind: "earning" | "deduction"; code: string; label: string; amountMinor: number }[] = [];
      for (let i = 0; i < labels.length; i++) {
        const label = (labels[i] ?? "").trim();
        const rawAmount = (amounts[i] ?? "").trim();
        if (label === "" && rawAmount === "") continue;
        if (label === "") {
          throw new ValidationError("Every line needs a label.", { items: "Every line needs a label." });
        }
        let amountMinor: number;
        try {
          amountMinor = toMinor(rawAmount || "0");
        } catch {
          throw new ValidationError(`"${rawAmount}" is not a valid amount.`, {
            items: `"${rawAmount}" is not a valid amount.`,
          });
        }
        if (amountMinor < 0) {
          throw new ValidationError("Amounts cannot be negative — use a deduction line instead.", {
            items: "Amounts cannot be negative — use a deduction line instead.",
          });
        }
        items.push({
          kind: kinds[i] === "deduction" ? "deduction" : "earning",
          code: (codes[i] ?? "other").trim() || "other",
          label,
          amountMinor,
        });
      }

      store.tx(() => {
        store.replaceItems(payslipId, items);
        recalc(payslipId);
      });
    },

    assertEditable(payslip: PayslipRow): void {
      if (payslip.cycle_status && payslip.cycle_status !== "draft") {
        throw new ConflictError(
          `This payslip belongs to a ${payslip.cycle_status} cycle and can no longer be edited.`,
        );
      }
    },

    // ---- tax slabs ----

    addTaxSlab(body: Record<string, unknown>): void {
      const v = validator(body);
      const fiscalYear = v.text("fiscal_year", { label: "Fiscal year", required: true, max: 12 });
      const lower = v.money("lower_annual_minor", { label: "Income from", required: true, min: 0 });
      const fixed = v.money("fixed_annual_minor", { label: "Fixed amount", min: 0 }) ?? 0;
      const ratePct = Number(String(body.rate_pct ?? "0").trim() || "0");
      if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) {
        v.check(false, "rate_pct", "Enter a rate between 0 and 100.");
      }
      v.done(null);
      store.insertTaxSlab({
        fiscalYear,
        lowerAnnualMinor: lower ?? 0,
        fixedAnnualMinor: fixed,
        rateBp: Math.round(ratePct * 100),
      });
    },

    removeTaxSlab(id: number): void {
      store.deleteTaxSlab(id);
    },

    /** CSV for the bank portal and the accountant. */
    cycleCsv(cycleId: number): string {
      const cycle = mustCycle(cycleId);
      const rows = store.listPayslips(cycleId).filter((p) => p.status !== "excluded");
      const header = [
        "code",
        "name",
        "designation",
        "department",
        "currency",
        "base",
        "period_days",
        "payable_days",
        "gross",
        "deductions",
        "net",
      ];
      const lines = [header.join(",")];
      for (const p of rows) {
        lines.push(
          [
            p.employee_code,
            p.employee_name,
            p.designation ?? "",
            p.department ?? "",
            p.currency,
            (p.base_monthly_minor / 100).toFixed(2),
            String(p.period_days),
            String(p.payable_days),
            (p.gross_minor / 100).toFixed(2),
            (p.deductions_minor / 100).toFixed(2),
            (p.net_minor / 100).toFixed(2),
          ]
            .map(csvCell)
            .join(","),
        );
      }
      return `${lines.join("\r\n")}\r\n# payroll ${cycle.period_month}\r\n`;
    },
  };
}

export type PayrollService = ReturnType<typeof createPayrollService>;

function toArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v));
  return [String(value)];
}

/** Excel-safe CSV cell: quote when needed, and neutralise formula injection. */
export function csvCell(value: string): string {
  let out = value;
  if (/^[=+\-@]/.test(out)) out = `'${out}`;
  if (/[",\r\n]/.test(out)) out = `"${out.replace(/"/g, '""')}"`;
  return out;
}
