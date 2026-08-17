/**
 * LC-05 -- Jitsi.
 *
 * No credentials and no server component: the public meet.jit.si instance is
 * joined straight from the browser. All this module does is decide the room
 * name and the per-role options, so both are testable and identical on every
 * screen that embeds a class.
 *
 * The Laravel view loaded the 8x8 JaaS build of external_api.js while pointing
 * `domain` at meet.jit.si. The script and the domain have to agree, so the
 * script URL is derived from the domain here.
 */
export const JITSI_DOMAIN = 'meet.jit.si';

export const externalApiUrl = (domain = JITSI_DOMAIN) => 'https://' + domain + '/external_api.js';

/**
 * Room names are shared secrets on the public instance -- anyone who can guess
 * one can walk into the class. Laravel used `lms-<course slug>-class-<id>`,
 * which is guessable from the public course page. The class code adds the
 * entropy; it is derived from the meeting row, not from the URL.
 */
export function roomName(courseSlug: string | null, classId: number, code: string): string {
  const slug = (courseSlug ?? 'course').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'course';
  return 'lms-' + slug + '-class-' + classId + '-' + code;
}

/**
 * Entropy for the room name, stored in additional_info when the class is
 * created. Without it the room is guessable from the public course page.
 */
export function newRoomCode(random: (n: number) => Uint8Array = webRandom): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (const b of random(12)) out += alphabet[b % alphabet.length];
  return out;
}

function webRandom(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export interface JitsiOptions {
  roomName: string;
  userInfo: { displayName: string; email: string };
  configOverwrite: Record<string, unknown>;
  interfaceConfigOverwrite: Record<string, unknown>;
}

const TOOLBAR = [
  'microphone', 'camera', 'desktop', 'fullscreen', 'fodeviceselection', 'hangup',
  'chat', 'etherpad', 'settings', 'raisehand', 'videoquality', 'filmstrip',
  'feedback', 'stats', 'shortcuts', 'tileview', 'download', 'help',
  'participants-pane', 'shareaudio', 'noisesuppression',
];

/** Host-only controls, kept out of a participant's toolbar. */
const HOST_TOOLBAR = ['recording', 'livestreaming', 'mute-everyone', 'security'];

export function jitsiOptions(opts: {
  room: string; displayName: string; email: string; isHost: boolean;
}): JitsiOptions {
  return {
    roomName: opts.room,
    userInfo: {
      displayName: opts.displayName + (opts.isHost ? ' (Host)' : ''),
      email: opts.email,
    },
    configOverwrite: {
      // Participants arrive muted so a late joiner cannot talk over the class.
      startWithAudioMuted: !opts.isHost,
      startWithVideoMuted: false,
      disableDeepLinking: true,
      prejoinPageEnabled: false,
      disableModeratorIndicator: false,
      enableLobby: opts.isHost,
    },
    interfaceConfigOverwrite: {
      SHOW_JITSI_WATERMARK: false,
      SHOW_WATERMARK_FOR_GUESTS: false,
      TOOLBAR_BUTTONS: opts.isHost ? [...TOOLBAR, ...HOST_TOOLBAR] : TOOLBAR,
      SETTINGS_SECTIONS: opts.isHost
        ? ['devices', 'language', 'moderator', 'profile']
        : ['devices', 'language', 'profile'],
      MOBILE_APP_PROMO: false,
      DISABLE_JOIN_LEAVE_NOTIFICATIONS: false,
    },
  };
}
