/**
 * In-memory stand-in for the slice of the Supabase Auth (GoTrue) client
 * `tenancy.service.ts`/`platform.service.ts` actually call: creating a
 * user, looking one up by email, signing in, refreshing a session, and
 * pointing a session at a tenant via app_metadata.
 *
 * There is no in-memory way to forge a token that would pass real
 * cryptographic verification (see auth.ts's own comment on why
 * requireOnyx()'s crypto step is e2e-only coverage) -- this fake exists one
 * layer down from that, for the services that call `.auth.admin.*`/
 * `.auth.signInWithPassword`/`.auth.refreshSession` directly rather than
 * verifying a token.
 */

interface FakeUser {
  id: string;
  email: string;
  password: string;
  app_metadata: Record<string, unknown>;
}

let nextId = 1;

export class FakeAuth {
  #users = new Map<string, FakeUser>();

  /** Pre-seeds an identity, the way a real signup already having happened would. */
  seed(email: string, password: string): string {
    const id = 'user-' + nextId++;
    this.#users.set(id, { id, email: email.trim().toLowerCase(), password, app_metadata: {} });
    return id;
  }

  auth = {
    admin: {
      createUser: async (input: { email: string; password?: string; email_confirm?: boolean }) => {
        const email = input.email.trim().toLowerCase();
        if ([...this.#users.values()].some((u) => u.email === email)) {
          return { data: null, error: { message: 'Email address already registered' } };
        }
        const id = 'user-' + nextId++;
        this.#users.set(id, { id, email, password: input.password ?? '', app_metadata: {} });
        return { data: { user: { id, email } }, error: null };
      },
      listUsers: async () => ({
        data: { users: [...this.#users.values()].map((u) => ({ id: u.id, email: u.email })) },
        error: null,
      }),
      updateUserById: async (id: string, patch: { app_metadata?: Record<string, unknown> }) => {
        const u = this.#users.get(id);
        if (!u) return { data: null, error: { message: 'User not found' } };
        u.app_metadata = { ...u.app_metadata, ...patch.app_metadata };
        return { data: { user: u }, error: null };
      },
    },
    signInWithPassword: async (input: { email: string; password: string }) => {
      const email = input.email.trim().toLowerCase();
      const u = [...this.#users.values()].find((x) => x.email === email);
      // The same shape either way -- wrong password and no such person both
      // come back as one generic error, the property tenancy.service.ts's
      // signIn() relies on to keep which emails exist non-public.
      if (!u || u.password !== input.password) {
        return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
      }
      return {
        data: {
          user: { id: u.id, email: u.email },
          session: {
            access_token: 'access.' + u.id + '.' + Date.now(),
            refresh_token: 'refresh.' + u.id,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
        },
        error: null,
      };
    },
    refreshSession: async (input: { refresh_token: string }) => {
      const id = input.refresh_token.replace(/^refresh\./, '');
      const u = this.#users.get(id);
      if (!u) return { data: { session: null }, error: { message: 'Invalid refresh token' } };
      return {
        data: {
          session: {
            access_token: 'access.' + u.id + '.' + Date.now(),
            refresh_token: 'refresh.' + u.id,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          },
        },
        error: null,
      };
    },
  };
}
