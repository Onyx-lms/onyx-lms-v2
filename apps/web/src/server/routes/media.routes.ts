/**
 * P-05 -- media library endpoints.
 */
import type { Router, ReqLike } from '../router.ts';
import { z } from 'zod';
import { validate, ok, requireAuth, requireRole, parsePageQuery, badRequest } from '@onyx/core';
import type { AppContext } from '../app-context.ts';

const asReq = (req: ReqLike) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

// 25 MB. Course video does not belong in Supabase Storage (no adaptive
// bitrate, no signed HLS) -- that goes to a video provider instead.
const MAX_BYTES = 25 * 1024 * 1024;

export function registerMediaRoutes(app: Router, ctx: AppContext): void {
  app.post('/api/media', async (req) => {
    const claims = requireRole(asReq(req), ctx.jwtSecret, 'instructor', 'admin');
    const file = await (req as unknown as {
      file: () => Promise<{ filename: string; mimetype: string; toBuffer: () => Promise<Buffer> } | undefined>;
    }).file();
    if (!file) throw badRequest('No file was uploaded.');

    const buffer = await file.toBuffer();
    if (buffer.byteLength > MAX_BYTES) {
      throw badRequest(`File exceeds the ${MAX_BYTES / 1024 / 1024}MB limit.`);
    }

    const folder = String((req.query as Record<string, string>).folder ?? 'media');
    const privacy = (req.query as Record<string, string>).privacy === 'private' ? 'private' : 'public';
    const record = await ctx.media.upload(claims.user_id, folder, file.filename,
      new Uint8Array(buffer), { contentType: file.mimetype, privacy });
    return ok(record, 'File uploaded.');
  });

  app.get('/api/media', async (req) => {
    const claims = requireAuth(asReq(req), ctx.jwtSecret);
    return ok(await ctx.media.list(claims.user_id,
      parsePageQuery(req.query as Record<string, string>, 24), '/api/media'));
  });

  app.get('/api/media/:id/url', async (req) => {
    const claims = requireAuth(asReq(req), ctx.jwtSecret);
    const id = Number((req.params as { id: string }).id);
    return ok({ url: await ctx.media.signedUrl(id, claims.user_id) });
  });

  app.delete('/api/media/:id', async (req) => {
    const claims = requireAuth(asReq(req), ctx.jwtSecret);
    await ctx.media.remove(Number((req.params as { id: string }).id), claims.user_id);
    return ok({}, 'File deleted.');
  });

  /** Diagnostic: confirms SMTP is reachable without sending to a real user. */
  app.post('/api/admin/mail/test', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const body = validate(z.object({ to: z.string().email() }), req.body);
    const result = await ctx.mail.send({
      to: body.to,
      subject: 'Onyx EduTech test email',
      html: '<p>If you are reading this, SMTP is configured correctly.</p>',
    });
    return ok(result, result.sent ? 'Test email sent.' :
      result.skipped ? 'SMTP is not configured in settings.' : 'SMTP send failed.');
  });
}
