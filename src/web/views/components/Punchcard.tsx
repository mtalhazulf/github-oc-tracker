import { WEEKDAY_NAMES, WEEKDAY_ORDER, hourLabel } from "../../format.ts";

interface Props {
  cells: { weekday: number; hour: number; n: number }[];
}

/**
 * Day-of-week × hour-of-day heatmap ("when do commits happen").
 * Sequential single-hue ramp: near-zero recedes toward the surface,
 * the maximum is the strongest step. Native tooltips on every cell.
 */
export function Punchcard({ cells }: Props) {
  const byKey = new Map<string, number>();
  let max = 0;
  for (const c of cells) {
    byKey.set(`${c.weekday}-${c.hour}`, c.n);
    if (c.n > max) max = c.n;
  }
  const bucket = (n: number): number => {
    if (n === 0 || max === 0) return 0;
    return Math.min(7, Math.max(1, Math.ceil((n / max) * 7)));
  };

  return (
    <div class="overflow-x-auto">
      <div class="inline-block min-w-max">
        <div class="grid gap-[2px]" style="grid-template-columns: 34px repeat(24, 18px)">
          {WEEKDAY_ORDER.map((wd) => (
            <>
              <div class="flex h-[18px] items-center pr-2 text-[10px] text-ink-muted">
                {WEEKDAY_NAMES[wd]}
              </div>
              {Array.from({ length: 24 }, (_, hour) => {
                const n = byKey.get(`${wd}-${hour}`) ?? 0;
                const b = bucket(n);
                return (
                  <div
                    class="h-[18px] w-[18px] rounded-[3px]"
                    style={`background: var(--seq-${b})`}
                    title={`${WEEKDAY_NAMES[wd]} ${hourLabel(hour)} — ${n.toLocaleString("en-US")} commit${n === 1 ? "" : "s"}`}
                  ></div>
                );
              })}
            </>
          ))}
          <div></div>
          {Array.from({ length: 24 }, (_, hour) => (
            <div class="pt-1 text-center text-[9px] text-ink-muted">
              {hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}
            </div>
          ))}
        </div>
        <div class="mt-3 flex items-center gap-1 text-[10px] text-ink-muted">
          <span class="mr-1">Less</span>
          {Array.from({ length: 8 }, (_, i) => (
            <span class="h-[10px] w-[10px] rounded-[2px]" style={`background: var(--seq-${i})`}></span>
          ))}
          <span class="ml-1">More</span>
        </div>
      </div>
    </div>
  );
}
