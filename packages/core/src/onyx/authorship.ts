/**
 * Who made this, said in a way a screen can print.
 *
 * Four things in this product record an author -- a question bank, a paper, a
 * sitting and (since 0042) a course module -- and every one of them stored
 * nothing but a uuid. That is the right thing to STORE and useless to show: a
 * bank list that says `created_by: "013ae959-…"` answers nobody's question,
 * and the question being asked is a real one. "Who set this paper" is the
 * first thing said when a question turns out to be wrong, and "did the
 * institution schedule this or did we" is the first thing an operator says
 * about an examination they were not expecting.
 *
 * The role is not stored anywhere and deliberately is not: it is read from the
 * author's membership at the institution the record belongs to, so a lecturer
 * who is later made an administrator reads as an administrator on everything,
 * which is what a person looking at a screen means by "who are they". A
 * creator with NO membership at that institution is the platform operator --
 * which is exactly what the console writing on an institution's behalf looks
 * like in the data, and it needs no second column to say so.
 *
 * One query for the names and one for the roles, however many records are
 * being labelled: the callers are list screens, and a per-row lookup on a
 * page of two hundred banks would be two hundred round trips for a byline.
 */
import type { OnyxDb } from './db.ts';

/** What a screen needs to name somebody: who they are, and what they are here. */
export interface Author {
  id: string;
  name: string;
  email: string | null;
  /**
   * Their standing at THIS institution.
   *
   * `superadmin` is not a membership -- it is the absence of one, which is how
   * the platform operator appears in every institution's data.
   */
  role: 'superadmin' | 'admin' | 'faculty' | 'exams' | 'student' | 'member';
}

/** How the role reads in a sentence, so twelve screens do not each invent one. */
export const AUTHOR_ROLE_LABELS: Record<Author['role'], string> = {
  superadmin: 'Platform',
  admin: 'Administrator',
  faculty: 'Faculty',
  exams: 'Examinations office',
  student: 'Student',
  member: 'Member',
};

/**
 * Resolves a set of author ids to names and roles, in two queries.
 *
 * Unknown ids are simply absent from the map rather than present as a
 * placeholder: a record whose author has been deleted has no author, and a
 * screen saying "Not recorded" is honest where "Unknown user" is not.
 */
export async function authorsOf(
  db: OnyxDb, tenantId: number, ids: readonly (string | null | undefined)[],
): Promise<Map<string, Author>> {
  const wanted = [...new Set(ids.filter((x): x is string => typeof x === 'string' && !!x))];
  const out = new Map<string, Author>();
  if (!wanted.length) return out;

  const [{ data: users }, { data: members }] = await Promise.all([
    db.from('onyx_users').select('id, name, email').in('id', wanted),
    // Their standing HERE. A person can belong to several institutions, so
    // this is scoped to the one whose record is being labelled -- otherwise a
    // lecturer at one and an administrator at another would read as whichever
    // row came back first.
    db.from('onyx_memberships').select('user_id, role, status')
      .eq('tenant_id', tenantId).eq('status', 1).in('user_id', wanted),
  ]);

  const roleOf = new Map<string, Author['role']>();
  for (const m of members ?? []) {
    const role = String(m.role) as Author['role'];
    roleOf.set(String(m.user_id), role in AUTHOR_ROLE_LABELS ? role : 'member');
  }

  for (const u of users ?? []) {
    const id = String(u.id);
    out.set(id, {
      id,
      name: String(u.name ?? '').trim() || 'Unnamed',
      email: u.email ? String(u.email) : null,
      // No membership at this institution: the platform operator, acting for
      // it. See the module docblock.
      role: roleOf.get(id) ?? 'superadmin',
    });
  }
  return out;
}

/**
 * Attaches `author` to each row, reading its id from `created_by`.
 *
 * Returns the same rows widened, so a service can hand its list straight back
 * with a byline on it and no caller has to know how the byline was found.
 */
export async function withAuthors<T extends { created_by?: string | null }>(
  db: OnyxDb, tenantId: number, rows: T[],
): Promise<(T & { author: Author | null })[]> {
  if (!rows.length) return [];
  const found = await authorsOf(db, tenantId, rows.map((r) => r.created_by));
  return rows.map((r) => ({
    ...r,
    author: (r.created_by && found.get(String(r.created_by))) || null,
  }));
}
