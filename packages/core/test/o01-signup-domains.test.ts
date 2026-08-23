/**
 * Which institution an address belongs to.
 *
 * This is the only thing standing between "anyone may register" and "a student
 * of this institution may register", so the interesting tests are the ones
 * where it must say NO. A domain is a string an attacker can buy: if the match
 * is a substring test, `meridian.edu.attacker.com` joins Meridian, and if it
 * ignores the dot boundary, so does `notmeridian.edu`.
 *
 * The rule: an address matches a listed domain when it IS that domain or a
 * subdomain of it. `*.example.edu` narrows that to subdomains only.
 *
 * Subdomains matching by default is deliberate and is the fix for the
 * complaint this came from. Universities issue addresses on department
 * subdomains, and an administrator who types `meridian.edu` means the people
 * at `cse.meridian.edu` too -- requiring every one to be listed is how a
 * configuration that looks right refuses real students on results day.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TenancyService } from '../src/onyx/tenancy.service.ts';

const matches = (email: string, list: string) =>
  TenancyService.domainMatches(TenancyService.domainOf(email), list);

// ------------------------------------------------------------------ the yes

test('the domain itself matches', () => {
  assert.equal(matches('priya@meridian.edu', 'meridian.edu'), true);
  // Case and stray whitespace are an administrator typing, not an attack.
  assert.equal(matches('Priya@MERIDIAN.EDU', ' Meridian.Edu '), true);
  // A leading @ and a trailing dot are both things people paste.
  assert.equal(matches('priya@meridian.edu', '@meridian.edu'), true);
  assert.equal(matches('priya@meridian.edu.', 'meridian.edu'), true);
});

test('a subdomain matches the domain it belongs to', () => {
  // The case this was written for.
  assert.equal(matches('priya@cse.meridian.edu', 'meridian.edu'), true);
  assert.equal(matches('priya@students.cse.meridian.edu', 'meridian.edu'), true);
});

test('a list may be separated by commas or by spaces', () => {
  // Somebody pasting from a document separates it however the document did.
  assert.equal(matches('a@ashcroft.ac', 'meridian.edu,ashcroft.ac'), true);
  assert.equal(matches('a@ashcroft.ac', 'meridian.edu ashcroft.ac'), true);
  assert.equal(matches('a@ashcroft.ac', 'meridian.edu,  ashcroft.ac '), true);
});

test('*. accepts subdomains and refuses the apex', () => {
  // For an institution whose staff are on the apex and whose students are not.
  assert.equal(matches('priya@students.meridian.edu', '*.meridian.edu'), true);
  assert.equal(matches('dean@meridian.edu', '*.meridian.edu'), false);
});

// ------------------------------------------------------------------- the no

test('a domain that merely ENDS with a listed one does not match', () => {
  // `endsWith` without the dot lets anybody in who can register a name.
  assert.equal(matches('attacker@notmeridian.edu', 'meridian.edu'), false);
  assert.equal(matches('attacker@xmeridian.edu', 'meridian.edu'), false);
});

test('a domain that merely CONTAINS a listed one does not match', () => {
  // The prefix attack: buy meridian.edu.attacker.com and register freely.
  assert.equal(matches('attacker@meridian.edu.attacker.com', 'meridian.edu'), false);
  assert.equal(matches('attacker@meridian.edu.co', 'meridian.edu'), false);
  assert.equal(matches('attacker@a-meridian.edu-b.com', 'meridian.edu'), false);
});

test('an empty or absent list matches nothing', () => {
  // An institution that has not said who may register accepts nobody, rather
  // than everybody, which is the direction this has to fail in.
  assert.equal(matches('priya@meridian.edu', ''), false);
  assert.equal(matches('priya@meridian.edu', '   '), false);
  assert.equal(matches('priya@meridian.edu', ',,,'), false);
});

test('something that is not an address matches nothing', () => {
  for (const bad of ['', 'priya', 'priya@', '@meridian.edu', 'priya meridian.edu']) {
    assert.equal(matches(bad, 'meridian.edu'), false, 'accepted: ' + JSON.stringify(bad));
  }
});

test('the domain is taken from the LAST @', () => {
  // A local part can legally contain one. Splitting on the first gives
  // "b@meridian.edu", which is not a domain and matches nothing -- a silent
  // refusal of somebody who should have been let in.
  assert.equal(TenancyService.domainOf('"a@b"@meridian.edu'), 'meridian.edu');
  assert.equal(matches('"a@b"@meridian.edu', 'meridian.edu'), true);
});

// --------------------------------------------------------------- which one

test('the more specific institution wins a shared domain', () => {
  // A university and one of its colleges can both accept an address. Picking
  // whichever the database returned first would sort people by row order.
  const university = TenancyService.domainSpecificity('cs.example.edu', 'example.edu');
  const college = TenancyService.domainSpecificity('cs.example.edu', 'cs.example.edu');
  assert.ok(college > university,
    'the college listing the exact subdomain must outrank the university');
});

test('specificity is zero for anything that does not match', () => {
  assert.equal(TenancyService.domainSpecificity('attacker.com', 'meridian.edu'), 0);
  assert.equal(TenancyService.domainSpecificity('meridian.edu.attacker.com', 'meridian.edu'), 0);
});
