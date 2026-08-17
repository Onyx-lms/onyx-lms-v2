/**
 * A-01 -- login endpoint.
 *
 * Uses the same email+password pair that Laravel uses today, against the same
 * users table, so existing accounts work unchanged.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validate, ok, unauthorized, tooManyRequests } from '@onyx/core';
import type { AppContext } from '../context.ts';

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/auth/login', async (req, reply) => {
    const body = validate(LoginBody, req.body);

    // Laravel throttles auth attempts; same shape here, keyed on ip+email.
    const key = `login:${req.ip}:${body.email}`;
    const gate = ctx.limiter.check(key, 6);
    if (!gate.allowed) {
      reply.header('Retry-After', String(gate.retryAfter));
      throw tooManyRequests();
    }

    const requireVerified = await ctx.settings.getBool('student_email_verification');
    const result = await ctx.auth.login(body.email, body.password, requireVerified);

    if (!result.ok) {
      if (result.reason === 'email_unverified') {
        throw unauthorized('Your email address is not verified.');
      }
      throw unauthorized('These credentials do not match our records.');
    }

    // A-10: one row per (user, session), not per request.
    await ctx.deviceIps.record(
      result.user!.id,
      req.ip,
      result.token!.slice(-24),
      String(req.headers['user-agent'] ?? ''),
    ).catch(() => { /* tracking must never block a login */ });

    reply.setCookie('onyx_token', result.token!, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Number(process.env.ACCESS_TOKEN_TTL ?? 3600),
    });

    return ok({
      user: result.user,
      token: result.token,
      expires_at: result.expiresAt,
      redirect_to: result.redirectTo,
    }, 'Signed in.');
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie('onyx_token', { path: '/' });
    return ok({}, 'Signed out.');
  });
}
