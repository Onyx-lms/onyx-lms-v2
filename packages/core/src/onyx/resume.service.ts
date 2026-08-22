/**
 * O10 -- a resume assembled from what the institution already knows.
 *
 * The requirement asked for "resume optimization". What it does NOT do is
 * write prose on somebody's behalf: there is no language model anywhere in this
 * product, and a paragraph invented about a person's career is a paragraph they
 * have to check line by line before sending it to an employer -- which is more
 * work than writing it, not less.
 *
 * What it does instead is remove the part of resume-writing that is genuinely
 * clerical and genuinely error-prone: remembering what you did. An institution
 * holds the answer already. It knows which programme somebody is reading for,
 * which courses they finished, which skills the evidence awarded them, which
 * certificates it issued them and what they built in their workspaces. A
 * learner typing all of that into a form again is a second copy of a fact,
 * which will disagree with the first within a term.
 *
 * So: DERIVE the whole document on every read, then apply the person's own
 * decisions over the top -- `hidden` subtracts, `extras` adds,
 * `section_order` reorders, `headline_override` and `objective` overlay.
 * Migration 0029's header explains why it is that way round and not the
 * obvious one. The load-bearing consequence: a certificate issued tomorrow is
 * on the resume tomorrow, with nobody pressing anything.
 *
 * Everything here is one person's own. There is no "view a learner's resume"
 * for staff -- `CareerService.profile` already answers that question, for the
 * roles allowed to ask it, and a second projection of the same records is a
 * second place for the permission rule to be wrong.
 */
import type { OnyxDb } from './db.ts';
import type { Role } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import type { AcademicsService } from './academics.service.ts';
import type { CareerService } from './career.service.ts';
import type { TenancyService } from './tenancy.service.ts';
import type { WorkspaceService } from './workspace.service.ts';

/**
 * One literal, not a concatenation. The database client infers the row's shape
 * from this string, and a computed one collapses it to an error type that makes
 * every field `unknown` -- the same trap GATEWAY_COLUMNS_WITH_KEYS documents in
 * checkout.service.ts. It is over the line length the rest of the file keeps to,
 * and breaking it would cost the types.
 */
/* eslint-disable-next-line max-len */
const RESUME_COLUMNS = 'id, tenant_id, user_id, title, objective, headline_override, include_phone, hidden, section_order, extras, created_at, updated_at';

/**
 * The sections, in the order a resume reads by default.
 *
 * Objective first because it is the one thing addressed to the reader.
 * Education before experience because this is a product for people who are
 * still in it -- a graduating student's degree is their strongest line, and
 * the convention of burying it under work history belongs to somebody ten
 * years out.
 */
export const RESUME_SECTIONS = [
  'objective', 'education', 'experience', 'skills', 'courses',
  'certificates', 'projects', 'extras',
] as const;

export type ResumeSection = (typeof RESUME_SECTIONS)[number];

/** One line of a resume, whatever section it is in. */
export interface ResumeItem {
  /** "course:12", "cert:8" -- what `hidden` names. Stable across reads. */
  key: string;
  title: string;
  /** The organisation, the issuer, the language. Empty where there is none. */
  subtitle: string;
  detail: string;
  /** Already formatted for print. A resume shows years, not timestamps. */
  when: string;
}

