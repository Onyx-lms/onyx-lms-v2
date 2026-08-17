/**
 * R-08 -- knowledge base.
 *
 * knowledge_bases are the top-level topics; knowledge_base_topicks are the
 * articles under them. The table name's spelling is preserved -- renaming it
 * would be a schema change.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';

export class KnowledgeBaseService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  /** Topics with their article counts, for the index page. */
  async topics() {
    const { data } = await this.#db.from('knowledge_bases')
      .select('id, title, created_at').order('title');
    const rows = data ?? [];
    if (!rows.length) return [];

    const { data: articles } = await this.#db.from('knowledge_base_topicks')
      .select('knowledge_base_id').in('knowledge_base_id', rows.map((r) => r.id));
    const counts = new Map<number, number>();
    for (const a of articles ?? []) {
      const id = Number(a.knowledge_base_id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return rows.map((r) => ({ ...r, article_count: counts.get(r.id) ?? 0 }));
  }

  async topic(id: number) {
    const { data } = await this.#db.from('knowledge_bases')
      .select('id, title').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Topic not found.');
    const { data: articles } = await this.#db.from('knowledge_base_topicks')
      .select('id, topic_name, created_at').eq('knowledge_base_id', id).order('id');
    return { ...data, articles: articles ?? [] };
  }

  async article(id: number) {
    const { data } = await this.#db.from('knowledge_base_topicks')
      .select('id, knowledge_base_id, topic_name, description, created_at')
      .eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Article not found.');

    const { data: topic } = await this.#db.from('knowledge_bases')
      .select('id, title').eq('id', data.knowledge_base_id as number).maybeSingle();
    // Siblings power the "more in this topic" list.
    const { data: siblings } = await this.#db.from('knowledge_base_topicks')
      .select('id, topic_name').eq('knowledge_base_id', data.knowledge_base_id as number).order('id');
    return { ...data, topic: topic ?? null, siblings: siblings ?? [] };
  }

  async createTopic(title: string) {
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('knowledge_bases')
      .insert({ title: title.trim(), created_at: now, updated_at: now })
      .select('id, title').maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the topic: ' + error.message);
    return data;
  }

  async updateTopic(id: number, title: string) {
    await this.#db.from('knowledge_bases')
      .update({ title: title.trim(), updated_at: new Date().toISOString() }).eq('id', id);
  }

  async removeTopic(id: number): Promise<void> {
    await this.#db.from('knowledge_base_topicks').delete().eq('knowledge_base_id', id);
    await this.#db.from('knowledge_bases').delete().eq('id', id);
  }

  async createArticle(topicId: number, name: string, description: string) {
    const { data: topic } = await this.#db.from('knowledge_bases')
      .select('id').eq('id', topicId).maybeSingle();
    if (!topic) throw new HttpError(404, 'Topic not found.');

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('knowledge_base_topicks').insert({
      knowledge_base_id: topicId, topic_name: name.trim(),
      description, created_at: now, updated_at: now,
    }).select('id, topic_name').maybeSingle();
    if (error) throw new HttpError(500, 'Could not create the article: ' + error.message);
    return data;
  }

  async updateArticle(id: number, name: string, description: string) {
    await this.#db.from('knowledge_base_topicks').update({
      topic_name: name.trim(), description, updated_at: new Date().toISOString(),
    }).eq('id', id);
  }

  async removeArticle(id: number): Promise<void> {
    await this.#db.from('knowledge_base_topicks').delete().eq('id', id);
  }

  /** Search across article titles and bodies. */
  async search(term: string) {
    if (!term.trim()) return [];
    const like = '%' + term.trim() + '%';
    const { data } = await this.#db.from('knowledge_base_topicks')
      .select('id, knowledge_base_id, topic_name')
      .or('topic_name.ilike.' + like + ',description.ilike.' + like)
      .limit(25);
    return data ?? [];
  }
}
