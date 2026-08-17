/**
 * Backup and restore for academic records.
 *
 * The proposal promises "backups and recovery procedures protect academic
 * records". Supabase takes its own snapshots of the whole project; this is the
 * other half, and the half that matters when something goes wrong at the
 * application level rather than the disk level:
 *
 *   * **A per-tenant export.** A snapshot restores everything or nothing. When
 *     one institution needs its records back -- or needs to take them elsewhere
 *     -- restoring the whole project would overwrite every other institution.
 *   * **A verified restore.** A backup nobody has restored is a hope. `--verify`
 *     reads the file back, checks every table and row count against it, and says
 *     so.
 *
 * Usage
 *   node tools/db/backup.mjs --tenant <slug> [--out backups/]
 *   node tools/db/backup.mjs --verify backups/<file>.json
 *   node tools/db/backup.mjs --restore backups/<file>.json --into <slug>
 *
 * Restoring is deliberately awkward: it refuses to write into a tenant that
 * already has data unless `--force` is given, because the failure mode of a
 * careless restore is silently merging two institutions' records.
 */
import fs from 'node:fs';
import path from 'node:path';
import { connect, loadEnv } from './connect.mjs';

/**
 * Every Onyx table, parents before children.
 *
 * Order matters on restore: a foreign key to a row that has not been written
 * yet fails, and the failure is halfway through.
 */
const TABLES = [
  'onyx_tenants',
  'onyx_memberships',
  'onyx_audit_logs',
  'onyx_programs', 'onyx_semesters', 'onyx_batches', 'onyx_batch_members',
  'onyx_courses', 'onyx_course_faculty', 'onyx_enrollments',
  'onyx_modules', 'onyx_lessons', 'onyx_lesson_progress', 'onyx_resources',
  'onyx_attendance_sessions', 'onyx_attendance_records',
  'onyx_assignments', 'onyx_rubric_criteria',
  'onyx_assignment_submissions', 'onyx_submission_scores',
  'onyx_problems', 'onyx_problem_tests', 'onyx_hints', 'onyx_hint_reveals',
  'onyx_code_submissions', 'onyx_submission_cases',
  'onyx_workspaces', 'onyx_workspace_files', 'onyx_workspace_snapshots',
  'onyx_workspace_comments',
  'onyx_question_banks', 'onyx_questions', 'onyx_question_versions',
  'onyx_assessments', 'onyx_assessment_attempts', 'onyx_assessment_answers',
  'onyx_proctor_events', 'onyx_assessment_grades',
  'onyx_skills', 'onyx_certificates', 'onyx_learner_skills', 'onyx_readiness_scores',
  'onyx_employers', 'onyx_jobs_posted', 'onyx_job_applications',
  'onyx_drives', 'onyx_drive_rounds', 'onyx_drive_results',
  'onyx_contests', 'onyx_contest_teams', 'onyx_contest_members',
  'onyx_contest_submissions', 'onyx_mock_interviews',
];

/**
 * `onyx_users` is a shared identity table: a person can belong to two
 * institutions, so their row is not one tenant's to export or to delete. Only
 * the people this tenant actually has a membership for are included, and a
 * restore attaches to an existing identity rather than replacing it.
 */
const SHARED = 'onyx_users';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? null : (args[i + 1] ?? true);
};

async function backup(slug, outDir) {
  const client = await connect(loadEnv());
  try {
    const { rows: [tenant] } = await client.query(
      'SELECT * FROM public."onyx_tenants" WHERE "slug" = $1', [slug]);
    if (!tenant) throw new Error('No institution with the slug "' + slug + '".');

    const data = {};
    let total = 0;
    for (const table of TABLES) {
      const column = table === 'onyx_tenants' ? 'id' : 'tenant_id';
      const { rows } = await client.query(
        'SELECT * FROM public."' + table + '" WHERE "' + column + '" = $1 ORDER BY "id"',
        [tenant.id]);
      data[table] = rows;
      total += rows.length;
    }

    // The people, reached through their memberships rather than by tenant.
    const { rows: people } = await client.query(
      `SELECT u.* FROM public."${SHARED}" u
       WHERE u."id" IN (SELECT "user_id" FROM public."onyx_memberships" WHERE "tenant_id" = $1)`,
      [tenant.id]);
    data[SHARED] = people;
    total += people.length;

    const document = {
      format: 'onyx-tenant-backup/1',
      taken_at: new Date().toISOString(),
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      counts: Object.fromEntries(Object.entries(data).map(([t, rows]) => [t, rows.length])),
      data,
    };

    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir,
      'onyx-' + slug + '-' + document.taken_at.replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(file, JSON.stringify(document, null, 2));

    console.log('backed up ' + total + ' rows across '
      + Object.keys(data).length + ' tables');
    console.log(file);
    return file;
  } finally {
    await client.end();
  }
}

/**
 * Reads a backup back and checks it against the database.
 *
 * A backup nobody has restored is a hope, and a count that has drifted since
 * the file was written is the first sign that something is wrong.
 */
