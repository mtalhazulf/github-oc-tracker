export interface ColumnPoint {
  label: string;
  value: number;
  title: string;
}

interface Props {
  points: ColumnPoint[];
  slot?: number;
  height?: number;
  labelEvery?: number;
  ariaLabel?: string;
}

function niceCeil(n: number): number {
  if (n <= 5) return Math.max(1, n);
  const mag = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * mag >= n) return m * mag;
  }
  return 10 * mag;
}

function barPath(x: number, yTop: number, w: number, h: number, baseline: number): string {
  const r = Math.min(4, w / 2, h);
  return [
    `M${x} ${baseline}`,
    `L${x} ${yTop + r}`,
    `Q${x} ${yTop} ${x + r} ${yTop}`,
    `L${x + w - r} ${yTop}`,
    `Q${x + w} ${yTop} ${x + w} ${yTop + r}`,
    `L${x + w} ${baseline}`,
    "Z",
  ].join(" ");
}

export function ColumnChart({ points, slot = 22, height = 170, labelEvery = 1, ariaLabel }: Props) {
  const padLeft = 34;
  const padRight = 6;
  const padTop = 16;
  const padBottom = 20;
  const width = padLeft + points.length * slot + padRight;
  const plotH = height - padTop - padBottom;
  const baseline = padTop + plotH;
  const rawMax = Math.max(0, ...points.map((p) => p.value));
  const yMax = niceCeil(rawMax === 0 ? 1 : rawMax);
  const barW = Math.min(24, Math.max(3, slot - 4));
  const peakIdx = rawMax > 0 ? points.findIndex((p) => p.value === rawMax) : -1;
  const gridYs = [0.5, 1].map((f) => baseline - plotH * f);
  const peak = peakIdx >= 0 ? points[peakIdx] : undefined;
  const summary =
    rawMax === 0
      ? "No commits in this period."
      : `Peak: ${peak?.title ?? ""}. Total ${points.reduce((s, p) => s + p.value, 0).toLocaleString("en-US")} commits.`;

  return (
    <div class="overflow-x-auto" tabindex={0} role="group" aria-label={ariaLabel ?? "Column chart"}>
      <p class="sr-only">{summary}</p>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${ariaLabel ?? "Column chart"}. ${summary}`}
        class="max-w-full"
        font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"
      >
        {gridYs.map((y) => (
          <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="var(--grid)" stroke-width="1" />
        ))}
        <line
          x1={padLeft}
          y1={baseline}
          x2={width - padRight}
          y2={baseline}
          stroke="var(--axis)"
          stroke-width="1"
        />
        <text x={padLeft - 6} y={padTop + 4} text-anchor="end" font-size="10" fill="var(--ink-muted)">
          {yMax.toLocaleString("en-US")}
        </text>
        <text x={padLeft - 6} y={baseline - plotH * 0.5 + 4} text-anchor="end" font-size="10" fill="var(--ink-muted)">
          {(yMax / 2).toLocaleString("en-US")}
        </text>
        <text x={padLeft - 6} y={baseline + 4} text-anchor="end" font-size="10" fill="var(--ink-muted)">
          0
        </text>
        {points.map((p, i) => {
          const x = padLeft + i * slot + (slot - barW) / 2;
          const h = rawMax === 0 ? 0 : (p.value / yMax) * plotH;
          const yTop = baseline - h;
          return (
            <g>
              {p.value > 0 ? (
                <path d={barPath(x, yTop, barW, h, baseline)} fill="var(--series-1)">
                  <title>{p.title}</title>
                </path>
              ) : (
                <rect x={x} y={baseline - 1} width={barW} height={1} fill="var(--grid)">
                  <title>{p.title}</title>
                </rect>
              )}
              {i === peakIdx && h > 0 ? (
                <text
                  x={x + barW / 2}
                  y={yTop - 4}
                  text-anchor="middle"
                  font-size="10"
                  font-weight="600"
                  fill="var(--ink-2)"
                >
                  {p.value.toLocaleString("en-US")}
                </text>
              ) : null}
              {i % labelEvery === 0 ? (
                <text
                  x={padLeft + i * slot + slot / 2}
                  y={height - 6}
                  text-anchor="middle"
                  font-size="9"
                  fill="var(--ink-muted)"
                >
                  {p.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
