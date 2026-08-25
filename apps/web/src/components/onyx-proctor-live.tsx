'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/onyx-ui';
import {
  apply, attemptPath, hasTurn, iceServers, pollSignals, sendSignal, wire, type Signal,
} from '@/lib/onyx-webrtc';

/**
 * ASS-02b -- live invigilation, both ends of it.
 *
 * The candidate's camera reaches the invigilator directly, browser to browser.
 * No video passes through this product's servers and none of it is stored;
 * what the API carries is the offer, the answer and a few ICE candidates.
 *
 * Two rules run through both components below, and they are the reason this
 * feature is shippable at all:
 *
 *   * **Nothing streams until somebody is looking.** The candidate's browser
 *     holds no camera until an invigilator has actually opened them, and drops
 *     it the moment they close the window.
 *   * **Being watched is visible to the person being watched.** There is a
 *     standing indicator on their own screen for as long as it lasts. A
 *     covert feed of somebody's room is not a thing this product does, whatever
 *     the consent screen said.
 */

/* ------------------------------------------------------------- the candidate */

/**
 * Sits inside the paper a candidate is writing. Renders nothing at all until
 * an invigilator asks, and then renders a notice rather than a preview -- a
 * live picture of your own face on top of an exam you are timed on is a
 * distraction nobody needs.
 */
export function CandidateCamera({ attemptId, enabled }: {
  attemptId: number;
  /** The paper's own `watch_camera`. Off, and nothing here ever runs. */
  enabled: boolean;
}) {
  const [watching, setWatching] = useState(false);
  const [failed, setFailed] = useState(false);
  const session = useRef<string | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;

    /** Everything down, camera light off. Called on close and on unmount. */
    const teardown = () => {
      stop.current?.();
      stop.current = null;
      pc.current?.close();
      pc.current = null;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      session.current = null;
      setWatching(false);
    };

    const onSignal = async (signal: Signal) => {
      const peer = pc.current;
      if (!peer) return;
      if (signal.kind === 'bye') { teardown(); return; }
      if (signal.kind === 'offer') {
        await peer.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await sendSignal(attemptId, session.current!, 'answer', answer);
        return;
      }
      await apply(peer, signal);
    };

    /** Asked once a second: has anybody opened me? */
    const watch = async () => {
      while (live) {
        try {
          const res = await fetch('/api/proxy/onyx/attempts/' + attemptId + '/watch');
          const body = await res.json().catch(() => ({ ok: false }));
          const id: string | null = body.ok ? body.data.session_id : null;

          if (id && id !== session.current) {
            // Somebody has started watching. The camera opens HERE, at the
            // moment of being asked, and not a second before.
            session.current = id;
            try {
              stream.current = await navigator.mediaDevices.getUserMedia({
                video: { width: 320, height: 240, frameRate: 12 }, audio: false,
              });
            } catch {
              // A refused camera is an event the invigilator already sees
              // through the normal proctoring timeline; there is nothing to
              // stream and nothing to pretend about here.
              setFailed(true);
              session.current = null;
              await new Promise((r) => setTimeout(r, 5000));
              continue;
            }

            const peer = new RTCPeerConnection({ iceServers: iceServers() });
            pc.current = peer;
            wire(peer, attemptId, id);
            // Small and slow on purpose. This is a supervision feed, not a
            // video call: 320x240 at 12fps is enough to see who is in the
            // room and costs a candidate on a phone tether almost nothing.
            stream.current.getTracks().forEach((t) => peer.addTrack(t, stream.current!));
            stop.current = pollSignals(attemptId, id, onSignal);
            setWatching(true);
            setFailed(false);
          } else if (!id && session.current) {
            teardown();
          }
        } catch { /* a failed poll is not worth telling a candidate about */ }
        await new Promise((r) => setTimeout(r, 3000));
      }
    };
    void watch();

    return () => { live = false; teardown(); };
  }, [attemptId, enabled]);

  if (!enabled || (!watching && !failed)) return null;

  return (
    <div role="status"
      className={'flex items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] font-semibold '
        + (failed ? 'bg-amber-50 text-amber-900' : 'bg-rose-50 text-rose-800')}>
      <Icon name={failed ? 'alert' : 'video'} className="h-4 w-4 shrink-0" />
      {failed
        ? 'An invigilator asked to see your camera and it could not be opened.'
        : 'An invigilator is watching your camera.'}
    </div>
  );
}

