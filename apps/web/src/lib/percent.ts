/**
 * What a percentage *says*, as distinct from how wide it is drawn.
 *
 * Geometry can round freely -- nobody measures a progress ring against a
 * ruler. The printed number cannot, because it sits inches from the exact
 * figure it was derived from. A mark of 0.5 out of 100 was displayed as
 * `0.5 / 100` and, beside it, `1%`, because `Math.round(0.5)` is 1 in
 * JavaScript: two numbers describing one score, disagreeing, on one card. The
 * accessible name said "Scored 1 percent" too, so the contradiction was
 * available to a screen-reader user without even the visible `0.5 / 100`
 * beside it to resolve which was right.
 *
 * Its own module rather than a helper inside the component file so it can be
 * tested by `node --test`, which cannot strip JSX.
 */

/**
 * Rules, in order:
 *
 *   * a nonzero score never reads as `0%` -- "you scored nothing" is a
 *     different claim from "you scored very little", and only one of them is
 *     true;
 *   * a whole number prints whole, so the ordinary case stays clean;
 *   * anything else keeps one decimal;
 *   * and a score short of full never rounds up into `100`, because claiming
 *     a perfect mark that was not earned is the one error here that somebody
 *     would reasonably complain about.
 */
export function percentText(percent: number): string {
  if (!Number.isFinite(percent)) return '—';
  const clamped = Math.max(0, Math.min(100, percent));
  if (clamped > 0 && Math.round(clamped) === 0) return '<1';
  if (Number.isInteger(clamped)) return String(clamped);
  const oneDp = Math.round(clamped * 10) / 10;
  if (oneDp === 100 && clamped < 100) return '99.9';
  if (oneDp === 0) return '<1';
  return String(oneDp);
}
