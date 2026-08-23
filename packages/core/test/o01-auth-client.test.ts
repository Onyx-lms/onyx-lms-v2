/**
 * The sign-in client is never shared.
 *
 * This guards one line, and that line was a live authentication bug: three
 * concurrent logins against production returned two distinct tokens, and a
 * learner was handed an administrator's session -- their identity, their
 * institution, their permissions.
 *
 * The cause was a memoised Supabase Auth client. `persistSession: false` stops
 * the client writing a session to storage; it does not stop GoTrueClient
 * keeping the session it last minted in memory on the instance. Two sign-ins
 * racing through one client leave that client holding one session, and the
 * `refreshSession()` that follows a sign-in can be answered with the other
 * person's.
 *
 * The fake in `fake-auth.ts` cannot catch this -- it models a user store, not
 * GoTrue's session state, so a shared instance of it behaves perfectly well.
 * What is testable without a network is the invariant that makes the bug
 * impossible: a new client every call. If somebody memoises this again for the
 * obvious-looking reason that building one per sign-in seems wasteful, this
 * fails and says why.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { onyxAuthClientFresh } from '../src/onyx/db.ts';

// createClient does no I/O -- it is a wrapper around fetch -- so a placeholder
// project is enough to build one.
process.env.SUPABASE_URL ??= 'https://placeholder.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'placeholder-anon-key';

test('every sign-in gets a client of its own', () => {
  const a = onyxAuthClientFresh();
  const b = onyxAuthClientFresh();

  assert.notEqual(a, b,
    'the sign-in client is memoised again — concurrent logins will hand each '
    + 'other their sessions; see the header of this file');
  // The auth surfaces are distinct objects too, which is where the session
  // state actually lives.
  assert.notEqual(a.auth, b.auth);
});

test('a hundred of them are a hundred, not one', () => {
  // A Set, because "not equal" for two proves less than it looks: a factory
  // that alternated between two cached clients would pass the test above.
  const clients = new Set(Array.from({ length: 100 }, () => onyxAuthClientFresh()));
  assert.equal(clients.size, 100);
});
