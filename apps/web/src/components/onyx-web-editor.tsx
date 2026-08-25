'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  WEB_FILES, WEB_FILE_HINT, PREVIEW_SANDBOX, composePreview, filesOf,
  type WebFile, type WebFiles,
} from '@/lib/onyx-web-preview';

/**
 * A browser preview of somebody's three files.
 *
 * `srcdoc` rather than a URL, deliberately: there is no page to host, nothing
 * to upload, no address to leak and nothing to clean up afterwards. The
 * document is composed in `composePreview` and handed to the frame as a
 * string, so a preview works identically for a candidate mid-paper, a marker
 * an hour later and an operator a term later — and works with no network at
 * all.
 *
 * The sandbox is the security story and is documented where it is defined.
 * The short version: `allow-scripts` and nothing else, so a submitted page
 * cannot read the reader's session, navigate them away, or trap them in a
 * dialog. A marker opens thirty of these while signed in as staff.
 */
export function WebPreview({ files, entry, title, className }: {
  files: WebFiles;
  entry?: string;
  /** Named for screen readers: "preview of Meghana's page" beats "iframe". */
  title: string;
  className?: string;
}) {
  const doc = useMemo(() => composePreview(files, entry), [files, entry]);
  return (
    <iframe
      title={title}
      srcDoc={doc}
      sandbox={PREVIEW_SANDBOX}
      className={className
        ?? 'h-[26rem] w-full rounded-xl border border-line bg-white'}
    />
  );
}

const TAB_LABEL: Record<string, string> = {
  'index.html': 'HTML',
  'index.css': 'CSS',
  'index.js': 'JavaScript',
};

/**
 * Write a page in three files and watch it render.
 *
 * Editor on the left, preview on the right, stacking on a narrow screen — the
 * arrangement every tool that does this uses, because seeing the change is the
 * point of the exercise.
 *
 * **The preview does not update on every keystroke.** It is debounced, and not
 * only for cost: a page that re-renders mid-word flickers, loses scroll
 * position, and re-runs the candidate's JavaScript on every character —
 * including the half-written line they are in the middle of. A short pause is
 * how the tools people learn on behave, and it is what makes an animation or a
 * timer in their script observable at all.
 */
export function WebEditor({ value, onChange, onRun, entry, readOnly, busy, note }: {
  value: WebFiles;
  onChange: (files: Record<WebFile, string>) => void;
  /** Offered where handing in is a separate act from editing. */
  onRun?: () => void;
  entry?: string;
  readOnly?: boolean;
  busy?: boolean;
  note?: string;
}) {
  const files = filesOf(value);
  const [open, setOpen] = useState<WebFile>('index.html');
  /** What the preview is showing, which trails what is typed. */
  const [shown, setShown] = useState(files);
  const [auto, setAuto] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!auto) return undefined;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(files), 600);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // The files are compared by content, not identity: a parent rebuilding the
    // object on every render would otherwise restart the timer forever.
  }, [files['index.html'], files['index.css'], files['index.js'], auto]);

  const set = (path: WebFile, text: string) => onChange({ ...files, [path]: text });

  return (
    <div className="space-y-2">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="min-w-0">
          <div role="tablist" aria-label="Files"
            className="flex flex-wrap items-center gap-1 border-b border-line pb-1.5">
            {WEB_FILES.map((path) => (
              <button
                key={path} type="button" role="tab"
                aria-selected={open === path}
                onClick={() => setOpen(path)}
                className={'rounded-lg px-3 py-1.5 font-mono text-[12.5px] font-semibold '
                  + (open === path
                    ? 'bg-brand-600 text-white'
                    : 'border border-line bg-white text-slate-700 hover:bg-brand-50')}
              >
                {TAB_LABEL[path] ?? path}
              </button>
            ))}
            <span className="ml-auto font-mono text-[11.5px] text-muted">{open}</span>
          </div>

          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
            {WEB_FILE_HINT[open]}
          </p>

          <textarea
            aria-label={open}
            spellCheck={false}
            readOnly={readOnly}
            value={files[open]}
            onChange={(e) => set(open, e.target.value)}
            rows={18}
            className="mt-1.5 w-full rounded-xl border border-line bg-white p-3 font-mono
                       text-[12.5px] leading-relaxed focus:border-brand-500
                       focus:outline-none read-only:bg-slate-50"
          />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line pb-1.5">
            <span className="text-[12.5px] font-semibold text-slate-700">Preview</span>
            <span className="flex-1" />
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              Update as I type
            </label>
            <button type="button" onClick={() => setShown(files)}
              className="rounded-lg border border-line bg-white px-2.5 py-1 text-[12px]
                         font-semibold hover:bg-brand-50">
              Refresh
            </button>
          </div>
          {/*
            * Keyed on the composed document so a Refresh genuinely reloads.
            * React reuses an iframe whose props it thinks are unchanged, and a
            * candidate pressing Refresh on a page whose script has already run
            * would otherwise see nothing happen.
            */}
          <WebPreview
            key={JSON.stringify(shown)}
            files={shown}
            entry={entry}
            title="Preview of your page"
            className="mt-1.5 h-[24rem] w-full rounded-xl border border-line bg-white"
          />
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
            The preview runs in a sandbox: your page cannot reach the internet or the rest
            of this site. Images work as <code className="font-mono">data:</code> URLs.
          </p>
        </div>
      </div>

      {note ? <p className="text-[12px] leading-relaxed text-muted">{note}</p> : null}

      {onRun ? (
        <button type="button" onClick={onRun} disabled={busy}
          className="rounded-xl bg-brand-600 px-4 py-2 text-[13.5px] font-bold text-white
                     hover:bg-brand-700 disabled:opacity-60">
          {busy ? 'Keeping…' : 'Hand it in'}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Somebody else's page, as a marker reads it: the render and the source.
 *
 * Both, and in that order. The render is what was asked for and what the mark
 * is mostly given for; the source is how you tell a page that works from a
 * page that works by accident. A marker given only one of them is guessing.
 */
export function WebAnswerView({ files, title }: { files: unknown; title: string }) {
  const shown = filesOf(files);
  const [open, setOpen] = useState<WebFile | null>(null);
  const written = WEB_FILES.filter((path) => shown[path].trim() !== '');

  if (!written.length) {
    return <p className="text-[13px] italic text-muted">Nothing was written.</p>;
  }

  return (
    <div className="space-y-2">
      <WebPreview files={shown} title={title}
        className="h-[22rem] w-full rounded-xl border border-line bg-white" />
      <div className="flex flex-wrap items-center gap-1.5">
        {written.map((path) => (
          <button key={path} type="button"
            onClick={() => setOpen(open === path ? null : path)}
            aria-expanded={open === path}
            className={'rounded-lg border px-2.5 py-1 font-mono text-[12px] font-semibold '
              + (open === path
                ? 'border-brand-500 bg-brand-50 text-brand-800'
                : 'border-line bg-white text-slate-700 hover:bg-slate-50')}>
            {path}
          </button>
        ))}
        <span className="text-[12px] text-muted">
          {open ? 'Showing the source' : 'Open a file to read the source'}
        </span>
      </div>
      {open ? (
        <pre className="max-h-[22rem] overflow-auto rounded-xl border border-line bg-slate-50
                        p-3 font-mono text-[12px] leading-relaxed">
          {shown[open]}
        </pre>
      ) : null}
    </div>
  );
}
