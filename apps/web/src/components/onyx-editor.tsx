'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

/**
 * LAB-01 -- the browser editor.
 *
 * "Multi-language in-browser editor with syntax highlighting, run controls and
 * an interactive console."
 *
 * Monaco is loaded from a CDN by `@monaco-editor/react`, and an institution's
 * network may well block it. Losing syntax highlighting is an inconvenience;
 * losing the ability to type code at all would make Code Lab unusable, so this
 * starts as a plain textarea, upgrades when Monaco arrives, and stays a
 * textarea if it never does. The value lives here either way, so a swap
 * mid-session costs nothing.
 */
const Monaco = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => null,
});

/** Monaco's language ids differ from ours for two of the eight. */
const MONACO_LANGUAGE: Record<string, string> = {
  python: 'python', javascript: 'javascript', typescript: 'typescript',
  java: 'java', c: 'c', cpp: 'cpp', go: 'go', rust: 'rust',
};

export function OnyxEditor({
  value, language, onChange, height = 420, readOnly = false, onRunShortcut,
}: {
  value: string;
  language: string;
  onChange?: (next: string) => void;
  height?: number;
  readOnly?: boolean;
  /** Ctrl/Cmd+Enter, wired through Monaco when it is the one active. The
   *  textarea fallback does not get this -- a browser reserves few enough
   *  chords already without one more page trapping Enter. */
  onRunShortcut?: () => void;
}) {
  const [ready, setReady] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    // Six seconds is long enough for a slow connection and short enough that a
    // blocked CDN does not look like a hung page.
    const timer = setTimeout(() => { if (!mounted.current) setGaveUp(true); }, 6000);
    return () => clearTimeout(timer);
  }, []);

  const fallback = (
    <textarea
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      readOnly={readOnly}
      spellCheck={false}
      aria-label="Code editor"
      style={{ height }}
      className="w-full rounded-xl border border-slate-300 bg-slate-950 p-3
                 font-mono text-sm text-slate-100 focus:border-slate-500 focus:outline-none"
    />
  );

  if (gaveUp) {
    return (
      <div className="space-y-1">
        {fallback}
        <p className="text-xs text-muted">
          The syntax highlighter could not be loaded, so this is a plain editor.
          Your code still runs exactly the same.
        </p>
      </div>
    );
  }

  return (
    <div className="relative" style={{ minHeight: height }}>
      {ready ? null : fallback}
      <div className={ready ? '' : 'pointer-events-none absolute inset-0 opacity-0'}>
        <Monaco
          height={height}
          language={MONACO_LANGUAGE[language] ?? 'plaintext'}
          theme="vs-dark"
          value={value}
          onChange={(next) => onChange?.(next ?? '')}
          onMount={(editor, monaco) => {
            mounted.current = true;
            setReady(true);
            if (onRunShortcut) {
              editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, onRunShortcut);
            }
          }}
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            renderWhitespace: 'selection',
          }}
        />
      </div>
    </div>
  );
}
