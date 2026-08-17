/**
 * CAR-03 / CAR-05 -- certificates, the skills passport and the readiness score.
 *
 * "From learning to employability."
 *
 * Three rules, each because this is where the platform starts making claims
 * about people to strangers:
 *
 *   * **A credential id is a capability, not a serial number.** The
 *     verification page is public, so the id is 32 random hex characters and
 *     the page returns only what a stranger is entitled to see. A sequential
 *     id would let anyone enumerate an institution's graduates.
 *   * **Every skill records what earned it.** CAR-05a's acceptance criterion is
 *     that each links to its evidence, so a skill is one row per piece of
 *     evidence rather than a level somebody typed.
 *   * **The readiness formula is published and stored.** A score nobody can
 *     explain is a score nobody should act on -- so the weights in force are
 *     saved with the score, and the breakdown is returned to the learner.
 */
import { randomBytes } from 'node:crypto';
import type { OnyxDb } from './db.ts';
import type { Role } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import { pdfCertificate } from '../format/pdf.ts';
import { slugify } from '../authoring/slug.ts';
import type { AcademicsService } from './academics.service.ts';
import type { AttendanceService } from './attendance.service.ts';

const CERTIFICATE_COLUMNS = 'id, tenant_id, user_id, kind, course_id, assessment_id, title, credential_id, issued_at, expires_at, revoked_at, revoked_reason, issued_by, detail';
const SKILL_COLUMNS = 'id, tenant_id, name, slug, category, created_at';
const LEARNER_SKILL_COLUMNS = 'id, tenant_id, user_id, skill_id, source_type, source_id, strength, evidence, earned_at';
const READINESS_COLUMNS = 'id, tenant_id, user_id, score, breakdown, formula, computed_at';

export type CertificateKind = 'course' | 'assessment' | 'contest' | 'program';
export type SkillSource = 'course' | 'assessment' | 'problem' | 'workspace' | 'certificate' | 'contest';

/**
 * The readiness formula, in one place and by name.
 *
 * Published rather than tuned in secret: a learner is told the weights, so
 * "why is my score 61" has an answer they can act on. Weights sum to 100.
 */
export const READINESS_WEIGHTS = {
  attendance: 20,
  assessment: 30,
  practice: 20,
  projects: 15,
  interview: 15,
} as const;

export const READINESS_LABELS: Record<keyof typeof READINESS_WEIGHTS, string> = {
  attendance: 'Attendance',
  assessment: 'Assessment results',
  practice: 'Code Lab practice',
  projects: 'Project work',
  interview: 'Mock interviews',
};

export interface ReadinessComponent {
  key: keyof typeof READINESS_WEIGHTS;
  label: string;
  weight: number;
  /** 0..1, what they achieved on this component. */
  raw: number;
  /** raw * weight, rounded to two places. */
  points: number;
  /** The counts behind `raw`, so the learner sees the working. */
  detail: Record<string, number>;
}

/** 32 hex characters. Long enough that guessing one is not a strategy. */
export function newCredentialId(): string {
  return randomBytes(16).toString('hex').toUpperCase();
}

export class CareerService {
  #db: OnyxDb;
  #academics: AcademicsService;
  #attendance: AttendanceService;
  #now: () => number;

  constructor(
    db: OnyxDb, academics: AcademicsService, attendance: AttendanceService,
    now: () => number = Date.now,
  ) {
    this.#db = db;
    this.#academics = academics;
    this.#attendance = attendance;
    this.#now = now;
  }

  // -------------------------------------------------------------------------
  // CAR-03 -- certificates
  // -------------------------------------------------------------------------

