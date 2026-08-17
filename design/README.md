# Onyx LMS — screen designs

Static, self-contained HTML prototypes for every screen in the product. Open
`index.html` in a browser to browse them; nothing needs to be built or served.

These are **design prototypes, not the app**. They exist so a screen can be
argued about before it is built. `apps/web` is unaffected by anything in here.

## Files

| Path | What it is |
|---|---|
| `onyx.css` | The whole design system: tokens, shell, and every primitive. Screens add no CSS of their own beyond one-off inline nudges. |
| `onyx.js` | Injects the icon sprite. Screens reference icons as `<svg class="ic"><use href="#i-name"/></svg>`. |
| `index.html` | Gallery of every screen, grouped by role. |
| `screens/*.html` | One file per screen. |
| `student-dashboard.html` | The original single-screen prototype, kept because `tests/browser/student-dashboard-responsive.spec.ts` points at this exact path. Superseded by `screens/student-dashboard.html`. |

## The rules these follow

**Palette is sampled, not invented.** Teal `#307890` and orange `#D87818` come
off the logo mark, and the scales in `onyx.css` mirror
`apps/web/tailwind.config.ts` exactly, so a design here is buildable there
without a translation step.

**Contrast decides the roles.** Against white: `--teal-600` is 7.11:1 and
carries every interactive element; the logo orange is 3.17:1 and **fails AA for
text**, so it is used for fills, rings, bars and large numerals only —
`--orange-700` (5.71:1) is the one that may carry words. `--muted` clears 4.5:1
on both white and the canvas grey; `--faint` is decorative marks only and must
never carry text.

**Colour never carries a state alone.** About one man in twelve reads the red
and the green as the same, so `.status` pairs a dot with a word and `.score`
always shows the number inside the band.

**A table is for comparing, a list is for choosing.** Operator screens
(people, finance, audit) use `.table`; learner screens use `.rowlist`, because
a learner is picking one thing to open, not scanning forty down a column.

**Every screen works at 320px.** The sidebar is desktop-only and phones get the
bottom tab bar — the previous shell stacked 13 nav links above the content, so a
student on a phone scrolled past a full viewport before reaching their own work.
Nothing may scroll sideways at any width; wide tables scroll inside
`.table-scroll`, not the page.

**Relative dates, not timestamps.** What someone scans a due list for is what is
urgent, and `8/17/2026, 12:00:00 AM` makes that a calculation.

## Class vocabulary

Shell — `.header` `.brand` `.layout` `.sidenav` `.tenant-card` `.nav-group`
`.nav-label` `.nav-item` `.tabbar` `.tab` `.page-head` `.page-title`
`.page-sub` `.page-actions` `.breadcrumb` `.section` `.section-head`

Surfaces — `.card` `.card-pad` `.card-head` `.card-foot` `.cols` `.cols-even`
`.grid` `.grid-2` `.grid-3` `.stack` `.stack-sm` `.inline` `.divider`

Data — `.stats` `.stat` `.stat-label` `.stat-value` `.stat-note` `.delta`
`.table-wrap` `.table-scroll` `.table` `.table-foot` `.rowlist` `.row`
`.row-icon` `.row-main` `.row-title` `.row-meta` `.row-trailing` `.kv` `.kv-row`

Controls — `.btn` (`.btn-ghost` `.btn-light` `.btn-danger` `.btn-sm` `.btn-lg`
`.btn-block`) `.toolbar` `.search` `.select` `.chip` `.segmented` `.tabs`
`.stepper` `.bulkbar`

State — `.pill` (`.brand` `.good` `.soon` `.late` `.info` `.solid`) `.status`
(`.on` `.off` `.idle` `.live`) `.score` (`.hi` `.mid` `.lo` `.none`) `.banner`
(`.info` `.warn` `.late` `.good`) `.empty`

Progress — `.meter` (`.sm` `.good` `.on-dark`) `.ring` (set `--p:64%`)
`.stackbar` `.buckets` `.bucket`

Media — `.hero` `.theatre` `.video` `.thumb` `.code` `.prose`

Timetable — `.cal` `.cal-scroll` `.cal-grid` `.cal-head` `.cal-time`
`.cal-cell` `.evt` `.legend`

## Icons

`home book code layers edit award trophy calendar wallet help briefcase mic
user users menu bell play chevron dots check clock chart flag shield building
save camera trash search filter plus download upload mail lock eye alert x
arrow external star message video grid list refresh settings logout card file
pie target sparkle`
