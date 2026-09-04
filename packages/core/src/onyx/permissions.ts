import type { Role } from '@onyx/types';

/**
 * What an institution may delegate, and to whom.
 *
 * Until now every answer to "who is allowed to do this" was a role list
 * written into a route: `requireOnyxRole(req, secret, 'admin', 'faculty')`.
 * That is correct for the shape of the product but wrong for the shape of
 * institutions -- a college that runs examinations centrally and one where
 * lecturers set their own papers are both normal, and neither could be
 * configured. The single exception, `faculty_can_schedule_exams` (0012), was
 * the same idea solved once, by hand, for one route.
 *
 * The model here is the one Canvas and Moodle both settle on, adapted to a
 * product with a fixed set of roles:
 *
 *   * A CAPABILITY is one thing a person can do, named `area.verb`, and it is
 *     the unit a route checks. (Moodle's `component:action`; Canvas's
 *     permission keys.)
 *   * Each capability ships with the role set that holds it today, so an
 *     institution that never opens Settings behaves exactly as it did.
 *   * An institution may grant or revoke a capability for a role, and what it
 *     saves is only the DIFFERENCE from those defaults -- so a capability
 *     added in a later release arrives switched on for the roles the release
 *     intends, rather than silently absent from every tenant that saved a
 *     matrix before it existed.
 *
 * Three rules keep the matrix from being a way to break an institution:
 *
 *   * `admin` holds everything, always. It is not rendered as a toggle and
 *     cannot be revoked -- an administrator who can remove their own last
 *     capability has locked the institution out of itself.
 *   * `holders` lists the only roles a capability may ever be given to. A
 *     student cannot be granted `fees.record_payment` even by mistake,
 *     because the option does not exist.
 *   * A capability's own guard still applies underneath. `courses.author`
 *     granted to faculty does not let a lecturer edit a course they do not
 *     teach: assertCanTeach runs after the capability check, not instead of
 *     it. The matrix widens or narrows who may attempt an act; it never
 *     removes the scoping on the record itself.
 *
 * Platform admins are not in this model at all. They operate above the
 * institution and hold everything in every tenant by definition -- see
 * requirePlatformAdmin.
 *
 * THE ONE THING ABOVE THE MATRIX. `admin holds everything` is a rule about
 * what an institution may do to ITSELF: an administrator cannot revoke their
 * own last capability, because that is a lockout with nobody left to undo it.
 * It is not a rule about what the PLATFORM may decide. An operator selling
 * this product needs to be able to say "this institution does not issue
 * credentials" -- a tier, a contract, a compliance decision -- and until
 * `PlatformDenials` existed there was no way to express it: the console
 * accepted the change, `holdersOf` put `admin` straight back, and the
 * institution carried on issuing. A denial is stored separately from the
 * institution's own matrix, is writable only through the platform routes, and
 * beats every grant beneath it including a personal one. It is never a lockout
 * because the operator who set it can always lift it.
 */

export type CapabilityKey =
  // People
  | 'people.invite' | 'people.edit' | 'people.remove' | 'people.roll_numbers'
  // Academic structure
  | 'academics.programmes' | 'academics.batches' | 'academics.enrol'
  // Courses and content
  | 'courses.create' | 'courses.author' | 'courses.publish' | 'courses.assign_faculty'
  | 'attendance.take'
  // Assignments
  | 'assignments.set' | 'assignments.grade'
  // Live Classes
  | 'domains.manage'
  // Assessment
  | 'assess.banks' | 'assess.papers' | 'assess.publish' | 'assess.mark'
  | 'assess.release' | 'assess.proctor'
  // Examinations
  | 'exams.schedule' | 'exams.halls' | 'exams.seating' | 'exams.marks'
  | 'exams.moderate' | 'exams.publish'
  // Timetable
  | 'timetable.manage' | 'timetable.publish'
  // Fees
  | 'fees.structures' | 'fees.invoice' | 'fees.record_payment' | 'fees.gateways'
  // Careers
  | 'careers.employers' | 'careers.jobs' | 'careers.drives' | 'careers.interviews'
  | 'careers.certificates' | 'careers.skills'
  // Code Lab
  | 'lab.problems' | 'lab.contests'
  // Operations
  | 'support.assign' | 'audit.read' | 'settings.manage';

