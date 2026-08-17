/**
 * CERT-02 to CERT-05 -- certificate management, verification and templates.
 *
 * Verification is deliberately PUBLIC and unauthenticated: the point of the QR
 * code on a certificate is that an employer can scan it without an account. It
 * returns only what the certificate already shows -- name, course, date -- and
 * never an email or an id that could be enumerated.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { paginate, type PageQuery, type Paginated } from '../http/pagination.ts';
import type { SettingsService } from '../settings/settings.service.ts';
import { phpJsonDecode, phpJsonEncode } from '../json/php-json.ts';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** random(12) -- the same shape Laravel wrote into certificates.identifier. */
export function newIdentifier(length = 12): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export interface CertificateTemplate {
  background: string | null;
  name_top: number; name_left: number;
  course_top: number; course_left: number;
  date_top: number; date_left: number;
  qr_top: number; qr_left: number; qr_size: number;
  signature: string | null;
}

export const DEFAULT_TEMPLATE: CertificateTemplate = {
  background: null,
  name_top: 42, name_left: 50,
  course_top: 55, course_left: 50,
  date_top: 72, date_left: 20,
  qr_top: 70, qr_left: 78, qr_size: 15,
  signature: null,
};

export class CertificateService {
  #db: Db;
  #settings: SettingsService;
  constructor(db: Db, settings: SettingsService) {
    this.#db = db;
    this.#settings = settings;
  }

  async list(filters: { search?: string; courseId?: number },
             page: PageQuery, path: string): Promise<Paginated<unknown>> {
    let query = this.#db.from('certificates')
      .select('id, user_id, course_id, identifier, created_at', { count: 'exact' });
    if (filters.courseId) query = query.eq('course_id', filters.courseId);
    if (filters.search) query = query.ilike('identifier', '%' + filters.search + '%');

    const { data, count, error } = await query
      .order('id', { ascending: false }).range(page.from, page.to);
    if (error) throw new HttpError(500, 'certificates.list failed: ' + error.message);
    return paginate(await this.decorate(data ?? []), count ?? 0, page, path);
  }

  async decorate(rows: { user_id: number | null; course_id: number | null }[]) {
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as number[];
    const courseIds = [...new Set(rows.map((r) => r.course_id).filter(Boolean))] as number[];
    const [users, courses] = await Promise.all([
      userIds.length ? this.#db.from('users').select('id, name, email').in('id', userIds)
                     : Promise.resolve({ data: [] }),
      courseIds.length ? this.#db.from('courses').select('id, title, slug').in('id', courseIds)
                       : Promise.resolve({ data: [] }),
    ]);
    const userById = new Map((users.data ?? []).map((u) => [u.id, u]));
    const courseById = new Map((courses.data ?? []).map((c) => [c.id, c]));
    return rows.map((r) => ({
      ...r,
      user: userById.get(r.user_id as number) ?? null,
      course: courseById.get(r.course_id as number) ?? null,
    }));
  }

  /** Students enrolled in a course who do not have a certificate yet. */
  async eligibleStudents(courseId: number) {
    const [enrolled, issued] = await Promise.all([
      this.#db.from('enrollments').select('user_id').eq('course_id', courseId),
      this.#db.from('certificates').select('user_id').eq('course_id', courseId),
    ]);
    const has = new Set((issued.data ?? []).map((r) => r.user_id));
    const ids = [...new Set((enrolled.data ?? []).map((r) => r.user_id))]
      .filter((id) => id && !has.has(id)) as number[];
    if (!ids.length) return [];
    const { data } = await this.#db.from('users').select('id, name, email').in('id', ids);
    return data ?? [];
  }

  /** CERT-02 -- issuing by hand. Enrolment required, duplicates refused. */
  async issue(courseId: number, userId: number) {
    const { data: enrolled } = await this.#db.from('enrollments')
      .select('id').eq('course_id', courseId).eq('user_id', userId).maybeSingle();
    if (!enrolled) {
      throw new HttpError(422, 'This student is not enrolled in the selected course.');
    }
    const { data: existing } = await this.#db.from('certificates')
      .select('id').eq('course_id', courseId).eq('user_id', userId).maybeSingle();
    if (existing) {
      throw new HttpError(422,
        'A certificate has already been issued to this student for this course.');
    }

    const identifier = newIdentifier();
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('certificates')
      .insert({ user_id: userId, course_id: courseId, identifier, created_at: now, updated_at: now })
      .select('id, identifier, user_id, course_id, created_at').maybeSingle();
    if (error) throw new HttpError(500, 'Could not issue the certificate: ' + error.message);
    return data;
  }

  async remove(id: number): Promise<void> {
    const { error } = await this.#db.from('certificates').delete().eq('id', id);
    if (error) throw new HttpError(500, 'Could not delete the certificate: ' + error.message);
  }

  /**
   * CERT-03 -- public verification. Returns verified:false rather than a 404 so
   * a scanner always gets an answer instead of a broken page.
   */
  async verify(identifier: string) {
    const { data } = await this.#db.from('certificates')
      .select('id, user_id, course_id, identifier, created_at')
      .eq('identifier', identifier).maybeSingle();
    if (!data) return { verified: false as const, certificate: null };

    const [user, course] = await Promise.all([
      this.#db.from('users').select('name').eq('id', data.user_id as number).maybeSingle(),
      this.#db.from('courses').select('title, slug').eq('id', data.course_id as number).maybeSingle(),
    ]);

    return {
      verified: true as const,
      certificate: {
        identifier: data.identifier,
        student_name: user.data?.name ?? null,
        course_title: course.data?.title ?? null,
        course_slug: course.data?.slug ?? null,
        issued_at: data.created_at,
      },
    };
  }

  async myCertificates(userId: number) {
    const { data } = await this.#db.from('certificates')
      .select('id, user_id, course_id, identifier, created_at')
      .eq('user_id', userId).order('id', { ascending: false });
    return this.decorate(data ?? []);
  }

  /** CERT-05 -- the template, stored as a JSON settings value. */
  async template(): Promise<CertificateTemplate> {
    const stored = await this.#settings.get('certificate_template');
    return { ...DEFAULT_TEMPLATE, ...phpJsonDecode<Partial<CertificateTemplate>>(stored, {}) };
  }

  async saveTemplate(template: Partial<CertificateTemplate>): Promise<CertificateTemplate> {
    const merged = { ...(await this.template()), ...template };
    await this.#settings.set('certificate_template', phpJsonEncode(merged));
    return merged;
  }
}
