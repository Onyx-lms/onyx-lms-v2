'use client';

import { useEffect, useRef, useState } from 'react';

export interface JitsiJoin {
  provider: 'jitsi';
  mode: 'embed';
  is_host: boolean;
  domain: string;
  script_url: string;
  options: Record<string, unknown>;
  class: { id: number; class_topic: string | null; note: string | null };
}

export interface ZoomSdkJoin {
  provider: 'zoom';
  mode: 'sdk';
  is_host: boolean;
  meeting_number: string;
  password: string;
  signature: string;
  sdk_key: string;
  user_name: string;
  email: string;
  class: { id: number; class_topic: string | null; note: string | null };
}

export interface ZoomRedirectJoin {
  provider: 'zoom'; mode: 'redirect'; is_host: boolean; url: string;
}

export type JoinPayload = JitsiJoin | ZoomSdkJoin | ZoomRedirectJoin;

declare global {
  interface Window {
    JitsiMeetExternalAPI?: new (domain: string, options: unknown) => { dispose(): void };
    ZoomMtg?: Record<string, (...args: unknown[]) => unknown>;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[data-live="' + src + '"]')) { resolve(); return; }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.dataset['live'] = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(el);
  });
}

/**
 * LC-04 / LC-05 -- the meeting itself.
 *
 * Everything security-relevant is decided on the server: the Zoom signature is
 * generated there (the SDK secret never reaches this component), and the host
 * role travels inside that signature. This component only renders.
 */
export function LiveClassRoom({ join }: { join: JoinPayload }) {
  const container = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (join.mode === 'redirect') { window.location.href = join.url; return; }

    let disposed = false;
    let api: { dispose(): void } | null = null;

    (async () => {
      try {
        if (join.mode === 'embed') {
          await loadScript(join.script_url);
          if (disposed || !window.JitsiMeetExternalAPI) return;
          api = new window.JitsiMeetExternalAPI(join.domain, {
            ...join.options,
            width: '100%',
            height: '100%',
            parentNode: container.current,
          });
          return;
        }

        await loadScript('https://source.zoom.us/3.8.0/lib/vendor/react.min.js');
        await loadScript('https://source.zoom.us/3.8.0/lib/vendor/react-dom.min.js');
        await loadScript('https://source.zoom.us/zoom-meeting-3.8.0.min.js');
        const ZoomMtg = window.ZoomMtg;
        if (disposed || !ZoomMtg) return;

        ZoomMtg['preLoadWasm']!();
        ZoomMtg['prepareWebSDK']!();
        ZoomMtg['init']!({
          leaveUrl: window.location.origin + '/my-courses',
          patchJsMedia: true,
          success: () => {
            // The signature already carries the meeting number and the role,
            // so a tampered field here simply fails to join.
            ZoomMtg['join']!({
              meetingNumber: join.meeting_number,
              passWord: join.password,
              signature: join.signature,
              sdkKey: join.sdk_key,
              userName: join.user_name,
              userEmail: join.email,
              error: (e: { errorMessage?: string }) =>
                setError(e.errorMessage ?? 'Zoom refused the join request.'),
            });
          },
          error: () => setError('The Zoom client could not start.'),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The meeting could not be loaded.');
      }
    })();

    return () => { disposed = true; api?.dispose(); };
  }, [join]);

  if (join.mode === 'redirect') {
    return (
      <p className="p-10 text-center text-sm text-slate-600">
        Opening the meeting... if nothing happens,{' '}
        <a href={join.url} className="text-brand-700 underline">click here</a>.
      </p>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h1 className="font-medium">{join.class.class_topic}</h1>
          {join.class.note && <p className="text-xs text-slate-500">{join.class.note}</p>}
        </div>
        {join.is_host && (
          <span className="rounded-full bg-brand-600 px-3 py-1 text-xs text-white">
            Host
          </span>
        )}
      </header>
      {error && <p className="bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      <div ref={container} id="live-class-root" className="min-h-0 flex-1" />
    </div>
  );
}
