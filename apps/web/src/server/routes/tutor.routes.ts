/**
 * S16 -- tutor booking (TB-01 .. TB-07).
 */
import type { Router, ReqLike } from '../router.ts';
import { z } from 'zod';
import {
  validate, ok, requireAuth, requireRole, forbidden, HttpError,
  tuitionStarted, newRoomCode, roomName, jitsiOptions, externalApiUrl, JITSI_DOMAIN,
  phpJsonDecode, type Taxonomy,
} from '@onyx/core';
import type { AppContext } from '../app-context.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const idOf = (req: ReqLike) => Number((req.params as { id: string }).id);
const TABLE: Record<string, Taxonomy> = {
  categories: 'tutor_categories', subjects: 'tutor_subjects',
};

function taxonomyOf(req: ReqLike): Taxonomy {
  const kind = (req.params as { kind: string }).kind;
  const table = TABLE[kind];
  if (!table) throw new HttpError(404, 'Not found.');
  return table;
}

export function registerTutorRoutes(app: Router, ctx: AppContext): void {
  // ---- TB-01: taxonomy ----

  app.get('/api/tutor/:kind', async (req) =>
    ok(await ctx.tutorCatalog.list(taxonomyOf(req), true)));

  app.get('/api/admin/tutor/:kind', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.tutorCatalog.list(taxonomyOf(req)));
  });

  app.post('/api/admin/tutor/:kind', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({ name: z.string().min(1).max(255) }), req.body);
    return ok(await ctx.tutorCatalog.create(taxonomyOf(req), body.name), 'Created.');
  });

  app.patch('/api/admin/tutor/:kind/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({ name: z.string().min(1).max(255) }), req.body);
    await ctx.tutorCatalog.rename(taxonomyOf(req), idOf(req), body.name);
    return ok({}, 'Updated.');
  });

  app.post('/api/admin/tutor/:kind/:id/status', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.tutorCatalog.toggleStatus(taxonomyOf(req), idOf(req)), 'Status updated.');
  });

  app.delete('/api/admin/tutor/:kind/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    await ctx.tutorCatalog.remove(taxonomyOf(req), idOf(req));
    return ok({}, 'Deleted.');
  });

  // ---- TB-02: what I can teach ----

  app.get('/api/tutor/me/subjects', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, 'admin', 'instructor');
    return ok(await ctx.tutorCatalog.canTeachFor(c.user_id));
  });

  app.post('/api/tutor/me/subjects', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, 'admin', 'instructor');
    const body = validate(z.object({
      category_id: z.number().int().positive(),
      subject_id: z.number().int().positive(),
      price: z.number().min(0),
      description: z.string().max(20000).nullish(),
      thumbnail: z.string().max(255).nullish(),
    }), req.body);
    return ok(await ctx.tutorCatalog.addCanTeach(c.user_id, body), 'Subject added.');
  });

  app.patch('/api/tutor/me/subjects/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, 'admin', 'instructor');
    const body = validate(z.object({
      price: z.number().min(0).optional(),
      description: z.string().max(20000).nullish(),
      thumbnail: z.string().max(255).nullish(),
      status: z.union([z.literal(0), z.literal(1)]).optional(),
    }), req.body);
    return ok(await ctx.tutorCatalog.updateCanTeach(idOf(req), c.user_id, body), 'Updated.');
  });

  app.delete('/api/tutor/me/subjects/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, 'admin', 'instructor');
    await ctx.tutorCatalog.removeCanTeach(idOf(req), c.user_id);
    return ok({}, 'Removed.');
  });

  // ---- TB-04: public discovery ----

  app.get('/api/tutors', async (req) => {
    const q = req.query as { category?: string; subject?: string; search?: string };
    return ok(await ctx.tutorCatalog.tutors({
      categoryId: q.category ? Number(q.category) : undefined,
      subjectId: q.subject ? Number(q.subject) : undefined,
      search: q.search,
    }));
  });

  app.get('/api/tutors/:id/schedules', async (req) => {
    const q = req.query as { date?: string };
    const tutorId = idOf(req);
    const slots = q.date
      ? await ctx.tutorSchedules.onDate(tutorId, q.date)
      : await ctx.tutorSchedules.forTutor(tutorId, {
          from: Math.floor(Date.now() / 1000), onlyOpen: true,
        });
    return ok({
      schedules: slots,
      subjects: await ctx.tutorCatalog.canTeachFor(tutorId),
      reviews: await ctx.tutorBookings.reviewsFor(tutorId),
    });
  });

  // ---- TB-03: my schedule ----

  app.get('/api/tutor/me/schedules', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, 'admin', 'instructor');
    const q = req.query as { date?: string };
    return ok(q.date
      ? await ctx.tutorSchedules.onDate(c.user_id, q.date, false)
      : await ctx.tutorSchedules.forTutor(c.user_id));
  });

  app.post('/api/tutor/me/schedules', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, 'admin', 'instructor');
    const body = validate(z.object({
      category_id: z.number().int().positive(),
      subject_id: z.number().int().positive(),
      tution_type: z.union([z.literal(0), z.literal(1)]),
      start_time: z.string().min(1),
      end_time: z.string().nullish(),
      duration: z.number().int().min(5).max(1440),
      days: z.array(z.string().max(16)).optional(),
      description: z.string().max(20000).nullish(),
    }), req.body);

    // The price comes from the tutor's own can-teach row, never the request.
    const price = await ctx.tutorCatalog.priceFor(c.user_id, body.category_id, body.subject_id);
    if (price === null) {
      throw new HttpError(422, 'Add that subject to what you teach before scheduling it.');
    }
    const created = await ctx.tutorSchedules.create(c.user_id, { ...body, price });
    return ok(created, 'Schedule successfully created.');
  });

  app.delete('/api/tutor/me/schedules/:id', async (req) => {
    const c = requireRole(asReq(req), ctx.jwtSecret, 'admin', 'instructor');
    await ctx.tutorSchedules.remove(idOf(req), c.user_id);
    return ok({}, 'Schedule removed.');
  });

  // ---- TB-05: booking ----

  app.post('/api/tutor-schedules/:id/book', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const invoice = '#' + ctx.bootcampPurchases.newInvoice();
    return ok(await ctx.tutorBookings.book(idOf(req), c.user_id, {
      invoice, paymentMethod: 'free',
    }), 'Session booked.');
  });

  app.get('/api/my-bookings', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const asTutor = (req.query as { as?: string }).as === 'tutor';
    const rows = asTutor
      ? await ctx.tutorBookings.forTutor(c.user_id)
      : await ctx.tutorBookings.forStudent(c.user_id);
    return ok({
      live: rows.filter((b) => b.tab === 'live'),
      upcoming: rows.filter((b) => b.tab === 'upcoming'),
      archive: rows.filter((b) => b.tab === 'archive'),
    });
  });

  app.get('/api/tutor-invoices/:invoice', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const invoice = (req.params as { invoice: string }).invoice;
    return ok(await ctx.tutorBookings.byInvoice(invoice, c.user_id, c.app_role === 'admin'));
  });

  /**
   * TB-06 -- join a session.
   *
   * The window is enforced for real here: tution_started() used firstOrNew()
   * and so returned true for every input, including ids that do not exist.
   */
  app.get('/api/tutor-bookings/:id/join', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const booking = await ctx.tutorBookings.find(idOf(req));

    const isTutor = Number(booking.tutor_id) === c.user_id;
    const isStudent = Number(booking.student_id) === c.user_id;
    if (!isTutor && !isStudent && c.app_role !== 'admin') throw forbidden();

    const seconds = Math.floor(Date.now() / 1000);
    if (Number(booking.end_time) <= seconds) {
      throw new HttpError(403, 'Time up! Session is over.');
    }
    if (Number(booking.start_time) - 15 * 60 > seconds) {
      throw new HttpError(403, 'You can join the class 15 minutes before the class start.');
    }

    // Laravel created the meeting lazily on the first join; same here, except a
    // Jitsi room needs nothing but a code, so a session works with no Zoom.
    let joining = phpJsonDecode<{ room_code?: string } | null>(
      booking.joining_data as string, null);
    if (!joining?.room_code) {
      joining = { room_code: newRoomCode() };
      await ctx.tutorBookings.setJoiningData(booking.id, joining);
    }

    const { data: user } = await ctx.db.from('users')
      .select('name, email').eq('id', c.user_id).maybeSingle();
    const host = isTutor || c.app_role === 'admin';
    const room = roomName('tuition', booking.id, joining.room_code!);

    return ok({
      provider: 'jitsi',
      mode: 'embed' as const,
      // The tutor hosts; the student joins as a participant. Laravel sent BOTH
      // to Zoom's start_url, which is a host credential.
      is_host: host,
      domain: JITSI_DOMAIN,
      script_url: externalApiUrl(),
      options: jitsiOptions({
        room,
        displayName: String(user?.name ?? 'Participant'),
        email: String(user?.email ?? ''),
        isHost: host,
      }),
      class: {
        id: booking.id, class_topic: 'Tuition session', note: null,
        start_time: booking.start_time, end_time: booking.end_time,
        startable: tuitionStarted({ ...booking, joining_data: 'set' } as never),
      },
    });
  });

  // ---- TB-07: reviews ----

  app.get('/api/tutors/:id/reviews', async (req) =>
    ok(await ctx.tutorBookings.reviewsFor(idOf(req))));

  app.post('/api/tutors/:id/reviews', async (req) => {
    const c = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      rating: z.number().int().min(1).max(5),
      review: z.string().max(5000).default(''),
    }), req.body);
    return ok(await ctx.tutorBookings.review(idOf(req), c.user_id, body.rating, body.review),
      'Thanks for your review.');
  });
}
