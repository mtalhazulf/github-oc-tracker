import { config } from "../config.ts";

export const tzOffsetSeconds = config.tzOffsetMinutes * 60;

export const tzLabel = (() => {
  const m = config.tzOffsetMinutes;
  if (m === 0) return "UTC";
  const sign = m < 0 ? "-" : "+";
  const abs = Math.abs(m);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
})();

const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});

/** Format an epoch timestamp in the configured display timezone. */
export function fmtDateTime(ts: number): string {
  return `${dateTimeFmt.format(new Date((ts + tzOffsetSeconds) * 1000))} ${tzLabel}`;
}

export function fmtDay(isoDay: string): string {
  return dateFmt.format(new Date(`${isoDay}T00:00:00Z`));
}

export function timeAgo(ts: number, now = Math.floor(Date.now() / 1000)): string {
  const s = Math.max(0, now - ts);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/** 1,284 / 12.9K / 4.2M — compact numbers for stat tiles. */
export function compact(n: number): string {
  if (n < 10_000) return n.toLocaleString("en-US");
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Display rows Monday-first; values are SQLite %w indexes (0 = Sunday). */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

export function firstLine(message: string): string {
  const nl = message.indexOf("\n");
  const line = nl === -1 ? message : message.slice(0, nl);
  return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
