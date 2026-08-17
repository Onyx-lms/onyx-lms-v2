/**
 * LAB-05 -- project workspaces.
 *
 * "Multi-file project spaces with snapshots and mentor review to move learners
 * from exercises to real builds."
 *
 * The acceptance criterion is exact: **a snapshot restores the file tree it
 * captured.** So a snapshot is one immutable jsonb document rather than a copy
 * of the file rows -- rows can be edited afterwards, and a "snapshot" that
 * drifts is worse than none, because it is trusted.
 *
 * Ownership: a workspace belongs to one learner. Mentors reach it through the
 * course it is attached to, and only if they teach that course.
 */
import type { OnyxDb } from './db.ts';
import type { Role } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import type { AcademicsService } from './academics.service.ts';
import {
  LANGUAGES, NoSandboxError, type ExecutionProvider, type Language, type RunResult,
} from './execution.provider.ts';
import { increment } from './metrics.ts';

const WORKSPACE_COLUMNS = 'id, tenant_id, course_id, user_id, title, language, entry_path, created_at, updated_at';
const FILE_COLUMNS = 'id, tenant_id, workspace_id, path, content, updated_at';
const SNAPSHOT_COLUMNS = 'id, tenant_id, workspace_id, label, files, created_by, created_at';
const COMMENT_COLUMNS = 'id, tenant_id, workspace_id, snapshot_id, file_path, line, body, author_id, resolved_at, created_at';

/** Files, as they are stored inside a snapshot. */
export interface SnapshotFile { path: string; content: string }

const MAX_FILES = 200;
const MAX_FILE_BYTES = 512 * 1024;

/**
 * A workspace path, cleaned.
 *
 * Paths are stored, listed and restored, so a traversal here would let one file
 * escape its workspace the moment anything wrote the tree to disk -- which a
 * future sandbox will do.
 */
export function normalisePath(input: string): string {
  const path = (input ?? '').replace(/\\/g, '/').trim();
  const parts = path.split('/')
    .filter((p) => p && p !== '.' && p !== '..')
    // Control characters, which a filesystem would take literally. Written as
    // escapes: a literal NUL in a source file breaks every tool that reads it.
    .map((p) => p.replace(/[\u0000-\u001f\u007f]/g, '').trim())
    .filter(Boolean);
  const cleaned = parts.join('/');
  if (!cleaned) throw new HttpError(422, 'That is not a usable file name.');
  if (cleaned.length > 400) throw new HttpError(422, 'That path is too long.');
  return cleaned;
}

export class WorkspaceService {
  #db: OnyxDb;
  #academics: AcademicsService;
  #provider: ExecutionProvider;
  #now: () => number;

  constructor(
    db: OnyxDb, academics: AcademicsService, provider: ExecutionProvider,
    now: () => number = Date.now,
  ) {
    this.#db = db;
    this.#academics = academics;
    this.#provider = provider;
    this.#now = now;
  }

