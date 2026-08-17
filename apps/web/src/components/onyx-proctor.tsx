'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * ASS-02a -- camera and screen capture.
 *
 * The database column, the event weights, the invigilator's review queue and
 * the consent copy were all built for this and the browser never did it: an
 * assessment could be created with `require_camera` set, the candidate was told
 * "your camera must stay on", and nothing ever asked for it. Four of the twelve
 * event kinds -- `camera_on`, `camera_off`, `screen_on`, `screen_off` -- could
 * not be produced by the shipped client at all.
 *
 * **No media is uploaded. Not one frame.** The invariant this product is built
 * on is "proctoring stores events, never recordings", and that is not a
 * limitation being worked around here -- it is the design. What the server
 * learns is that a camera was on at 10:04 and stopped at 10:31, which is what
 * an invigilator can actually act on. A stored video of a hundred candidates
 * sitting a paper is a liability with a retention policy attached, and it
 * answers no question that a timeline does not.
 *
 * So the stream is held only to observe it:
 *
 *   * **Granting** raises `camera_on` / `screen_on`, weight 0 -- recorded, not
 *     suspicious.
 *   * **A track ending** raises `camera_off` / `screen_off`, weight 2. That
 *     fires whether the candidate closed the sharing bar, unplugged the camera
 *     or revoked permission, because all three look identical from here and
 *     none of them is an accusation.
 *   * **Refusing** is not an event, it is a wall: a paper that requires a
 *     camera does not start without one. A flag nobody can avoid earning is
 *     noise, and a requirement that can be clicked past is not a requirement.
 *
 * Face counting is attempted only where the browser has a detector of its own
 * (`FaceDetector`, which in practice means some Chromium builds). Where it
 * exists, a frame is examined **in the page** and only the number is sent.
 * Where it does not, `no_face` and `multiple_faces` simply never fire, and the
 * status panel says so rather than implying a check that is not happening.
 */

export type ProctorKind =
  | 'camera_on' | 'camera_off' | 'screen_on' | 'screen_off'
  | 'no_face' | 'multiple_faces';

/** How often a frame is examined, where the browser can examine one at all. */
const FACE_CHECK_MS = 20_000;

interface FaceDetectorLike {
  detect(source: CanvasImageSource): Promise<unknown[]>;
}

function faceDetector(): FaceDetectorLike | null {
  const ctor = (window as unknown as {
    FaceDetector?: new (opts?: unknown) => FaceDetectorLike;
  }).FaceDetector;
  if (!ctor) return null;
  try {
    return new ctor({ fastMode: true });
  } catch {
    return null;
  }
}

/** What the preflight proved, and what the Start button sends to the server. */
export interface DeviceState { camera: boolean; screen: boolean; ok: boolean }

/**
 * Asks for the devices a paper requires, before the clock starts.
 *
 * Deliberately part of the consent step rather than the paper: discovering that
 * your camera is broken is survivable at the front of the paper and is not
 * survivable ninety seconds into a timed one.
 *
 * Screen sharing is proved here too. It used to be skipped -- the note said a
 * grant cannot be carried across a navigation, which is true -- but "cannot be
 * carried" is not "cannot be checked", and the consequence of skipping it was
 * that `require_screen` never stopped anybody: a candidate could sit the whole
 * paper having simply not clicked the button. The grant here is released
 * immediately and asked for again on the paper; what this step establishes is
 * that the candidate HAS a screen to share and is willing to share it, which is
 * what the server is told and what the Start button waits for.
 */