export interface Capability {
  key: CapabilityKey;
  area: string;
  label: string;
  /** What it lets somebody do, in the words the screen uses. */
  detail: string;
  /** Roles that hold it out of the box -- today's hard-coded guards. */
  defaults: Role[];
  /**
   * Roles this may ever be granted to. `admin` is implicit and omitted; a role
   * absent from here is never offered, because giving it would be nonsense
   * (a guardian entering marks) or unsafe.
   */
  holders: Role[];
}

const A = (
  key: CapabilityKey, area: string, label: string, detail: string,
  defaults: Role[], holders: Role[],
): Capability => ({ key, area, label, detail, defaults, holders });

/**
 * The catalogue, in the order a settings screen should show it: who is here,
 * what they study, what they sit, what they owe, where they go afterwards.
 */
export const CAPABILITIES: Capability[] = [
  // ---- People -------------------------------------------------------------
  A('people.invite', 'People', 'Add people',
    'Create an account at this institution and give it a role.',
    ['admin'], ['exams', 'placement']),
  A('people.edit', 'People', 'Edit people',
    'Change somebody’s name, role or account state.',
    ['admin'], ['exams', 'placement']),
  A('people.remove', 'People', 'Remove people',
    'End somebody’s membership of this institution.',
    ['admin'], []),
  A('people.roll_numbers', 'People', 'Set roll numbers',
    'Give a member the institution’s own number for them.',
    ['admin'], ['exams', 'faculty']),

  // ---- Academic structure -------------------------------------------------
  A('academics.programmes', 'Academic structure', 'Programmes and semesters',
    'Create programmes and the semesters inside them.',
    ['admin'], ['faculty']),
  A('academics.batches', 'Academic structure', 'Batches',
    'Create cohorts and put learners in them.',
    ['admin'], ['faculty', 'exams']),
  A('academics.enrol', 'Academic structure', 'Enrol learners',
    'Put a learner, or a whole batch, onto a course.',
    ['admin'], ['faculty', 'exams']),

  // ---- Courses ------------------------------------------------------------
  A('courses.create', 'Courses', 'Create courses',
    'Add a course to the catalogue.',
    ['admin', 'faculty'], ['faculty']),
  A('courses.author', 'Courses', 'Author content',
    'Modules, lessons, resources and assignments on a course.',
    ['admin', 'faculty'], ['faculty']),
  A('courses.publish', 'Courses', 'Publish courses',
    'Open a course to learners, or close it again.',
    ['admin', 'faculty'], ['faculty']),
  A('courses.assign_faculty', 'Courses', 'Assign teaching',
    'Attach a member of faculty to a course.',
    ['admin'], ['faculty']),
  A('attendance.take', 'Courses', 'Take attendance',
    'Open a session, mark the register and close it.',
    ['admin', 'faculty'], ['faculty', 'exams']),

  // ---- Assignments --------------------------------------------------------
  // Two keys, not six, and not one.
  //
  // Not six, for the reason assess.banks and domains.manage give: create, edit
  // and publish on the same object are only ever granted together, and three
  // switches an administrator always flips at once is three chances to leave
  // one behind.
  //
  // Not one, because SETTING work and MARKING it are genuinely different jobs
  // done by different people -- a teaching assistant marks what they did not
  // set, a lecturer on leave hands marking over without handing over the
  // course. Assessment already splits exactly here (assess.papers /
  // assess.mark) and assignments were the one place that did not.
  //
  // These are new keys, so every institution gets the defaults below -- which
  // are the roles that could already do this before the keys existed. Nobody
  // loses a power they were using; migration 0023 stores only diffs, so the
  // defaults arrive switched on everywhere.
  A('assignments.set', 'Assignments', 'Set assignments',
    'Create an assignment on a course, write its rubric, and publish it to learners.',
    ['admin', 'faculty'], ['faculty']),
  A('assignments.grade', 'Assignments', 'Grade assignments',
    'Score submitted work against the rubric and return it.',
    ['admin', 'faculty'], ['faculty']),

  // ---- Live Classes -------------------------------------------------------
  // One key for the whole of it, not three. Create, edit and remove on the same
  // small catalogue are only ever granted together -- the same reasoning
  // assess.banks and lab.problems already follow -- and three switches an
  // administrator always flips at once is three chances to leave one behind.
  A('domains.manage', 'Live Classes', 'Manage domains',
    'Create, edit and remove the domains shown on Live Classes, including their '
    + 'price, curriculum link and thumbnail.',
    ['admin'], ['faculty']),

  // ---- Assessment ---------------------------------------------------------
  A('assess.banks', 'Assessment', 'Question banks',
    'Create banks and write the questions in them.',
    ['admin', 'faculty', 'exams'], ['faculty', 'exams']),
  A('assess.papers', 'Assessment', 'Set papers',
    'Draw a paper from a bank and set its window.',
    ['admin', 'faculty', 'exams'], ['faculty', 'exams']),
  A('assess.publish', 'Assessment', 'Publish papers',
    'Make a paper available to sit.',
    ['admin', 'faculty', 'exams'], ['faculty', 'exams']),
  A('assess.mark', 'Assessment', 'Mark papers',
    'Award marks on the written answers of a sat paper.',
    ['admin', 'faculty', 'exams'], ['faculty', 'exams']),
  A('assess.release', 'Assessment', 'Release results',
    'Let candidates see their marks.',
    ['admin', 'faculty', 'exams'], ['faculty', 'exams']),
  A('assess.proctor', 'Assessment', 'Review monitoring',
    'Work the proctoring queue and rule on flagged events.',
    ['admin', 'faculty', 'exams'], ['faculty', 'exams']),

  // ---- Examinations -------------------------------------------------------
  A('exams.schedule', 'Examinations', 'Schedule examinations',
    'Put an examination on the calendar.',
    ['admin', 'exams', 'faculty'], ['exams', 'faculty']),
  A('exams.halls', 'Examinations', 'Manage halls',
    'Create examination halls and their seating grids.',
    ['admin', 'exams'], ['exams']),
  A('exams.seating', 'Examinations', 'Allocate seating',
    'Seat candidates and print the plan.',
    ['admin', 'exams'], ['exams', 'faculty']),
  A('exams.marks', 'Examinations', 'Enter marks',
    'Record raw marks against a paper.',
    ['admin', 'exams', 'faculty'], ['exams', 'faculty']),
  A('exams.moderate', 'Examinations', 'Moderate marks',
    'Apply a board’s adjustment across a paper.',
    ['admin', 'exams'], ['exams']),
  A('exams.publish', 'Examinations', 'Publish results',
    'Release examination marks to candidates.',
    ['admin', 'exams'], ['exams']),

  // ---- Timetable ----------------------------------------------------------
  A('timetable.manage', 'Timetable', 'Build the timetable',
    'Rooms, and the slots on the weekly grid.',
    ['admin'], ['exams', 'faculty']),
  A('timetable.publish', 'Timetable', 'Publish the timetable',
    'Make the grid visible to learners.',
    ['admin'], ['exams']),

  // ---- Fees ---------------------------------------------------------------
  A('fees.structures', 'Fees', 'Fee heads and structures',
    'Define what is charged, and publish a structure.',
    ['admin'], []),
  A('fees.invoice', 'Fees', 'Raise invoices',
    'Issue an invoice against a learner.',
    ['admin'], []),
  A('fees.record_payment', 'Fees', 'Record payments',
    'Enter a payment taken outside the gateway.',
    ['admin'], []),
  A('fees.gateways', 'Fees', 'Payment gateways',
    'Configure how the institution takes money.',
    ['admin'], []),

  // ---- Careers ------------------------------------------------------------
  A('careers.employers', 'Careers', 'Employers',
    'Keep the employer records.',
    ['admin', 'placement'], ['placement']),
  A('careers.jobs', 'Careers', 'Publish job posts',
    'Open a post to applications, and close it.',
    ['admin', 'placement'], ['placement', 'faculty']),
  A('careers.drives', 'Careers', 'Placement drives',
    'Run a drive and record its rounds.',
    ['admin', 'placement'], ['placement']),
  A('careers.interviews', 'Careers', 'Interviews',
    'Schedule mock interviews and release feedback.',
    ['admin', 'placement'], ['placement', 'faculty']),
  A('careers.certificates', 'Careers', 'Issue certificates',
    'Award a verifiable credential, or revoke one.',
    ['admin'], ['placement', 'faculty', 'exams']),
  A('careers.skills', 'Careers', 'Award skills',
    'Record a skill against a learner’s profile.',
    ['admin', 'placement'], ['placement', 'faculty']),

  // ---- Code Lab -----------------------------------------------------------
  A('lab.problems', 'Code Lab', 'Practice problems',
    'Write problems, their tests and their hints.',
    ['admin', 'faculty'], ['faculty']),
  A('lab.contests', 'Code Lab', 'Contests',
    'Run a contest and publish its results.',
    ['admin', 'faculty'], ['faculty', 'placement']),

  // ---- Operations ---------------------------------------------------------
  A('support.assign', 'Operations', 'Assign support tickets',
    'Route a ticket to whoever should answer it.',
    ['admin'], ['faculty', 'placement', 'exams']),
  A('audit.read', 'Operations', 'Read the audit log',
    'Every recorded action at this institution.',
    ['admin'], ['exams']),
  A('settings.manage', 'Operations', 'Change settings',
    'These permissions, and how the institution runs.',
    ['admin'], []),
];

