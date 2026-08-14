import type { Database } from "bun:sqlite";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { log } from "../logger.ts";

export async function createBackup(db: Database): Promise<{ bytes: Uint8Array; filename: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const target = join(tmpdir(), `oc-backup-${stamp}-${process.pid}.db`);

  db.query("VACUUM INTO ?").run(target);
  try {
    const bytes = new Uint8Array(await Bun.file(target).arrayBuffer());
    log.info("backup created", { bytes: bytes.byteLength });
    return { bytes, filename: `oc-tracker-backup-${stamp}.db` };
  } finally {
    await unlink(target).catch((err) => log.warn("backup temp cleanup failed", { err: String(err) }));
  }
}