export function ProctorPreflight({ requireCamera, requireScreen, onReady }: {
  requireCamera: boolean;
  requireScreen: boolean;
  onReady: (state: DeviceState) => void;
}) {
  const [camera, setCamera] = useState<'unknown' | 'ok' | 'refused'>('unknown');
  const [screen, setScreen] = useState<'unknown' | 'ok' | 'refused'>('unknown');
  const [busy, setBusy] = useState<'camera' | 'screen' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needed = requireCamera || requireScreen;

  useEffect(() => {
    const state = {
      camera: camera === 'ok',
      screen: screen === 'ok',
      ok: (!requireCamera || camera === 'ok') && (!requireScreen || screen === 'ok'),
    };
    onReady(needed ? state : { camera: false, screen: false, ok: true });
  }, [needed, requireCamera, requireScreen, camera, screen, onReady]);

  const checkCamera = useCallback(async () => {
    setBusy('camera');
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      // Released immediately. This step proves the camera exists and is
      // permitted; holding it open until the paper starts would leave a light
      // on for no reason.
      stream.getTracks().forEach((t) => t.stop());
      setCamera('ok');
    } catch (e) {
      setCamera('refused');
      setError(e instanceof Error && e.name === 'NotAllowedError'
        ? 'Your browser refused access to the camera. This paper cannot be started without it.'
        : 'No camera was available. Check that one is connected and not in use by another app.');
    } finally {
      setBusy(null);
    }
  }, []);

  const checkScreen = useCallback(async () => {
    setBusy('screen');
    setError(null);
    try {
      const stream = await (navigator.mediaDevices as MediaDevices & {
        getDisplayMedia(c?: unknown): Promise<MediaStream>;
      }).getDisplayMedia({ video: true, audio: false });
      const surface = (stream.getVideoTracks()[0]?.getSettings() as
        { displaySurface?: string } | undefined)?.displaySurface;
      stream.getTracks().forEach((t) => t.stop());
      // Sharing one window hides everything else on the desktop, which is the
      // thing an invigilator is looking at. Say so rather than silently
      // accepting a share that defeats the requirement.
      if (surface && surface !== 'monitor') {
        setScreen('refused');
        setError('You shared a single window. This paper needs your entire screen — '
          + 'choose the whole screen and try again.');
        return;
      }
      setScreen('ok');
    } catch {
      setScreen('refused');
      setError('Screen sharing was refused. This paper cannot be started without it.');
    } finally {
      setBusy(null);
    }
  }, []);

  if (!needed) return null;

  const row = (label: string, state: 'unknown' | 'ok' | 'refused', busyKey: 'camera' | 'screen',
    onClick: () => void, doneText: string, todoText: string) => (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button" onClick={onClick} disabled={busy !== null || state === 'ok'}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm
                   hover:bg-slate-50 disabled:opacity-60"
      >
        {state === 'ok' ? doneText : busy === busyKey ? 'Checking…' : label}
      </button>
      <span className={'text-xs ' + (state === 'ok' ? 'text-green-700' : 'text-muted')}>
        {state === 'ok' ? 'Granted.' : todoText}
      </span>
    </div>
  );

  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-white p-3">
      <p className="text-sm font-medium">Before you start</p>
      {requireCamera
        ? row('Check my camera', camera, 'camera', () => void checkCamera(),
          'Camera ready', 'Required for this paper.')
        : null}
      {requireScreen
        ? row('Share my screen', screen, 'screen', () => void checkScreen(),
          'Screen ready', 'Required — choose your entire screen, not one window.')
        : null}
      {requireScreen ? (
        <p className="mt-2 text-xs text-muted">
          You will be asked for your screen once more when the paper opens: a browser will not
          carry a share across a page change.
        </p>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}

/**
 * Holds the camera and screen for the duration of an attempt, and reports what
 * happens to them.
 *
 * The self-view is not decoration. A candidate who is being watched should be
 * able to see exactly what is being captured, and an invigilator's timeline is
 * fairer when the person on it knew the state they were in.
 */
export function ProctorMedia({ attemptId, requireCamera, requireScreen, onState }: {
  attemptId: number;
  requireCamera: boolean;
  requireScreen: boolean;
  /**
   * Live device state, so the paper can refuse to show itself while a required
   * device is off. Without this the panel could say "Camera off" in red beside
   * a perfectly readable paper, which is a label rather than a requirement.
   */
  onState?: (state: { camera: boolean; screen: boolean }) => void;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [facesChecked, setFacesChecked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const send = useCallback((kind: ProctorKind, detail?: unknown) => {
    void fetch('/api/proxy/onyx/attempts/' + attemptId + '/proctor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, detail, client_at: new Date().toISOString() }),
    });
  }, [attemptId]);

  // ---- camera ----

  const startCamera = useCallback(async () => {
    if (cameraStream.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      cameraStream.current = stream;
      if (video.current) {
        video.current.srcObject = stream;
        void video.current.play().catch(() => { /* autoplay policy; the track is what matters */ });
      }
      setCameraOn(true);
      setNotice(null);
      send('camera_on');
      // One handler for every way a camera can stop: revoked in the browser,
      // unplugged, or claimed by another application. They are the same event
      // to an invigilator and there is nothing to gain by telling them apart.
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          cameraStream.current = null;
          setCameraOn(false);
          setNotice('Your camera stopped. Turn it back on to continue being monitored.');
          send('camera_off', { reason: 'track_ended' });
        });
      });
    } catch {
      setCameraOn(false);
      setNotice('The camera is not available. This paper requires it.');
      send('camera_off', { reason: 'unavailable' });
    }
  }, [send]);

  const startScreen = useCallback(async () => {
    if (screenStream.current) return;
    try {
      // A user gesture is mandatory here and no browser will waive it, which is
      // why this is a button rather than something that happens on mount.
      const stream = await (navigator.mediaDevices as MediaDevices & {
        getDisplayMedia(c?: unknown): Promise<MediaStream>;
      }).getDisplayMedia({ video: true, audio: false });
      screenStream.current = stream;
      setScreenOn(true);
      const track = stream.getVideoTracks()[0];
      send('screen_on', { surface: (track?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface ?? null });
      track?.addEventListener('ended', () => {
        screenStream.current = null;
        setScreenOn(false);
        setNotice('Screen sharing stopped. Share your screen again to continue.');
        send('screen_off', { reason: 'track_ended' });
      });
    } catch {
      setScreenOn(false);
      send('screen_off', { reason: 'refused' });
    }
  }, [send]);

  // Report upward whenever either device changes, so the paper can gate on it.
  useEffect(() => {
    onState?.({ camera: cameraOn, screen: screenOn });
  }, [cameraOn, screenOn, onState]);

  useEffect(() => {
    if (requireCamera) void startCamera();
    const camera = cameraStream;
    const screen = screenStream;
    return () => {
      // Nothing is left running when the paper closes. A camera light still on
      // after a candidate hands in is its own kind of broken promise.
      camera.current?.getTracks().forEach((t) => t.stop());
      screen.current?.getTracks().forEach((t) => t.stop());
    };
  }, [requireCamera, startCamera]);

  // ---- best-effort face counting, where the browser has a detector ----

  useEffect(() => {
    if (!cameraOn) return;
    const detector = faceDetector();
    if (!detector) return;
    setFacesChecked(true);

    const canvas = document.createElement('canvas');
    let last: 'one' | 'none' | 'many' | null = null;

    const check = async () => {
      const el = video.current;
      if (!el || !el.videoWidth) return;
      canvas.width = el.videoWidth;
      canvas.height = el.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(el, 0, 0, canvas.width, canvas.height);
      try {
        const faces = await detector.detect(canvas);
        const state = faces.length === 0 ? 'none' : faces.length === 1 ? 'one' : 'many';
        // Only transitions. A candidate who leans out of frame for a minute
        // should produce one event, not three.
        if (state !== last) {
          if (state === 'none') send('no_face', { faces: 0 });
          if (state === 'many') send('multiple_faces', { faces: faces.length });
          last = state;
        }
      } catch { /* a detector that throws is a detector we do not have */ }
      // The frame never leaves this canvas, and the canvas never leaves the
      // page. Only the count is sent.
      canvas.width = 0;
      canvas.height = 0;
    };

    const timer = setInterval(() => { void check(); }, FACE_CHECK_MS);
    return () => clearInterval(timer);
  }, [cameraOn, send]);

  if (!requireCamera && !requireScreen) return null;

  return (
    <section
      aria-label="Monitoring"
      className="flex flex-wrap items-start gap-4 rounded-xl border border-amber-300
                 bg-amber-50 p-3"
    >
      {requireCamera ? (
        <div className="flex items-center gap-3">
          {/* Muted and playsInline so no browser blocks it, and mirrored
              because an unmirrored self-view reads as someone else. */}
          <video
            ref={video} muted playsInline
            aria-label="Your camera, as the invigilator sees it is on"
            className="h-20 w-28 shrink-0 -scale-x-100 rounded-lg bg-slate-900 object-cover"
          />
          <div className="text-xs">
            <div className={'font-semibold ' + (cameraOn ? 'text-green-800' : 'text-rose-700')}>
              {cameraOn ? 'Camera on' : 'Camera off'}
            </div>
            {cameraOn ? null : (
              <button
                type="button" onClick={() => void startCamera()}
                className="mt-1 rounded-lg border border-slate-300 bg-white px-2 py-1
                           text-xs hover:bg-slate-50"
              >
                Turn the camera on
              </button>
            )}
          </div>
        </div>
      ) : null}

      {requireScreen ? (
        <div className="text-xs">
          <div className={'font-semibold ' + (screenOn ? 'text-green-800' : 'text-rose-700')}>
            {screenOn ? 'Screen shared' : 'Screen not shared'}
          </div>
          {screenOn ? null : (
            <button
              type="button" onClick={() => void startScreen()}
              className="mt-1 rounded-lg border border-slate-300 bg-white px-2 py-1
                         text-xs hover:bg-slate-50"
            >
              Share my screen
            </button>
          )}
        </div>
      ) : null}

      <p className="basis-full text-xs text-amber-900">
        No video is recorded or uploaded. What is stored is when your camera and screen
        started and stopped.
        {requireCamera
          ? facesChecked
            ? ' Your browser can count faces in view; only the number is sent, never the picture.'
            : ' Your browser cannot count faces, so nothing is checked in the picture.'
          : ''}
      </p>

      {notice ? (
        <p role="alert" className="basis-full text-xs font-medium text-rose-800">{notice}</p>
      ) : null}
    </section>
  );
}
