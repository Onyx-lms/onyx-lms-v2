/**
 * C-05 -- SEO fields.
 *
 * seo_fields carries either a route-level record or an entity-level one
 * (course_id / blog_id / bootcamp_id). Entity records win over route records,
 * and anything missing falls back to the global meta_* settings, so a page
 * always ships complete metadata rather than empty tags.
 */
import type { Db } from '../db/client.ts';
import { phpJsonDecode } from '../json/php-json.ts';
import type { SettingsService } from '../settings/settings.service.ts';

export interface PageMetadata {
  title: string;
  description: string;
  keywords: string;
  robots: string;
  canonical: string | null;
  og: { title: string; description: string; image: string | null };
  jsonLd: unknown | null;
}

const COLUMNS = 'id, route, name_route, meta_title, meta_keywords, meta_description, meta_robot, canonical_url, custom_url, json_ld, og_title, og_description, og_image, course_id, blog_id, bootcamp_id';

export class SeoService {
  #db: Db;
  #settings: SettingsService;
  constructor(db: Db, settings: SettingsService) {
    this.#db = db;
    this.#settings = settings;
  }

  async forRoute(route: string) {
    const { data } = await this.#db.from('seo_fields').select(COLUMNS).eq('route', route).maybeSingle();
    return data ?? null;
  }

  async forEntity(kind: 'course' | 'blog' | 'bootcamp', id: number) {
    const column = `${kind}_id` as const;
    const { data } = await this.#db.from('seo_fields').select(COLUMNS).eq(column, id).maybeSingle();
    return data ?? null;
  }

  /**
   * Resolves the metadata for a page.
   * @param fallback values from the entity itself (course title etc.)
   */
  async resolve(opts: {
    route?: string;
    entity?: { kind: 'course' | 'blog' | 'bootcamp'; id: number };
    fallback?: Partial<{ title: string; description: string; keywords: string; image: string }>;
  }): Promise<PageMetadata> {
    const record = opts.entity
      ? (await this.forEntity(opts.entity.kind, opts.entity.id)) ?? (opts.route ? await this.forRoute(opts.route) : null)
      : (opts.route ? await this.forRoute(opts.route) : null);

    const [siteTitle, siteDescription, siteKeywords] = await Promise.all([
      this.#settings.get('meta_title'),
      this.#settings.get('meta_description'),
      this.#settings.get('meta_keywords'),
    ]);

    const title = record?.meta_title || opts.fallback?.title || siteTitle || '';
    const description =
      record?.meta_description || opts.fallback?.description || siteDescription || '';
    const keywords = record?.meta_keywords || opts.fallback?.keywords || siteKeywords || '';

    return {
      title,
      description,
      keywords,
      robots: record?.meta_robot || 'index, follow',
      canonical: record?.canonical_url || null,
      og: {
        title: record?.og_title || title,
        description: record?.og_description || description,
        image: record?.og_image || opts.fallback?.image || null,
      },
      jsonLd: phpJsonDecode<unknown>(record?.json_ld ?? null, null),
    };
  }
}
