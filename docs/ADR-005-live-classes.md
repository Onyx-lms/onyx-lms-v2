# ADR-005: live classes, and where the Zoom secret lives

## Status

Accepted (S13).

## Context

`live_classes` holds `class_topic`, `provider`, `class_date_and_time`, `note`
and `additional_info` — the last being the raw provider response as JSON text.
Two providers are supported: Zoom and Jitsi.

Three things about the Laravel implementation drove the decisions here.

**1. The Meeting SDK secret was printed into the browser.**
`resources/views/course_player/live_class/zoom_live_class.blade.php` rendered

```php
var sdkKey    = "{{get_settings('zoom_sdk_client_id')}}";
var sdkSecret = "{{get_settings('zoom_sdk_client_secret')}}";
console.log(mn, user_name, pwd, role, email, lang, china, sdkKey, sdkSecret, leaveUrl)
```

and then called `ZoomMtg.generateSDKSignature()` client-side. Anyone who opened
a class page could read the account's SDK secret out of the HTML — it was even
written to the console — and afterwards mint host signatures for any meeting on
that account.

**2. `role` was computed in the page and passed to the signer.** Because the
signature was generated in the browser from a secret the browser held, a user
could sign themselves in as host (`role: 1`) regardless of what the page decided.

**3. Any instructor was a moderator in any course.** The Jitsi view computed

```php
$is_host = $course->instructors()->where('id', auth()->id())->count() > 0
        || auth()->user()->role == 'admin'
        || auth()->user()->role == 'instructor';
```

The final clause makes every instructor account a moderator in every course's
room, whether or not they teach it.

## Decision

- **The Zoom join signature is generated on the server** (`ZoomService.signature`)
  and returned to the browser already signed. `zoom_sdk_client_secret` never
  leaves the server, and the settings endpoint reports only whether it is set.
- **The role is decided from the database**, by `LiveClassService.isHost`, and
  baked into the signature. Nothing the client sends can change it.
- **Host means the course owner, a listed co-instructor, or an admin** — not
  anyone whose role happens to be `instructor`.
- **The OAuth token is cached** until a minute before it expires. Laravel
  fetched a fresh one on every call, including three times for one create.
- **Nothing is written when the provider refuses.** The Zoom meeting is created
  first; if it fails, no `live_classes` row appears. Deleting a class is the
  other way round — the row goes even if Zoom errors, because an orphaned Zoom
  meeting is a smaller problem than a class nobody can cancel.

## The join window

`live_classes` has no end time, so `class_started()` (which lives on
`bootcamp_live_classes` and reads `start_time`/`end_time`/`force_stop`) cannot be
applied to it directly. The window here keeps the rule that matters — open 15
minutes before the start, as the original did — and derives the close from the
start (`JOIN_CLOSES_MINUTES`, 3 hours).

A **host may join outside the window** so they can set up or run over; a student
may not. Laravel had no window at all on course live classes: the start button
was always live.

## Jitsi room names

Laravel used `lms-<course slug>-class-<id>`. Both parts are public — the slug is
in the course URL — so on the public `meet.jit.si` instance anyone could guess a
room and walk into a paid class. A 12-character random code is generated when the
class is created, stored in `additional_info`, and appended to the room name.

The original also loaded the 8x8 JaaS build of `external_api.js` while pointing
`domain` at `meet.jit.si`. The script URL is derived from the domain here so the
two cannot drift apart.

## Consequences

- **Zoom is implemented but not verified against the live API**: this deployment
  has no Zoom credentials in `settings`, so `configured` is false. `ZoomService`
  takes an injectable `fetch`, and the unit tests assert the exact URL, method,
  headers and body of every call, plus the signature's claims and that it
  verifies against the SDK secret. The end-to-end test covers the
  no-credentials path and asserts it fails cleanly with nothing written.
- **Jitsi is fully exercised end to end**, because the public instance needs no
  account.
- Zoom's `start_url` signs the holder in as host, so it is only ever returned to
  a host. `additional_info` is stripped from every list response for the same
  reason.
