/**
 * OAuth Server Mode -- visibility into who has registered as a client.
 *
 * See docs/ADR-011-supabase-auth-migration.md's OAuth Server Mode section
 * and docs/runbooks/supabase-auth-setup.md. Third-party apps self-register
 * against GoTrue's own `/oauth/clients/register` directly (Dynamic Client
 * Registration, RFC 7591) -- nothing here performs registration. This is
 * read/revoke only, for a platform admin to see what has registered and
 * take one away if it should not have.
 *
 * GoTrue's OAuth client admin surface isn't wrapped by @supabase/supabase-js
 * yet, so this calls the REST endpoints directly with the service-role key
 * -- the same key onyxAuthAdmin() carries, just used as a plain bearer
 * token here instead of through the SDK.
 */
import { HttpError } from '../http/errors.ts';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error('Missing required env var ' + name + ' (see .env.example)');
  return v;
}

export interface OAuthClient {
  client_id: string;
  client_name?: string;
  client_type: 'public' | 'confidential';
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  registration_type: 'dynamic' | 'manual';
  created_at: string;
  updated_at: string;
}

function authAdminUrl(path: string): string {
  return required('SUPABASE_URL') + '/auth/v1/admin/oauth' + path;
}

function authHeaders(): Record<string, string> {
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  return { Authorization: 'Bearer ' + key, apikey: key };
}

export class OAuthClientsService {
  /** Every OAuth client that has registered against this project. */
  async list(): Promise<OAuthClient[]> {
    const res = await fetch(authAdminUrl('/clients'), { headers: authHeaders() });
    if (!res.ok) throw new HttpError(502, 'Could not reach the OAuth client registry: ' + res.status);
    const body = (await res.json()) as { clients?: OAuthClient[] };
    return body.clients ?? [];
  }

  /** Revokes a registered client -- it can no longer request delegated access. */
  async revoke(clientId: string): Promise<void> {
    const res = await fetch(authAdminUrl('/clients/' + encodeURIComponent(clientId)), {
      method: 'DELETE', headers: authHeaders(),
    });
    if (res.status === 404) throw new HttpError(404, 'No such OAuth client.');
    if (!res.ok) throw new HttpError(502, 'Could not revoke that client: ' + res.status);
  }
}
