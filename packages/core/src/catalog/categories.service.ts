/**
 * C-02 -- categories.
 *
 * Ports the parent/child model plus top_categories() and
 * count_category_courses() from Common_helper.php.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';

export interface CategoryNode {
  id: number;
  parent_id: number;
  title: string | null;
  slug: string | null;
  icon: string | null;
  thumbnail: string | null;
  category_logo: string | null;
  sort: number;
  status: number | null;
  course_count: number;
  children: CategoryNode[];
}

const COLUMNS = 'id, parent_id, title, slug, icon, thumbnail, category_logo, sort, status, keywords, description';

export class CategoriesService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async all() {
    const { data, error } = await this.#db.from('categories').select(COLUMNS).order('sort');
    if (error) throw new HttpError(500, `categories.all failed: ${error.message}`);
    return data ?? [];
  }

  /** Active-course counts per category id, in one round trip. */
  async courseCounts(): Promise<Map<number, number>> {
    const { data, error } = await this.#db
      .from('courses').select('category_id').eq('status', 'active');
    if (error) throw new HttpError(500, `categories.courseCounts failed: ${error.message}`);
    const counts = new Map<number, number>();
    for (const row of data ?? []) {
      if (row.category_id == null) continue;
      counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Two-level tree. A parent's count includes its children's courses, which is
   * what the catalog filter actually returns when you click the parent.
   */
  async tree(): Promise<CategoryNode[]> {
    const [rows, counts] = await Promise.all([this.all(), this.courseCounts()]);
    const toNode = (r: Record<string, unknown>): CategoryNode => ({
      id: r['id'] as number,
      parent_id: (r['parent_id'] as number) ?? 0,
      title: (r['title'] as string) ?? null,
      slug: (r['slug'] as string) ?? null,
      icon: (r['icon'] as string) ?? null,
      thumbnail: (r['thumbnail'] as string) ?? null,
      category_logo: (r['category_logo'] as string) ?? null,
      sort: (r['sort'] as number) ?? 0,
      status: (r['status'] as number) ?? null,
      course_count: counts.get(r['id'] as number) ?? 0,
      children: [],
    });

    const nodes = new Map<number, CategoryNode>();
    for (const r of rows) nodes.set(r.id, toNode(r as Record<string, unknown>));

    const roots: CategoryNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
      if (parent) {
        parent.children.push(node);
        parent.course_count += node.course_count;
      } else {
        roots.push(node);
      }
    }
    const bySort = (a: CategoryNode, b: CategoryNode) => a.sort - b.sort;
    roots.sort(bySort);
    for (const r of roots) r.children.sort(bySort);
    return roots;
  }

  /** top_categories() -- most courses first. */
  async top(limit = 8): Promise<CategoryNode[]> {
    const tree = await this.tree();
    return [...tree].sort((a, b) => b.course_count - a.course_count).slice(0, limit);
  }

  async findBySlug(slug: string) {
    const { data } = await this.#db.from('categories').select(COLUMNS).eq('slug', slug).maybeSingle();
    return data ?? null;
  }

  /**
   * Category ids a catalog filter should match. Selecting a parent includes its
   * children; selecting a child matches only itself. Same as Laravel.
   */
  async filterIdsForSlug(slug: string): Promise<number[] | null> {
    const category = await this.findBySlug(slug);
    if (!category) return null;
    if ((category.parent_id ?? 0) > 0) return [category.id];
    const { data } = await this.#db.from('categories').select('id').eq('parent_id', category.id);
    return [category.id, ...(data ?? []).map((r) => r.id)];
  }
}