export interface ResumeDocument {
  name: string;
  headline: string;
  email: string;
  phone: string;
  website: string;
  /**
   * The setting, not whether a number came out.
   *
   * The editor needs both: somebody who has switched this on but has no number
   * on their profile must still see the box ticked, or turning it on looks
   * like it failed and the real problem -- an empty phone field -- goes
   * unmentioned.
   */
  include_phone: boolean;
  location: string;
  institution: string;
  title: string;
  objective: string;
  sections: { key: ResumeSection; label: string; items: ResumeItem[] }[];
  /**
   * Everything the document COULD show, hidden entries included, so an editor
   * can offer a checkbox per item without a second request that would race
   * with this one.
   */
  available: { key: string; label: string; section: ResumeSection }[];
  hidden: string[];
  /**
   * The entries the person typed, as stored.
   *
   * The assembled `sections` above hold these too, already filed into whichever
   * section each names -- but mixed in with the derived items and with a hidden
   * one missing entirely. An editor needs the list itself to offer editing and
   * removal, so it is returned separately rather than reconstructed from a
   * projection that has already thrown information away.
   */
  extras: ResumeExtra[];
  /**
   * The EFFECTIVE order -- what the person chose, then everything they did not
   * name, in the default order. Never the raw stored value, which is usually
   * empty and would make the reorder controls start from nothing.
   */
  section_order: ResumeSection[];
  /**
   * True when a name or headline contains a character the PDF writer cannot
   * set. Not an error -- the screen version is complete either way, and the
   * page says so rather than handing somebody a PDF that spells their name
   * with question marks. See `pdfResume`.
   */
  pdf_will_mangle: boolean;
}

const SECTION_LABELS: Record<ResumeSection, string> = {
  objective: 'Objective',
  education: 'Education',
  experience: 'Experience',
  skills: 'Skills',
  courses: 'Courses',
  certificates: 'Certificates',
  projects: 'Projects',
  extras: 'Also',
};

/**
 * One typed-in entry: a job, a publication, a volunteering stint.
 *
 * `id` is assigned on save and never reused. It exists because `hidden` names
 * items by key, and an extra keyed by its POSITION in the list would move the
 * moment somebody deleted the one above it -- hiding a job and then removing a
 * publication would silently hide something else instead. That was survivable
 * while nothing could delete an extra; the editor can, so the id is the fix.
 */
export interface ResumeExtra {
  id: number;
  section: string;
  title: string;
  detail: string;
  when: string;
}

export interface ResumeOverrides {
  title?: string;
  objective?: string;
  headline_override?: string | null;
  include_phone?: boolean;
  hidden?: string[];
  section_order?: string[];
  extras?: { id?: number; section?: string; title?: string; detail?: string; when?: string }[];
}

/** The year, which is all a resume ever shows. Empty for anything unparseable. */
function year(value: unknown): string {
  const t = Date.parse(String(value ?? ''));
  return Number.isNaN(t) ? '' : String(new Date(t).getUTCFullYear());
}

/**
 * Whether the PDF writer can set this string.
 *
 * The writer is Helvetica/WinAnsi and nothing else, so anything above U+00FF --
 * Devanagari, Tamil, Han -- becomes a question mark. Tolerable on a seating
 * plan. Materially worse when the mangled thing is somebody's own name on a
 * document they are about to send to an employer, which is why this is
 * detected and said rather than silently rendered.
 */
export function isLatin1(value: string): boolean {
  for (const ch of value) if (ch.codePointAt(0)! > 0xff) return false;
  return true;
}

export class ResumeService {
  #db: OnyxDb;
  #academics: AcademicsService;
  #career: CareerService;
  #tenancy: TenancyService;
  #workspaces: WorkspaceService;

  constructor(db: OnyxDb, deps: {
    academics: AcademicsService;
    career: CareerService;
    tenancy: TenancyService;
    workspaces: WorkspaceService;
  }) {
    this.#db = db;
    this.#academics = deps.academics;
    this.#career = deps.career;
    this.#tenancy = deps.tenancy;
    this.#workspaces = deps.workspaces;
  }

  /** The stored decisions, or the defaults for somebody who has made none. */
  async overrides(tenantId: number, userId: string) {
    const { data } = await this.#db.from('onyx_resumes')
      .select(RESUME_COLUMNS)
      .eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
    return data ?? {
      tenant_id: tenantId, user_id: userId,
      title: '', objective: '', headline_override: null, include_phone: false,
      hidden: [] as unknown, section_order: [] as unknown, extras: [] as unknown,
    };
  }

