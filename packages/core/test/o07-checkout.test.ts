/**
 * CMP-03b -- the signed payment reference.
 *
 * This is the piece the whole webhook path rests on. A webhook arrives with no
 * session and no token, so the reference is the only thing saying which
 * institution and which invoice a payment belongs to -- which makes "can it be
 * edited in transit" the question that decides whether one college's fees can
 * be credited to another's ledger.
 *
 * The service around it is tested end to end (o07-campus.e2e.ts); what is here
 * is the arithmetic and the crypto, which an end-to-end test cannot show
 * failing safely because a forged token never reaches it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { signIntent, readIntent } from '../src/onyx/checkout.service.ts';

const SECRET = 'test-secret-not-a-real-one';
const NOW = 1_800_000_000_000;

const intent = {
  tenantId: 7,
  invoiceId: 42,
  userId: 900,
  gateway: 'razorpay',
  amountMinor: 250_000,
  currency: 'INR',
};

test('a reference round-trips everything settlement needs', () => {
  const reference = signIntent(intent, SECRET, NOW);
  const read = readIntent(reference, SECRET, NOW);

  assert.ok(read);
  assert.equal(read.tenantId, 7);
  assert.equal(read.invoiceId, 42);
  assert.equal(read.userId, 900);
  assert.equal(read.gateway, 'razorpay');
  assert.equal(read.amountMinor, 250_000);
  assert.equal(read.currency, 'INR');
});

test('two references for the same invoice are different', () => {
  // A nonce, so a reference is never a stable identifier for an invoice. Two
  // checkouts on one invoice have to be distinguishable -- a learner who
  // abandons a payment and starts again has made two attempts, not one.
  const a = signIntent(intent, SECRET, NOW);
  const b = signIntent(intent, SECRET, NOW);
  assert.notEqual(a, b);
});

test('an edited reference does not verify', () => {
  const reference = signIntent(intent, SECRET, NOW);
  const [body, sig] = reference.split('.') as [string, string];

  // The attack this exists to stop: re-point a real payment at another
  // institution, or at a smaller amount, and keep the signature.
  const decoded = JSON.parse(Buffer.from(body, 'base64url').toString());
  for (const tampered of [
    { ...decoded, tenantId: 8 },
    { ...decoded, amountMinor: 1 },
    { ...decoded, invoiceId: 43 },
  ]) {
    const forged = Buffer.from(JSON.stringify(tampered)).toString('base64url') + '.' + sig;
    assert.equal(readIntent(forged, SECRET, NOW), null,
      'a tampered reference verified: ' + JSON.stringify(tampered));
  }
});

test('a reference signed with another secret does not verify', () => {
  const reference = signIntent(intent, 'someone-elses-secret', NOW);
  assert.equal(readIntent(reference, SECRET, NOW), null);
});

test('malformed references are refused rather than thrown at', () => {
  // Whatever arrives on a public webhook has to be survivable. Each of these
  // reached readIntent at some point during development.
  for (const bad of ['', '.', 'nodot', 'a.b.c', 'e30.badsig', '....']) {
    assert.equal(readIntent(bad, SECRET, NOW), null, 'accepted: ' + JSON.stringify(bad));
  }
});

test('a checkout goes stale after two hours', () => {
  const reference = signIntent(intent, SECRET, NOW);
  // Still good most of the way through.
  assert.ok(readIntent(reference, SECRET, NOW + 60 * 119 * 1000));
  // A gateway replaying a reference from last week must not settle it.
  assert.equal(readIntent(reference, SECRET, NOW + 60 * 121 * 1000), null);
});

test('a reference with the amount missing is not a reference', () => {
  // Zero would settle a payment for nothing and mark an invoice as touched.
  const empty = signIntent({ ...intent, amountMinor: 0 }, SECRET, NOW);
  assert.equal(readIntent(empty, SECRET, NOW), null);
});
