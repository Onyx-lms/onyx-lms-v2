/**
 * The shapes and small readings the console's invigilation screens share.
 *
 * Kept out of the pages because both of them — the list and the drill-down —
 * count the same four things off the same queue, and two copies of "what
 * counts as flagged" is how a summary card and the table under it come to
 * disagree.
 */

/** One attempt, as the invigilation queue reports it. */
export interface QueueRow {
  attempt_id: number;
  assessment_id: number;
  user_id: string;
  status: string;
  name: string | null;
  roll_number: string | null;
  integrity_flags: number;
  integrity_status: string;
  open_events: number;
  /** null means the attempt has never reported either way — not the same as off. */
  camera_on: boolean | null;
  screen_on: boolean | null;
  requires_camera: boolean;
  requires_screen: boolean;
  /** Whether this paper allows an invigilator to watch the camera live. */
  watch_camera?: boolean;
  tab_switches: number;
  started_at: string | null;
  /**
   * Departures counted against the RULE -- reset when somebody is reinstated,
   * which is deliberately not the same number as `tab_switches`, the total
   * ever recorded. One says how many lives are left, the other says what this
   * candidate has been doing all morning.
   */
  breaches?: number;
  /** Set when the rule stopped the paper. Null on every ordinary attempt. */
  terminated_at?: string | null;
  terminated_reason?: string | null;
}

/** How one sitting is doing, read off its rows. */
export function sittingOf(rows: QueueRow[]): {
  attempts: number; live: number; flagged: number; open: number; worst: number;
} {
  return {
    attempts: rows.length,
    live: rows.filter((r) => r.status === 'in_progress').length,
    flagged: rows.filter((r) => r.integrity_flags > 0).length,
    open: rows.reduce((n, r) => n + Number(r.open_events ?? 0), 0),
    worst: rows.reduce((n, r) => Math.max(n, Number(r.integrity_flags ?? 0)), 0),
  };
}

/**
 * A device, as four states rather than two.
 *
 * "Off", "never said" and "never wanted" are three different things that a
 * boolean flattens into one. Silence on a paper that requires a camera is the
 * loudest of them — somebody is sitting a monitored paper and the browser has
 * never once said the camera is on — and it must not render as a reassuring
 * "not required". The institution's own console draws the same distinction;
 * this is the same rule, written where the console can reach it.
 */
export function device(on: boolean | null, required: boolean, label: string): {
  tone: 'on' | 'off' | 'idle'; text: string;
} {
  if (!required) return { tone: 'idle', text: 'Not required' };
  if (on === null) return { tone: 'off', text: label + ' never reported' };
  return on ? { tone: 'on', text: label + ' on' } : { tone: 'off', text: label + ' OFF' };
}

/**
 * How loud one attempt's flag score is.
 *
 * `REVIEW_THRESHOLD` in the proctor service is 5, so five is the line at which
 * the product itself already says "a human should look at this". The word is
 * always shown beside the band: severity decides whether somebody walks into a
 * hall, and about one man in twelve reads the red and the amber alike.
 */
export function severity(flags: number): {
  label: string; tone: 'late' | 'soon' | 'neutral'; band: 'lo' | 'mid' | 'none';
} {
  if (flags >= 5) return { label: 'High', tone: 'late', band: 'lo' };
  if (flags >= 2) return { label: 'Medium', tone: 'soon', band: 'mid' };
  return { label: 'Low', tone: 'neutral', band: 'none' };
}

/** How a candidate is written on the queue: the number first, then the name. */
export function candidateOf(row: QueueRow): string {
  if (row.roll_number && row.name) return row.roll_number + ' · ' + row.name;
  return row.roll_number || row.name || 'Candidate #' + row.user_id;
}
