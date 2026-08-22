/**
 * LRN-01a / LRN-01b -- the academic structure and the catalog on top of it.
 *
 * "Structured catalog mapped to programs and semesters with self-service and
 * administrator-driven enrollment."
 *
 * The structure is what separates this from a marketplace. A course is not a
 * product; it sits in a semester of a programme, and a learner usually reaches
 * it by belonging to a batch rather than by choosing it.
 *
 * Every method takes `tenantId` as its first argument and every query filters
 * on it. That is repetitive on purpose: the alternative is a query somewhere
 * that forgot, and the forgetting is invisible until it is somebody else's data.
 */
import type { OnyxDb } from './db.ts';
import type { Role } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import { slugify } from '../authoring/slug.ts';

const PROGRAM_COLUMNS = 'id, tenant_id, name, code, description, duration_semesters, status, created_at';
const SEMESTER_COLUMNS = 'id, tenant_id, program_id, name, number, starts_on, ends_on, status';
const BATCH_COLUMNS = 'id, tenant_id, program_id, name, code, year, status';
const COURSE_COLUMNS = 'id, tenant_id, program_id, semester_id, code, title, slug, description, credits, self_enroll, access, price_minor, currency, status, created_by, created_at';
const ENROLLMENT_COLUMNS = 'id, tenant_id, course_id, user_id, batch_id, status, enrolled_by, created_at';

/**
 * Who is allowed to see a course that is not published yet. The same two
 * roles `courses()` lets past its `status: 1` filter -- they are the ones
 * who have to finish the thing.
 */
const STAFF_ROLES: Role[] = ['admin', 'faculty'];
const isStaff = (role: Role) => STAFF_ROLES.includes(role);

export interface OnyxCourseInput {
  code: string;
  title: string;
  slug?: string;
  description?: string | null;
  program_id?: number | null;
  semester_id?: number | null;
  credits?: number;
  self_enroll?: boolean;
  status?: number;
  /** 'batch' (institution enrols), 'open' (free self-enrol), 'locked' (paid). */
  access?: 'batch' | 'open' | 'locked';
  price_minor?: number;
  currency?: string;
}

export class AcademicsService {
  #db: OnyxDb;
  constructor(db: OnyxDb) { this.#db = db; }

  // ---- programmes ----

  async programs(tenantId: number) {
    const { data } = await this.#db.from('onyx_programs')
      .select(PROGRAM_COLUMNS).eq('tenant_id', tenantId).order('name');
    return data ?? [];
  }

  async program(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_programs')
      .select(PROGRAM_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Programme not found.');
    return data;
  }

  async createProgram(tenantId: number, input: {
    name: string; code: string; description?: string | null; duration_semesters?: number;
  }) {
    const { data, error } = await this.#db.from('onyx_programs').insert({
      tenant_id: tenantId,
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      description: input.description ?? null,
      duration_semesters: input.duration_semesters ?? 1,
      status: 1,
    }).select(PROGRAM_COLUMNS).maybeSingle();
    if (error?.code === '23505') throw new HttpError(422, 'That programme code is already in use.');
    if (error) throw new HttpError(500, 'Could not create the programme: ' + error.message);
    return data!;
  }

  // ---- semesters ----

  async semesters(tenantId: number, programId?: number) {
    let q = this.#db.from('onyx_semesters').select(SEMESTER_COLUMNS).eq('tenant_id', tenantId);
    if (programId) q = q.eq('program_id', programId);
    const { data } = await q.order('number');
    return data ?? [];
  }