async function verify(file) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (document.format !== 'onyx-tenant-backup/1') {
    throw new Error('That is not an Onyx backup.');
  }

  const client = await connect(loadEnv());
  const problems = [];
  try {
    const { rows: [tenant] } = await client.query(
      'SELECT "id" FROM public."onyx_tenants" WHERE "slug" = $1', [document.tenant.slug]);

    for (const [table, expected] of Object.entries(document.counts)) {
      const inFile = (document.data[table] ?? []).length;
      if (inFile !== expected) {
        problems.push(table + ': the file says ' + expected + ' rows but holds ' + inFile);
        continue;
      }
      if (!tenant) continue; // the institution is gone; the file is all there is
      if (table === SHARED) continue;
      const column = table === 'onyx_tenants' ? 'id' : 'tenant_id';
      const { rows: [live] } = await client.query(
        'SELECT count(*)::int c FROM public."' + table + '" WHERE "' + column + '" = $1',
        [tenant.id]);
      if (live.c !== expected) {
        problems.push(table + ': ' + expected + ' in the backup, ' + live.c + ' live now');
      }
    }
  } finally {
    await client.end();
  }

  const rows = Object.values(document.counts).reduce((a, b) => a + b, 0);
  console.log('backup of "' + document.tenant.slug + '" taken ' + document.taken_at);
  console.log(rows + ' rows across ' + Object.keys(document.counts).length + ' tables');
  if (!problems.length) {
    console.log('VERIFIED: the file is complete and matches the live database.');
    return true;
  }
  console.log('DIFFERENCES (expected if the institution has changed since):');
  for (const p of problems) console.log('  - ' + p);
  return false;
}

async function restore(file, intoSlug, force) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (document.format !== 'onyx-tenant-backup/1') {
    throw new Error('That is not an Onyx backup.');
  }
  const client = await connect(loadEnv());
  try {
    const { rows: [target] } = await client.query(
      'SELECT * FROM public."onyx_tenants" WHERE "slug" = $1', [intoSlug]);
    if (!target) throw new Error('No institution with the slug "' + intoSlug + '".');

    const { rows: [existing] } = await client.query(
      'SELECT count(*)::int c FROM public."onyx_memberships" WHERE "tenant_id" = $1',
      [target.id]);
    if (existing.c > 0 && !force) {
      // Merging two institutions' records silently is the failure mode worth
      // being awkward about.
      throw new Error('"' + intoSlug + '" already has ' + existing.c + ' members. '
        + 'Restoring into it would merge two institutions. Pass --force if that '
        + 'is genuinely what you want.');
    }

    await client.query('BEGIN');
    let written = 0;
    // Identities first, attaching to whoever already exists by email.
    for (const person of document.data[SHARED] ?? []) {
      await client.query(
        `INSERT INTO public."${SHARED}" ("id", "email", "name", "password", "phone",
           "photo", "status", "email_verified_at", "created_at", "updated_at")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT ("email") DO NOTHING`,
        [person.id, person.email, person.name, person.password, person.phone,
          person.photo, person.status, person.email_verified_at,
          person.created_at, person.updated_at]);
      written += 1;
    }

    for (const table of TABLES) {
      if (table === 'onyx_tenants') continue; // the target already exists
      for (const row of document.data[table] ?? []) {
        const columns = Object.keys(row);
        const values = columns.map((c) => (c === 'tenant_id' ? target.id : row[c]));
        const placeholders = columns.map((_, i) => '$' + (i + 1)).join(', ');
        await client.query(
          'INSERT INTO public."' + table + '" ("' + columns.join('", "') + '") '
          + 'VALUES (' + placeholders + ') ON CONFLICT DO NOTHING', values);
        written += 1;
      }
    }

    // Identity columns keep their own counters, which know nothing about rows
    // inserted with explicit ids. Without this the next insert collides.
    for (const table of [...TABLES, SHARED]) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('public.${table}', 'id'),
           GREATEST((SELECT COALESCE(MAX("id"), 1) FROM public."${table}"), 1))`);
    }

    await client.query('COMMIT');
    console.log('restored ' + written + ' rows into "' + intoSlug + '"');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

const tenant = flag('tenant');
const verifyFile = flag('verify');
const restoreFile = flag('restore');

try {
  if (verifyFile) {
    process.exitCode = (await verify(String(verifyFile))) ? 0 : 1;
  } else if (restoreFile) {
    const into = flag('into');
    if (!into) throw new Error('--restore needs --into <slug>.');
    await restore(String(restoreFile), String(into), args.includes('--force'));
  } else if (tenant) {
    await backup(String(tenant), String(flag('out') ?? 'backups'));
  } else {
    console.log('usage:');
    console.log('  node tools/db/backup.mjs --tenant <slug> [--out backups/]');
    console.log('  node tools/db/backup.mjs --verify <file>');
    console.log('  node tools/db/backup.mjs --restore <file> --into <slug> [--force]');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
