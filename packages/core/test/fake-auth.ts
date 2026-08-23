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
  /** The live email OTP, as GoTrue holds one against the address. */
  otp?: string;
  /** Whether this address had been seen before the code was sent. See `otpKind`. */
  otpKind?: 'signup' | 'magiclink';
}

let nextId = 1;

export class FakeAuth {
  #users = new Map<string, FakeUser>();

  /**
   * Every OTP this fake has been asked to send, in order.
   *
   * A test asserting that a code went out has to read it from somewhere, and
   * the alternative -- reaching into `#users` -- would not catch the case that
   * matters most: a code sent for an address the product should have refused
   * before it ever got here.
   */
  sent: { email: string; code: string; created: boolean }[] = [];

  /** Fixed, so a test can type it. A real one is random and unguessable. */
  static CODE = '424242';

  /**
   * Refuse the generic `type: 'email'` and insist on the exact kind.
   *
   * Some GoTrue versions accept 'email' for any email OTP and some want
   * 'signup' or 'magiclink' specifically. The service tries each in turn
   * because of that; turning this on is how a test proves the fallback works
   * rather than trusting that the first attempt always happens to succeed.
   */
  strictOtpType = false;

  /**
   * Whether the project allows `signInWithOtp` to create a new identity.
   *
   * False, matching the real deployment: every account here is made through
   * the Admin API, so public email signups are switched off in Supabase. A
   * test that needs the other configuration can turn it on.
   */
  allowsPublicSignups = false;

  /**
   * Make the next `n` GoTrue calls fail the way an over-quota project does.
   *
   * Signing in costs two of them, so a burst hits this at half the number of
   * people it looks like it should -- which is why a test needs to be able to
   * fail the FIRST call and the SECOND independently.
   */
  rateLimitFor = 0;

  #rateLimited(): boolean {
    if (this.rateLimitFor <= 0) return false;
    this.rateLimitFor -= 1;
    return true;
  }

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
      updateUserById: async (id: string, patch: {
        app_metadata?: Record<string, unknown>;
        password?: string;
        email_confirm?: boolean;
      }) => {
        const u = this.#users.get(id);
        if (!u) return { data: null, error: { message: 'User not found' } };
        u.app_metadata = { ...u.app_metadata, ...patch.app_metadata };
        // A verified signup sets the password here, because signInWithOtp has
        // nowhere to put one.
        if (patch.password !== undefined) u.password = patch.password;
        return { data: { user: u }, error: null };
      },
    },

    /**
     * Mails a one-time code, creating the address if it is new.
     *
     * The `signup` / `magiclink` distinction is reproduced because it is real
     * and because getting it wrong is invisible until somebody retries an
     * abandoned registration: GoTrue issues one kind of token for an address
     * it has never seen and another for one it has, and `verifyOtp` refuses a
     * code offered under the wrong name.
     */
    signInWithOtp: async (input: { email: string; options?: { shouldCreateUser?: boolean } }) => {
      const email = input.email.trim().toLowerCase();
      let u = [...this.#users.values()].find((x) => x.email === email);
      const created = !u;
      if (!u) {
        /*
         * Modelled on the real project, where public email signups are OFF.
         *
         * GoTrue refuses to create a user from this call in that
         * configuration, whatever `shouldCreateUser` says, with exactly this
         * message -- which is how the first version of this feature failed:
         * it asked signInWithOtp to create the identity and got a flat refusal
         * on every registration.
         *
         * Reproduced here so that going back to relying on it fails in the
         * tests rather than in front of a student.
         */
        if (!this.allowsPublicSignups) {
          return {
            data: { user: null, session: null },
            error: { message: 'Signups not allowed for this instance' },
          };
        }
        const id = 'user-' + nextId++;
        u = { id, email, password: '', app_metadata: {} };
        this.#users.set(id, u);
      }
      u.otp = FakeAuth.CODE;
      u.otpKind = created ? 'signup' : 'magiclink';
      this.sent.push({ email, code: FakeAuth.CODE, created });
      return { data: { user: null, session: null }, error: null };
    },

    verifyOtp: async (input: { email: string; token: string; type: string }) => {
      const email = input.email.trim().toLowerCase();
      const u = [...this.#users.values()].find((x) => x.email === email);
      if (!u || !u.otp) {
        return { data: { user: null, session: null }, error: { message: 'Token has expired or is invalid' } };
      }
      // Both halves must line up. A wrong code and a right code offered under
      // the wrong type fail identically, which is what the service's
      // try-each-type loop is written against.
      const typeOk = this.strictOtpType
        ? input.type === u.otpKind
        : input.type === 'email' || input.type === u.otpKind;
      if (u.otp !== input.token || !typeOk) {
        return { data: { user: null, session: null }, error: { message: 'Token has expired or is invalid' } };
      }
      // Burned on use. A code that works twice is not a second factor.
      u.otp = undefined;
      return { data: { user: { id: u.id, email: u.email }, session: null }, error: null };
    },
    signInWithPassword: async (input: { email: string; password: string }) => {
      if (this.#rateLimited()) {
        return { data: { user: null, session: null }, error: { message: 'Request rate limit reached' } };
      }
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
      if (this.#rateLimited()) {
        return { data: { session: null }, error: { message: 'Request rate limit reached' } };
      }
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
