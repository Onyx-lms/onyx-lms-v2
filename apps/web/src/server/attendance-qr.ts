/**
 * LRN-03b -- the attendance code as something a phone can read.
 *
 * The check-in used to be a human-readable string: eight hex characters on the
 * projector, typed into a box. That works, and it has two costs a QR does not.
 * A learner in row 14 mistypes it, and -- more to the point -- a string that
 * can be read aloud can be *relayed*. Someone photographs the screen and sends
 * eight characters to a friend at home, who types them in. Thirty seconds is a
 * short window but it is a wide enough one for a text message.
 *
 * So the code is no longer written down anywhere. It is encoded into a URL and
 * drawn as a QR, and the only way to use it is to point a camera at the screen
 * and follow the link. That is not proof of presence either -- a photograph of
 * a QR is still a photograph -- but it removes the trivially relayable form,
 * and it removes the typing.
 *
 * No in-app scanner is involved, deliberately. Every phone camera made in the
 * last decade recognises a QR and offers to open the URL, so this works on iOS
 * Safari and on Android, with no camera permission prompt from us, no
 * `BarcodeDetector` (which Safari and Firefox lack), and no scanner library
 * shipped to the browser. The learner opens the link and the app does the rest.
 *
 * The code travels as a query parameter, which puts it in browser history and
 * in whatever logs sit in front of the app. That is acceptable *only* because
 * of what the code is: an HMAC of the session secret and the current time
 * bucket, dead within two windows -- about thirty seconds. A recovered one is
 * worth nothing by the time anybody reads a log. The session secret itself
 * never leaves the server.
 */
import QRCode from 'qrcode';
import { appOrigin } from '../lib/app-origin.ts';

/**
 * Where a scanned code lands. Absolute, because a phone camera opens it
 * outside any page context and a relative path would mean nothing.
 */
export function checkInUrl(sessionId: number, code: string): string {
  return appOrigin() + '/onyx/attendance/' + sessionId + '/check-in?c='
    + encodeURIComponent(code);
}

/**
 * The QR itself, as SVG.
 *
 * SVG rather than a PNG data URI because this is projected: it is scaled to
 * whatever the room needs and stays sharp, and it costs about a kilobyte.
 *
 * Error correction is deliberately the lowest level. The counter-intuitive
 * part is that higher correction is *worse* here -- it buys resilience to a
 * damaged print by adding modules, and a denser code is harder for a phone to
 * resolve across a lecture theatre. This code is displayed on a clean bright
 * screen for fifteen seconds and never printed, so the failure it should be
 * tuned against is distance, not damage.
 */
export async function checkInQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'L',
    // The projector panel supplies its own padding; a wide quiet zone inside
    // the SVG would only shrink the modules within the space available.
    margin: 1,
    // Rendered without width/height so the SVG scales to its container. The
    // colours are overridden by the panel via CSS for dark mode.
    color: { dark: '#000000', light: '#ffffff' },
  });
}
