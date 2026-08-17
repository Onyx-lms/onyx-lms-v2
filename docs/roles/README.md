# Role-by-role screen guide

DOC-05. What each role sees and can do in Onyx, screen by screen, with a
real screenshot of every page their own navigation offers. Captured live
against a running build, signed in through the real login form as each of
the demo institution's accounts.

Every screenshot was taken at 1440×900 in Chromium via
`tools/screenshot-roles.mjs`; re-run it (with the API and web dev servers
up) to refresh them after a UI change.

| Role | Guide | Demo account |
| --- | --- | --- |
| Student | [student.md](student.md) | `student@demo.onyx` |
| Faculty | [faculty.md](faculty.md) | `faculty@demo.onyx` |
| Examinations | [examinations.md](examinations.md) | `exams@demo.onyx` |
| Placement | [placement.md](placement.md) | `placement@demo.onyx` |
| Employer | [employer.md](employer.md) | `employer@demo.onyx` |
| Parent or guardian | [guardian.md](guardian.md) | `guardian@demo.onyx` |
| Administrator | [admin.md](admin.md) | `admin@demo.onyx` |
| Platform super admin | [platform.md](platform.md) | `superadmin@onyx.platform` |

All tenant-role passwords are `Demo#2026!`, all at **ABC Institution**
(`/onyx/login`). The platform super admin signs in separately, at
`/onyx/platform/login`, with password `Platform#2026!` — see
[Onyx-Tenants-and-Credentials.xlsx](../../Onyx-Tenants-and-Credentials.xlsx)
at the repository root for the full set, including the five other seeded
institutions.

For a workflow-ordered walkthrough instead of a role-ordered one (e.g. "a
faculty member marks work, then a student sees the result"), see
[../UAT.md](../UAT.md).