  async issueCertificate(tenantId: number, issuedBy: string, input: {
    user_id: string; title: string; kind?: CertificateKind;
    course_id?: number | null; assessment_id?: number | null;
    detail?: Record<string, unknown>; expires_at?: string | null;
  }) {
    const kind = input.kind ?? 'course';
    if (input.course_id) await this.#academics.course(tenantId, input.course_id);

    // Nothing personal beyond the holder's name ever goes on a public page, so
    // the detail a caller supplies is filtered rather than trusted.
    const detail = pickPublicDetail(input.detail ?? {});

    const { data, error } = await this.#db.from('onyx_certificates').insert({
      tenant_id: tenantId,
      user_id: input.user_id,
      kind,
      course_id: input.course_id ?? null,
      assessment_id: input.assessment_id ?? null,
      title: input.title.trim(),
      credential_id: newCredentialId(),
      expires_at: input.expires_at ?? null,
      issued_by: issuedBy,
      detail: detail as never,
    }).select(CERTIFICATE_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not issue the certificate: ' + error.message);
    return data!;
  }

  async certificates(tenantId: number, userId: string) {
    const { data } = await this.#db.from('onyx_certificates')
      .select(CERTIFICATE_COLUMNS)
      .eq('tenant_id', tenantId).eq('user_id', userId)
      .order('issued_at', { ascending: false });
    return data ?? [];
  }

  /**
   * Everything this institution has issued.
   *
   * Staff-facing, and the counterpart to `certificates()` above: a registrar
   * cannot revoke what they cannot find, and until this existed the only way
   * to see an issued credential was to already know whose it was. Newest
   * first, because the reason someone opens this list is almost always the
   * thing that was issued a moment ago.
   */
  async issuedCertificates(tenantId: number, opts: { userId?: string } = {}) {
    let q = this.#db.from('onyx_certificates')
      .select(CERTIFICATE_COLUMNS).eq('tenant_id', tenantId);
    if (opts.userId) q = q.eq('user_id', opts.userId);
    const { data } = await q.order('issued_at', { ascending: false });
    return data ?? [];
  }

  /**
   * The public verification page.
   *
   * Deliberately NOT tenant-scoped: a stranger holding a credential has no idea
   * which institution issued it, and asking them to know would make the feature
   * useless. The credential id is the capability, and what comes back is the
   * minimum that makes a credential checkable -- the holder's name, what it is
   * for, who issued it, and whether it still stands.
   */
  async verify(credentialId: string) {
    const { data } = await this.#db.from('onyx_certificates')
      .select(CERTIFICATE_COLUMNS)
      .eq('credential_id', credentialId.trim().toUpperCase()).maybeSingle();
    // The same answer for "never existed" and "malformed": a verifier learns
    // only whether the credential in their hand is good.
    if (!data) return { valid: false as const, reason: 'not_found' as const };

    const [{ data: tenant }, { data: holder }] = await Promise.all([
      this.#db.from('onyx_tenants').select('id, name').eq('id', data.tenant_id).maybeSingle(),
      // Name only. Not the email, not the id, not the cohort.
      this.#db.from('onyx_users').select('name').eq('id', data.user_id).maybeSingle(),
    ]);

    const now = this.#now();
    const expired = Boolean(data.expires_at) && now > Date.parse(data.expires_at!);
    const revoked = Boolean(data.revoked_at);

    return {
      valid: !expired && !revoked,
      reason: revoked ? ('revoked' as const) : expired ? ('expired' as const) : ('valid' as const),
      credential_id: data.credential_id,
      title: data.title,
      // The holder's name and nothing else about them: no email, no id, no
      // cohort, no marks beyond what the issuer chose to state.
      holder: holder?.name ?? null,
      issuer: tenant?.name ?? null,
      issued_at: data.issued_at,
      expires_at: data.expires_at,
      revoked_at: data.revoked_at,
      detail: data.detail,
    };
  }

  /**
   * CAR-03 -- the credential as a file.
   *
   * "Verifiable, shareable." The verification page made it verifiable from the
   * first day; shareable meant a URL, and a URL is not what a graduate attaches
   * to an application. This is.
   *
   * A revoked or expired credential still renders. Refusing would leave the
   * holder of a withdrawn certificate with nothing to explain, and the document
   * says on its face that the page is the evidence -- which will tell any
   * verifier the truth whatever the paper says.
   */
  async certificatePdf(tenantId: number, id: number, opts: {
    viewer?: { userId: string; role: Role };
    baseUrl?: string;
  } = {}): Promise<{ file: Buffer; filename: string }> {
    const { data } = await this.#db.from('onyx_certificates')
      .select(CERTIFICATE_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Certificate not found.');

    // A holder may take their own; an issuer may take anyone's. Nobody else.
    if (opts.viewer
      && String(data.user_id) !== opts.viewer.userId
      && !['admin', 'exams', 'placement'].includes(opts.viewer.role)) {
      throw new HttpError(403, 'That is not your certificate.');
    }

    const [{ data: tenant }, { data: holder }] = await Promise.all([
      this.#db.from('onyx_tenants').select('id, name').eq('id', tenantId).maybeSingle(),
      this.#db.from('onyx_users').select('name').eq('id', data.user_id).maybeSingle(),
    ]);

    const day = (iso: string | null | undefined) => (iso
      ? new Date(iso).toLocaleDateString('en-GB',
        { day: 'numeric', month: 'long', year: 'numeric' })
      : null);

    const base = (opts.baseUrl ?? 'http://127.0.0.1:5173').replace(/\/+$/, '');
    return {
      file: pdfCertificate({
        issuer: tenant?.name ?? 'Onyx',
        holder: holder?.name ?? 'The holder',
        title: String(data.title),
        kind: String(data.kind),
        credentialId: String(data.credential_id),
        issuedAt: day(data.issued_at) ?? '',
        expiresAt: day(data.expires_at),
        verifyUrl: base + '/onyx/verify/' + data.credential_id,
      }),
      filename: 'certificate-' + data.credential_id + '.pdf',
    };
  }

  async revokeCertificate(tenantId: number, id: number, reason: string) {
    const { data } = await this.#db.from('onyx_certificates')
      .select(CERTIFICATE_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Certificate not found.');
    if (data.revoked_at) throw new HttpError(422, 'That certificate is already revoked.');

    // Revoked, never deleted: somebody out there is holding the credential, and
    // a verification that answers "not found" tells them nothing about why.
    const at = new Date(this.#now()).toISOString();
    await this.#db.from('onyx_certificates')
      .update({ revoked_at: at, revoked_reason: reason.slice(0, 500) }).eq('id', id);
    return { ...data, revoked_at: at, revoked_reason: reason };
  }

  // -------------------------------------------------------------------------
  // CAR-05a -- the skills passport
  // -------------------------------------------------------------------------

  async createSkill(tenantId: number, input: { name: string; category?: string | null }) {
    const slug = slugify(input.name);
    if (!slug) throw new HttpError(422, 'That is not a usable skill name.');
    // Checked here as well as by the unique constraint: this way the caller
    // gets the reason rather than a constraint name, and the rule is visible
    // in the code that enforces it.
    if ((await this.skills(tenantId)).some((s) => s.slug === slug)) {
      throw new HttpError(422, 'That skill already exists.');
    }
    const { data, error } = await this.#db.from('onyx_skills').insert({
      tenant_id: tenantId, name: input.name.trim(), slug, category: input.category ?? null,
    }).select(SKILL_COLUMNS).maybeSingle();
    if (error?.code === '23505') throw new HttpError(422, 'That skill already exists.');
    if (error) throw new HttpError(500, 'Could not create the skill: ' + error.message);
    return data!;
  }

  async skills(tenantId: number) {
    const { data } = await this.#db.from('onyx_skills')
      .select(SKILL_COLUMNS).eq('tenant_id', tenantId).order('name');
    return data ?? [];
  }

  /**
   * Records that something a learner did is evidence of a skill.
   *
   * The same piece of evidence cannot be recorded twice, so re-running the
   * derivation is safe -- which matters, because it runs whenever a profile is
   * opened.
   */
  async awardSkill(tenantId: number, input: {
    user_id: string; skill_id: number;
    source_type: SkillSource; source_id: number | null;
    strength?: number; evidence?: Record<string, unknown>;
  }) {
    const strength = Math.max(0, Math.min(100, Math.round(input.strength ?? 50)));
    const existing = await this.#learnerSkills(tenantId, input.user_id);
    const already = existing.find((s) => Number(s.skill_id) === input.skill_id
      && s.source_type === input.source_type
      && Number(s.source_id ?? 0) === Number(input.source_id ?? 0));
    if (already) {
      await this.#db.from('onyx_learner_skills')
        .update({ strength, evidence: (input.evidence ?? {}) as never }).eq('id', already.id);
      return { ...already, strength };
    }

    const { data, error } = await this.#db.from('onyx_learner_skills').insert({
      tenant_id: tenantId, user_id: input.user_id, skill_id: input.skill_id,
      source_type: input.source_type, source_id: input.source_id,
      strength, evidence: (input.evidence ?? {}) as never,
    }).select(LEARNER_SKILL_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not record the skill: ' + error.message);
    return data!;
  }

  /**
   * The passport: every skill, its level, and the evidence behind each.
   *
   * The level is the mean of the evidence rather than the best of it. One
   * excellent piece of work does not make somebody good at something, and a
   * passport that says otherwise is the sort of claim an employer will find out
   * about.
   */
  async passport(tenantId: number, userId: string) {
    const [rows, catalogue] = await Promise.all([
      this.#learnerSkills(tenantId, userId),
      this.skills(tenantId),
    ]);
    const byId = new Map(catalogue.map((s) => [Number(s.id), s]));

    const grouped = new Map<number, typeof rows>();
    for (const row of rows) {
      const key = Number(row.skill_id);
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }

    return [...grouped.entries()].map(([skillId, evidence]) => {
      const skill = byId.get(skillId);
      const level = Math.round(
        evidence.reduce((t, e) => t + Number(e.strength), 0) / evidence.length);
      return {
        skill_id: skillId,
        name: skill?.name ?? 'Unknown skill',
        category: skill?.category ?? null,
        level,
        evidence_count: evidence.length,
        // The acceptance criterion: every skill links to what produced it.
        evidence: evidence.map((e) => ({
          source_type: e.source_type,
          source_id: e.source_id,
          strength: e.strength,
          earned_at: e.earned_at,
          detail: e.evidence,
        })),
      };
    }).sort((a, b) => b.level - a.level);
  }

  // -------------------------------------------------------------------------
  // CAR-05b -- the readiness score
  // -------------------------------------------------------------------------

  /**
   * Computes and stores a readiness score, with its working.
   *
   * Every component is 0..1 before weighting, so the weights mean what they
   * say and a missing component contributes nothing rather than a default.
   */
  async computeReadiness(tenantId: number, userId: string) {
    const components: ReadinessComponent[] = [];

    // Attendance: their own figure across every course they are enrolled in.
    const attendance = await this.#attendance.learnerSummary(tenantId, userId);
    const attended = attendance.length
      ? attendance.reduce((t, a) => t + a.percent, 0) / attendance.length / 100
      : 0;
    components.push(component('attendance', attended, {
      courses: attendance.length,
      average_percent: Math.round(attended * 1000) / 10,
    }));

    // Assessment: the mean percentage over published results only. An
    // unpublished mark is not something the learner has been told, so scoring
    // them on it would be scoring them on a secret.
    const { data: attempts } = await this.#db.from('onyx_assessment_attempts')
      .select('id, score, max_score, status')
      .eq('tenant_id', tenantId).eq('user_id', userId).eq('status', 'published');
    const marked = (attempts ?? []).filter((a) => a.score !== null && Number(a.max_score) > 0);
    const assessment = marked.length
      ? marked.reduce((t, a) => t + Number(a.score) / Number(a.max_score), 0) / marked.length
      : 0;
    components.push(component('assessment', assessment, {
      assessments: marked.length,
      average_percent: Math.round(assessment * 1000) / 10,
    }));

    // Practice: distinct Code Lab problems fully solved. Capped at ten, because
    // the eleventh says less about readiness than the first did.
    const { data: submissions } = await this.#db.from('onyx_code_submissions')
      .select('id, problem_id, score, max_score, status, mode')
      .eq('tenant_id', tenantId).eq('user_id', userId).eq('mode', 'submit')
      .eq('status', 'done');
    const solved = new Set((submissions ?? [])
      .filter((s) => Number(s.max_score) > 0 && Number(s.score) >= Number(s.max_score))
      .map((s) => Number(s.problem_id)));
    components.push(component('practice', Math.min(1, solved.size / 10), {
      problems_solved: solved.size,
      counts_up_to: 10,
    }));

    // Projects: workspaces with at least one snapshot. A workspace nobody ever
    // captured is a file, not a project.
    const { data: workspaces } = await this.#db.from('onyx_workspaces')
      .select('id').eq('tenant_id', tenantId).eq('user_id', userId);
    const ids = (workspaces ?? []).map((x) => Number(x.id));
    const { data: snapshots } = ids.length
      ? await this.#db.from('onyx_workspace_snapshots')
        .select('workspace_id').eq('tenant_id', tenantId).in('workspace_id', ids)
      : { data: [] };
    const withSnapshots = new Set((snapshots ?? []).map((s) => Number(s.workspace_id)));
    components.push(component('projects', Math.min(1, withSnapshots.size / 3), {
      projects: withSnapshots.size,
      counts_up_to: 3,
    }));

    // Mock interviews: the mean of released overall scores, out of 5.
    const { data: interviews } = await this.#db.from('onyx_mock_interviews')
      .select('id, overall, status, released_at')
      .eq('tenant_id', tenantId).eq('user_id', userId).eq('status', 'completed');
    const scored = (interviews ?? []).filter((i) => i.released_at && i.overall !== null);
    const interview = scored.length
      ? scored.reduce((t, i) => t + Number(i.overall), 0) / scored.length / 5
      : 0;
    components.push(component('interview', Math.min(1, interview), {
      interviews: scored.length,
      average_out_of_5: scored.length
        ? Math.round((scored.reduce((t, i) => t + Number(i.overall), 0) / scored.length) * 10) / 10
        : 0,
    }));

    const score = Math.round(components.reduce((t, c) => t + c.points, 0) * 100) / 100;
    const at = new Date(this.#now()).toISOString();

    const existing = await this.readiness(tenantId, userId);
    if (existing) {
      await this.#db.from('onyx_readiness_scores').update({
        score, breakdown: components as never,
        formula: READINESS_WEIGHTS as never, computed_at: at,
      }).eq('id', existing.id);
    } else {
      const { error } = await this.#db.from('onyx_readiness_scores').insert({
        tenant_id: tenantId, user_id: userId, score,
        breakdown: components as never,
        // Stored with the score so an old score still makes sense after the
        // weights are changed.
        formula: READINESS_WEIGHTS as never,
        computed_at: at,
      });
      if (error) throw new HttpError(500, 'Could not save the score: ' + error.message);
    }

    return { user_id: userId, score, breakdown: components, formula: READINESS_WEIGHTS, computed_at: at };
  }

  async readiness(tenantId: number, userId: string) {
    const { data } = await this.#db.from('onyx_readiness_scores')
      .select(READINESS_COLUMNS).eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
    return data ?? null;
  }

  /**
   * The employability profile: everything CAR-05 promises, in one place.
   *
   * `viewer` decides how much is shown. A learner sees their own in full; the
   * placement office sees the same; an employer sees only what a shared profile
   * carries, which is decided in the placement service rather than here.
   */
  async profile(tenantId: number, userId: string, viewer: { role: Role; userId: string }) {
    const own = viewer.userId === userId;
    const staff = viewer.role === 'admin' || viewer.role === 'placement';
    if (!own && !staff) throw new HttpError(403, 'That is not your profile.');

    // The person has to be at THIS institution. User ids are global, so without
    // this an administrator could compute -- and store -- a readiness score for
    // somebody who has never been near their institution.
    const { data: membership } = await this.#db.from('onyx_memberships')
      .select('id').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
    if (!membership) throw new HttpError(404, 'They are not at this institution.');

    const [passport, certificates, score] = await Promise.all([
      this.passport(tenantId, userId),
      this.certificates(tenantId, userId),
      this.computeReadiness(tenantId, userId),
    ]);
    return {
      user_id: userId,
      readiness: score,
      skills: passport,
      certificates: certificates
        .filter((c) => !c.revoked_at)
        .map((c) => ({
          // The id is here only so the holder's own page can offer them the
          // PDF. It is never on the PUBLIC verification payload, which is a
          // different projection in `verify()` and stays name-only.
          id: c.id,
          credential_id: c.credential_id, title: c.title,
          kind: c.kind, issued_at: c.issued_at, detail: c.detail,
        })),
    };
  }

  async #learnerSkills(tenantId: number, userId: string) {
    const { data } = await this.#db.from('onyx_learner_skills')
      .select(LEARNER_SKILL_COLUMNS)
      .eq('tenant_id', tenantId).eq('user_id', userId).order('earned_at');
    return data ?? [];
  }
}

function component(
  key: keyof typeof READINESS_WEIGHTS, raw: number, detail: Record<string, number>,
): ReadinessComponent {
  const bounded = Math.max(0, Math.min(1, raw));
  const weight = READINESS_WEIGHTS[key];
  return {
    key,
    label: READINESS_LABELS[key],
    weight,
    raw: Math.round(bounded * 1000) / 1000,
    points: Math.round(bounded * weight * 100) / 100,
    detail,
  };
}

/**
 * What may appear on a public certificate.
 *
 * An allow-list, not a filter: a caller passing `{ email }` into `detail` would
 * otherwise publish it to anyone holding the credential id.
 */
const PUBLIC_DETAIL_KEYS = ['score', 'max_score', 'percent', 'grade', 'hours', 'level', 'course'];

function pickPublicDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_DETAIL_KEYS) {
    if (detail[key] !== undefined && detail[key] !== null) out[key] = detail[key];
  }
  return out;
}
