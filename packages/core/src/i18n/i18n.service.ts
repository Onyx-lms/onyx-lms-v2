/**
 * P-03 -- get_phrase() port.
 *
 * Laravel behaviour being reproduced, including the surprising parts:
 *   1. active language = session override, else settings.language
 *   2. language row matched by NAME (a LIKE, case-insensitive in MySQL)
 *   3. missing language row  -> return the key untouched
 *   4. missing phrase        -> return the key AND auto-register it against
 *                               English so translators can find it later
 *   5. '____' placeholders replaced one occurrence at a time, in order
 *
 * (4) is a write-on-read. It is preserved for parity but gated behind
 * `autoRegisterMissing` so the read path can be made pure in production if the
 * write volume ever becomes a problem.
 */
import type { Db } from '../db/client.ts';

export interface I18nOptions {
  autoRegisterMissing?: boolean;
}

interface LanguageRow { id: number; name: string; direction: string | null }

export class I18nService {
  #db: Db;
  #autoRegister: boolean;
  #languages: LanguageRow[] | null = null;
  /** languageId -> (phrase -> translated) */
  #phrases = new Map<number, Map<string, string>>();

  constructor(db: Db, opts: I18nOptions = {}) {
    this.#db = db;
    this.#autoRegister = opts.autoRegisterMissing ?? true;
  }

  async languages(): Promise<LanguageRow[]> {
    if (!this.#languages) {
      const { data, error } = await this.#db.from('languages').select('id, name, direction');
      if (error) throw new Error(`i18n.languages failed: ${error.message}`);
      this.#languages = (data ?? []) as LanguageRow[];
    }
    return this.#languages;
  }

  async findLanguage(name: string): Promise<LanguageRow | null> {
    const wanted = (name ?? '').trim().toLowerCase();
    return (await this.languages()).find((l) => (l.name ?? '').toLowerCase() === wanted) ?? null;
  }

  /** RTL flag for the active language -- drives dir="rtl" on <html>. */
  async direction(languageName: string): Promise<'ltr' | 'rtl'> {
    const lang = await this.findLanguage(languageName);
    return lang?.direction === 'rtl' ? 'rtl' : 'ltr';
  }

  async #load(languageId: number): Promise<Map<string, string>> {
    const cached = this.#phrases.get(languageId);
    if (cached) return cached;
    const { data, error } = await this.#db
      .from('language_phrases').select('phrase, translated').eq('language_id', languageId);
    if (error) throw new Error(`i18n.load(${languageId}) failed: ${error.message}`);
    const map = new Map<string, string>();
    for (const row of data ?? []) {
      if (row.phrase != null) map.set(row.phrase, row.translated ?? row.phrase);
    }
    this.#phrases.set(languageId, map);
    return map;
  }

  /**
   * get_phrase($phrase, $value_replace)
   * @param languageName active language; caller resolves session-vs-settings
   */
  async phrase(
    key: string,
    languageName: string,
    replacements: (string | number)[] | string | number = [],
  ): Promise<string> {
    const lang = await this.findLanguage(languageName);
    if (!lang) return key; // step 3: no language row -> untranslated key

    const map = await this.#load(lang.id);
    let translated = map.get(key);

    if (translated === undefined) {
      translated = key;
      if (this.#autoRegister) await this.#registerMissing(key);
    }

    const list = Array.isArray(replacements) ? replacements : [replacements];
    for (const value of list) {
      translated = translated.replace('____', String(value)); // one at a time
    }
    return translated;
  }

  /** Records an unknown key against English so it surfaces in the phrase editor. */
  async #registerMissing(key: string): Promise<void> {
    const english = await this.findLanguage('english');
    if (!english) return;
    const map = await this.#load(english.id);
    if (map.has(key)) return;
    const { error } = await this.#db
      .from('language_phrases')
      .insert({ language_id: english.id, phrase: key, translated: key });
    if (!error) map.set(key, key);
  }

  invalidate(): void { this.#languages = null; this.#phrases.clear(); }

  /** Whole dictionary for a language -- feeds next-intl on the web side. */
  async dictionary(languageName: string): Promise<Record<string, string>> {
    const lang = await this.findLanguage(languageName);
    if (!lang) return {};
    return Object.fromEntries(await this.#load(lang.id));
  }
}