  async create(tenantId: number, userId: string, input: {
    title: string; language?: string; entry_path?: string;
    course_id?: number | null; files?: SnapshotFile[];
  }) {
    if (input.course_id) {
      // A workspace attached to a course is one a mentor can reach, so the
      // learner has to actually be in that course.
      await this.#academics.assertEnrolled(tenantId, input.course_id, userId);
    }
    const entry = normalisePath(input.entry_path ?? 'main.py');
    const { data, error } = await this.#db.from('onyx_workspaces').insert({
      tenant_id: tenantId,
      course_id: input.course_id ?? null,
      user_id: userId,
      title: input.title.trim(),
      language: input.language ?? 'python',
      entry_path: entry,
    }).select(WORKSPACE_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the workspace: ' + error.message);

    const files = input.files?.length ? input.files : [{ path: entry, content: '' }];
    await this.writeFiles(tenantId, Number(data!.id), userId, 'student', files);
    return data!;
  }

  async list(tenantId: number, userId: string) {
    const { data } = await this.#db.from('onyx_workspaces')
      .select(WORKSPACE_COLUMNS)
      .eq('tenant_id', tenantId).eq('user_id', userId)
      .order('id', { ascending: false });
    return data ?? [];
  }

  /** Every project at the institution, personal or course-attached -- an
   * administrator does not create workspaces here, they monitor everyone
   * who does. Ownership is who to ask about it, not who else can read it:
   * see #assertReachable() for the actual open-one-and-look-inside check. */
  async listAll(tenantId: number) {
    const { data } = await this.#db.from('onyx_workspaces')
      .select(WORKSPACE_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('id', { ascending: false });
    return data ?? [];
  }

  /**
   * The same monitoring view as listAll(), narrowed to one person's own
   * classes -- faculty do not get every project at the institution, only
   * the ones their students built for a course they actually teach.
   * `#assertReachable` already let a faculty member open one of these
   * individually if they somehow had its id; this is the list that makes
   * them discoverable in the first place.
   */
  async listForCourses(tenantId: number, courseIds: number[]) {
    if (!courseIds.length) return [];
    const { data } = await this.#db.from('onyx_workspaces')
      .select(WORKSPACE_COLUMNS)
      .eq('tenant_id', tenantId).in('course_id', courseIds)
      .order('id', { ascending: false });
    return data ?? [];
  }

  /** The workspace with its tree, its snapshots and its review comments. */
  async open(tenantId: number, workspaceId: number, userId: string, role: Role) {
    const workspace = await this.#assertReachable(tenantId, workspaceId, userId, role);
    const [files, snapshots, comments] = await Promise.all([
      this.files(tenantId, workspaceId),
      this.snapshots(tenantId, workspaceId),
      this.comments(tenantId, workspaceId),
    ]);
    return {
      ...workspace,
      files,
      // The file contents of every snapshot would be the whole history in one
      // response; the list is metadata, and restoring fetches the one wanted.
      snapshots: snapshots.map((s) => ({
        id: s.id, label: s.label, created_by: s.created_by, created_at: s.created_at,
        file_count: Array.isArray(s.files) ? (s.files as unknown[]).length : 0,
      })),
      comments,
      can_review: role === 'admin' || role === 'faculty',
    };
  }

  async files(tenantId: number, workspaceId: number) {
    const { data } = await this.#db.from('onyx_workspace_files')
      .select(FILE_COLUMNS).eq('tenant_id', tenantId).eq('workspace_id', workspaceId).order('path');
    return data ?? [];
  }

  /**
   * Writes files, creating or replacing by path.
   *
   * Only the owner edits. A mentor reviews by commenting, which is a different
   * verb on purpose -- a reviewer silently rewriting a learner's project is not
   * review.
   */
  async writeFiles(
    tenantId: number, workspaceId: number, userId: string, role: Role, files: SnapshotFile[],
  ) {
    const workspace = await this.#assertOwner(tenantId, workspaceId, userId, role);
    if (!files.length) throw new HttpError(422, 'There is nothing to save.');

    const existing = await this.files(tenantId, workspaceId);
    const byPath = new Map(existing.map((f) => [f.path, f]));
    const incoming = files.map((f) => ({
      path: normalisePath(f.path), content: f.content ?? '',
    }));
    for (const f of incoming) {
      if (Buffer.byteLength(f.content, 'utf8') > MAX_FILE_BYTES) {
        throw new HttpError(422, f.path + ' is larger than 512KB.');
      }
    }
    const total = new Set([...byPath.keys(), ...incoming.map((f) => f.path)]).size;
    if (total > MAX_FILES) throw new HttpError(422, 'A workspace holds at most 200 files.');

    const at = new Date(this.#now()).toISOString();
    const fresh = incoming.filter((f) => !byPath.has(f.path));
    for (const f of incoming.filter((f) => byPath.has(f.path))) {
      await this.#db.from('onyx_workspace_files')
        .update({ content: f.content, updated_at: at }).eq('id', byPath.get(f.path)!.id);
    }
    if (fresh.length) {
      const { error } = await this.#db.from('onyx_workspace_files').insert(
        fresh.map((f) => ({
          tenant_id: tenantId, workspace_id: workspaceId,
          path: f.path, content: f.content, updated_at: at,
        })));
      if (error) throw new HttpError(500, 'Could not save the files: ' + error.message);
    }
    await this.#db.from('onyx_workspaces')
      .update({ updated_at: at }).eq('id', workspace.id);
    return this.files(tenantId, workspaceId);
  }

  async deleteFile(
    tenantId: number, workspaceId: number, userId: string, role: Role, path: string,
  ) {
    const workspace = await this.#assertOwner(tenantId, workspaceId, userId, role);
    const clean = normalisePath(path);
    if (clean === workspace.entry_path) {
      throw new HttpError(422, 'The entry file cannot be deleted.');
    }
    await this.#db.from('onyx_workspace_files')
      .delete().eq('tenant_id', tenantId).eq('workspace_id', workspaceId).eq('path', clean);
    return this.files(tenantId, workspaceId);
  }

  /**
   * Runs one file through the sandbox and returns the result in the same
   * response.
   *
   * LAB-02b's queue exists for "200 submissions at once" -- a whole class
   * hitting Submit against one assignment. A workspace has one owner running
   * their own project, so there is nothing to batch and nothing gained by
   * making this a row someone has to poll: it is a single Judge0 call, and
   * Judge0's own `wait=true` is built for exactly that.
   *
   * Only the owner runs it, for the same reason only the owner edits it: a
   * mentor's tool here is a comment, not code they can execute themselves.
   */
  async run(tenantId: number, workspaceId: number, userId: string, role: Role, input: {
    path?: string; stdin?: string;
  }): Promise<RunResult & { path: string }> {
    const workspace = await this.#assertOwner(tenantId, workspaceId, userId, role);
    const language = workspace.language as Language;
    if (!LANGUAGES.includes(language)) {
      throw new HttpError(422, 'This workspace is set to "' + workspace.language
        + '", which has no sandbox to run it in.');
    }
    if (!this.#provider.supports(language)) {
      throw new HttpError(503, new NoSandboxError().message);
    }

    const path = input.path ? normalisePath(input.path) : workspace.entry_path;
    const files = await this.files(tenantId, workspaceId);
    const file = files.find((f) => f.path === path);
    if (!file) throw new HttpError(404, 'No file at ' + path + '.');
    if (!String(file.content ?? '').trim()) throw new HttpError(422, 'There is nothing to run.');

    increment('onyx_workspace_runs_total', { language });
    try {
      const result = await this.#provider.run({
        language, source: String(file.content), stdin: input.stdin ?? null,
      });
      // A provider failure is a verdict (`internal_error`), not a throw -- see
      // Judge0Provider.run(), which never lets a sandbox problem become an
      // unhandled rejection. Counted the same either way.
      if (result.verdict === 'internal_error') increment('onyx_workspace_run_failures_total');
      return { path, ...result };
    } catch (e) {
      increment('onyx_workspace_run_failures_total');
      throw e;
    }
  }

  // ---- snapshots ----

  async snapshot(tenantId: number, workspaceId: number, userId: string, role: Role, label: string) {
    await this.#assertReachable(tenantId, workspaceId, userId, role);
    const files = await this.files(tenantId, workspaceId);
    if (!files.length) throw new HttpError(422, 'There is nothing to capture.');

    // One immutable document. Copying rows would leave a "snapshot" that later
    // edits could change, which is worse than none because it is trusted.
    const captured: SnapshotFile[] = files.map((f) => ({
      path: String(f.path), content: String(f.content ?? ''),
    }));
    const { data, error } = await this.#db.from('onyx_workspace_snapshots').insert({
      tenant_id: tenantId, workspace_id: workspaceId,
      label: label.trim() || 'Snapshot',
      files: captured as never,
      created_by: userId,
    }).select(SNAPSHOT_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not take the snapshot: ' + error.message);
    return { ...data!, file_count: captured.length };
  }

  async snapshots(tenantId: number, workspaceId: number) {
    const { data } = await this.#db.from('onyx_workspace_snapshots')
      .select(SNAPSHOT_COLUMNS)
      .eq('tenant_id', tenantId).eq('workspace_id', workspaceId)
      .order('id', { ascending: false });
    return data ?? [];
  }

  /**
   * Restores a snapshot exactly.
   *
   * Exactly means exactly: a file created after the snapshot is removed, not
   * left behind. A restore that only overwrites is a merge, and would quietly
   * fail the one thing this feature promises.
   */
  async restore(
    tenantId: number, workspaceId: number, snapshotId: number, userId: string, role: Role,
  ) {
    await this.#assertOwner(tenantId, workspaceId, userId, role);
    const { data: snapshot } = await this.#db.from('onyx_workspace_snapshots')
      .select(SNAPSHOT_COLUMNS)
      .eq('tenant_id', tenantId).eq('id', snapshotId).eq('workspace_id', workspaceId)
      .maybeSingle();
    if (!snapshot) throw new HttpError(404, 'Snapshot not found.');

    const captured = (snapshot.files ?? []) as unknown as SnapshotFile[];
    const at = new Date(this.#now()).toISOString();

    await this.#db.from('onyx_workspace_files')
      .delete().eq('tenant_id', tenantId).eq('workspace_id', workspaceId);
    if (captured.length) {
      const { error } = await this.#db.from('onyx_workspace_files').insert(
        captured.map((f) => ({
          tenant_id: tenantId, workspace_id: workspaceId,
          path: f.path, content: f.content, updated_at: at,
        })));
      if (error) throw new HttpError(500, 'Could not restore: ' + error.message);
    }
    await this.#db.from('onyx_workspaces').update({ updated_at: at }).eq('id', workspaceId);
    return this.files(tenantId, workspaceId);
  }

  // ---- mentor review ----

  async comment(tenantId: number, workspaceId: number, authorId: string, role: Role, input: {
    body: string; file_path?: string | null; line?: number | null; snapshot_id?: number | null;
  }) {
    await this.#assertReachable(tenantId, workspaceId, authorId, role);
    if (!input.body.trim()) throw new HttpError(422, 'A comment needs something in it.');

    const { data, error } = await this.#db.from('onyx_workspace_comments').insert({
      tenant_id: tenantId, workspace_id: workspaceId,
      snapshot_id: input.snapshot_id ?? null,
      file_path: input.file_path ? normalisePath(input.file_path) : null,
      line: input.line ?? null,
      body: input.body.trim(),
      author_id: authorId,
    }).select(COMMENT_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not save the comment: ' + error.message);
    return data!;
  }

  async comments(tenantId: number, workspaceId: number) {
    const { data } = await this.#db.from('onyx_workspace_comments')
      .select(COMMENT_COLUMNS).eq('tenant_id', tenantId).eq('workspace_id', workspaceId).order('id');
    return data ?? [];
  }

  async resolveComment(
    tenantId: number, workspaceId: number, commentId: number, userId: string, role: Role,
  ) {
    await this.#assertReachable(tenantId, workspaceId, userId, role);
    const { data } = await this.#db.from('onyx_workspace_comments')
      .select(COMMENT_COLUMNS)
      .eq('tenant_id', tenantId).eq('id', commentId).eq('workspace_id', workspaceId)
      .maybeSingle();
    if (!data) throw new HttpError(404, 'Comment not found.');
    const at = new Date(this.#now()).toISOString();
    await this.#db.from('onyx_workspace_comments')
      .update({ resolved_at: at }).eq('id', commentId);
    return { ...data, resolved_at: at };
  }

  /** Faculty view: every workspace attached to a course they teach. */
  async forCourse(tenantId: number, courseId: number, userId: string, role: Role) {
    await this.#academics.assertCanTeach(tenantId, courseId, userId, role);
    const { data } = await this.#db.from('onyx_workspaces')
      .select(WORKSPACE_COLUMNS)
      .eq('tenant_id', tenantId).eq('course_id', courseId)
      .order('id', { ascending: false });
    return data ?? [];
  }

  // ---- internals ----

  async #workspace(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_workspaces')
      .select(WORKSPACE_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Workspace not found.');
    return data;
  }

  /** Editing is the owner's alone. */
  async #assertOwner(tenantId: number, id: number, userId: string, role: Role) {
    const workspace = await this.#workspace(tenantId, id);
    if (String(workspace.user_id) !== userId) {
      // Not even an admin edits somebody's project in place. Review is a
      // comment, not a rewrite.
      throw new HttpError(403, 'This is not your workspace.');
    }
    void role;
    return workspace;
  }

  /**
   * Reading, and reviewing.
   *
   * The owner always. A mentor only through the course it is attached to, and
   * only if they teach that course -- a workspace with no course is private.
   */
  async #assertReachable(tenantId: number, id: number, userId: string, role: Role) {
    const workspace = await this.#workspace(tenantId, id);
    if (String(workspace.user_id) === userId) return workspace;
    // An administrator monitors every project at the institution, personal
    // or not -- the same standing they already hold over every course,
    // roster and result. Faculty stay narrower: only a course they teach,
    // which is why a personal (course_id null) workspace stays theirs alone.
    if (role === 'admin') return workspace;
    if (role !== 'faculty') {
      throw new HttpError(403, 'This is not your workspace.');
    }
    if (!workspace.course_id) {
      throw new HttpError(403, 'This workspace is not attached to a course.');
    }
    await this.#academics.assertCanTeach(tenantId, Number(workspace.course_id), userId, role);
    return workspace;
  }
}
