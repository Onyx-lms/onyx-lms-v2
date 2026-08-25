/**
 * S02 -- registration, email verification and password reset.
 *
 * Throttled 6/minute, matching Laravel's throttle:6,1.
 *
 * Tokens are emailed (P-06), never returned in the response body outside
 * development. Returning a reset token to an unauthenticated caller would let
 * anyone who can hit this endpoint take over any account by email address.
 */
import type { Router } from '../router.ts';
import { z } from 'zod';
import {
  validate, ok, tooManyRequests, verifyEmailTemplate, resetPasswordTemplate,
} from '@onyx/core';
import type { AppContext } from '../app-context.ts';

const RegisterBody = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(8),
});

const isDev = () => process.env.NODE_ENV !== 'production';

export function registerAccountRoutes(app: Router, ctx: AppContext): void {
  // Async since the limiter's buckets moved into Postgres -- they have to be
  // shared across instances to mean anything on serverless.
  const throttle = async (key: string) => {
    if (!(await ctx.limiter.check(key, 6)).allowed) throw tooManyRequests();
  };

  const siteTitle = async () => (await ctx.settings.get('system_title')) ?? 'Onyx EduTech';

  async function sendVerification(userId: number, email: string) {
    const token = await ctx.verification.issue(userId);
    const url = `${ctx.webOrigin}/verify-email?token=${encodeURIComponent(token)}`;
    const tpl = verifyEmailTemplate({ siteTitle: await siteTitle(), actionUrl: url });
    const result = await ctx.mail.send({ to: email, subject: tpl.subject, html: tpl.html });
    // Surfaced only in development so a misconfigured SMTP server is obvious
    // during setup instead of silently swallowing every signup.
    return isDev() ? { token, mail: result } : {};
  }

  app.post('/api/auth/register', async (req) => {
    const body = validate(RegisterBody, req.body);
    const requireVerification = await ctx.settings.getBool('student_email_verification');
    const user = await ctx.registration.register(body, requireVerification);

    const debug = requireVerification ? await sendVerification(user.id, user.email) : {};
    return ok({ user, ...debug },
      requireVerification ? 'Check your email to verify your account.' : 'Welcome aboard.');
  });

  app.post('/api/auth/email/verify', async (req) => {
    const body = validate(z.object({ token: z.string().min(1) }), req.body);
    const firstTime = await ctx.verification.consume(body.token);
    return ok({ verified: true, first_time: firstTime },
      firstTime ? 'Email verified.' : 'Email was already verified.');
  });

  app.post('/api/auth/email/resend', async (req) => {
    const body = validate(z.object({ email: z.string().email() }), req.body);
    await throttle('verify-resend:' + req.ip + ':' + body.email);
    const { data } = await ctx.db.from('users')
      .select('id, email, email_verified_at').eq('email', body.email.toLowerCase()).maybeSingle();
    // Same response whether or not the address exists or is already verified.
    const debug = data && !data.email_verified_at
      ? await sendVerification(data.id, data.email) : {};
    return ok(debug, 'If that address needs verifying, a link is on its way.');
  });

  app.post('/api/auth/password/forgot', async (req) => {
    const body = validate(z.object({ email: z.string().email() }), req.body);
    await throttle('pwd-forgot:' + req.ip);
    const token = await ctx.passwordReset.request(body.email);

    let debug: Record<string, unknown> = {};
    if (token) {
      const url = `${ctx.webOrigin}/reset-password?token=${encodeURIComponent(token)}` +
        `&email=${encodeURIComponent(body.email)}`;
      const tpl = resetPasswordTemplate({ siteTitle: await siteTitle(), actionUrl: url });
      const mail = await ctx.mail.send({ to: body.email, subject: tpl.subject, html: tpl.html });
      if (isDev()) debug = { token, mail };
    }
    return ok(debug, 'If that address exists, a reset link is on its way.');
  });

  app.post('/api/auth/password/reset', async (req) => {
    const body = validate(z.object({
      email: z.string().email(),
      token: z.string().min(1),
      password: z.string().min(8),
    }), req.body);
    await throttle('pwd-reset:' + req.ip);
    await ctx.passwordReset.reset(body.email, body.token, body.password);
    return ok({}, 'Password has been reset.');
  });
}