  /**
   * Saves the decisions. Upsert by hand rather than `.upsert()`, because the
   * fake in the unit tests and the real client disagree about the latter and
   * this is two queries either way.
   */
  async save(tenantId: number, userId: string, patch: ResumeOverrides) {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    // Field by field, so an absent key is left alone rather than blanked. The
    // editor sends one section at a time and a whole-object write would mean
    // hiding a course silently discarded an objective typed a minute earlier.
    if (patch.title !== undefined) row.title = String(patch.title).slice(0, 120);
    if (patch.objective !== undefined) row.objective = String(patch.objective).slice(0, 1200);
    if (patch.headline_override !== undefined) {
      row.headline_override = patch.headline_override === null
        ? null : String(patch.headline_override).slice(0, 160);
    }
    if (patch.include_phone !== undefined) row.include_phone = Boolean(patch.include_phone);
    if (patch.hidden !== undefined) row.hidden = [...new Set(patch.hidden.map(String))];
    if (patch.section_order !== undefined) {
      // Only names this build knows. An unknown key would silently drop a
      // whole section from somebody's resume and there would be nothing on
      // screen saying why.
      row.section_order = patch.section_order
        .filter((s) => (RESUME_SECTIONS as readonly string[]).includes(String(s)));
    }
    if (patch.extras !== undefined) {
      // Ids are assigned here and never reused within one resume, so a hidden
      // key keeps pointing at the entry it was written for. `next` starts
      // above every id the request carries rather than above the list length,
      // which would collide with a surviving entry after a deletion.
      let next = patch.extras.reduce(
        (top, e) => Math.max(top, Number.isInteger(e.id) ? Number(e.id) : 0), 0) + 1;
      row.extras = patch.extras.map((e) => ({
        id: Number.isInteger(e.id) && Number(e.id) > 0 ? Number(e.id) : next++,
        section: (RESUME_SECTIONS as readonly string[]).includes(String(e.section))
          ? String(e.section) : 'extras',
        // Trimmed before the length cap and before the emptiness check. A
        // title of three spaces is truthy, so an untrimmed guard stored it --
        // and it printed as a blank line with a date beside it, on a page
        // where there was no control to remove it from.
        title: String(e.title ?? '').trim().slice(0, 200),
        detail: String(e.detail ?? '').trim().slice(0, 1000),
        when: String(e.when ?? '').trim().slice(0, 40),
      })).filter((e) => e.title);
    }

    const { data: existing } = await this.#db.from('onyx_resumes')
      .select('id').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();

    if (existing) {
      const { error } = await this.#db.from('onyx_resumes')
        .update(row).eq('tenant_id', tenantId).eq('id', existing.id);
      if (error) throw new HttpError(500, 'Could not save that: ' + error.message);
    } else {
      const { error } = await this.#db.from('onyx_resumes')
        .insert({ tenant_id: tenantId, user_id: userId, ...row });
      // A second tab saving at the same instant. The unique index caught it;
      // re-reading is the right answer, not an error thrown at somebody who
      // did nothing wrong.
      if (error && !/duplicate key|unique/i.test(String(error.message))) {
        throw new HttpError(500, 'Could not save that: ' + error.message);
      }
    }
    return this.overrides(tenantId, userId);
  }

