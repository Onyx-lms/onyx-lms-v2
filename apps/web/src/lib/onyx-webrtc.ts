/**
 * ASS-02b -- the peer connection behind live invigilation.
 *
 * One candidate, one invigilator, one direction: the candidate's camera goes
 * to the invigilator and nothing comes back. The video never touches this
 * product's servers -- it is a direct connection between two browsers, and all
 * that goes through the API is the handful of messages needed to establish it.
 *
 * The invigilator is the one who OFFERS, even though the candidate is the one
 * sending video. That is deliberate: the offer is what tells the candidate's
 * screen somebody has started watching, and a candidate's browser sitting in
 * `recvonly` waiting to be asked is a browser that is not holding an open
 * camera on the off-chance. Nothing turns on until somebody is looking.
 */

/**
 * Where to look for a route between two networks.
 *
 * STUN alone gets most pairs connected -- it is enough whenever at least one
 * side can accept an inbound connection once it knows its own public address.
 * It is NOT enough behind a symmetric NAT or a strict corporate firewall,
 * which is where a TURN relay comes in: it forwards the media rather than
 * introducing the peers, and it is therefore bandwidth somebody pays for.
 *
 * So TURN is configuration rather than a default, and its absence is reported
 * honestly by the viewer instead of leaving somebody staring at a black
 * rectangle wondering whether the candidate has covered the lens.
 */
export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  const turn = process.env.NEXT_PUBLIC_TURN_URL;
  if (turn) {
    servers.push({
      urls: turn.split(',').map((u) => u.trim()).filter(Boolean),
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }
  return servers;
}

/** True when a relay is configured, so the UI can say what it can promise. */
export function hasTurn(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TURN_URL);
}

export interface Signal {
  id: number;
  sender: 'watcher' | 'candidate';
  kind: 'offer' | 'answer' | 'ice' | 'bye';
  payload: unknown;
}

/**
 * Where one attempt's signalling lives, from the caller's side of the product.
 *
 * A candidate and an invigilator both reach it as `onyx/attempts/:id`; a
 * platform operator reaches the same attempt through the console's own
 * tenant-scoped guard, `onyx/platform/tenants/:tenant/attempts/:id`. The two
 * routes call the same service, so only the prefix differs -- and passing it in
 * is what stopped this file needing a second copy of the negotiation.
 */
export const attemptPath = (attemptId: number, base = 'onyx/attempts/'): string =>
  '/api/proxy/' + base + attemptId;

/** POSTs one message into the negotiation. */
export async function sendSignal(attemptId: number, sessionId: string,
  kind: Signal['kind'], payload: unknown, base?: string): Promise<void> {
  await fetch(attemptPath(attemptId, base) + '/signal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, kind, payload }),
  }).catch(() => undefined);
}

/**
 * Polls for the other side's messages until stopped.
 *
 * A poll rather than a socket, because this deployment is serverless and there
 * is nowhere to hold one open. It is only expensive for the two or three
 * seconds a negotiation takes -- once the peer connection is up, the media
 * flows directly and this loop is carrying nothing but the occasional late ICE
 * candidate. It slows down accordingly.
 */
export function pollSignals(
  attemptId: number, sessionId: string,
  onSignal: (signal: Signal) => void | Promise<void>,
  base?: string,
): () => void {
  let after = 0;
  let live = true;
  let idle = 0;

  const tick = async () => {
    while (live) {
      try {
        const res = await fetch(attemptPath(attemptId, base)
          + '/signal?session_id=' + encodeURIComponent(sessionId) + '&after=' + after);
        const body = await res.json().catch(() => ({ ok: false }));
        const rows: Signal[] = body.ok ? body.data : [];
        for (const signal of rows) {
          after = Math.max(after, signal.id);
          await onSignal(signal);
        }
        // Busy while things are arriving, lazy once they stop. A connected
        // call needs almost nothing from this loop.
        idle = rows.length ? 0 : Math.min(idle + 1, 10);
      } catch {
        idle = Math.min(idle + 1, 10);
      }
      await new Promise((r) => setTimeout(r, idle < 3 ? 700 : 2500));
    }
  };
  void tick();

  return () => { live = false; };
}

/**
 * Wires ICE candidates and connection state onto a peer connection.
 *
 * Shared by both sides because both do exactly the same thing with them, and
 * two copies of ICE plumbing is two places for a race to hide.
 */
export function wire(pc: RTCPeerConnection, attemptId: number, sessionId: string,
  onState?: (state: RTCPeerConnectionState) => void, base?: string): void {
  pc.onicecandidate = (e) => {
    // The null candidate means gathering finished; there is nothing to send.
    if (e.candidate) void sendSignal(attemptId, sessionId, 'ice', e.candidate.toJSON(), base);
  };
  pc.onconnectionstatechange = () => onState?.(pc.connectionState);
}

/**
 * Applies one signal to a peer connection.
 *
 * ICE candidates that arrive before the remote description are a normal race
 * rather than an error -- addIceCandidate throws in that window, and the
 * browser will re-offer the same candidates. Swallowing it is correct here and
 * is why this is one function rather than inline handlers on both sides.
 */
export async function apply(pc: RTCPeerConnection, signal: Signal): Promise<void> {
  if (signal.kind === 'ice') {
    try {
      await pc.addIceCandidate(signal.payload as RTCIceCandidateInit);
    } catch { /* arrived before the description; the browser will retry */ }
  }
}
