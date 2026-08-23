/**
 * Onyx O05 -- Onyx Career.
 *
 * "From learning to employability."
 *
 * Two things here are unlike every other Onyx route file.
 *
 * **One route is public.** `/api/onyx/verify/:credentialId` takes no token,
 * because the person checking a credential is a stranger who does not have an
 * account and never will. That is the whole point of a verifiable certificate,
 * and it is why the credential id is 32 random hex characters and the response
 * carries only what a verifier is entitled to see.
 *
 * **One role is an outsider.** An `employer` is a member of the institution
 * with an account scoped to their own company. Every route they can reach goes
 * through `assertEmployerOwns`, and nothing gives them a roster, a cohort or
 * another employer's pipeline.
 */
import type { Router, ReqLike } from '../../router.ts';
import { z } from 'zod';
import {
  validate, ok, HttpError, requireOnyx, requireOnyxRole,
  APPLICATION_STATUSES, ROUND_OUTCOMES, pdfResume,
} from '@onyx/core';
import type { ApplicationStatus, RoundOutcome } from '@onyx/core';
import type { AppContext } from '../../app-context.ts';
import { assertCan } from '../../capability.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const idOf = (req: ReqLike, key = 'id') =>
  Number((req.params as Record<string, string>)[key]);
const ipOf = (req: ReqLike) => (req as unknown as { ip?: string }).ip ?? null;

/** Who runs placement. Employers are outsiders and are never in this list. */
const PLACEMENT = ['admin', 'placement'] as const;
/** Who may issue a credential in the institution's name. */
const ISSUERS = ['admin', 'exams', 'placement'] as const;

const StatusSchema = z.enum(APPLICATION_STATUSES as unknown as [ApplicationStatus, ...ApplicationStatus[]]);
const OutcomeSchema = z.enum(ROUND_OUTCOMES as unknown as [RoundOutcome, ...RoundOutcome[]]);