  /**
   * The whole document.
   *
   * Two of the sections come from CareerService, and from its own methods
   * rather than from a second copy of its queries -- `passport()` is what makes
   * a skill evidence-backed and `certificates()` is what knows a revoked one
   * does not count, and re-implementing either here would be a second,
   * divergent answer to a question this product already answers.
   *
   * NOT `profile()`, which bundles those two with a readiness score. Readiness
   * appears nowhere on a resume, and computing it is six queries and a WRITE --
   * it stores the score it computes. Assembling a resume, or downloading the
   * PDF, would silently rewrite somebody's readiness row every time. A read
   * that writes is a read you cannot put behind a download button.
   */
  async build(tenantId: number, userId: string, viewer: { role: Role; userId: string }) {
    if (viewer.userId !== userId) {
      // Not a permission check with an exception for staff. Staff have
      // `CareerService.profile` for this, and a resume carries a phone number
      // the holder opted into showing to EMPLOYERS.
      throw new HttpError(403, 'A resume is its own author\'s.');
    }

    // They have to be AT this institution. User ids are global, so without
    // this a token for one tenant would assemble a document out of another's
    // programmes -- the same check CareerService.profile makes, for the same
    // reason.
    const { data: membership } = await this.#db.from('onyx_memberships')
      .select('id').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
    if (!membership) throw new HttpError(404, 'You are not at this institution.');

    const [saved, user, skills, certificates, batches, tenant] = await Promise.all([
      this.overrides(tenantId, userId),
      this.#tenancy.profileFor(userId),
      this.#career.passport(tenantId, userId),
      this.#career.certificates(tenantId, userId),
      this.#academics.batchesFor(tenantId, userId),
      this.#tenant(tenantId),
    ]);
    if (!user) throw new HttpError(404, 'No such person.');

    const [enrollments, workspaces] = await Promise.all([
      this.#academics.enrollmentsFor(tenantId, userId),
      this.#workspaces.list(tenantId, userId),
    ]);
    const courses = await this.#academics.coursesByIds(
      tenantId, enrollments.map((e) => Number(e.course_id)), { publishedOnly: true });

    const hidden = new Set((asArray(saved.hidden)).map(String));
    const extras = (asArray(saved.extras) as Partial<ResumeExtra>[]).map((e, i) => ({
      // A row written before ids existed. Numbered by position on the way out
      // rather than migrated: the next save assigns it a real one, and until
      // then it behaves exactly as it did before.
      id: Number.isInteger(e.id) && Number(e.id) > 0 ? Number(e.id) : i + 1,
      section: String(e.section ?? 'extras'),
      title: String(e.title ?? ''),
      detail: String(e.detail ?? ''),
      when: String(e.when ?? ''),
    })).filter((e) => e.title);

    const derived: Record<ResumeSection, ResumeItem[]> = {
      objective: [],

      education: batches.map((b) => ({
        key: 'batch:' + b.batch_id,
        title: b.program ?? b.batch,
        subtitle: String(tenant?.name ?? ''),
        detail: [b.program ? b.batch : null, b.code].filter(Boolean).join(' · '),
        when: b.year ? String(b.year) : year(b.joined_at),
      })),

      // Prose, as one block. 0026's header made the case for keeping it that
      // way and it still holds: a schema for a career is a form with a shape
      // nobody's career fits. `extras` is the way out for anybody who wants
      // discrete entries.
      experience: String(user.experience ?? '').trim()
        ? [{
          key: 'experience',
          title: '', subtitle: '',
          detail: String(user.experience).trim(),
          when: '',
        }]
        : [],

      skills: [
        // Awarded first, because these are the ones with evidence behind them.
        // `level` and the evidence count are what distinguish a skill somebody
        // was assessed on from one they typed, and a resume that flattened the
        // two would throw away the only part of this that an employer cannot
        // get from a self-description.
        ...skills.map((sk) => ({
          key: 'skill:' + Number(sk.skill_id),
          title: String(sk.name),
          subtitle: sk.category ? String(sk.category) : 'Assessed',
          detail: 'Level ' + Number(sk.level) + ' · '
            + sk.evidence_count + (sk.evidence_count === 1 ? ' assessment' : ' assessments'),
          when: year(sk.evidence.map((e) => e.earned_at).sort().at(-1)),
        })),
        // Then what they say about themselves, minus anything already awarded
        // -- a skill listed twice, once with evidence and once without, reads
        // as padding.
        ...String(user.skills_text ?? '').split(',')
          .map((x) => x.trim()).filter(Boolean)
          .filter((x) => !skills.some((a) =>
            String(a.name).toLowerCase() === x.toLowerCase()))
          .map((x) => ({ key: 'declared:' + x.toLowerCase(), title: x,
            subtitle: 'Stated', detail: '', when: '' })),
      ],

      courses: courses.map((c) => ({
        key: 'course:' + Number(c.id),
        title: String(c.title),
        subtitle: String(c.code ?? ''),
        detail: c.credits ? String(c.credits) + ' credits' : '',
        when: '',
      })),

      // A revoked credential is not one you hold. The filter is here rather
      // than in the query because `certificates()` is also what the holder's
      // own certificate list uses, where a revoked row is shown AS revoked.
      certificates: certificates.filter((c) => !c.revoked_at).map((c) => ({
        key: 'cert:' + c.id,
        title: String(c.title),
        subtitle: String(tenant?.name ?? ''),
        detail: String(c.credential_id ?? ''),
        when: year(c.issued_at),
      })),

      projects: workspaces.map((w) => ({
        key: 'project:' + Number(w.id),
        title: String(w.title),
        subtitle: String(w.language ?? ''),
        detail: '',
        when: year(w.updated_at ?? w.created_at),
      })),

      extras: [],
    };

