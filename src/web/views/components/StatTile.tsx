import { compact } from "../../format.ts";

interface Props {
  label: string;
  value: number;
  delta?: { value: number; period: string } | undefined;
}

export function StatTile({ label, value, delta }: Props) {
  return (
    <div class="rounded-lg border border-hairline bg-surface p-4">
      <div class="text-sm text-ink-2">{label}</div>
      <div class="mt-1 text-2xl font-semibold text-ink">{compact(value)}</div>
      {delta !== undefined ? (
        <div class={`mt-1 text-xs ${delta.value > 0 ? "text-up" : "text-ink-2"}`}>
          {delta.value > 0 ? "▲" : delta.value < 0 ? "▼" : "•"} {delta.value > 0 ? "+" : ""}
          {compact(Math.abs(delta.value))} vs {delta.period}
        </div>
      ) : null}
    </div>
  );
}
