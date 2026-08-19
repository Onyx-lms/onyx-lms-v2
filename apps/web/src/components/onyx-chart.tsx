import { Icon, type IconName } from '@/components/onyx-ui';

/**
 * The one chart shape this product needs: a single measure over time.
 *
 * Written rather than installed. A charting library is 40-90kB of JavaScript to
 * draw eleven rectangles, and every page that would use it here is a server
 * component -- shipping a client bundle to render a static bar chart would be
 * the most expensive thing on the screen. This is SVG, rendered on the server,
 * with no hydration at all.
 *
 * The rules it follows, and why each one:
 *
 *   * ONE series, so there is no legend and no colour key to learn -- the title
 *     names the measure. A second series on a second axis is the single most
 *     common way a dashboard chart lies about correlation, and there is no way
 *     to ask for one here.
 *   * Bars sit ON the baseline with 4px rounded tops. A floating bar reads as a
 *     range; a fully rounded one makes small values look larger than they are,
 *     because the cap is a fixed size the value did not earn.
 *   * A 2px gap of surface between bars, so adjacent days stay countable
 *     without a gridline between them.
 *   * Only the tallest bar is labelled. A number on every bar is a table
 *     pretending to be a chart, and the eye stops reading the shape.
 *   * The axis is one hairline and two end dates. Gridlines behind eleven bars
 *     add ink and answer nothing a hover cannot.
 *   * Every bar carries a <title>, which is a real tooltip in every browser
 *     with no JavaScript, and the whole series is repeated as a table for
 *     screen readers -- colour and height are never the only encoding.
 *
 * Zero is drawn as a 2px stub rather than nothing: a day with no activity is a
 * fact, and an absent bar reads as missing data.
 */

export interface TrendPoint {
  /** Short axis label, e.g. "Mon" or "Aug". */
  label: string;
  /** What a tooltip should say, e.g. "Monday 18 August". */
  full?: string;
  value: number;
}

export function TrendBars({ points, title, unit, height = 108, tone = 'brand' }: {
  points: TrendPoint[];
  /** Names the measure, so no legend is needed. */
  title: string;
  /** Singular noun for the tooltip, e.g. "action" -> "3 actions". */
  unit: string;
  height?: number;
  tone?: 'brand' | 'accent';
}) {
  if (!points.length) return null;

  // A viewBox in abstract units with preserveAspectRatio="none" would stretch
  // the rounded corners; this keeps one unit = one pixel and lets the SVG scale
  // by width only, which is what `w-full` on the element does.
  const W = 640;
  const GAP = 2;
  const slot = W / points.length;
  const bar = Math.max(3, slot - GAP);
  const top = 18;                       // room for the one direct label
  const plot = height - top - 16;       // room for the axis labels underneath
  const peak = Math.max(...points.map((p) => p.value));
  const peakAt = points.findIndex((p) => p.value === peak);
  const scale = (v: number) => (peak <= 0 ? 0 : Math.round((v / peak) * plot));

  const fill = tone === 'accent' ? '#D87818' : '#307890';
  const total = points.reduce((n, p) => n + p.value, 0);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="block h-auto w-full"
        role="img"
        aria-label={title + ': ' + total + ' ' + unit + (total === 1 ? '' : 's')
          + ' across ' + points.length + ' periods, highest '
          + peak + ' on ' + (points[peakAt]?.full ?? points[peakAt]?.label ?? '')}
      >
        {points.map((p, i) => {
          const h = Math.max(2, scale(p.value));
          const y = top + plot - h;
          const x = i * slot + GAP / 2;
          return (
            <g key={p.label + i}>
              {/* The hit area is the whole column, not the bar: a 2-pixel stub
                  for a quiet day is not something anybody can point at. */}
              <rect x={x} y={top} width={bar} height={plot} fill="transparent">
                <title>{(p.full ?? p.label) + ': ' + p.value + ' ' + unit
                  + (p.value === 1 ? '' : 's')}</title>
              </rect>
              <rect
                x={x} y={y} width={bar} height={h} rx={Math.min(4, bar / 2)}
                fill={p.value === 0 ? '#E2E8F0' : fill}
                opacity={p.value === 0 ? 1 : i === peakAt ? 1 : 0.82}
              />
              {i === peakAt && peak > 0 ? (
                <text x={x + bar / 2} y={y - 6} textAnchor="middle"
                  className="fill-ink text-[11px] font-bold" style={{ fontSize: 11 }}>
                  {peak}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* The baseline: one hairline, no gridlines. */}
        <line x1={0} y1={top + plot + 0.5} x2={W} y2={top + plot + 0.5}
          stroke="#E2E8F0" strokeWidth={1} />

        {/* Two dates, not eleven: the ends anchor the range and the tooltip
            answers everything in between. */}
        <text x={0} y={height - 3} className="fill-muted" style={{ fontSize: 11 }}>
          {points[0]!.label}
        </text>
        <text x={W} y={height - 3} textAnchor="end" className="fill-muted" style={{ fontSize: 11 }}>
          {points[points.length - 1]!.label}
        </text>
      </svg>

      {/* The same numbers, for anyone who cannot see the shape. */}
      <figcaption className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead><tr><th scope="col">Period</th><th scope="col">{unit}</th></tr></thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={p.label + i}>
                <th scope="row">{p.full ?? p.label}</th>
                <td>{p.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}

/**
 * A queue row: something that is waiting for a person, with the number waiting
 * and one link to where it is dealt with.
 *
 * This is the part an operator's home screen was missing. Counters tell them
 * how big the institution is; this tells them what has not been done -- draft
 * courses nobody can enrol on, a timetable that was never published, marks
 * entered but not released. Each row is only rendered when its count is
 * non-zero, so an institution with nothing outstanding sees an empty state
 * rather than a list of noughts.
 */
export function QueueRow({ href, icon, title, meta, count, tone = 'neutral' }: {
  href: string;
  icon: IconName;
  title: string;
  meta: string;
  count: number;
  tone?: 'neutral' | 'warn' | 'late';
}) {
  const ring = tone === 'late' ? 'bg-red-50 text-red-700'
    : tone === 'warn' ? 'bg-accent-50 text-accent-700'
      : 'bg-brand-50 text-brand-700';
  return (
    <li>
      <a href={href}
        className="flex items-center gap-3 px-3.5 py-3 transition hover:bg-brand-50/50">
        <span className={'grid h-9 w-9 shrink-0 place-items-center rounded-xl ' + ring}>
          <Icon name={icon} className="h-4.5 w-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">{title}</span>
          <span className="block truncate text-[12.5px] text-muted">{meta}</span>
        </span>
        <span className="shrink-0 text-[17px] font-extrabold tabular-nums">{count}</span>
        <Icon name="chevron" className="h-4 w-4 shrink-0 text-faint" />
      </a>
    </li>
  );
}
