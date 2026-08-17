/**
 * SET-01 / SET-02 / SET-04 / SET-05 -- the admin settings screens.
 *
 * Everything is key/value in `settings` (type, description). The Laravel
 * controller wrote whatever the form posted, so a typo in a field name silently
 * created a new setting nobody reads. The keys are declared here instead, in
 * groups that match the screens, and anything unknown is refused.
 *
 * SECRETS ARE WRITE-ONLY. smtp_pass, the gateway keys and the API credentials
 * are never returned by a read -- the screens show "set" or "not set" and an
 * empty field leaves the stored value alone.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import type { SettingsService } from '../settings/settings.service.ts';

/** Keys the admin screens may write, grouped by screen. */
export const SETTING_GROUPS = {
  system: [
    'system_title', 'system_email', 'timezone', 'language', 'theme',
    'system_currency', 'currency_position', 'footer_text', 'address', 'phone',
    'logo', 'logo_dark', 'favicon', 'meta_title', 'meta_description', 'meta_keywords',
  ],
  website: [
    'banner_title', 'banner_subtitle', 'banner_image', 'about_us', 'about_image',
    'facebook', 'twitter', 'linkedin', 'instagram', 'youtube',
    'blog_visibility_on_the_home_page', 'instructors_blog_permission',
    'instructor_can_publish_course', 'instructor_application',
    'instructor_application_note', 'course_per_page', 'home_page_layout',
  ],
  player: [
    'drip_content', 'lesson_completion_role', 'minimum_duration', 'minimum_percentage',
    'disable_download', 'watermark_type', 'watermark_logo', 'watermark_text',
    'watermark_top', 'watermark_left', 'watermark_width', 'watermark_height',
    'watermark_opacity',
  ],
  notification: [
    'notify_on_enrolment', 'notify_on_purchase', 'notify_on_course_approval',
    'notify_on_payout', 'notify_on_message', 'notify_on_new_user',
  ],
  api: [
    'zoom_account_id', 'zoom_client_id', 'zoom_account_email', 'zoom_web_sdk',
    'zoom_sdk_client_id', 'open_ai_model', 'recaptcha_site_key',
    'protocol', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_encryption',
    'google_client_id', 'facebook_client_id',
    'instructor_revenue', 'tax',
  ],
} as const;

export type SettingGroup = keyof typeof SETTING_GROUPS;

/**
 * Keys whose value must never leave the server. They can be written and their
 * presence reported, but a read returns `<key>_set: true|false` instead.
 */
export const SECRET_KEYS = new Set([
  'smtp_pass', 'zoom_client_secret', 'zoom_sdk_client_secret',
  'open_ai_secret_key', 'recaptcha_secret_key',
  'google_client_secret', 'facebook_client_secret',
]);

/** Secrets the API screen may write, alongside its readable keys. */
const WRITABLE_SECRETS: Record<SettingGroup, string[]> = {
  system: ['smtp_pass'],
  website: [],
  player: [],
  notification: [],
  api: [
    'smtp_pass', 'zoom_client_secret', 'zoom_sdk_client_secret',
    'open_ai_secret_key', 'recaptcha_secret_key',
    'google_client_secret', 'facebook_client_secret',
  ],
};

export class SettingsAdminService {
  #db: Db;
  #settings: SettingsService;
  constructor(db: Db, settings: SettingsService) {
    this.#db = db;
    this.#settings = settings;
  }

  /** Everything one screen shows, with secrets reduced to a boolean. */
  async group(group: SettingGroup) {
    const keys = SETTING_GROUPS[group];
    const out: Record<string, unknown> = {};
    for (const key of keys) out[key] = await this.#settings.get(key);
    for (const key of WRITABLE_SECRETS[group]) {
      out[key + '_set'] = Boolean(await this.#settings.get(key));
    }
    return out;
  }

  /**
   * Writes one screen's values. Unknown keys are refused rather than silently
   * stored, and a blank secret leaves the existing one in place.
   */
  async saveGroup(group: SettingGroup, values: Record<string, unknown>) {
    const allowed = new Set<string>([...SETTING_GROUPS[group], ...WRITABLE_SECRETS[group]]);
    const unknown = Object.keys(values).filter((k) => !allowed.has(k));
    if (unknown.length) {
      throw new HttpError(422, 'Not a setting on this screen: ' + unknown.join(', '));
    }

    let written = 0;
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null) continue;
      const text = String(value);
      // An untouched password field posts empty; that must not wipe the secret.
      if (SECRET_KEYS.has(key) && text === '') continue;
      await this.#settings.set(key, text);
      written++;
    }
    return { written };
  }

  /** SET-01 -- the whole settings table, for support and debugging. */
  async all() {
    const { data } = await this.#db.from('settings')
      .select('id, type, description').order('type');
    return (data ?? []).map((r) => ({
      ...r,
      description: SECRET_KEYS.has(String(r.type)) ? null : r.description,
      is_secret: SECRET_KEYS.has(String(r.type)),
    }));
  }
}
