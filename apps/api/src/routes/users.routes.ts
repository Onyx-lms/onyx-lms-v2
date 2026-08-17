/**
 * S02 -- account, profile and admin user endpoints.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { validate, ok, requireAuth, requireRole, parsePageQuery, forbidden } from '@onyx/core';
import type { AppContext } from '../context.ts';

const asReq = (req: FastifyRequest) => ({
  headers: req.headers as Record<string, string | string[] | undefined>,
  cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
});

const ProfilePatch = z.object({
  name: z.string().min(1).max(255).optional(),
  phone: z.string().max(255).optional(),
  address: z.string().optional(),
  about: z.string().optional(),
  skills: z.array(z.string()).optional(),
  facebook: z.string().max(255).optional(),
  twitter: z.string().max(255).optional(),
  linkedin: z.string().max(255).optional(),
  website: z.string().max(255).optional(),
});

const Education = z.object({
  degree: z.string().optional(),
  institute: z.string().optional(),
  year: z.string().optional(),
});

const AdminUserBody = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['admin', 'instructor', 'student']),
  phone: z.string().max(255).optional(),
  address: z.string().optional(),
  status: z.number().int().optional(),
});

export function registerUserRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/me', async (req) => {
    const claims = requireAuth(asReq(req), ctx.jwtSecret);
    return ok(await ctx.profiles.get(claims.user_id));
  });

  app.patch('/api/me', async (req) => {
    const claims = requireAuth(asReq(req), ctx.jwtSecret);
    await ctx.profiles.update(claims.user_id, validate(ProfilePatch, req.body));
    return ok(await ctx.profiles.get(claims.user_id), 'Profile updated.');
  });

  app.post('/api/me/password', async (req) => {
    const claims = requireAuth(asReq(req), ctx.jwtSecret);
    const body = validate(z.object({
      current_password: z.string().min(1),
      password: z.string().min(8),
    }), req.body);
    await ctx.profiles.changePassword(claims.user_id, body.current_password, body.password);
    return ok({}, 'Password changed.');
  });

  app.get('/api/me/courses', async (req) => {
    const claims = requireAuth(asReq(req), ctx.jwtSecret);
    return ok(await ctx.courses.enrolledFor(claims.user_id));
  });

 app.get('/api/me/educations', async (req) => {
    const claims = requireAuth(asReq(req), ctx.jwtSecret);
    return ok(await ctx.profiles.educations(claims.user_id));
  });

  app.post('/api/me/educations', async (req) => {
    const claims = requireRole(asReq(req), ctx.jwtSecret, 'instructor', 'admin');
    return ok(await ctx.profiles.addEducation(claims.user_id, validate(Education, req.body)),
      'Education added.');
  });

  app.put('/api/me/educations/:index', async (req) => {
    const claims = requireRole(asReq(req), ctx.jwtSecret, 'instructor', 'admin');
    const index = Number((req.params as { index: string }).index);
    return ok(await ctx.profiles.updateEducation(claims.user_id, index, validate(Education, req.body)),
      'Education updated.');
  });

  app.delete('/api/me/educations/:index', async (req) => {
    const claims = requireRole(asReq(req), ctx.jwtSecret, 'instructor', 'admin');
    const index = Number((req.params as { index: string }).index);
    return ok(await ctx.profiles.removeEducation(claims.user_id, index), 'Education removed.');
  });

  app.get('/api/admin/users', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const q = req.query as Record<string, string>;
    const filters: { role?: 'admin' | 'instructor' | 'student'; search?: string } = {};
    if (q.role === 'admin' || q.role === 'instructor' || q.role === 'student') filters.role = q.role;
    if (q.search) filters.search = q.search;
    return ok(await ctx.users.list(filters, parsePageQuery(q), '/api/admin/users'));
  });

  app.post('/api/admin/users', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.users.create(validate(AdminUserBody, req.body)), 'User created.');
  });

  app.get('/api/admin/users/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    return ok(await ctx.users.find(Number((req.params as { id: string }).id)));
  });

  app.patch('/api/admin/users/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const id = Number((req.params as { id: string }).id);
    return ok(await ctx.users.update(id, validate(AdminUserBody.partial(), req.body)),
      'User updated.');
  });

  app.delete('/api/admin/users/:id', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const id = Number((req.params as { id: string }).id);
    await ctx.users.remove(id, await ctx.permissions.rootAdminId());
    return ok({}, 'User deleted.');
  });

  app.get('/api/admin/users/:id/permissions', async (req) => {
    requireRole(asReq(req), ctx.jwtSecret, 'admin');
    const id = Number((req.params as { id: string }).id);
    return ok({
      is_root_admin: await ctx.permissions.isRootAdmin(id),
      permissions: await ctx.permissions.listFor(id),
    });
  });

  app.post('/api/admin/users/:id/permissions', async (req) => {
    const claims = requireRole(asReq(req), ctx.jwtSecret, 'admin');
    // Only the root admin may hand out permissions.
    if (!(await ctx.permissions.isRootAdmin(claims.user_id))) throw forbidden();
    const body = validate(z.object({ permission: z.string().min(1) }), req.body);
    const id = Number((req.params as { id: string }).id);
    return ok({ permissions: await ctx.permissions.toggle(id, body.permission) },
      'Permissions updated.');
  });
}
