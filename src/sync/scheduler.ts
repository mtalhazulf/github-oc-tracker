import { config } from "../config.ts";
import { log } from "../logger.ts";
import type { Store } from "../db/store.ts";
import type { SyncService } from "./service.ts";

/**
 * Periodic background sync: re-discovers org repositories and queues
 * incremental commit syncs for every tracked repository.
 */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: Store,
    private readonly sync: SyncService,
  ) {}

  start(): void {
    if (config.syncIntervalMinutes <= 0) {
      log.info("background sync disabled (SYNC_INTERVAL_MINUTES=0)");
      return;
    }
    const ms = config.syncIntervalMinutes * 60_000;
    this.timer = setInterval(() => {
      this.tick().catch((err) => log.error("scheduled sync failed", { err: String(err) }));
    }, ms);
    // Don't keep the process alive just for the scheduler.
    if (typeof this.timer === "object" && "unref" in this.timer) this.timer.unref();
    log.info("background sync scheduled", { everyMinutes: config.syncIntervalMinutes });
    // Catch up on anything never synced (e.g. after a restart mid-sync).
    this.sync.queueAll();
  }

  async tick(): Promise<void> {
    for (const org of this.store.listOrgs()) {
      try {
        await this.sync.discoverOrgRepos(org.id);
      } catch (err) {
        log.error("org discovery failed", { org: org.login, err: String(err) });
      }
    }
    const queued = this.sync.queueAll();
    log.info("scheduled sync tick", { queued });
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
