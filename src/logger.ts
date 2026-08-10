import { config } from "./config.ts";

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel];

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString();
  if (config.logFormat === "json") {
    const line = JSON.stringify({ ts, level, msg, ...fields });
    if (level === "error") console.error(line);
    else console.log(line);
  } else {
    const extra = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
    const line = `${ts} [${level.toUpperCase().padEnd(5)}] ${msg}${extra}`;
    if (level === "error") console.error(line);
    else console.log(line);
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