/* ----------------------------------------------------------- the invigilator */

/**
 * The viewer. Opens one candidate at a time, by design rather than by
 * omission: media is peer-to-peer, so a wall of forty would be forty inbound
 * streams in one browser tab, which no browser will do. A whole-hall view
 * needs an SFU, and an SFU is a server this deployment does not have.
 */
export function WatchCandidate({ attemptId, name, base }: {
  attemptId: number;
  name: string;
  /**
   * Which side of the product is watching.
   *
   * Defaults to the institution's own route. The platform console passes its
   * tenant-scoped prefix instead, because its operator holds a platform
   * session rather than a membership -- same service, same three refusals,
   * different guard.
   */
  base?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'connecting' | 'live' | 'failed' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const session = useRef<string | null>(null);

  const close = () => {
    if (session.current) void sendSignal(attemptId, session.current, 'bye', {}, base);
    stop.current?.();
    stop.current = null;
    pc.current?.close();
    pc.current = null;
    session.current = null;
    if (video.current) video.current.srcObject = null;
    setState('idle');
    setOpen(false);
  };

  useEffect(() => () => { stop.current?.(); pc.current?.close(); }, []);

  const start = async () => {
    setError(null);
    setOpen(true);
    setState('connecting');

    const res = await fetch(attemptPath(attemptId, base) + '/watch',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await res.json().catch(() => ({ ok: false }));
    if (!body.ok) {
      setError(body.message ?? 'Could not start watching.');
      setState('failed');
      return;
    }
    const id: string = body.data.session_id;
    session.current = id;

    const peer = new RTCPeerConnection({ iceServers: iceServers() });
    pc.current = peer;
    // One-way. The invigilator sends nothing back, so the transceiver is
    // receive-only and the candidate's browser is never asked for permission
    // to do anything with the invigilator's own camera.
    peer.addTransceiver('video', { direction: 'recvonly' });
    peer.ontrack = (e) => {
      if (video.current) video.current.srcObject = e.streams[0] ?? null;
    };
    wire(peer, attemptId, id, (s) => {
      if (s === 'connected') setState('live');
      else if (s === 'failed' || s === 'disconnected') setState('failed');
    }, base);

    stop.current = pollSignals(attemptId, id, async (signal) => {
      if (signal.kind === 'answer') {
        await peer.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
        return;
      }
      if (signal.kind === 'bye') { close(); return; }
      await apply(peer, signal);
    }, base);

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await sendSignal(attemptId, id, 'offer', offer, base);
  };

  return (
    <>
      <button type="button" onClick={() => void start()}
        className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-line
                   px-3 text-[12.5px] font-semibold text-slate-700 hover:bg-brand-50">
        <Icon name="video" className="h-[15px] w-[15px]" />
        Watch camera
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          role="dialog" aria-modal="true" aria-label={'Camera of ' + name}>
          <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-bold text-ink">{name}</p>
                <p className="text-[12px] text-muted">
                  {state === 'live' ? 'Live — they can see that you are watching.'
                    : state === 'connecting' ? 'Connecting…'
                      : state === 'failed' ? 'Not connected.'
                        : ''}
                </p>
              </div>
              <button type="button" onClick={close}
                className="min-h-[34px] rounded-xl border border-line px-3 text-[12.5px]
                           font-semibold">
                Stop watching
              </button>
            </div>

            <video ref={video} autoPlay playsInline muted
              className="aspect-[4/3] w-full rounded-xl bg-black object-cover" />

            {error ? (
              <p role="alert" className="mt-2 text-[13px] text-red-700">{error}</p>
            ) : null}

            {state === 'failed' && !hasTurn() ? (
              /* Said plainly rather than left as a black rectangle. Without a
                 relay configured, a candidate behind a symmetric NAT or a
                 strict firewall simply cannot be reached, and that is an
                 infrastructure fact rather than something they have done. */
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px]
                            leading-relaxed text-amber-900">
                No connection could be made. This deployment has no TURN relay
                configured, so candidates on some networks cannot be reached at all —
                it does not mean they have covered their camera.
              </p>
            ) : null}

            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Nothing here is recorded. This is a live view between two browsers, and it
              stops when you close it.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
