# Platform super admin

DOC-05. What the platform operator sees and can do in Onyx, screen by
screen, with what each one actually looks like. Screenshots captured live
against a running build.

## Who this is

Operates across every institution on the platform, not inside one. A
platform admin account is a completely separate identity from any
tenant's administrator — its own login door, its own session cookie, its
own token shape (a `platform: true` claim, no `tenant_id` at all), so a
tenant token can never pass as a platform one and vice versa. This is the
account that brings an institution into existence in the first place.

## Signing in

![Platform sign in](screenshots/login-platform.png)

| | |
| --- | --- |
| URL | `/onyx/platform/login` — a deliberately different door from `/onyx/login` |
| Email | `superadmin@onyx.platform` |
| Password | `Platform#2026!` |

The sign-in page states its own reach in words, not just by looking
different (ink panel instead of teal): *"This session belongs to no
institution and can act on every one of them."* Typing a tenant admin's
email here fails outright — the two account types are not interchangeable
at any door.

## Navigation

| Items |
| --- |
| Institutions, Platform admins |

No dashboard, no bottom tab bar — this is an operator console, used from a
desktop.

---

## Institutions

![Institutions](screenshots/platform/institutions.png)

Every institution on the platform — 7 in the demo data — with member
counts, plan, creation date and status, searchable and filterable.
**Create an institution** provisions a new tenant and its first
administrator in one act; **Create a profile** adds another platform
admin. Each row's **Open** drills into that institution.

## Institution detail

![Institution detail](screenshots/platform/tenant-detail.png)

Everything about one institution from the outside: its people, academic
structure, timetable, grades, and fees — read access across the tenant's
own data, plus **Suspend** / **Activate** to take an institution offline
without deleting it, and the ability to manage its members, courses,
assignments, assessments, exams, fee structures, exam marks and
submissions directly, all attributed to the platform admin in that
institution's own audit trail.

## Platform admins

![Platform admins](screenshots/platform/admins.png)

The roster of accounts with platform-wide reach — deliberately small and
visible, since this list is who can act on *every* institution, not just
one.

## Platform audit log

![Platform audit log](screenshots/platform/audit.png)

Every platform-level action, separate from any tenant's own audit log — an
institution being created, suspended, or reactivated, and who did it.

---

## What the platform super admin is *not*

Not a tenant administrator — signing in here does not put you inside any
one institution's console, and the reverse is equally true: a tenant
admin's credentials do not work at `/onyx/platform/login`. The platform
console exists for operating the estate (onboarding institutions, seeing
usage and health, holding the record of what was done to each), not for
running a single institution's day-to-day — that stays each institution's
own administrator's job, on their own door.