export const CAPABILITY_AREAS = [...new Set(CAPABILITIES.map((c) => c.area))];

const BY_KEY = new Map(CAPABILITIES.map((c) => [c.key, c]));

/** The stored shape: only what an institution changed. */
export type PermissionOverrides = Partial<Record<CapabilityKey, Role[]>>;

/**
 * Capabilities the PLATFORM has withheld from an institution.
 *
 * Not part of the tenant's own matrix and not writable from inside the
 * institution: this is the operator's decision about what the customer has
 * bought or may do. Stored as a plain list of keys on the tenant row.
 */
export type PlatformDenials = CapabilityKey[];

/** Drops anything that is not a capability, and de-duplicates. */
export function normaliseDenials(input: unknown): PlatformDenials {
  if (!Array.isArray(input)) return [];
  const seen = new Set<CapabilityKey>();
  for (const k of input) {
    if (typeof k === 'string' && BY_KEY.has(k as CapabilityKey)) seen.add(k as CapabilityKey);
  }
  return [...seen];
}

/**
 * Capabilities an institution does not get merely by existing.
 *
 * The difference between "withheld" and "not yet granted" is only where the
 * institution starts. Everything else in the catalogue ships switched on and
 * an operator may take it away; these ship OFF, and an administrator has to be
 * given them by the platform before anyone at the institution can act.
 *
 * Issuing credentials is the first of them, and the reason the distinction
 * exists: a certificate is the institution making a permanent, publicly
 * verifiable claim about a person, under the platform's own verification
 * domain. Whether a new customer may do that at all is the platform's call to
 * make deliberately, not something they inherit by signing up.
 *
 * Applied at creation (see PlatformService.createTenant), never retroactively:
 * an institution already issuing credentials does not lose them because this
 * list grew.
 */
