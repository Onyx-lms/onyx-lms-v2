/**
 * SET-03 / SET-06 -- payment gateways and the language manager.
 *
 * payment_gateways.keys holds JSON as text, so it goes through the PHP codec.
 * Gateway secrets are write-only for the same reason SMTP is (see
 * settings-admin.service.ts).
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import { phpJsonEncode, phpJsonDecode } from '../json/php-json.ts';

const GATEWAY_COLUMNS = 'id, identifier, title, keys, description, status, test_mode, is_addon, created_at, updated_at';

/** Key names that must never be echoed back to a browser. */
const SECRET_KEY_NAME = /secret|password|private|token/i;

/** What a set-but-hidden credential looks like on the wire. */
export const KEPT = '__set__';

export class PlatformAdminService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  // ---- SET-03: payment gateways ----

  async gateways() {
    const { data } = await this.#db.from('payment_gateways')
      .select(GATEWAY_COLUMNS).order('title');
    return (data ?? []).map((g) => {
      const keys = phpJsonDecode<Record<string, unknown>>(g.keys as string, {});
      // Report which credentials are set without revealing any of them.
      const shape: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(keys)) {
        shape[k] = SECRET_KEY_NAME.test(k) ? (v ? KEPT : '') : v;
      }
      return { ...g, keys: shape };
    });
  }

  async saveGateway(id: number, input: {
    status?: 0 | 1; test_mode?: 0 | 1; keys?: Record<string, unknown>;
  }) {
    const { data: current } = await this.#db.from('payment_gateways')
      .select(GATEWAY_COLUMNS).eq('id', id).maybeSingle();
    if (!current) throw new HttpError(404, 'Gateway not found.');

    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.status !== undefined) row['status'] = input.status;
    if (input.test_mode !== undefined) row['test_mode'] = input.test_mode;

    if (input.keys) {
      const existing = phpJsonDecode<Record<string, unknown>>(current.keys as string, {});
      const merged = { ...existing };
      for (const [k, v] of Object.entries(input.keys)) {
        // The placeholder means "unchanged"; a real blank clears the value.
        if (v === KEPT) continue;
        merged[k] = v;
      }
      // Written back in the same JSON-as-text shape Laravel reads.
      row['keys'] = phpJsonEncode(merged);
    }
    await this.#db.from('payment_gateways').update(row as never).eq('id', id);
    return (await this.gateways()).find((g) => g.id === id) ?? null;
  }

  // ---- SET-06: languages and phrases ----

  async languages() {
    const { data } = await this.#db.from('languages')
      .select('id, name, direction').order('name');
    const rows = data ?? [];
    if (!rows.length) return [];

    const { data: phrases } = await this.#db.from('language_phrases').select('language_id');
    const counts = new Map<number, number>();
    for (const p of phrases ?? []) {
      const id = Number(p.language_id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return rows.map((l) => ({ ...l, phrase_count: counts.get(l.id) ?? 0 }));
  }

  async addLanguage(name: string, direction: 'ltr' | 'rtl') {
    const clean = name.trim();
    const { data: existing } = await this.#db.from('languages')
      .select('id').eq('name', clean).maybeSingle();
    if (existing) throw new HttpError(422, 'That language already exists.');

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('languages')
      .insert({ name: clean, direction, created_at: now, updated_at: now })
      .select('id, name, direction').maybeSingle();
    if (error) throw new HttpError(500, 'Could not add the language: ' + error.message);

    // A new language starts with every known phrase, untranslated, so the
    // editor has something to edit rather than an empty screen.
    const { data: source } = await this.#db.from('language_phrases')
      .select('phrase').limit(2000);
    const seen = new Set<string>();
    const rows = (source ?? [])
      .map((p) => String(p.phrase))
      .filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
      .map((phrase) => ({
        language_id: data!.id, phrase, translated: phrase,
        created_at: now, updated_at: now,
      }));
    if (rows.length) await this.#db.from('language_phrases').insert(rows as never);
    return { ...data, phrase_count: rows.length };
  }

  async setDirection(id: number, direction: 'ltr' | 'rtl') {
    const { data } = await this.#db.from('languages').select('id').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Language not found.');
    await this.#db.from('languages')
      .update({ direction, updated_at: new Date().toISOString() }).eq('id', id);
  }

  async removeLanguage(id: number, currentDefault: string | null): Promise<void> {
    const { data } = await this.#db.from('languages')
      .select('id, name').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Language not found.');

    // Deleting the site's own language would leave every phrase unresolvable.
    // The comparison is case-insensitive on purpose: the seeded row is
    // 'English' while settings.language is 'english', and an exact match let a
    // delete through that took the language and all 404 of its phrases with it.
    const name = String(data.name).trim().toLowerCase();
    if (currentDefault && name === currentDefault.trim().toLowerCase()) {
      throw new HttpError(422, 'That is the site language. Change it before deleting.');
    }
    await this.#db.from('language_phrases').delete().eq('language_id', id);
    await this.#db.from('languages').delete().eq('id', id);
  }

  async phrases(languageId: number, search: string | undefined, from: number, to: number) {
    let query = this.#db.from('language_phrases')
      .select('id, language_id, phrase, translated', { count: 'exact' })
      .eq('language_id', languageId);
    if (search?.trim()) {
      const like = '%' + search.trim() + '%';
      query = query.or('phrase.ilike.' + like + ',translated.ilike.' + like);
    }
    const { data, count } = await query.order('id').range(from, to);
    return { rows: data ?? [], total: count ?? 0 };
  }

  async savePhrases(languageId: number, updates: Record<string, string>) {
    let written = 0;
    for (const [id, translated] of Object.entries(updates)) {
      const { count } = await this.#db.from('language_phrases')
        .select('id', { count: 'exact', head: true })
        .eq('id', Number(id)).eq('language_id', languageId);
      // Only phrases belonging to this language, so an id from another one
      // cannot be rewritten by passing it here.
      if (!count) continue;
      await this.#db.from('language_phrases')
        .update({ translated, updated_at: new Date().toISOString() }).eq('id', Number(id));
      written++;
    }
    return { written };
  }

  /** SET-06 -- export a language as a flat phrase map. */
  async exportLanguage(languageId: number) {
    const { data: language } = await this.#db.from('languages')
      .select('id, name, direction').eq('id', languageId).maybeSingle();
    if (!language) throw new HttpError(404, 'Language not found.');
    const { data } = await this.#db.from('language_phrases')
      .select('phrase, translated').eq('language_id', languageId).order('id');
    const phrases: Record<string, string> = {};
    for (const p of data ?? []) phrases[String(p.phrase)] = String(p.translated ?? '');
    return { language, phrases };
  }

  /** SET-06 -- import a phrase map: update what exists, add what does not. */
  async importLanguage(languageId: number, phrases: Record<string, string>) {
    const { data: language } = await this.#db.from('languages')
      .select('id').eq('id', languageId).maybeSingle();
    if (!language) throw new HttpError(404, 'Language not found.');

    const { data: existing } = await this.#db.from('language_phrases')
      .select('id, phrase').eq('language_id', languageId);
    const byPhrase = new Map((existing ?? []).map((p) => [String(p.phrase), p.id]));

    const now = new Date().toISOString();
    let updated = 0;
    const added: Record<string, unknown>[] = [];
    for (const [phrase, translated] of Object.entries(phrases)) {
      const id = byPhrase.get(phrase);
      if (id) {
        await this.#db.from('language_phrases')
          .update({ translated, updated_at: now }).eq('id', id);
        updated++;
      } else {
        added.push({
          language_id: languageId, phrase, translated,
          created_at: now, updated_at: now,
        });
      }
    }
    if (added.length) await this.#db.from('language_phrases').insert(added as never);
    return { updated, added: added.length };
  }
}
