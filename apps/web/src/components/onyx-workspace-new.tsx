'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Course } from '@/lib/onyx-learn';
import { WEB_FILES, startingFiles } from '@/lib/onyx-web-preview';

const field = 'rounded-lg border border-slate-300 px-3 py-2 text-sm '
  + 'focus:border-slate-900 focus:outline-none';

/** Default entry file per language, so a new project opens on something. */
const ENTRY: Record<string, string> = {
  web: 'index.html',
  python: 'main.py', javascript: 'index.js', typescript: 'index.ts',
  java: 'Main.java', c: 'main.c', cpp: 'main.cpp', go: 'main.go', rust: 'main.rs',
};

/** How each is described in the picker, where "web" needs more than its name. */
const LABEL: Record<string, string> = {
  web: 'web — HTML, CSS and JavaScript',
};

export function OnyxNewWorkspace({ courses }: { courses: Course[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="grid gap-3 rounded-2xl border border-line p-4 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const language = String(data.get('language') ?? 'python');
        setError(null);
        start(async () => {
          const res = await fetch('/api/proxy/onyx/workspaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: String(data.get('title') ?? ''),
              language,
              entry_path: ENTRY[language] ?? 'main.txt',
              course_id: data.get('course_id') ? Number(data.get('course_id')) : null,
              /*
               * A web project starts as three files, not one empty one.
               *
               * Every other language opens on a single entry file, which is
               * right: a Python project is one file until it is not. A web
               * page is three from the first second -- markup, styling and
               * behaviour -- and starting with an empty index.html would leave
               * somebody wondering where to put their CSS.
               */
              ...(language === 'web'
                ? {
                  files: WEB_FILES.map((path) => ({
                    path, content: startingFiles(null)[path],
                  })),
                }
                : {}),
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!body.ok) { setError(body.message ?? 'Could not create it.'); return; }
          router.push('/onyx/workspaces/' + body.data.id);
          router.refresh();
        });
      }}
    >
      {/* aria-label, like the two controls below. A placeholder is not a
          label: it disappears on the first keystroke, and a required field
          with no accessible name leaves a screen-reader user nothing to tie
          the validation error to. */}
      <input name="title" required maxLength={255} placeholder="Project name"
        aria-label="Project name" className={field} />
      <select name="language" defaultValue="web" aria-label="Language" className={field}>
        {Object.keys(ENTRY).map((l) => (
          <option key={l} value={l}>{LABEL[l] ?? l}</option>
        ))}
      </select>
      <select name="course_id" defaultValue="" aria-label="Course" className={field}>
        <option value="">Not for a course</option>
        {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select>
      <button type="submit" disabled={pending}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white
                   hover:bg-brand-700 disabled:opacity-50">
        Start a project
      </button>
      {error ? <p role="alert" className="text-sm text-rose-600 sm:col-span-4">{error}</p> : null}
      <p className="text-xs text-muted sm:col-span-4">
        Attaching a project to a course lets the people teaching it review your work.
        A project with no course stays private to you.
      </p>
    </form>
  );
}