export function registerOnyxCareerRoutes(app: Router, ctx: AppContext): void {
  const viewerOf = async (req: ReqLike) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return { claims, viewer: { role: claims.tenant_role, userId: claims.user_id } };
  };

  // -------------------------------------------------------------------------
  // CAR-03 -- certificates
  // -------------------------------------------------------------------------

  /**
   * The public verification page's data. No token, by design.
   *
   * Deliberately not tenant-scoped either: a verifier holding a credential has
   * no idea which institution issued it, and requiring them to know would make
   * the feature useless.
   */
  app.get('/api/onyx/verify/:credentialId', async (req) => {
    const credentialId = String((req.params as { credentialId: string }).credentialId ?? '');
    if (!/^[0-9A-Fa-f]{8,64}$/.test(credentialId)) {
      // The same answer as a credential that does not exist: a verifier learns
      // only whether the one in their hand is good.
      return ok({ valid: false, reason: 'not_found' });
    }
    return ok(await ctx.onyxCareer.verify(credentialId));
  });

  app.post('/api/onyx/certificates', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'exams', 'placement', 'faculty');
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'careers.certificates');
    const body = validate(z.object({
      user_id: z.string().uuid(),
      title: z.string().min(1).max(255),
      kind: z.enum(['course', 'assessment', 'contest', 'program']).optional(),
      course_id: z.number().int().positive().nullish(),
      assessment_id: z.number().int().positive().nullish(),
      detail: z.record(z.string(), z.unknown()).optional(),
      expires_at: z.string().nullish(),
    }), req.body);

    // Only somebody at this institution can be given its certificate.
    const membership = await ctx.onyxTenancy.membership(claims.tenant_id, body.user_id);
    if (!membership) throw new HttpError(422, 'They are not at this institution.');

    const certificate = await ctx.onyxCareer.issueCertificate(claims.tenant_id, claims.user_id, body);
    await ctx.onyxAudit.record(claims, {
      action: 'certificate.issued', entityType: 'certificate', entityId: Number(certificate.id),
      after: { credential_id: certificate.credential_id, user_id: body.user_id }, ip: ipOf(req),
    });
    return ok(certificate, 'Certificate issued.');
  });

  app.post('/api/onyx/certificates/:id/revoke', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...ISSUERS);
    const body = validate(z.object({ reason: z.string().min(1).max(500) }), req.body);
    const revoked = await ctx.onyxCareer.revokeCertificate(claims.tenant_id, idOf(req), body.reason);
    await ctx.onyxAudit.record(claims, {
      action: 'certificate.revoked', entityType: 'certificate', entityId: idOf(req),
      after: { reason: body.reason }, ip: ipOf(req),
    });
    return ok(revoked, 'Revoked.');
  });

  /**
   * What this institution has issued.
   *
   * The same roles that may issue may read the register -- revoking a
   * credential you cannot find is not a workflow, and it was the only thing
   * standing between the API and a screen.
   */
  app.get('/api/onyx/certificates', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...ISSUERS);
    const q = req.query as { user_id?: string };
    const userId = q.user_id || undefined;
    return ok(await ctx.onyxCareer.issuedCertificates(claims.tenant_id,
      userId ? { userId } : {}));
  });

  /**
   * The credential as a document. The holder's own, or an issuer's copy.
   *
   * Not tenant-public like `/verify`: this carries the holder's name on a
   * printable page, and a stranger holding a credential id is entitled to
   * check it, not to a copy of it.
   */
  app.get('/api/onyx/certificates/:id/document.pdf', async (req, reply) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const { file, filename } = await ctx.onyxCareer.certificatePdf(
      claims.tenant_id, idOf(req), {
        viewer: { userId: claims.user_id, role: claims.tenant_role },
        baseUrl: process.env.WEB_URL,
      });

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'attachment; filename="' + filename + '"');
    return reply.send(file);
  });

  app.get('/api/onyx/my/certificates', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxCareer.certificates(claims.tenant_id, claims.user_id));
  });

  // -------------------------------------------------------------------------
  // O10 -- the resume
  //
  // Everything is under /my/ and everything is scoped to claims.user_id. NO
  // capability key: a person's own resume is not a delegated act, the same
  // reasoning PATCH /api/onyx/my/profile-details follows. There is deliberately
  // no route for staff to read a learner's resume -- CareerService.profile
  // already answers that, for the roles allowed to ask, and a second projection
  // of the same records is a second place for the rule to be wrong.
  // -------------------------------------------------------------------------

  /** The assembled document, and everything an editor needs to change it. */
  app.get('/api/onyx/my/resume', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxResume.build(claims.tenant_id, claims.user_id,
      { userId: claims.user_id, role: claims.tenant_role }));
  });

  /**
   * The person's own decisions about it.
   *
   * Every array is bounded. These are jsonb columns, so nothing in the database
   * stops a request from storing a megabyte of them, and a resume with four
   * hundred hidden keys is a request that was never made in good faith.
   */
  app.patch('/api/onyx/my/resume', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      title: z.string().max(120).optional(),
      objective: z.string().max(1200).optional(),
      // Nullable AND optional, and they mean different things: null is "use my
      // profile headline", absent is "leave whatever I set before".
      headline_override: z.string().max(160).nullable().optional(),
      include_phone: z.boolean().optional(),
      hidden: z.array(z.string().max(80)).max(500).optional(),
      section_order: z.array(z.string().max(40)).max(20).optional(),
      extras: z.array(z.object({
        // Sent back by the editor so an entry keeps its identity across a
        // save. Absent for a newly typed one, which the service numbers.
        id: z.number().int().positive().optional(),
        section: z.string().max(40).optional(),
        title: z.string().max(200),
        detail: z.string().max(1000).optional(),
        when: z.string().max(40).optional(),
      })).max(50).optional(),
    }), req.body);
    return ok(await ctx.onyxResume.save(claims.tenant_id, claims.user_id, body),
      'Saved.');
  });

  /**
   * The resume as a document.
   *
   * Modelled exactly on the certificate route above: application/pdf, an
   * attachment disposition, and the Buffer returned. Binary transport already
   * works -- the catch-all wraps a Uint8Array in a ReadableStream.
   */
  app.get('/api/onyx/my/resume/document.pdf', async (req, reply) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const doc = await ctx.onyxResume.build(claims.tenant_id, claims.user_id,
      { userId: claims.user_id, role: claims.tenant_role });

    const file = pdfResume({
      name: doc.name,
      headline: doc.headline,
      contact: [doc.email, doc.phone, doc.website],
      objective: doc.objective,
      sections: doc.sections.map((s) => ({
        label: s.label,
        items: s.items.map((i) => ({
          title: i.title, subtitle: i.subtitle, detail: i.detail, when: i.when,
        })),
      })),
    });

    // Their own name on the file, because a folder of "resume.pdf" is a folder
    // an employer cannot sort. Reduced to the characters a filename header can
    // carry without quoting rules getting involved.
    const stem = (doc.name || 'resume').replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 60) || 'resume';
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'attachment; filename="' + stem + '-resume.pdf"');
    return reply.send(file);
  });

  /**
   * The batches this person is in, each with its programme.
   *
   * The resume's education section derives from this. Its own endpoint because
   * it is a genuinely missing read -- there was a way to ask "who is in this
   * batch" and no way to ask "which batches am I in".
   */
  app.get('/api/onyx/my/batches', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxAcademics.batchesFor(claims.tenant_id, claims.user_id));
  });

  // -------------------------------------------------------------------------
  // CAR-05 -- skills and readiness
  // -------------------------------------------------------------------------

  app.get('/api/onyx/skills', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxCareer.skills(claims.tenant_id));
  });

  app.post('/api/onyx/skills', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'placement', 'faculty');
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'careers.skills');
    const body = validate(z.object({
      name: z.string().min(1).max(255),
      category: z.string().max(100).nullish(),
    }), req.body);
    return ok(await ctx.onyxCareer.createSkill(claims.tenant_id, body), 'Skill added.');
  });

  app.post('/api/onyx/skills/award', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'placement', 'faculty');
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'careers.skills');
    const body = validate(z.object({
      user_id: z.string().uuid(),
      skill_id: z.number().int().positive(),
      source_type: z.enum(['course', 'assessment', 'problem', 'workspace', 'certificate', 'contest']),
      source_id: z.number().int().positive().nullish(),
      strength: z.number().int().min(0).max(100).optional(),
      evidence: z.record(z.string(), z.unknown()).optional(),
    }), req.body);
    return ok(await ctx.onyxCareer.awardSkill(claims.tenant_id, {
      ...body, source_id: body.source_id ?? null,
    }), 'Recorded.');
  });

  /** The learner's own passport and score, with the whole breakdown. */
  app.get('/api/onyx/my/profile', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxCareer.profile(claims.tenant_id, claims.user_id, viewer));
  });

  app.get('/api/onyx/profiles/:id', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const userId = (req.params as { id: string }).id;
    return ok(await ctx.onyxCareer.profile(claims.tenant_id, userId, viewer));
  });

  // -------------------------------------------------------------------------
  // CAR-04 -- employers, jobs, applications, drives
  // -------------------------------------------------------------------------

  app.get('/api/onyx/employers', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...PLACEMENT);
    return ok(await ctx.onyxPlacement.employers(claims.tenant_id));
  });

  app.patch('/api/onyx/employers/:id', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...PLACEMENT);
    const body = validate(z.object({
      name: z.string().min(1).max(255).optional(),
      website: z.string().max(255).nullish(),
      about: z.string().max(10_000).nullish(),
      contact_name: z.string().max(255).nullish(),
      contact_email: z.string().email().nullish(),
      user_id: z.string().uuid().nullish(),
    }), req.body);
    return ok(await ctx.onyxPlacement.updateEmployer(claims.tenant_id, idOf(req), body), 'Updated.');
  });

  /**
   * The one employer record an employer contact is actually allowed to
   * know exists -- their own. `GET /employers` is placement-office-only (it
   * lists every company at the institution); an employer posting a job
   * still needs *an* employer_id to post it under, and this is where they
   * get it without being handed the roster of every other company too.
   */
  app.get('/api/onyx/employers/mine', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    if (viewer.role !== 'employer') {
      throw new HttpError(403, 'Only an employer contact has one of these.');
    }
    const mine = await ctx.onyxPlacement.employerFor(claims.tenant_id, viewer.userId);
    if (!mine) throw new HttpError(404, 'No employer record is linked to this account.');
    return ok(mine);
  });

  app.post('/api/onyx/employers', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...PLACEMENT);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'careers.employers');
    const body = validate(z.object({
      name: z.string().min(1).max(255),
      website: z.string().max(255).nullish(),
      about: z.string().max(10_000).nullish(),
      contact_name: z.string().max(255).nullish(),
      contact_email: z.string().email().nullish(),
      user_id: z.string().uuid().nullish(),
    }), req.body);

    // An employer contact signs in as a member with the `employer` role. Tying
    // the record to anyone else would give them somebody else's account.
    if (body.user_id) {
      const membership = await ctx.onyxTenancy.membership(claims.tenant_id, body.user_id);
      if (!membership) throw new HttpError(422, 'That account is not at this institution.');
      if (membership.role !== 'employer') {
        throw new HttpError(422, 'An employer contact needs the employer role.');
      }
    }
    const employer = await ctx.onyxPlacement.createEmployer(
      claims.tenant_id, claims.user_id, body);

    // CAR-04a: "employer records ... with contacts and an invitation flow".
    // The record could always be linked to an account; nothing ever told the
    // contact that it had been.
    if (body.user_id) {
      const tenant = await ctx.onyxTenancy.tenant(claims.tenant_id);
      await ctx.onyxNotify.notify(claims.tenant_id, {
        userId: body.user_id,
        kind: 'employer.invited',
        title: (tenant?.name ?? 'An institution') + ' has given you employer access',
        body: 'You can post roles and see your own pipeline. Nothing else at the '
          + 'institution is shared with you.',
        link: '/onyx/jobs',
        email: body.contact_email ? { to: body.contact_email } : null,
      });
    }
    return ok(employer,
      'Employer added.');
  });

  app.get('/api/onyx/jobs', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxPlacement.jobs(claims.tenant_id, viewer));
  });

  app.post('/api/onyx/jobs', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    if (viewer.role !== 'employer' && !(PLACEMENT as readonly string[]).includes(viewer.role)) {
      throw new HttpError(403, 'This action is unauthorized.');
    }
    const body = validate(z.object({
      employer_id: z.number().int().positive(),
      title: z.string().min(1).max(255),
      description: z.string().max(50_000).nullish(),
      location: z.string().max(255).nullish(),
      compensation: z.string().max(255).nullish(),
      openings: z.number().int().min(1).max(10_000).optional(),
      min_readiness: z.number().int().min(0).max(100).nullish(),
      min_attendance: z.number().int().min(0).max(100).nullish(),
      required_skills: z.array(z.number().int().positive()).max(30).optional(),
      program_ids: z.array(z.number().int().positive()).max(50).optional(),
      batch_ids: z.array(z.number().int().positive()).max(50).optional(),
      closes_at: z.string().nullish(),
    }), req.body);
    return ok(await ctx.onyxPlacement.createJob(claims.tenant_id, claims.user_id, viewer, body),
      'Job created.');
  });

  app.get('/api/onyx/jobs/:id', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const job = await ctx.onyxPlacement.job(claims.tenant_id, idOf(req));
    const staff = (PLACEMENT as readonly string[]).includes(viewer.role);
    if (job.status !== 'open' && !staff) {
      if (viewer.role !== 'employer') throw new HttpError(404, 'Job not found.');
      await ctx.onyxPlacement.assertEmployerOwns(claims.tenant_id, Number(job.employer_id), viewer);
    }
    // A learner gets their own eligibility with the post, so the reason they
    // cannot apply is on the same screen as the button.
    const eligibility = viewer.role === 'student'
      ? await ctx.onyxPlacement.eligibility(claims.tenant_id, idOf(req), claims.user_id)
      : undefined;
    return ok({ ...job, eligibility });
  });

  app.post('/api/onyx/jobs/:id/publish', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'careers.jobs');
    return ok(await ctx.onyxPlacement.publishJob(claims.tenant_id, idOf(req), viewer), 'Published.');
  });

  app.post('/api/onyx/jobs/:id/close', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxPlacement.closeJob(claims.tenant_id, idOf(req), viewer), 'Closed.');
  });

  app.get('/api/onyx/jobs/:id/eligibility', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlacement.eligibility(claims.tenant_id, idOf(req), claims.user_id));
  });

  app.post('/api/onyx/jobs/:id/apply', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({ note: z.string().max(5000).nullish() }), req.body ?? {});
    return ok(await ctx.onyxPlacement.apply(
      claims.tenant_id, idOf(req), claims.user_id, body.note), 'Applied.');
  });

  app.get('/api/onyx/jobs/:id/applicants', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxPlacement.applicants(claims.tenant_id, idOf(req), viewer));
  });

  app.get('/api/onyx/my/applications', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlacement.myApplications(claims.tenant_id, claims.user_id));
  });

  app.patch('/api/onyx/applications/:id', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const body = validate(z.object({
      status: StatusSchema,
      note: z.string().max(5000).nullish(),
    }), req.body);
    return ok(await ctx.onyxPlacement.decide(claims.tenant_id, idOf(req), viewer, body),
      'Updated.');
  });

  app.post('/api/onyx/applications/:id/withdraw', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxPlacement.withdraw(claims.tenant_id, idOf(req), claims.user_id),
      'Withdrawn.');
  });

  /*
   * QA F6. This required only a session, and `drives()` narrows its query for
   * exactly one role -- `employer`, to their own drives -- so every OTHER role
   * received the institution's entire recruitment calendar: students,
   * guardians, the exams office.
   *
   * `employer` is on the list beside PLACEMENT rather than folded into it,
   * because an employer is an outsider who may see their own drives and
   * nothing else, and the service is what enforces that half. The role guard
   * decides who may ask; the service decides what they are shown.
   */
  app.get('/api/onyx/drives', async (req) => {
    await requireOnyxRole(asReq(req), ctx.jwtSecret, ...PLACEMENT, 'employer');
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxPlacement.drives(claims.tenant_id, viewer));
  });

  app.post('/api/onyx/drives', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...PLACEMENT);
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'careers.drives');
    const body = validate(z.object({
      employer_id: z.number().int().positive(),
      title: z.string().min(1).max(255),
      job_id: z.number().int().positive().nullish(),
      scheduled_at: z.string().nullish(),
      venue: z.string().max(255).nullish(),
      rounds: z.array(z.object({
        name: z.string().min(1).max(255),
        scheduled_at: z.string().nullish(),
      })).max(20).optional(),
    }), req.body);
    return ok(await ctx.onyxPlacement.createDrive(claims.tenant_id, claims.user_id, body),
      'Drive created.');
  });

  app.post('/api/onyx/rounds/:id/results', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...PLACEMENT);
    const body = validate(z.object({
      entries: z.array(z.object({
        user_id: z.string().uuid(),
        outcome: OutcomeSchema,
        note: z.string().max(500).nullish(),
      })).min(1).max(2000),
    }), req.body);
    return ok(await ctx.onyxPlacement.recordRound(
      claims.tenant_id, idOf(req), claims.user_id, body.entries), 'Recorded.');
  });

  /** CAR-04c: the reconciliation between rounds and offers. */
  app.get('/api/onyx/drives/:id/summary', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, ...PLACEMENT);
    return ok(await ctx.onyxPlacement.driveSummary(claims.tenant_id, idOf(req)));
  });

  // -------------------------------------------------------------------------
  // CAR-01 -- contests
  // -------------------------------------------------------------------------

  app.get('/api/onyx/contests', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxContests.contests(claims.tenant_id, claims.tenant_role));
  });

  app.post('/api/onyx/contests', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty', 'placement');
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'lab.contests');
    const body = validate(z.object({
      title: z.string().min(1).max(255),
      description: z.string().max(50_000).nullish(),
      starts_at: z.string().min(1),
      ends_at: z.string().min(1),
      problems: z.array(z.object({
        problem_id: z.number().int().positive(),
        points: z.number().int().min(1).max(10_000),
      })).max(50).optional(),
      team_size: z.number().int().min(1).max(10).optional(),
      penalty_minutes: z.number().int().min(0).max(240).optional(),
      freeze_minutes: z.number().int().min(0).max(1440).optional(),
    }), req.body);
    return ok(await ctx.onyxContests.create(claims.tenant_id, claims.user_id, body),
      'Contest created.');
  });

  app.get('/api/onyx/contests/:id', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const contest = await ctx.onyxContests.contest(claims.tenant_id, idOf(req));
    const staff = ['admin', 'faculty', 'placement'].includes(claims.tenant_role);
    if (contest.status === 'draft' && !staff) throw new HttpError(404, 'Contest not found.');
    return ok({
      ...contest,
      my_team: await ctx.onyxContests.teamFor(claims.tenant_id, idOf(req), claims.user_id),
      teams: await ctx.onyxContests.teams(claims.tenant_id, idOf(req)),
    });
  });

  app.post('/api/onyx/contests/:id/publish', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'faculty', 'placement');
    return ok(await ctx.onyxContests.publish(claims.tenant_id, idOf(req)), 'Published.');
  });

  app.post('/api/onyx/contests/:id/teams', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({ name: z.string().min(1).max(255) }), req.body);
    return ok(await ctx.onyxContests.createTeam(
      claims.tenant_id, idOf(req), claims.user_id, body.name), 'Team created.');
  });

  app.post('/api/onyx/teams/:id/join', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxContests.joinTeam(claims.tenant_id, idOf(req), claims.user_id),
      'Joined.');
  });

  app.post('/api/onyx/contests/:id/submit', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      problem_id: z.number().int().positive(),
      submission_id: z.number().int().positive(),
    }), req.body);
    return ok(await ctx.onyxContests.recordSubmission(
      claims.tenant_id, idOf(req), claims.user_id, body), 'Recorded.');
  });

  app.get('/api/onyx/contests/:id/leaderboard', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxContests.leaderboard(claims.tenant_id, idOf(req),
      { role: claims.tenant_role }));
  });

  // -------------------------------------------------------------------------
  // CAR-02 -- mock interviews
  // -------------------------------------------------------------------------

  app.get('/api/onyx/my/interviews', async (req) => {
    const claims = await requireOnyx(asReq(req), ctx.jwtSecret);
    return ok(await ctx.onyxContests.myInterviews(claims.tenant_id, claims.user_id));
  });

  app.get('/api/onyx/interviews/mine', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret,
      'admin', 'faculty', 'placement', 'employer');
    return ok(await ctx.onyxContests.interviewsFor(claims.tenant_id, claims.user_id));
  });

  app.post('/api/onyx/interviews', async (req) => {
    const claims = await requireOnyxRole(asReq(req), ctx.jwtSecret, 'admin', 'placement', 'faculty');
    await assertCan(ctx, claims.tenant_id, claims.tenant_role, 'careers.interviews');
    const body = validate(z.object({
      user_id: z.string().uuid(),
      interviewer_id: z.string().uuid().nullish(),
      title: z.string().min(1).max(255),
      scheduled_at: z.string().min(1),
      duration_minutes: z.number().int().min(5).max(480).optional(),
      join_url: z.string().max(500).nullish(),
    }), req.body);
    return ok(await ctx.onyxContests.scheduleInterview(claims.tenant_id, body), 'Scheduled.');
  });

  app.get('/api/onyx/interviews/:id', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxContests.interview(claims.tenant_id, idOf(req),
      { role: viewer.role, userId: viewer.userId }));
  });

  app.post('/api/onyx/interviews/:id/feedback', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    const body = validate(z.object({
      feedback: z.array(z.object({
        criterion: z.string().min(1).max(255),
        score: z.number().min(0),
        of: z.number().min(1),
        comment: z.string().max(5000).nullish(),
      })).min(1).max(30),
      overall: z.number().int().min(1).max(5),
      notes: z.string().max(20_000).nullish(),
      release: z.boolean().optional(),
      recording_path: z.string().max(500).nullish(),
      recording_consented: z.boolean().optional(),
    }), req.body);
    return ok(await ctx.onyxContests.recordFeedback(claims.tenant_id, idOf(req),
      { role: viewer.role, userId: viewer.userId }, body), 'Feedback saved.');
  });

  app.post('/api/onyx/interviews/:id/release', async (req) => {
    const { claims, viewer } = await viewerOf(req);
    return ok(await ctx.onyxContests.releaseFeedback(claims.tenant_id, idOf(req),
      { role: viewer.role, userId: viewer.userId }), 'Released to the learner.');
  });
}