    // Added, then subtracted. Extras carry no key of their own, so they are
    // keyed by position -- which is stable for as long as the list is, and
    // hiding one is not something anybody does with an entry they typed.
    for (const e of extras) {
      const section = (RESUME_SECTIONS as readonly string[]).includes(e.section)
        ? e.section as ResumeSection : 'extras';
      derived[section].push({
        key: 'extra:' + e.id,
        title: e.title,
        subtitle: '',
        detail: e.detail,
        when: e.when,
      });
    }

    const available = RESUME_SECTIONS.flatMap((key) =>
      derived[key].map((item) => ({
        key: item.key,
        label: item.title || SECTION_LABELS[key],
        section: key,
      })));

    const order = orderedSections(asArray(saved.section_order).map(String));
    const objective = String(saved.objective ?? '').trim();

    const sections = order
      .map((key) => ({
        key,
        label: SECTION_LABELS[key],
        items: key === 'objective'
          ? (objective ? [{ key: 'objective', title: '', subtitle: '', detail: objective, when: '' }] : [])
          : derived[key].filter((item) => !hidden.has(item.key)),
      }))
      .filter((s) => s.items.length);

    const name = String(user.name ?? '');
    const headline = saved.headline_override === null || saved.headline_override === undefined
      ? String(user.headline ?? '')
      : String(saved.headline_override);

    return {
      name,
      headline,
      email: String(user.email ?? ''),
      // Opt-in, and 0029's header says why. Absent by default even though the
      // row it comes from has always held it.
      phone: saved.include_phone ? String(user.phone ?? '') : '',
      website: String(user.website ?? ''),
      include_phone: Boolean(saved.include_phone),
      location: '',
      institution: String(tenant?.name ?? ''),
      title: String(saved.title ?? '') || 'Resume',
      objective,
      sections,
      available,
      extras,
      section_order: order,
      hidden: [...hidden],
      pdf_will_mangle: !isLatin1(name) || !isLatin1(headline),
    } satisfies ResumeDocument;
  }

  async #tenant(tenantId: number) {
    const { data } = await this.#db.from('onyx_tenants')
      .select('id, name, slug').eq('id', tenantId).maybeSingle();
    return data;
  }
}

/** A jsonb column that should hold a list, read defensively. */
function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

/**
 * The person's order, then everything they did not name, in the default order.
 *
 * The tail is what matters. A section added in a later release would otherwise
 * vanish for every learner who had ever reordered theirs -- silently, and only
 * for the people who had used the feature.
 */
export function orderedSections(preferred: string[]): ResumeSection[] {
  const known = preferred.filter((s): s is ResumeSection =>
    (RESUME_SECTIONS as readonly string[]).includes(s));
  const seen = new Set(known);
  return [...known, ...RESUME_SECTIONS.filter((s) => !seen.has(s))];
}
