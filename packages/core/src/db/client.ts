/**
 * Supabase client factories.
 *
 * Two clients, and the distinction is a security boundary, not a convenience:
 *
 *   anonClient()    -- respects RLS. Safe for catalog reads. Never writes.
 *   serviceClient() -- BYPASSES RLS. Server-side only. Every mutation, and
 *                      anything touching money, progress or certificates.
 *
 * P-07 acceptance: "Direct anon client cannot write any table."
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@onyx/types';

export type Db = SupabaseClient<Database>;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

let _anon: Db | null = null;
let _service: Db | null = null;

export function anonClient(): Db {
  if (!_anon) {
    _anon = createClient<Database>(required('SUPABASE_URL'), required('SUPABASE_ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _anon;
}

export function serviceClient(): Db {
  if (!_service) {
    _service = createClient<Database>(
      required('SUPABASE_URL'),
      required('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return _service;
}

/** A client acting as a specific end user: RLS applies, with our custom
 *  claims (user_id / app_role) visible to the onyx.* helper functions. */
export function userClient(accessToken: string): Db {
  return createClient<Database>(required('SUPABASE_URL'), required('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Reset memoised clients. Tests only. */
export function __resetClients(): void {
  _anon = null;
  _service = null;
}
