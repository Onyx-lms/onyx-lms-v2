'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { OnyxEditor } from './onyx-editor';
import { Banner, Card, Empty, Icon, SectionHead } from './onyx-ui';
import type { WorkspaceRunResult } from '@/lib/onyx-codelab';

/**
 * A past date, said the way a person says it.
 *
 * "8/17/2026, 12:00:00 AM" makes "is this snapshot the one from this morning"
 * a calculation. The value is rendered with `suppressHydrationWarning` because
 * the server and the browser evaluate `Date.now()` a moment apart.
 */
function since(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.round((now - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return days + ' days ago';
  const weeks = Math.round(days / 7);
  if (weeks === 1) return 'last week';
  if (weeks < 5) return weeks + ' weeks ago';
  const months = Math.round(days / 30);
  if (months < 12) return months === 1 ? 'a month ago' : months + ' months ago';
  return new Date(t).toLocaleDateString(undefined,
    { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A file's extension, coloured -- the same shorthand every IDE file tree
 *  uses so a project reads at a glance rather than one filename at a time. */
const EXT_DOT: Record<string, string> = {
  py: 'bg-amber-400', js: 'bg-yellow-400', jsx: 'bg-sky-400',
  ts: 'bg-blue-400', tsx: 'bg-blue-400', java: 'bg-orange-500',
  c: 'bg-slate-400', cpp: 'bg-indigo-400', go: 'bg-cyan-400', rs: 'bg-orange-500',
  json: 'bg-lime-400', md: 'bg-slate-400', html: 'bg-red-400', css: 'bg-purple-400',
};
function extDot(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return EXT_DOT[ext] ?? 'bg-slate-400';
}

/** A keyboard chord, styled as a keycap -- decorative, but it is what tells
 *  someone Ctrl/Cmd+Enter is a real shortcut and not a decoration itself. */
function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5
                     font-mono text-[10px] text-slate-300">
      {children}
    </kbd>
  );
}

/**
 * LAB-05 -- the project workspace.
 *
 * The file tree, the editor, snapshots and mentor comments in one screen,
 * because moving between them is the work. Four things are deliberate:
 *
 *   * **One dark surface, not a light toolbar bolted onto a dark editor.**
 *     Every real reference for this (VS Code, Codespaces, Replit, Codecademy's
 *     own teaching IDE) keeps chrome and editor the same theme; a white bar
 *     sitting directly on black is the tell of an unfinished screen, not a
 *     stylistic choice.
 *   * **Restore asks first.** It replaces the tree exactly, including deleting
 *     files added since, which is the feature -- and is also destructive, so it
 *     is not a single unlabelled click.
 *   * **A mentor comments; a mentor does not edit.** The editor is read-only
 *     for anyone who is not the owner, matching what the API allows rather than
 *     letting someone type into a box whose save will be refused.
 *   * **Run answers in the same request.** `/workspaces/:id/run` is not the
 *     queued path `/problems/:id/submit` uses -- one owner running one file
 *     has nothing to batch, so there is no submission id to poll here, only a
 *     result to show.
 */
export interface WsFile { id: number; path: string; content: string }
export interface WsSnapshot { id: number; label: string; created_at: string; file_count: number }
export interface WsComment {
  id: number; file_path: string | null; line: number | null;
  body: string; author_id: number | null; resolved_at: string | null; created_at: string;
}

export function OnyxWorkspace({ workspace, isOwner, canReview }: {
  workspace: {
    id: number; title: string; language: string; entry_path: string;
    files: WsFile[]; snapshots: WsSnapshot[]; comments: WsComment[];
  };
  isOwner: boolean;
  canReview: boolean;
}) {
  const router = useRouter();
  const [files, setFiles] = useState(workspace.files);
  const [active, setActive] = useState(
    workspace.files.find((f) => f.path === workspace.entry_path)?.path
    ?? workspace.files[0]?.path ?? '');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<WorkspaceRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const current = files.find((f) => f.path === active);

  const call = (path: string, init: RequestInit, ok: string, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fetch('/api/proxy/onyx/workspaces/' + workspace.id + path, init);
      const body = await res.json().catch(() => ({}));
      if (!body.ok) { setError(body.message ?? 'That did not work.'); return; }
      setNotice(ok);
      after?.();
      router.refresh();
    });

  /**
   * Saves, then answers straight away -- see the note above on why this does
   * not poll.
   *
   * The server reads a run's file from what is persisted, not from a request
   * body -- a workspace file is a row, same as everything else here, and
   * "run whatever the browser currently has open" would mean a run and a
   * restart-mid-session could disagree about what actually ran. That means
   * skipping the save is what silently ran the file's last-saved content --
   * usually the empty string a new file starts as -- while the editor showed
   * whatever had just been typed. Codecademy's own teaching IDE names this
   * plainly, "Save + Run", rather than pretending the two are one action that
   * happens to save as a side effect.
   */
  const run = async () => {
    if (running) return; // the Ctrl+Enter shortcut bypasses the button's own disabled state
    setRunError(null);
    setRunResult(null);
    setRunning(true);
    try {
      const saveRes = await fetch('/api/proxy/onyx/workspaces/' + workspace.id + '/files', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: files.map((f) => ({ path: f.path, content: f.content })) }),
      });
      const saveBody = await saveRes.json().catch(() => ({}));
      if (!saveBody.ok) { setRunError(saveBody.message ?? 'Could not save before running.'); return; }

      const res = await fetch('/api/proxy/onyx/workspaces/' + workspace.id + '/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: active }),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.ok) { setRunError(body.message ?? 'That did not run.'); return; }
      setRunResult(body.data as WorkspaceRunResult);
      router.refresh(); // the save above changed updated_at server-side too
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {notice ? <div role="status"><Banner tone="good" icon="check">{notice}</Banner></div> : null}
      {error ? <div role="alert"><Banner tone="late" icon="alert">{error}</Banner></div> : null}

      {/* One dark instrument -- sidebar, toolbar, editor and console all the
          same surface, elevated off the page rather than bordered onto it. */}
      <div className="overflow-hidden rounded-2xl bg-slate-900 shadow-xl shadow-slate-900/25 ring-1 ring-slate-800">
        {/* The project's own bar. Save, Snapshot and Run are controls on the
            instrument, not on one file, so they sit here rather than on the
            open tab -- and they stay on the same dark surface, because a white
            toolbar bolted onto a black editor is the tell of an unfinished
            screen. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-800
                        bg-slate-950/40 px-3 py-2.5 sm:px-4">
          {/* Purely decorative window chrome -- three dots is the fastest
              possible signal that what follows is a code surface. */}
          <span aria-hidden="true" className="flex shrink-0 items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-200">
            {workspace.title}
          </span>
          <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10.5px]
                            font-bold uppercase tracking-wide text-slate-400">
            {workspace.language}
          </span>

          {isOwner ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button" disabled={pending}
                onClick={() => call('/files', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    files: files.map((f) => ({ path: f.path, content: f.content })),
                  }),
                }, 'Saved.')}
                title="Save"
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border
                           border-slate-700 bg-slate-800/60 px-3 text-sm text-slate-300 transition
                           hover:border-slate-600 hover:bg-slate-800 hover:text-white
                           disabled:opacity-50"
              >
                <Icon name="save" className="h-3.5 w-3.5" />
                Save
              </button>
              <button
                type="button" disabled={pending}
                onClick={() => {
                  const label = window.prompt('Name this snapshot', 'Snapshot');
                  if (label === null) return;
                  call('/snapshots', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ label }),
                  }, 'Snapshot taken.');
                }}
                title="Take a snapshot"
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border
                           border-slate-700 bg-slate-800/60 px-3 text-sm text-slate-300 transition
                           hover:border-slate-600 hover:bg-slate-800 hover:text-white
                           disabled:opacity-50"
              >
                <Icon name="camera" className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Snapshot</span>
                <span className="sr-only sm:hidden">Snapshot</span>
              </button>
              <button
                type="button" disabled={running}
                onClick={run}
                title="Save and run -- Ctrl / Cmd + Enter"
                className="group inline-flex min-h-[34px] items-center gap-1.5 rounded-lg
                           bg-gradient-to-b from-brand-500 to-brand-600 px-3.5 text-sm
                           font-semibold text-white shadow-md shadow-brand-900/30 transition
                           hover:-translate-y-px hover:shadow-lg hover:shadow-brand-900/40
                           disabled:translate-y-0 disabled:opacity-60 disabled:shadow-none"
              >
                {running
                  ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2
                                      border-white/30 border-t-white" />
                  : <Icon name="play" className="h-3.5 w-3.5" />}
                {running ? 'Running…' : 'Run'}
              </button>
            </div>
          ) : (
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400">
              You are reviewing this project &mdash; leave a comment rather than editing
            </span>
          )}
        </div>

        {/* minmax(0,1fr) rather than 1fr: a grid item defaults to min-width
            auto, so a long line in the editor would otherwise widen the whole
            instrument and take a 320px page sideways with it. */}
        <div className="grid lg:grid-cols-[210px_minmax(0,1fr)]">
          <aside className="flex min-w-0 flex-col gap-4 border-b border-slate-800 bg-slate-950/50
                             p-3 lg:border-b-0 lg:border-r">
            <div className="min-w-0">
              <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Files
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {files.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => setActive(f.path)}
                      className={'flex w-full items-center gap-2 truncate rounded-lg px-2 py-1.5 '
                        + 'text-left font-mono text-xs transition-colors '
                        + (f.path === active
                          ? 'bg-slate-800 text-white ring-1 ring-inset ring-brand-500/50'
                          : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200')}
                    >
                      <span className={'h-1.5 w-1.5 shrink-0 rounded-full ' + extDot(f.path)} />
                      <span className="truncate">{f.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {isOwner ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const path = String(new FormData(form).get('path') ?? '').trim();
                  if (!path) return;
                  call('/files', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ files: [{ path, content: '' }] }),
                  }, 'File added.', () => {
                    setFiles((list) => [...list, { id: -Date.now(), path, content: '' }]);
                    setActive(path);
                  });
                  form.reset();
                }}
              >
                <label className="sr-only" htmlFor="newfile">New file</label>
                <input id="newfile" name="path" placeholder="+ new-file.py"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-2 py-1.5
                             font-mono text-xs text-slate-200 placeholder:text-slate-500
                             focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/40" />
              </form>
            ) : null}
          </aside>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-800
                            bg-slate-900/95 px-4 py-2.5">
              <span aria-hidden="true"
                className={'h-2 w-2 shrink-0 rounded-full ' + extDot(active)} />
              <span className="min-w-0 truncate font-mono text-xs text-slate-300">
                {active || workspace.entry_path}
              </span>
              {isOwner ? (
                <span className="ml-auto hidden text-[11.5px] text-slate-500 sm:inline">
                  Ctrl / Cmd + Enter to save and run
                </span>
              ) : null}
            </div>

            <OnyxEditor
              value={current?.content ?? ''}
              language={workspace.language}
              readOnly={!isOwner}
              onChange={(next) => setFiles((list) =>
                list.map((f) => (f.path === active ? { ...f, content: next } : f)))}
              onRunShortcut={isOwner ? run : undefined}
            />

            {runError ? (
              <p role="alert" className="border-t border-slate-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
                {runError}
              </p>
            ) : null}
            {runResult ? (
              <RunConsole result={runResult} onClear={() => setRunResult(null)} />
            ) : isOwner ? (
              <div className="flex items-center gap-1.5 border-t border-slate-800 bg-slate-950/40
                               px-4 py-2.5 text-xs text-slate-500">
                Click Run, or press <Key>Ctrl/Cmd + Enter</Key>, to see output here.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Snapshots and review are page furniture, not part of the instrument,
          so they come back onto the ordinary white surface below it. */}
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0">
          <SectionHead title="Snapshots" />
          <Card>
            <ul className="divide-y divide-line">
              {workspace.snapshots.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{s.label}</span>
                    <span className="mt-0.5 block text-[13px] text-muted"
                      suppressHydrationWarning>
                      {since(s.created_at)} · {s.file_count} files
                    </span>
                  </span>
                  {isOwner ? (
                    <button
                      type="button" disabled={pending}
                      onClick={() => {
                        // Restoring deletes files added since the snapshot. That
                        // is the promise, and it is also destructive.
                        const sure = window.confirm(
                          'Restore "' + s.label + '"? This replaces the file tree exactly as it '
                          + 'was, including removing files added since.');
                        if (!sure) return;
                        call('/restore/' + s.id, { method: 'POST' }, 'Restored.');
                      }}
                      className="inline-flex min-h-[34px] shrink-0 items-center rounded-2xl border
                                 border-line px-3 text-[13px] font-bold text-slate-700
                                 hover:bg-brand-50 disabled:opacity-50"
                    >
                      Restore
                    </button>
                  ) : null}
                </li>
              ))}
              {workspace.snapshots.length === 0 ? (
                <li><Empty icon="camera">No snapshots yet.</Empty></li>
              ) : null}
            </ul>
            {/* Restoring is the feature and is also destructive: it replaces
                the tree exactly, deleting files added since. Saying so here is
                what stops it being a single unlabelled click. */}
            {isOwner && workspace.snapshots.length ? (
              <p className="border-t border-line px-4 py-3 text-[13px] text-muted">
                Restoring replaces the file tree exactly as it was, including removing files
                added since.
              </p>
            ) : null}
          </Card>
        </div>

        <div className="min-w-0">
          <SectionHead title="Review" />
          <Card>
            <ul className="divide-y divide-line">
              {workspace.comments.map((c) => (
                <li key={c.id} className="px-4 py-3 text-sm">
                  {c.file_path ? (
                    <span className="block truncate font-mono text-xs text-muted">
                      {c.file_path}{c.line ? ':' + c.line : ''}
                    </span>
                  ) : null}
                  <span className={'mt-0.5 block ' + (c.resolved_at ? 'text-muted' : 'text-slate-700')}>
                    {c.body}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-xs text-muted" suppressHydrationWarning>
                      {since(c.created_at)}
                    </span>
                    {c.resolved_at ? (
                      // The state is a word, never a tint on its own.
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold
                                       text-green-700">
                        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-green-600" />
                        Resolved
                      </span>
                    ) : (
                      <button
                        type="button" disabled={pending}
                        onClick={() => call('/comments/' + c.id + '/resolve', { method: 'POST' },
                          'Resolved.')}
                        className="text-xs font-bold text-brand-600 hover:underline
                                   disabled:opacity-50"
                      >
                        Mark resolved
                      </button>
                    )}
                  </span>
                </li>
              ))}
              {workspace.comments.length === 0 ? (
                <li>
                  <Empty icon="message">
                    Nothing yet. A mentor comments on this project; a mentor does not edit it.
                  </Empty>
                </li>
              ) : null}
            </ul>

            {canReview || isOwner ? (
              <form
                className="flex flex-wrap gap-2 border-t border-line p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const body = String(new FormData(form).get('body') ?? '').trim();
                  if (!body) return;
                  call('/comments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ body, file_path: active || null }),
                  }, 'Comment added.');
                  form.reset();
                }}
              >
                <label className="sr-only" htmlFor="comment">Comment</label>
                <input id="comment" name="body"
                  placeholder={'Comment on ' + (active || 'this project')}
                  className="h-10 min-w-0 flex-1 basis-[180px] rounded-xl border border-line px-3
                             text-sm outline-none focus:border-brand-500" />
                <button type="submit" disabled={pending}
                  className="inline-flex min-h-[40px] shrink-0 items-center rounded-2xl
                             bg-brand-600 px-4 text-[13px] font-bold text-white
                             hover:bg-brand-700 disabled:opacity-50">
                  Add
                </button>
              </form>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}