  async createSemester(tenantId: number, input: {
    program_id: number; name: string; number: number;
    starts_on?: string | null; ends_on?: string | null;
  }) {
    const program = await this.program(tenantId, input.program_id);
    // A semester outside the programme's declared length is almost always a
    // typo, and it would silently orphan every course put into it.
    if (input.number < 1 || input.number > program.duration_semesters) {
      throw new HttpError(422,
        'This programme has ' + program.duration_semesters + ' semesters.');
    }
    if (input.starts_on && input.ends_on && input.ends_on < input.starts_on) {
      throw new HttpError(422, 'A semester cannot end before it starts.');
    }

    const { data, error } = await this.#db.from('onyx_semesters').insert({
      tenant_id: tenantId,
      program_id: input.program_id,
      name: input.name.trim(),
      number: input.number,
      starts_on: input.starts_on ?? null,
      ends_on: input.ends_on ?? null,
      status: 1,
    }).select(SEMESTER_COLUMNS).maybeSingle();
    if (error?.code === '23505') throw new HttpError(422, 'That semester already exists.');
    if (error) throw new HttpError(500, 'Could not create the semester: ' + error.message);
    return data!;
  }

  // ---- batches ----

  async batches(tenantId: number, programId?: number) {
    let q = this.#db.from('onyx_batches').select(BATCH_COLUMNS).eq('tenant_id', tenantId);
    if (programId) q = q.eq('program_id', programId);
    const { data } = await q.order('id', { ascending: false });
    return data ?? [];
  }

  async batch(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_batches')
      .select(BATCH_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Batch not found.');
    return data;
  }

  async createBatch(tenantId: number, input: {
    program_id: number; name: string; code: string; year?: number | null;
  }) {
    await this.program(tenantId, input.program_id);
    const { data, error } = await this.#db.from('onyx_batches').insert({
      tenant_id: tenantId,
      program_id: input.program_id,
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      year: input.year ?? null,
      status: 1,
    }).select(BATCH_COLUMNS).maybeSingle();
    if (error?.code === '23505') throw new HttpError(422, 'That batch code is already in use.');
    if (error) throw new HttpError(500, 'Could not create the batch: ' + error.message);
    return data!;
  }

  /** Batch membership is what makes bulk enrolment possible at all. */
  async addToBatch(tenantId: number, batchId: number, userIds: string[]) {
    await this.batch(tenantId, batchId);
    const members = await this.batchMembers(tenantId, batchId);
    const existing = new Set(members.map((m) => String(m.user_id)));
    const fresh = [...new Set(userIds)].filter((id) => !existing.has(id));
    if (!fresh.length) return { added: 0 };

    const { error } = await this.#db.from('onyx_batch_members').insert(
      fresh.map((user_id) => ({ tenant_id: tenantId, batch_id: batchId, user_id })));
    if (error) throw new HttpError(500, 'Could not add them to the batch: ' + error.message);
    return { added: fresh.length };
  }

  /**
   * The batches one person is in, each with the programme it belongs to.
   *
   * The inverse of batchMembers, and the reason it exists is a resume. Batch ->
   * programme is what an education section says -- the qualification being read
   * for, and the cohort reading for it -- and it is data the institution
   * already holds. The alternative was a table for learners to type their own
   * education into, which is a second copy of a fact the registrar already has
   * and which would disagree with it within a term.
   *
   * Two queries rather than a join: the row shapes stay the ones every other
   * reader of these tables already gets, and a learner is in a handful of
   * batches, not thousands.
   */
  async batchesFor(tenantId: number, userId: string) {
    const { data: memberships } = await this.#db.from('onyx_batch_members')
      .select('id, tenant_id, batch_id, user_id, created_at')
      .eq('tenant_id', tenantId).eq('user_id', userId);
    const rows = memberships ?? [];
    if (!rows.length) return [];

    const batches = await this.batches(tenantId);
    const byId = new Map(batches.map((b) => [Number(b.id), b]));
    const programs = await this.programs(tenantId);
    const programById = new Map(programs.map((pr) => [Number(pr.id), pr]));

    return rows
      .map((m) => {
        const batch = byId.get(Number(m.batch_id));
        if (!batch) return null;
        const program = batch.program_id ? programById.get(Number(batch.program_id)) : null;
        return {
          batch_id: Number(batch.id),
          batch: String(batch.name),
          code: String(batch.code ?? ''),
          year: batch.year === null || batch.year === undefined ? null : Number(batch.year),
          status: Number(batch.status),
          program_id: program ? Number(program.id) : null,
          program: program ? String(program.name) : null,
          program_code: program ? String(program.code ?? '') : null,
          duration_semesters: program?.duration_semesters === null
            || program?.duration_semesters === undefined
            ? null : Number(program.duration_semesters),
          joined_at: m.created_at ? String(m.created_at) : null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      // Most recent first, the way anybody reads their own education.
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || b.batch_id - a.batch_id);
  }

  async batchMembers(tenantId: number, batchId: number) {
    const { data } = await this.#db.from('onyx_batch_members')
      .select('id, tenant_id, batch_id, user_id, created_at')
      .eq('tenant_id', tenantId).eq('batch_id', batchId);
    return data ?? [];
  }

  // ---- courses ----

  /**
   * The catalogue, with two facts a browsing card is judged on and neither
   * worth a follow-up request per course: how many are enrolled, and who
   * teaches it. Two bulk queries against the id list the first query just
   * returned, not one query per course -- the shape every other list-with-
   * counts read in this codebase already uses (see PlatformService's
   * tenantAcademics()).
   */
  async courses(tenantId: number, filters: {
    programId?: number; semesterId?: number; status?: number; search?: string;
  } = {}) {
    let q = this.#db.from('onyx_courses').select(COURSE_COLUMNS).eq('tenant_id', tenantId);
    if (filters.programId) q = q.eq('program_id', filters.programId);
    if (filters.semesterId) q = q.eq('semester_id', filters.semesterId);
    if (filters.status !== undefined) q = q.eq('status', filters.status);
    const { data } = await q.order('code');

    let rows = data ?? [];
    if (filters.search?.trim()) {
      const needle = filters.search.trim().toLowerCase();
      rows = rows.filter((c) => (c.title ?? '').toLowerCase().includes(needle)
        || (c.code ?? '').toLowerCase().includes(needle));
    }

    const ids = rows.map((c) => Number(c.id));
    const [enrolQ, facQ] = ids.length ? await Promise.all([
      this.#db.from('onyx_enrollments').select('course_id')
        .eq('tenant_id', tenantId).eq('status', 1).in('course_id', ids),
      this.#db.from('onyx_course_faculty').select('course_id, user_id')
        .eq('tenant_id', tenantId).in('course_id', ids),
    ]) : [{ data: [] }, { data: [] }];

    const enrolCount = new Map<number, number>();
    for (const e of enrolQ.data ?? []) {
      const c = Number(e.course_id);
      enrolCount.set(c, (enrolCount.get(c) ?? 0) + 1);
    }
    const facultyIds = [...new Set((facQ.data ?? []).map((f) => String(f.user_id)))];
    const { data: facultyUsers } = facultyIds.length
      ? await this.#db.from('onyx_users').select('id, name').in('id', facultyIds)
      : { data: [] };
    const nameOf = new Map((facultyUsers ?? []).map((u) => [String(u.id), String(u.name)]));
    const facultyByCourse = new Map<number, { user_id: string; name: string }[]>();
    for (const f of facQ.data ?? []) {
      const c = Number(f.course_id);
      const list = facultyByCourse.get(c) ?? [];
      list.push({ user_id: String(f.user_id), name: nameOf.get(String(f.user_id)) ?? 'Unknown' });
      facultyByCourse.set(c, list);
    }

    return rows.map((c) => ({
      ...c,
      enrollment_count: enrolCount.get(Number(c.id)) ?? 0,
      faculty: facultyByCourse.get(Number(c.id)) ?? [],
    }));
  }

  async course(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_courses')
      .select(COURSE_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Course not found.');
    return data;
  }

  /**
   * The gate in front of a course *itself*, as `assertEnrolled` is the gate
   * in front of its contents.
   *
   * A course at `status: 0` is a draft -- faculty are still writing it, and
   * the catalog has always hidden it, because `courses()` forces `status: 1`
   * for anyone who is not staff. But the catalog was the only place that
   * looked. Anything else holding a course id reached the course anyway: a
   * typed URL, a link in a notification, an enrolment an administrator
   * arranged before the course was finished. `course()` itself has no
   * opinion about who is asking, so every reader of it inherited that.
   *
   * 404 rather than 403 on purpose. Course ids are sequential `bigint`s, so
   * a 403 would confirm that an unpublished course exists at that id, which
   * is the one fact a draft is meant to keep.
   */
  async assertCourseVisible(tenantId: number, courseId: number, role: Role) {
    const course = await this.course(tenantId, courseId);
    if (!isStaff(role) && course.status !== 1) {
      throw new HttpError(404, 'Course not found.');
    }
    return course;
  }

  /**
   * The same course rows `course()` returns, for a whole id list at once.
   * Written for the callers that already know exactly which courses they
   * want -- `/my/courses`, a faculty member's taught set -- and used to get
   * there by calling `course()` once per id. One `.in('id', ids)` query
   * instead of N `.eq('id', id)` ones; unlike `courses()` this does not
   * join enrolment counts or faculty, because the callers that have an id
   * list in hand already know who is on it.
   */
  async coursesByIds(tenantId: number, ids: number[], opts: { publishedOnly?: boolean } = {}) {
    if (!ids.length) return [];
    let q = this.#db.from('onyx_courses')
      .select(COURSE_COLUMNS).eq('tenant_id', tenantId).in('id', ids);
    // An id list is usually an enrolment list, and an enrolment can be
    // arranged before the course is published. Callers serving a learner
    // pass `publishedOnly` so a draft never reaches a "my courses" shelf.
    if (opts.publishedOnly) q = q.eq('status', 1);
    const { data } = await q;
    return data ?? [];
  }

  async courseBySlug(tenantId: number, slug: string) {
    const { data } = await this.#db.from('onyx_courses')
      .select(COURSE_COLUMNS).eq('tenant_id', tenantId).eq('slug', slug).maybeSingle();
    if (!data) throw new HttpError(404, 'Course not found.');
    return data;
  }

  async createCourse(tenantId: number, createdBy: string, input: OnyxCourseInput) {
    const slug = slugify(input.slug ?? input.title);
    if (!slug) throw new HttpError(422, 'That title does not make a usable address.');
    await this.#assertStructureBelongs(tenantId, input.program_id, input.semester_id);

    const { data, error } = await this.#db.from('onyx_courses').insert({
      tenant_id: tenantId,
      program_id: input.program_id ?? null,
      semester_id: input.semester_id ?? null,
      code: input.code.trim().toUpperCase(),
      title: input.title.trim(),
      slug,
      description: input.description ?? null,
      credits: input.credits ?? 0,
      /*
       * How learners get on, honoured at creation and not only at update.
       *
       * This wrote `self_enroll` from a boolean the form stopped sending when
       * open/locked courses landed, and dropped `access` and `price_minor` on
       * the floor entirely -- so an administrator who chose "Open — anyone here
       * may start it" or "Locked — they buy it first" got a batch course at no
       * price, with no error and nothing on screen to say the answer had been
       * discarded. updateCourse was fixed for this; create was not, which is
       * why it only showed up on the first save.
       *
       * `access` and `self_enroll` travel together for the reason updateCourse
       * gives: `access` is what every read asks about, `self_enroll` is what
       * selfEnroll() has read since 0002, and setting one without the other is
       * how a course comes to say "open" on the catalogue and then refuse the
       * learner who clicks it.
       */
      access: input.access ?? 'batch',
      self_enroll: input.access !== undefined
        ? (input.access === 'batch' ? 0 : 1)
        : (input.self_enroll ? 1 : 0),
      price_minor: input.price_minor ?? 0,
      ...(input.currency ? { currency: input.currency.toUpperCase() } : {}),
      // Courses start unpublished: an empty course visible to a cohort is worse
      // than no course at all.
      status: input.status ?? 0,
      created_by: createdBy,
    }).select(COURSE_COLUMNS).maybeSingle();
    if (error?.code === '23505') throw new HttpError(422, 'That course code or address is already in use.');
    if (error) throw new HttpError(500, 'Could not create the course: ' + error.message);
    return data!;
  }

  async updateCourse(tenantId: number, id: number, input: Partial<OnyxCourseInput>) {
    await this.course(tenantId, id);
    await this.#assertStructureBelongs(tenantId, input.program_id, input.semester_id);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.code !== undefined) patch.code = input.code.trim().toUpperCase();
    if (input.slug !== undefined) patch.slug = slugify(input.slug);
    if (input.description !== undefined) patch.description = input.description;
    if (input.credits !== undefined) patch.credits = input.credits;
    if (input.program_id !== undefined) patch.program_id = input.program_id;
    if (input.semester_id !== undefined) patch.semester_id = input.semester_id;
    if (input.self_enroll !== undefined) patch.self_enroll = input.self_enroll ? 1 : 0;
    if (input.access !== undefined) {
      patch.access = input.access;
      // The two travel together: `access` is what every read asks about, and
      // `self_enroll` is what selfEnroll() has read since 0002. Setting one
      // and not the other is how a course comes to say "open" on the catalogue
      // and refuse the learner who clicks it.
      patch.self_enroll = input.access === 'batch' ? 0 : 1;
    }
    if (input.price_minor !== undefined) patch.price_minor = input.price_minor;
    if (input.currency !== undefined) patch.currency = input.currency.toUpperCase();
    if (input.status !== undefined) patch.status = input.status;

    const { error } = await this.#db.from('onyx_courses')
      .update(patch).eq('tenant_id', tenantId).eq('id', id);
    if (error?.code === '23505') throw new HttpError(422, 'That course code or address is already in use.');
    if (error) throw new HttpError(500, 'Could not update the course: ' + error.message);
    return this.course(tenantId, id);
  }

  /**
   * Removes a course outright.
   *
   * Everything that hangs off it goes too, at the database: faculty
   * allocations, enrolments, modules (and their lessons and lesson
   * progress), resources, attendance sessions (and their records),
   * assignments (and their rubric criteria, submissions, scores),
   * discussions, timetable slots and exams (and their seating and marks)
   * are all ON DELETE CASCADE on course_id (confirmed against
   * 0002_learn.sql, 0007_engage.sql, 0008_campus.sql). A question bank, an
   * assessment, a problem/workspace, a certificate or a support ticket
   * that happened to draw on this course survives with course_id set to
   * null instead -- those belong to the institution, not to any one
   * course, the same reasoning ExaminationsService.remove() gives for
   * leaving an exam's linked assessment untouched.
   *
   * Same authorization the route applies before calling this
   * (requireCourseManager, admin or this course's own faculty) -- this is
   * the role-only backstop that pattern always keeps alongside the
   * course-scoped check.
   */
  async remove(tenantId: number, id: number, role: Role): Promise<void> {
    if (role !== 'admin' && role !== 'faculty') {
      throw new HttpError(403, 'Only an administrator or the course’s own faculty can remove a course.');
    }
    await this.course(tenantId, id); // 404s cleanly if it does not exist
    const { error } = await this.#db.from('onyx_courses')
      .delete().eq('tenant_id', tenantId).eq('id', id);
    if (error) throw new HttpError(500, 'Could not remove the course: ' + error.message);
  }

  // ---- who teaches what ----

  /**
   * A course is run by one or two people, not a crowd -- past that, "who
   * teaches this" stops being a question with a fast answer. The cap is
   * checked here rather than left to the unique constraint, so a course
   * already at two gets a real reason rather than a silent no-op.
   */
  async assignFaculty(tenantId: number, courseId: number, userId: string) {
    await this.course(tenantId, courseId);
    const current = await this.faculty(tenantId, courseId);
    if (current.some((f) => String(f.user_id) === userId)) return { assigned: false };
    if (current.length >= 2) {
      throw new HttpError(422,
        'This course already has two faculty. Remove one before assigning another.');
    }

    const { error } = await this.#db.from('onyx_course_faculty')
      .insert({ tenant_id: tenantId, course_id: courseId, user_id: userId });
    if (error?.code === '23505') return { assigned: false };
    if (error) throw new HttpError(500, 'Could not assign them: ' + error.message);
    return { assigned: true };
  }

  /** The other half of assignFaculty() -- a course stuck at two wrong people
   * needs a way back to one before a correct third can be assigned. */
  async removeFaculty(tenantId: number, courseId: number, userId: string) {
    await this.course(tenantId, courseId);
    await this.#db.from('onyx_course_faculty')
      .delete().eq('tenant_id', tenantId).eq('course_id', courseId).eq('user_id', userId);
    return { removed: true };
  }

  async faculty(tenantId: number, courseId: number) {
    const { data } = await this.#db.from('onyx_course_faculty')
      .select('id, tenant_id, course_id, user_id')
      .eq('tenant_id', tenantId).eq('course_id', courseId);
    return data ?? [];
  }

  /**
   * The check every faculty-facing route makes.
   *
   * An admin may act on any course in their institution. Faculty may act only
   * on courses they teach -- otherwise "faculty" would be a tenant-wide key to
   * every roster, grade and attendance record.
   */
  async assertCanTeach(tenantId: number, courseId: number, userId: string, role: Role) {
    const course = await this.course(tenantId, courseId);
    if (role === 'admin') return course;
    const teaches = await this.faculty(tenantId, courseId);
    if (!teaches.some((f) => String(f.user_id) === userId)) {
      throw new HttpError(403, 'You do not teach this course.');
    }
    return course;
  }

  // ---- enrolment ----

  async enrollment(tenantId: number, courseId: number, userId: string) {
    const { data } = await this.#db.from('onyx_enrollments')
      .select(ENROLLMENT_COLUMNS)
      .eq('tenant_id', tenantId).eq('course_id', courseId).eq('user_id', userId)
      .maybeSingle();
    return data ?? null;
  }

  /**
   * The gate in front of every piece of course content.
   *
   * Every caller of this is a learner path -- staff reach the same material
   * through `assertCanTeach`, or past an `isStaff` branch -- so this is the
   * one place that can speak for lessons, resources, assignments,
   * attendance, discussions, workspaces and assessments at once. Which is
   * why the draft check belongs here too: enrolment alone used to be the
   * whole answer, and enrolment says nothing about whether the course has
   * been published.
   */
  async assertEnrolled(tenantId: number, courseId: number, userId: string) {
    const [enrolled, course] = await Promise.all([
      this.enrollment(tenantId, courseId, userId),
      this.course(tenantId, courseId),
    ]);
    if (!enrolled || enrolled.status !== 1) {
      throw new HttpError(403, 'You are not enrolled in this course.');
    }
    if (course.status !== 1) throw new HttpError(404, 'Course not found.');
    return enrolled;
  }

  async enrollmentsFor(tenantId: number, userId: string) {
    const { data } = await this.#db.from('onyx_enrollments')
      .select(ENROLLMENT_COLUMNS)
      .eq('tenant_id', tenantId).eq('user_id', userId).eq('status', 1);
    return data ?? [];
  }

  /** The reverse of `faculty()` -- every course id this person teaches. */
  async teachingFor(tenantId: number, userId: string): Promise<number[]> {
    const { data } = await this.#db.from('onyx_course_faculty')
      .select('course_id').eq('tenant_id', tenantId).eq('user_id', userId);
    return [...new Set((data ?? []).map((r) => Number(r.course_id)))];
  }

  async roster(tenantId: number, courseId: number) {
    const { data } = await this.#db.from('onyx_enrollments')
      .select(ENROLLMENT_COLUMNS)
      .eq('tenant_id', tenantId).eq('course_id', courseId).eq('status', 1)
      .order('id');
    return data ?? [];
  }

  /**
   * The active roster for several courses at once -- rows carry `course_id`
   * so a caller groups them itself. The bulk twin of `roster()`, for a
   * dashboard reading a dozen taught courses' headcounts, which would
   * otherwise be a `roster()` call per course.
   */
  async rosterBulk(tenantId: number, courseIds: number[]) {
    if (!courseIds.length) return [];
    const { data } = await this.#db.from('onyx_enrollments')
      .select(ENROLLMENT_COLUMNS)
      .eq('tenant_id', tenantId).eq('status', 1).in('course_id', courseIds);
    return data ?? [];
  }

  /** Administrator-driven enrolment. */
  async enroll(tenantId: number, courseId: number, userId: string, opts: {
    enrolledBy?: string | null; batchId?: number | null;
  } = {}) {
    const course = await this.course(tenantId, courseId);
    const existing = await this.enrollment(tenantId, courseId, userId);
    if (existing) {
      // Re-enrolling someone previously withdrawn should restore them rather
      // than fail: the alternative is an administrator deleting a row to fix it.
      if (existing.status === 1) throw new HttpError(422, 'They are already enrolled.');
      await this.#db.from('onyx_enrollments')
        .update({ status: 1, updated_at: new Date().toISOString() }).eq('id', existing.id);
      return { ...existing, status: 1 };
    }

    const { data, error } = await this.#db.from('onyx_enrollments').insert({
      tenant_id: tenantId,
      course_id: course.id,
      user_id: userId,
      batch_id: opts.batchId ?? null,
      status: 1,
      enrolled_by: opts.enrolledBy ?? null,
    }).select(ENROLLMENT_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not enrol them: ' + error.message);
    return data!;
  }

  /** Self-service enrolment, which only some courses allow. */
  async selfEnroll(tenantId: number, courseId: number, userId: string) {
    const course = await this.course(tenantId, courseId);
    if (course.status !== 1) throw new HttpError(403, 'This course is not open.');

    // A locked course is self-enrollable in the same sense an open one is --
    // the learner starts it themselves -- but the door is a purchase. Refusing
    // here rather than inside enroll() keeps the reason specific: "buy it"
    // rather than "the institution enrols you", which is a different answer
    // and sends the learner to a different place.
    if (course.access === 'locked') {
      const paid = await this.hasPurchased(tenantId, courseId, userId);
      if (!paid) throw new HttpError(402, 'This course has to be bought before you can start it.');
      return this.enroll(tenantId, courseId, userId, { enrolledBy: userId });
    }

    if (!course.self_enroll && course.access !== 'open') {
      throw new HttpError(403, 'This course is enrolled by the institution.');
    }
    return this.enroll(tenantId, courseId, userId, { enrolledBy: userId });
  }

  /**
   * The courses a stranger may see, before they have an account.
   *
   * Scoped to institutions that have opened student registration -- the same
   * flag that decides whether somebody can join at all (0025). An institution
   * that enrols its own cohorts and never takes public learners does not
   * appear here, and neither do its courses: publishing a customer's catalogue
   * because the software could is not a decision this should make for them.
   *
   * Published, self-startable courses only. A draft is not a product, and a
   * `batch` course cannot be joined by somebody who walks up to it.
   */
  async publicCatalogue(limit = 24) {
    const { data: tenants } = await this.#db.from('onyx_tenants')
      .select('id, name, slug').eq('student_signup', true).eq('status', 1);
    const open = tenants ?? [];
    if (!open.length) return [];

    const { data } = await this.#db.from('onyx_courses')
      .select(COURSE_COLUMNS)
      .in('tenant_id', open.map((t) => Number(t.id)))
      .eq('status', 1)
      .in('access', ['open', 'locked'])
      .order('access', { ascending: false })
      .limit(limit);

    const byTenant = new Map(open.map((t) => [Number(t.id), t]));
    return (data ?? []).map((c) => ({
      id: Number(c.id),
      code: String(c.code),
      title: String(c.title),
      description: c.description ? String(c.description) : null,
      credits: Number(c.credits ?? 0),
      access: String(c.access) as 'open' | 'locked',
      price_minor: Number(c.price_minor ?? 0),
      currency: String(c.currency ?? 'INR'),
      institution: {
        name: String(byTenant.get(Number(c.tenant_id))?.name ?? ''),
        slug: String(byTenant.get(Number(c.tenant_id))?.slug ?? ''),
      },
    }));
  }

  /**
   * A course's public page: what it is, who runs it, what is inside, and what
   * it costs. No content, no roster, no marks.
   *
   * Every PUBLISHED course has one, whether or not its institution advertises
   * publicly. The two are different things and the split is deliberate: the
   * homepage catalogue LISTS courses, and listing an institution's internal
   * cohort courses to the world would be advertising on their behalf, so that
   * stays opt-in (publicCatalogue, gated on student_signup). This answers when
   * somebody already has the address -- a lecturer sent it, or a learner is
   * deciding whether to sign up -- and a link that 404s for the person it was
   * sent to is a link nobody can use.
   *
   * A draft has no page at all. It is not a course yet.
   *
   * The outline is titles only: module names, lesson names, their kind and how
   * long they run. That is a syllabus, which is what somebody choosing a course
   * needs; the lessons themselves stay behind enrolment, which is what they are
   * paying or registering for.
   */
  async publicCourse(courseId: number) {
    const { data: course } = await this.#db.from('onyx_courses')
      .select(COURSE_COLUMNS).eq('id', courseId).eq('status', 1).maybeSingle();
    if (!course) return null;

    const tenantId = Number(course.tenant_id);
    const [{ data: tenant }, { data: modules }, { data: faculty }, { count: enrolled }] =
      await Promise.all([
        this.#db.from('onyx_tenants')
          .select('id, name, slug, status, student_signup').eq('id', tenantId).maybeSingle(),
        this.#db.from('onyx_modules')
          .select('id, title, summary, sort').eq('tenant_id', tenantId)
          .eq('course_id', courseId).order('sort'),
        this.#db.from('onyx_course_faculty')
          .select('user_id').eq('tenant_id', tenantId).eq('course_id', courseId),
        this.#db.from('onyx_enrollments')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('course_id', courseId).eq('status', 1),
      ]);

    if (!tenant || tenant.status !== 1) return null;

    interface LessonRow {
      id: number; module_id: number; title: string; type: string | null;
      duration_seconds: number | null; is_preview: boolean | null; sort: number | null;
    }
    const moduleIds = (modules ?? []).map((m) => Number(m.id));
    const { data: lessonRows } = moduleIds.length
      ? await this.#db.from('onyx_lessons')
        .select('id, module_id, title, type, duration_seconds, is_preview, sort')
        .eq('tenant_id', tenantId).in('module_id', moduleIds).order('sort')
      : { data: [] };
    const lessons = (lessonRows ?? []) as unknown as LessonRow[];

    const facultyIds = (faculty ?? []).map((f) => String(f.user_id));
    const { data: people } = facultyIds.length
      ? await this.#db.from('onyx_users').select('id, name').in('id', facultyIds)
      : { data: [] as { id: string; name: string }[] };

    const byModule = new Map<number, LessonRow[]>();
    for (const l of lessons) {
      const list = byModule.get(Number(l.module_id)) ?? [];
      list.push(l);
      byModule.set(Number(l.module_id), list);
    }

    const totalSeconds = lessons.reduce((n, l) => n + Number(l.duration_seconds ?? 0), 0);

    return {
      id: Number(course.id),
      code: String(course.code),
      title: String(course.title),
      description: course.description ? String(course.description) : null,
      credits: Number(course.credits ?? 0),
      access: String(course.access) as 'batch' | 'open' | 'locked',
      price_minor: Number(course.price_minor ?? 0),
      currency: String(course.currency ?? 'INR'),
      institution: {
        name: String(tenant.name),
        slug: String(tenant.slug),
        /** Whether somebody without an account can register to take it. */
        registration_open: Boolean(tenant.student_signup),
      },
      taught_by: (people ?? []).map((u) => String(u.name)),
      learners: Number(enrolled ?? 0),
      lesson_count: lessons.length,
      total_minutes: Math.round(totalSeconds / 60),
      modules: (modules ?? []).map((m) => ({
        id: Number(m.id),
        title: String(m.title),
        summary: m.summary ? String(m.summary) : null,
        lessons: (byModule.get(Number(m.id)) ?? []).map((l) => ({
          title: String(l.title),
          type: String(l.type ?? 'text'),
          minutes: Math.round(Number(l.duration_seconds ?? 0) / 60),
          preview: Boolean(l.is_preview),
        })),
      })),
    };
  }

  /** Whether this learner has already bought this course. */
  async hasPurchased(tenantId: number, courseId: number, userId: string): Promise<boolean> {
    const { data } = await this.#db.from('onyx_course_purchases')
      .select('id').eq('tenant_id', tenantId).eq('course_id', courseId)
      .eq('user_id', userId).eq('status', 'captured').maybeSingle();
    return Boolean(data);
  }

  /** Everything this learner has bought, for the catalogue to mark as owned. */
  async purchasesFor(tenantId: number, userId: string): Promise<number[]> {
    const { data } = await this.#db.from('onyx_course_purchases')
      .select('course_id').eq('tenant_id', tenantId).eq('user_id', userId)
      .eq('status', 'captured');
    return (data ?? []).map((r) => Number(r.course_id));
  }

  /**
   * Buying a locked course, and being enrolled onto it.
   *
   * The payment is a MOCK: no gateway is called, the row is written as
   * captured, and the learner is enrolled. It is deliberately shaped like the
   * real thing -- a gateway name, a reference, an amount taken from the COURSE
   * rather than from the request -- so wiring a real gateway later replaces
   * one function rather than the flow around it. The amount coming from the
   * course is the part that would otherwise be a way to buy a ₹9,000 course
   * for ₹1 by editing a request.
   *
   * The unique index on (tenant, course, learner) is what makes a double-click
   * safe: the second attempt finds the first purchase and enrols, rather than
   * charging twice.
   */
  async purchase(tenantId: number, courseId: number, userId: string, opts: {
    gateway?: string; reference?: string;
  } = {}) {
    const course = await this.course(tenantId, courseId);
    if (course.status !== 1) throw new HttpError(403, 'This course is not open.');
    if (course.access !== 'locked') {
      throw new HttpError(422, 'This course is not for sale -- it is free to start.');
    }

    const already = await this.hasPurchased(tenantId, courseId, userId);
    if (!already) {
      const reference = opts.reference
        ?? 'MOCK-' + tenantId + '-' + courseId + '-' + Date.now().toString(36).toUpperCase();
      const { error } = await this.#db.from('onyx_course_purchases').insert({
        tenant_id: tenantId, course_id: courseId, user_id: userId,
        amount_minor: Number(course.price_minor), currency: String(course.currency ?? 'INR'),
        gateway: opts.gateway ?? 'mock', reference, status: 'captured',
      });
      // A duplicate here is two clicks racing, not a failure: the row that won
      // is the one that counts, and the learner still gets their enrolment.
      if (error && !String(error.message).includes('duplicate')) {
        throw new HttpError(500, 'The payment could not be recorded: ' + error.message);
      }
    }

    // Buying is idempotent from the learner's side. `enroll()` refuses an
    // active enrolment with a 422 -- correct when an administrator is enrolling
    // somebody twice by mistake, wrong here, where the second click is somebody
    // wondering whether the first one worked. The answer they need is "you own
    // this", not an error.
    const existing = await this.enrollment(tenantId, courseId, userId);
    const enrollment = existing && existing.status === 1
      ? existing
      : await this.enroll(tenantId, courseId, userId, { enrolledBy: userId });
    return { purchased: !already, enrollment };
  }

  /**
   * A real gateway's answer, written down.
   *
   * Split out of purchase() rather than bolted into it, because the two have
   * different jobs: purchase() is the mock -- one statement, always captured,
   * nothing to reconcile. This one lands a payment that already happened
   * somewhere else, and everything about it is shaped by that arriving twice.
   *
   * The order below is the whole method and it has to be exactly this:
   *
   *   1. Look for the gateway's own transaction id FIRST, before any write. A
   *      capture that is already recorded is reported, not repeated. This is
   *      what makes the redirect-versus-webhook race harmless rather than a
   *      double charge.
   *   2. Only then write, and never downgrade. A `begin` that arrives late --
   *      after a webhook already captured -- must not reset the row to pending.
   *   3. Enrol using the same idempotent block purchase() uses, so whichever of
   *      the two arrives second finds an active enrolment and returns it.
   *   4. Catch a unique violation anyway and re-read. Steps 1 and 2 race each
   *      other under concurrency; the database is the only real arbiter.
   */
  async recordPurchase(tenantId: number, courseId: number, userId: string, input: {
    gateway: string; reference: string; providerRef?: string; amountMinor?: number;
  }) {
    const course = await this.course(tenantId, courseId);

    // 1. Already recorded under this transaction id?
    const seen = await this.#purchaseByReference(tenantId, input.gateway, input.reference);
    if (seen && String(seen.status) === 'captured') {
      const enrolment = await this.enrollment(tenantId, courseId, userId);
      return { replayed: true, purchase: seen, enrollment: enrolment };
    }

    const row = {
      tenant_id: tenantId,
      course_id: courseId,
      user_id: userId,
      amount_minor: input.amountMinor ?? Number(course.price_minor),
      currency: String(course.currency ?? 'INR'),
      gateway: input.gateway,
      reference: input.reference,
      provider_ref: input.providerRef ?? null,
      status: 'captured',
      updated_at: new Date().toISOString(),
    };

    // 2. One row per learner per course, so this is an upsert on that key --
    //    and a captured row is never written back to anything lesser.
    const existing = await this.#purchaseFor(tenantId, courseId, userId);
    let error;
    if (existing) {
      if (String(existing.status) === 'captured') {
        const enrolment = await this.enrollment(tenantId, courseId, userId);
        return { replayed: true, purchase: existing, enrollment: enrolment };
      }
      ({ error } = await this.#db.from('onyx_course_purchases')
        .update(row).eq('tenant_id', tenantId).eq('id', existing.id));
    } else {
      ({ error } = await this.#db.from('onyx_course_purchases').insert(row));
    }

    // 4. The database had the last word after all.
    if (error && /duplicate key|unique/i.test(String(error.message))) {
      const original = await this.#purchaseByReference(tenantId, input.gateway, input.reference);
      const enrolment = await this.enrollment(tenantId, courseId, userId);
      return { replayed: true, purchase: original, enrollment: enrolment };
    }
    if (error) throw new HttpError(500, 'The payment could not be recorded: ' + error.message);

    // 3. Theirs now.
    const already = await this.enrollment(tenantId, courseId, userId);
    const enrollment = already && already.status === 1
      ? already
      : await this.enroll(tenantId, courseId, userId, { enrolledBy: userId });
    return { replayed: false, purchase: { ...row }, enrollment };
  }

  async #purchaseByReference(tenantId: number, gateway: string, reference: string) {
    const { data } = await this.#db.from('onyx_course_purchases')
      .select('id, tenant_id, course_id, user_id, amount_minor, currency, gateway, reference, status')
      .eq('tenant_id', tenantId).eq('gateway', gateway).eq('reference', reference).maybeSingle();
    return data as Record<string, unknown> | null;
  }

  async #purchaseFor(tenantId: number, courseId: number, userId: string) {
    const { data } = await this.#db.from('onyx_course_purchases')
      .select('id, status')
      .eq('tenant_id', tenantId).eq('course_id', courseId).eq('user_id', userId).maybeSingle();
    return data as { id: number; status: string } | null;
  }

  /**
   * Bulk enrolment by batch -- the everyday case. An institution enrols a
   * cohort, not a person, and doing it one at a time is where mistakes live.
   */
  async enrollBatch(tenantId: number, courseId: number, batchId: number, enrolledBy: string) {
    await this.course(tenantId, courseId);
    const members = await this.batchMembers(tenantId, batchId);
    if (!members.length) return { enrolled: 0, already: 0 };

    // EVERY enrolment, not just the active ones. A learner withdrawn earlier
    // still has a row, and inserting a second would violate the unique
    // constraint and fail the whole batch -- so they are restored instead.
    const { data: existing } = await this.#db.from('onyx_enrollments')
      .select(ENROLLMENT_COLUMNS).eq('tenant_id', tenantId).eq('course_id', courseId);
    const byUser = new Map((existing ?? []).map((e) => [String(e.user_id), e]));

    const wanted = [...new Set(members.map((m) => String(m.user_id)))];
    const fresh = wanted.filter((id) => !byUser.has(id));
    const revived = wanted.filter((id) => byUser.get(id)?.status === 0);

    if (fresh.length) {
      const { error } = await this.#db.from('onyx_enrollments').insert(
        fresh.map((user_id) => ({
          tenant_id: tenantId, course_id: courseId, user_id,
          batch_id: batchId, status: 1, enrolled_by: enrolledBy,
        })));
      if (error) throw new HttpError(500, 'Could not enrol the batch: ' + error.message);
    }
    for (const id of revived) {
      await this.#db.from('onyx_enrollments').update({
        status: 1, batch_id: batchId, enrolled_by: enrolledBy,
        updated_at: new Date().toISOString(),
      }).eq('id', byUser.get(id)!.id);
    }
    return {
      enrolled: fresh.length + revived.length,
      already: wanted.length - fresh.length - revived.length,
    };
  }

  async withdraw(tenantId: number, courseId: number, userId: string) {
    const existing = await this.enrollment(tenantId, courseId, userId);
    if (!existing || existing.status !== 1) throw new HttpError(404, 'They are not enrolled.');
    // Withdrawn, not deleted: their attendance and submissions still happened,
    // and a deleted enrolment would orphan the record of them.
    await this.#db.from('onyx_enrollments')
      .update({ status: 0, updated_at: new Date().toISOString() }).eq('id', existing.id);
    return { user_id: userId, status: 0 };
  }

  /** Programme and semester must belong to the same institution as the course. */
  async #assertStructureBelongs(
    tenantId: number, programId?: number | null, semesterId?: number | null,
  ): Promise<void> {
    if (programId) await this.program(tenantId, programId);
    if (semesterId) {
      const { data } = await this.#db.from('onyx_semesters')
        .select('id, program_id').eq('tenant_id', tenantId).eq('id', semesterId).maybeSingle();
      if (!data) throw new HttpError(404, 'Semester not found.');
      if (programId && Number(data.program_id) !== Number(programId)) {
        throw new HttpError(422, 'That semester belongs to a different programme.');
      }
    }
  }
}
