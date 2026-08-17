import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './fake-db.ts';
import {
  LiveClassService, joinWindow, JOIN_OPENS_MINUTES,
} from '../src/live/live-class.service.ts';
import { jitsiOptions, roomName, newRoomCode, externalApiUrl, JITSI_DOMAIN }
  from '../src/live/jitsi.ts';
import { phpJsonEncode } from '../src/json/php-json.ts';
import { HttpError } from '../src/http/errors.ts';

const START = '2026-08-20T10:00:00.000Z';

const db = () => new FakeDb({
  users: [
    { id: 1, name: 'Root', email: 'root@onyx.test' },
    { id: 2, name: 'Ada', email: 'ada@onyx.test' },
    { id: 3, name: 'Sam', email: 'sam@onyx.test' },
    { id: 4, name: 'Other', email: 'other@onyx.test' },
  ],
  courses: [{
    id: 5, slug: 'node-basics', user_id: 3,
    instructor_ids: phpJsonEncode([3, 9]),
  }],
  enrollments: [{ id: 1, course_id: 5, user_id: 2, expiry_date: null }],
  live_classes: [],
});

test('LC-06 the join window opens 15 minutes early and closes after the class', () => {
  const before = joinWindow(START, new Date('2026-08-20T09:30:00Z'));
  assert.equal(before.open, false, 'half an hour early is too early');

  const opens = new Date(new Date(START).getTime() - JOIN_OPENS_MINUTES * 60_000);
  assert.equal(joinWindow(START, opens).open, true, 'exactly at the opening moment');
  assert.equal(joinWindow(START, new Date('2026-08-20T10:30:00Z')).open, true, 'mid-class');
  assert.equal(joinWindow(START, new Date('2026-08-20T14:00:00Z')).open, false, 'long over');

  // A class with no date can never be open, rather than always being open.
  assert.equal(joinWindow(null).open, false);
  assert.equal(joinWindow('not a date').open, false);
});

test('LC-01 host is the course owner, a named co-instructor or an admin', async () => {
  const svc = new LiveClassService(db() as never);

  assert.equal(await svc.isHost(5, 3, 'instructor'), true, 'the course owner');
  assert.equal(await svc.isHost(5, 9, 'instructor'), true, 'a listed co-instructor');
  assert.equal(await svc.isHost(5, 1, 'admin'), true, 'an admin');

  // Laravel granted moderator to any account whose role was 'instructor',
  // in any course's room.
  assert.equal(await svc.isHost(5, 4, 'instructor'), false, 'an unrelated instructor');
  assert.equal(await svc.isHost(5, 2, 'student'), false);
  assert.equal(await svc.isHost(999, 3, 'instructor'), false, 'unknown course');
});

test('LC-06 attending needs a live enrolment', async () => {
  const d = db();
  const svc = new LiveClassService(d as never);

  assert.equal(await svc.canAttend(5, 2, 'student'), true, 'enrolled');
  assert.equal(await svc.canAttend(5, 4, 'student'), false, 'not enrolled');
  assert.equal(await svc.canAttend(5, 3, 'instructor'), true, 'the host always may');

  d.tables['enrollments']![0]!['expiry_date'] = '2020-01-01T00:00:00.000Z';
  assert.equal(await svc.canAttend(5, 2, 'student'), false, 'an expired enrolment is not one');
});

test('LC-01 a class round-trips its provider payload through the PHP codec', async () => {
  const d = db();
  const svc = new LiveClassService(d as never);
  const created = await svc.create({
    course_id: 5, user_id: 3, class_topic: '  Intro  ',
    provider: 'zoom', class_date_and_time: START, note: 'bring questions',
  }, { id: 87654321, password: 'abc', start_url: 'https://zoom.us/s/secret' });

  assert.equal(created.class_topic, 'Intro', 'trimmed');
  assert.equal(created.meeting_id, 87654321);
  assert.equal(created.join_window.open, false, 'scheduled for later');

  const stored = d.tables['live_classes']![0]!['additional_info'] as string;
  assert.equal(stored.includes('zoom.us'), true);
  // The codec escapes solidus, as PHP does -- plain JSON.stringify would not.
  const escapedSlash = String.fromCharCode(92) + '/';
  assert.equal(stored.includes('https:' + escapedSlash + escapedSlash + 'zoom.us'), true);
  assert.equal(stored.includes('https://zoom.us'), false, 'a bare solidus would differ from PHP');

  const row = await svc.find(created.id);
  assert.equal(LiveClassService.meeting<{ password: string }>(row)!.password, 'abc');
});

test('LC-01 updating a missing class is a 404, and delete removes it', async () => {
  const d = db();
  const svc = new LiveClassService(d as never);
  await assert.rejects(() => svc.update(999, { class_topic: 'x' }),
    (e: HttpError) => e.status === 404);
  await assert.rejects(() => svc.remove(999), (e: HttpError) => e.status === 404);

  const made = await svc.create({
    course_id: 5, user_id: 3, class_topic: 'Doomed',
    provider: 'jitsi', class_date_and_time: START,
  }, { room_code: 'abc123' });
  await svc.remove(made.id);
  assert.equal(d.tables['live_classes']!.length, 0);
});

test('LC-05 the Jitsi room is not guessable from the public course page', () => {
  const code = newRoomCode();
  assert.equal(code.length, 12);
  assert.notEqual(newRoomCode(), newRoomCode());

  const room = roomName('node-basics', 7, code);
  assert.equal(room, 'lms-node-basics-class-7-' + code);
  // Laravel used just slug + id, both public on the course page.
  assert.equal(room.includes(code), true, 'the entropy is what keeps strangers out');

  // A slug that is null or full of punctuation must not produce a broken room.
  assert.equal(roomName(null, 7, code), 'lms-course-class-7-' + code);
  assert.equal(roomName('!!!', 7, code), 'lms-course-class-7-' + code);
});

test('LC-05 host and participant get different Jitsi powers', () => {
  const host = jitsiOptions({ room: 'r', displayName: 'Sam', email: 's@x', isHost: true });
  const guest = jitsiOptions({ room: 'r', displayName: 'Ada', email: 'a@x', isHost: false });

  const hostBar = host.interfaceConfigOverwrite['TOOLBAR_BUTTONS'] as string[];
  const guestBar = guest.interfaceConfigOverwrite['TOOLBAR_BUTTONS'] as string[];
  for (const control of ['recording', 'livestreaming', 'mute-everyone', 'security']) {
    assert.equal(hostBar.includes(control), true, 'host has ' + control);
    assert.equal(guestBar.includes(control), false, 'a participant must not have ' + control);
  }

  assert.equal(host.configOverwrite['startWithAudioMuted'], false);
  assert.equal(guest.configOverwrite['startWithAudioMuted'], true, 'guests arrive muted');
  assert.equal(host.userInfo.displayName, 'Sam (Host)');
  assert.equal(guest.userInfo.displayName, 'Ada');

  // The script has to come from the domain it connects to; Laravel loaded the
  // 8x8 JaaS build while pointing at meet.jit.si.
  assert.equal(externalApiUrl(), 'https://' + JITSI_DOMAIN + '/external_api.js');
});
