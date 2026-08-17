/**
 * The Onyx database client.
 *
 * Onyx tables share `public` with the Laravel port, kept apart by the `onyx_`
 * prefix (ADR-006). A dedicated schema would be tidier, but PostgREST only
 * serves schemas the project is configured to expose, and that setting is not
 * ours to change on a project the port depends on.
 *
 * Same boundary as the port: the service client bypasses RLS and is the only
 * write path; the tenant client carries a caller's JWT so RLS applies.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { OnyxDatabase } from '@onyx/types';

export const ONYX_SCHEMA = 'public';

export type OnyxDb = ReturnType<SupabaseClient<OnyxDatabase, 'public'>['schema']>;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error('Missing required env var ' + name + ' (see .env.example)');
  return v;
}

let _service: OnyxDb | null = null;

/** Bypasses RLS. Server-side only, and the only path for writes. */
export function onyxServiceClient(): OnyxDb {
  if (!_service) {
    _service = createClient<OnyxDatabase, 'public'>(
      required('SUPABASE_URL'),
      required('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false },
        db: { schema: ONYX_SCHEMA } },
    ).schema(ONYX_SCHEMA);
  }
  return _service;
}

/**
 * A client that carries someone's token, so every read is filtered by RLS to
 * their tenant. Used by the isolation tests, and by anything that wants the
 * database to be the thing enforcing the boundary rather than the API.
 */
export function onyxTenantClient(accessToken: string): OnyxDb {
  return createClient<OnyxDatabase, 'public'>(
    required('SUPABASE_URL'),
    required('SUPABASE_ANON_KEY'),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: ONYX_SCHEMA },
      global: { headers: { Authorization: 'Bearer ' + accessToken } },
    },
  ).schema(ONYX_SCHEMA);
}

let _authAdmin: SupabaseClient | null = null;

/**
 * Supabase Auth's Admin API -- creating/updating auth.users rows,
 * server-side only (see docs/ADR-011-supabase-auth-migration.md).
 *
 * `onyxServiceClient()` above cannot be reused for this: `.schema()` narrows
 * a SupabaseClient down to the Postgrest surface, which drops `.auth`
 * entirely. This is the same service-role client, deliberately kept at its
 * un-narrowed type instead.
 */
export function onyxAuthAdmin(): SupabaseClient {
  if (!_authAdmin) {
    _authAdmin = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _authAdmin;
}

let _authClient: SupabaseClient | null = null;

/**
 * A plain (anon-key) Supabase Auth client for password sign-in/refresh.
 *
 * The API server is a trusted intermediary here, not a privileged one --
 * this authenticates exactly the way a browser calling Supabase directly
 * would, which is why it is the anon key rather than the service-role key
 * `onyxAuthAdmin()` above uses for account provisioning.
 */
export function onyxAuthClient(): SupabaseClient {
  if (!_authClient) {
    _authClient = createClient(required('SUPABASE_URL'), required('SUPABASE_ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _authClient;
}