export const GRANT_REQUIRED: CapabilityKey[] = ['careers.certificates'];

/** What a brand-new institution starts with withheld. */
export function defaultDenials(): PlatformDenials {
  return [...GRANT_REQUIRED];
}

/** Whether this capability has to be granted by the platform before use. */
export function needsPlatformGrant(key: CapabilityKey): boolean {
  return GRANT_REQUIRED.includes(key);
}

/** Whether the platform has withheld this capability from this institution. */
export function isDenied(key: CapabilityKey, denied?: PlatformDenials | null): boolean {
  return Array.isArray(denied) && denied.includes(key);
}

/**
 * Who holds a capability at this institution.
 *
 * Defaults, unless the institution has said otherwise about this exact
 * capability -- and `admin` is added back whatever the stored value says,
 * because an override that drops it is a lockout, not a configuration.
 */
export function holdersOf(
  key: CapabilityKey,
  overrides?: PermissionOverrides | null,
  /** What the platform has withheld. Nobody holds a denied capability. */
  denied?: PlatformDenials | null,
): Role[] {
  const cap = BY_KEY.get(key);
  if (!cap) return ['admin'];
  // Before the admin floor, not after it: a platform denial is the one thing
  // that empties this list, and re-adding `admin` underneath would put back
  // exactly the holder the operator meant to remove.
  if (isDenied(key, denied)) return [];
  const stored = overrides?.[key];
  const roles = stored ?? cap.defaults;
  return roles.includes('admin') ? roles : ['admin', ...roles];
}