const VERDICT_LABEL: Record<WorkspaceRunResult['verdict'], string> = {
  ok: 'Ran',
  compile_error: 'Did not compile',
  runtime_error: 'Runtime error',
  timeout: 'Timed out',
  memory_exceeded: 'Used too much memory',
  output_exceeded: 'Output was too long, truncated',
  internal_error: 'Could not run',
};

/** What Run answers with. Not the graded Console in onyx-codelab -- there is
 *  no pass/fail here, only what the file printed. */
function RunConsole({ result, onClear }: { result: WorkspaceRunResult; onClear: () => void }) {
  const ok = result.verdict === 'ok';
  return (
    <section className="border-t border-slate-800">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-950/60 px-4 py-2">
        {/* The dot is decorative -- the label carries the meaning, same rule
            as the login page's underlined link: colour alone never does. */}
        <span aria-hidden="true" className={'h-2 w-2 shrink-0 rounded-full '
          + (ok ? 'bg-emerald-400' : 'bg-rose-400')} />
        <span className={'text-sm font-medium ' + (ok ? 'text-emerald-400' : 'text-rose-400')}>
          {VERDICT_LABEL[result.verdict]}
        </span>
        <span className="font-mono text-xs text-slate-500">{result.path}</span>
        {result.runtimeMs ? <span className="text-xs text-slate-500">{result.runtimeMs}ms</span> : null}
        {result.memoryKb ? (
          <span className="text-xs text-slate-500">{Math.round(result.memoryKb / 1024)}MB</span>
        ) : null}
        <button
          type="button" onClick={onClear} title="Clear output"
          className="ml-auto rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
        >
          <Icon name="trash" className="h-3.5 w-3.5" />
          <span className="sr-only">Clear output</span>
        </button>
      </header>
      {result.compileOutput ? (
        <pre className="overflow-x-auto border-b border-slate-800 bg-amber-950/30 p-3 text-xs text-amber-300">
          {result.compileOutput}
        </pre>
      ) : null}
      {result.stdout ? (
        <pre className="overflow-x-auto border-b border-slate-800 bg-slate-950 p-3 text-xs text-slate-100">
          {result.stdout}
        </pre>
      ) : null}
      {result.stderr ? (
        <pre className="overflow-x-auto bg-slate-950 p-3 text-xs text-rose-400">{result.stderr}</pre>
      ) : null}
      {ok && !result.stdout && !result.stderr ? (
        <p className="bg-slate-950 px-4 py-3 text-xs text-slate-500">Ran with no output.</p>
      ) : null}
    </section>
  );
}
