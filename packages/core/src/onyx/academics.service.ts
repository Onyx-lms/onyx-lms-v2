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
const COURSE_COLUMNS = 'id, tenant_id, program_id, semester_id, code, title, slug, description, credits, self_enroll, status, created_by, created_at';
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
      self_enroll: input.self_enroll ? 1 : 0,
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
    if (!course.self_enroll) {
      throw new HttpError(403, 'This course is enrolled by the institution.');
    }
    return this.enroll(tenantId, courseId, userId, { enrolledBy: userId });
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