/**
 * What ONE PERSON has been granted or refused, over and above their role.
 *
 * `true` gives somebody a capability their role does not carry; `false` takes
 * one away from somebody whose role does. Both are real needs -- the lecturer
 * who also runs the timetable, and the one who should no longer publish
 * results -- and answering either with the role matrix means changing what the
 * role means for everybody who shares it.
 */
export type PersonalPermissions = Partial<Record<CapabilityKey, boolean>>;

/**
 * Whether this person may attempt this act at this institution.
 *
 * Order matters and is the whole design: a personal decision beats the role,
 * and the role beats the default. What a personal grant CANNOT do is exceed
 * the capability itself -- `holders` is the list of roles an institution may
 * ever delegate this to, several capabilities have an empty one on purpose,
 * and naming a person is not a way round that. `normalisePersonal` drops such
 * a grant on write; this drops it on read as well, so a row written before a
 * capability was locked down cannot outlive the decision.
 *
 * A REVOCATION is honoured whatever the holders list says. Taking something
 * away is always allowed -- except from an administrator, who cannot be locked
 * out of their own institution for the same reason `holdersOf` puts them back.
 */
export function can(
  role: Role | null | undefined,
  key: CapabilityKey,
  overrides?: PermissionOverrides | null,
  personal?: PersonalPermissions | null,
  denied?: PlatformDenials | null,
): boolean {
  if (!role) return false;
  // First, and without exception. A platform denial outranks the role matrix,
  // the admin floor and a personal grant alike -- it is the operator's answer
  // to "may this institution do this at all", and anything that could override
  // it from inside the institution would make it advisory.
  if (isDenied(key, denied)) return false;
  const mine = personal?.[key];
  if (mine === false) return role === 'admin';
  if (mine === true) {
    const cap = BY_KEY.get(key);
    // Grantable to this role at all? If not, the personal grant is void.
    return Boolean(cap && (role === 'admin' || cap.holders.includes(role)));
  }
  return holdersOf(key, overrides).includes(role);
}

/**
 * Sanitises one person's overrides before they are stored.
 *
 * Same shape of rule as `normaliseOverrides` next door: anything not in the
 * catalogue is dropped, and a GRANT to a role the capability may never be
 * delegated to is dropped. A revocation survives regardless -- an institution
 * may always take something away.
 */
export function normalisePersonal(
  input: Record<string, unknown>,
  role: Role,
): PersonalPermissions {
  const out: PersonalPermissions = {};
  for (const cap of CAPABILITIES) {
    const asked = input[cap.key];
    if (typeof asked !== 'boolean') continue;
    if (asked && role !== 'admin' && !cap.holders.includes(role)) continue;
    // Storing "granted" for something the role already has by default is
    // noise that goes stale the moment the matrix changes -- but storing it
    // is harmless and honest about what somebody clicked, so it is kept.
    out[cap.key] = asked;
  }
  return out;
}

/**
 * Sanitises what an institution tried to save.
 *
 * Anything not in the catalogue is dropped; any role a capability may not be
 * given to is dropped; `admin` is always kept. A capability whose set matches
 * its defaults is not stored at all, so "reset to defaults" and "never touched"
 * are the same state rather than two states that drift apart.
 */
export function normaliseOverrides(input: Record<string, string[]>): PermissionOverrides {
  const out: PermissionOverrides = {};
  for (const cap of CAPABILITIES) {
    const asked = input[cap.key];
    if (!Array.isArray(asked)) continue;
    const allowed = asked.filter((r): r is Role =>
      cap.holders.includes(r as Role));
    const next = ['admin' as Role, ...allowed.filter((r) => r !== 'admin')];
    const same = next.length === new Set([...cap.defaults, 'admin']).size
      && next.every((r) => cap.defaults.includes(r) || r === 'admin');
    if (!same) out[cap.key] = next;
  }
  return out;
}

export function capability(key: CapabilityKey): Capability | undefined {
  return BY_KEY.get(key);
}
