interface Props {
  status: string;
  error?: string | null | undefined;
}

export function SyncBadge({ status, error }: Props) {
  switch (status) {
    case "syncing":
      return (
        <span class="inline-flex items-center gap-1 rounded-full bg-plane px-2 py-0.5 text-xs text-ink-2">
          <span class="htmx-spin inline-block">⟳</span> Syncing
        </span>
      );
    case "error":
      return (
        <span
          class="inline-flex items-center gap-1 rounded-full bg-plane px-2 py-0.5 text-xs text-status-critical"
          title={error ?? "Sync failed"}
        >
          ✕ Error
        </span>
      );
    case "pending":
      return (
        <span class="inline-flex items-center gap-1 rounded-full bg-plane px-2 py-0.5 text-xs text-ink-2">
          ○ Pending
        </span>
      );
    default:
      return (
        <span class="inline-flex items-center gap-1 rounded-full bg-plane px-2 py-0.5 text-xs text-up">
          ✓ Synced
        </span>
      );
  }
}
