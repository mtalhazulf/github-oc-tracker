import type { Child } from "hono/jsx";
import { fmtDateTime, timeAgo } from "../../format.ts";
import { fmtMoney } from "../../../domain/money.ts";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: Child;
}) {
  return (
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-ink">{title}</h1>
        {subtitle ? <p class="mt-0.5 text-sm text-ink-2">{subtitle}</p> : null}
      </div>
      {actions ? <div class="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, subtitle, actions, children }: { title?: string; subtitle?: string; actions?: Child; children: Child }) {
  return (
    <section class="rounded-lg border border-hairline bg-surface p-4">
      {title ? (
        <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 class="text-sm font-semibold text-ink">{title}</h2>
            {subtitle ? <p class="mt-0.5 text-xs text-ink-2">{subtitle}</p> : null}
          </div>
          {actions ? <div class="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export const btn = {
  primary: "rounded-md bg-accent px-4 py-2 text-sm font-medium text-white",
  secondary: "rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-2 hover:text-ink",
  danger: "rounded-md border border-hairline px-3 py-2 text-sm text-status-critical",
  small: "rounded-md border border-hairline px-3 py-1.5 text-xs text-ink-2 hover:text-ink",
  smallDanger: "rounded-md border border-hairline px-3 py-1.5 text-xs text-status-critical",
};

export const inputCls =
  "w-full rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted";

export function Field({
  name,
  label,
  children,
  error,
  hint,
  required,
  wide,
}: {
  name: string;
  label: string;
  children: Child;
  error?: string | undefined;
  hint?: string;
  required?: boolean;
  wide?: boolean;
}) {
  return (
    <div class={wide ? "sm:col-span-2" : ""}>
      <label for={name} class="mb-1 block text-xs font-medium text-ink-2">
        {label}
        {required ? <span class="text-status-critical"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p class="mt-1 text-xs text-status-critical" id={`${name}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p class="mt-1 text-xs text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({
  name,
  value,
  error,
  type = "text",
  placeholder,
  required,
  ...rest
}: {
  name: string;
  value?: string | number | null;
  error?: string | undefined;
  type?: string;
  placeholder?: string;
  required?: boolean;
  [key: string]: unknown;
}) {
  return (
    <input
      id={name}
      name={name}
      type={type}
      value={value === null || value === undefined ? "" : String(value)}
      placeholder={placeholder}
      required={required}
      aria-invalid={error ? "true" : undefined}
      aria-describedby={error ? `${name}-error` : undefined}
      class={error ? `${inputCls} border-status-critical` : inputCls}
      {...rest}
    />
  );
}

export function Select({
  name,
  value,
  options,
  error,
  placeholder,
}: {
  name: string;
  value?: string | null;
  options: { value: string; label: string }[];
  error?: string | undefined;
  placeholder?: string;
}) {
  return (
    <select
      id={name}
      name={name}
      aria-invalid={error ? "true" : undefined}
      class={error ? `${inputCls} border-status-critical` : inputCls}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option value={o.value} selected={String(value ?? "") === o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: Child }) {
  return (
    <div class="rounded-lg border border-hairline bg-surface p-8 text-center">
      <h2 class="text-base font-semibold text-ink">{title}</h2>
      <p class="mx-auto mt-1.5 max-w-md text-sm text-ink-2">{body}</p>
      {action ? <div class="mt-4 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Badge({ label, tone = "neutral", title }: { label: string; tone?: "neutral" | "good" | "warn" | "critical"; title?: string }) {
  const tones = {
    neutral: "bg-plane text-ink-2",
    good: "bg-plane text-up",
    warn: "bg-plane text-ink-2",
    critical: "bg-plane text-status-critical",
  };
  return (
    <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${tones[tone]}`} title={title}>
      {label}
    </span>
  );
}

export function Table({ head, children }: { head: string[]; children: Child }) {
  return (
    <div class="overflow-x-auto rounded-lg border border-hairline bg-surface px-4 pb-2" tabindex={0}>
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-ink-2">
            {head.map((h, i) => (
              <th class={`py-2 font-medium ${i === head.length - 1 ? "text-right" : "pr-3"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Money({ minor, currency }: { minor: number | null; currency: string }) {
  if (minor === null) return <span class="text-ink-muted">—</span>;
  return <span class="tabular-nums">{fmtMoney(minor, currency)}</span>;
}

export function When({ ts }: { ts: number | null }) {
  if (ts === null) return <span class="text-ink-muted">never</span>;
  return <span title={fmtDateTime(ts)}>{timeAgo(ts)}</span>;
}

export function FormError({ message }: { message?: string | undefined }) {
  if (!message) return <div id="form-error"></div>;
  return (
    <div id="form-error" class="mb-3 rounded-md border border-hairline bg-plane p-3 text-sm text-status-critical" role="alert">
      {message}
    </div>
  );
}
