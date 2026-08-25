/**
 * Who somebody is, in the two forms an institution actually uses.
 *
 * A name and the institution's own number for them -- roll number, enrolment
 * number, staff ID. Six different screens need exactly this pair and each was
 * resolving it separately: a `.in('id', ids)` against `onyx_users` for the
 * name, and nothing at all for the number, because until 0022 there was no
 * number to resolve.
 *
 * Written once here rather than six times, for a reason beyond tidiness: the
 * two fields live on two tables. The name is on the account (`onyx_users`),
 * which is shared across institutions; the roll number is on the membership
 * (`onyx_memberships`), which is not. Every caller that only remembered the
 * first would silently show a name where the register, the script and the
 * seating plan all say a number -- which is how the product came to render
 * "Candidate #null" and raw uuids in the first place.
 *
 * Two queries, never a join: `created_by`-style columns are nullable and an
 * inner join would drop exactly the rows that need a fallback, and the
 * membership may be absent for somebody who has left.
 */
import type { OnyxDb } from './db.ts';

export interface Person {
  user_id: string;
  name: string;
  /** The institution's own number. Null where it does not use them. */
  roll_number: string | null;
  /**
   * The teaching division, named.
   *
   * Every screen that lists submissions now shows it, so it is read here with
   * the name and the roll number rather than by each of them separately -- a
   * marker looking at a script wants "Alpha-CSE", not a section id, and a
   * fourth query per screen to turn one into the other.
   */
  section: string | null;
}

/** What to show when an account has gone but its work has not. */
export const UNKNOWN_PERSON = 'Unknown';

/**
 * Names and roll numbers for a set of people, in one pair of queries.
 *
 * Returns a Map keyed by user id as a string. Ids are Supabase Auth uuids;
 * `String()` rather than `Number()` throughout, which is the coercion that
 * produced `NaN` and then `null` on the invigilation queue.
 */
export async function peopleFor(
  db: OnyxDb, tenantId: number, userIds: (string | number | null | undefined)[],
): Promise<Map<string, Person>> {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  const out = new Map<string, Person>();
  if (!ids.length) return out;

  const [{ data: users }, { data: memberships }] = await Promise.all([
    db.from('onyx_users').select('id, name').in('id', ids),
    db.from('onyx_memberships')
      .select('user_id, roll_number, section_id').eq('tenant_id', tenantId).in('user_id', ids),
  ]);

  const rollOf = new Map((memberships ?? [])
    .map((m) => [String(m.user_id), (m.roll_number ?? null) as string | null]));

  // Named once for the whole set rather than joined per person.
  const sectionIds = [...new Set((memberships ?? [])
    .map((m) => m.section_id).filter((x) => x != null).map(Number))];
  const { data: sectionRows } = sectionIds.length
    ? await db.from('onyx_sections').select('id, name')
      .eq('tenant_id', tenantId).in('id', sectionIds)
    : { data: [] as { id: number; name: string }[] };
  const sectionName = new Map((sectionRows ?? [])
    .map((sx) => [Number(sx.id), String(sx.name)]));
  const sectionOf = new Map((memberships ?? []).map((m) => [
    String(m.user_id),
    m.section_id == null ? null : sectionName.get(Number(m.section_id)) ?? null,
  ]));

  for (const id of ids) {
    const user = (users ?? []).find((u) => String(u.id) === id);
    out.set(id, {
      user_id: id,
      name: user?.name ? String(user.name) : UNKNOWN_PERSON,
      roll_number: rollOf.get(id) ?? null,
      section: sectionOf.get(id) ?? null,
    });
  }
  return out;
}

/**
 * Roll order.
 *
 * A paper register, a marks list and a seating plan are all read "in roll
 * order", and an institution that has gone to the trouble of numbering people
 * expects the screen to agree with the sheet in their hand. Anyone without a
 * number sorts last by name rather than first -- an unnumbered row at the top
 * of a numbered list reads as an error.
 *
 * Numeric-aware, because CS-2 belongs before CS-10 and a plain string
 * comparison puts it after.
 */
export function byRoll(a: Person | undefined, b: Person | undefined): number {
  const ra = a?.roll_number ?? null;
  const rb = b?.roll_number ?? null;
  if (ra && rb) {
    return ra.localeCompare(rb, undefined, { numeric: true, sensitivity: 'base' });
  }
  if (ra) return -1;
  if (rb) return 1;
  return (a?.name ?? '').localeCompare(b?.name ?? '');
}

/**
 * How a person is written on a list that has room for both.
 *
 * The number first, because that is what somebody is scanning for when they
 * have a script or a register in front of them, and the name after it so the
 * row is still readable by a person who thinks in names.
 */
export function labelFor(person: Person | undefined, fallback = UNKNOWN_PERSON): string {
  if (!person) return fallback;
  return person.roll_number ? person.roll_number + ' · ' + person.name : person.name;
}
