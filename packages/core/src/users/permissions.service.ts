/**
 * A-08 -- sub-admin permissions.
 *
 * Ports is_root_admin(), is_permission() and admin_permission_store().
 *
 * NOTE ON A LARAVEL INCONSISTENCY: the original has two ways of finding the
 * root admin. is_root_admin() uses `User::limit(1)->orderBy('id','asc')` (the
 * lowest id), while has_permission() uses `User::firstOrNew()->id` (unordered,
 * so whatever the engine returns first). Those can disagree.
 *
 * We implement the ORDERED version everywhere, because the unordered one makes
 * root-admin identity depend on physical row order -- meaning deleting user 1
 * could silently promote somebody else. Documented here so the divergence is a
 * decision, not a bug.
 */
import type { Db } from '../db/client.ts';
import { phpJsonDecode, phpJsonEncode } from '../json/php-json.ts';

export class PermissionsService {
  #db: Db;
  #rootAdminId: number | null = null;
  constructor(db: Db) { this.#db = db; }

  async rootAdminId(): Promise<number | null> {
    if (this.#rootAdminId !== null) return this.#rootAdminId;
    const { data } = await this.#db
      .from('users').select('id').order('id', { ascending: true }).limit(1).maybeSingle();
    this.#rootAdminId = data?.id ?? null;
    return this.#rootAdminId;
  }

  async isRootAdmin(userId: number): Promise<boolean> {
    return (await this.rootAdminId()) === userId;
  }

  /** Permission list for a sub-admin, decoded from the JSON-as-text column. */
  async listFor(userId: number): Promise<string[]> {
    const { data } = await this.#db
      .from('permissions').select('permissions').eq('admin_id', userId).maybeSingle();
    const parsed = phpJsonDecode<unknown>(data?.permissions ?? null, []);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  }

  /** is_permission($route, $admin_id) -- root admin bypasses all checks. */
  async can(userId: number, routeName: string): Promise<boolean> {
    if (await this.isRootAdmin(userId)) return true;
    return (await this.listFor(userId)).includes(routeName);
  }

  /** admin_permission_store() -- toggles a single route on or off. */
  async toggle(userId: number, routeName: string): Promise<string[]> {
    const current = await this.listFor(userId);
    const next = current.includes(routeName)
      ? current.filter((p) => p !== routeName)
      : [...current, routeName];

    const { data: existing } = await this.#db
      .from('permissions').select('id').eq('admin_id', userId).maybeSingle();

    const payload = phpJsonEncode(next); // byte-compatible with Laravel
    const { error } = existing
      ? await this.#db.from('permissions').update({ permissions: payload }).eq('admin_id', userId)
      : await this.#db.from('permissions').insert({ admin_id: userId, permissions: payload });
    if (error) throw new Error(`permissions.toggle failed: ${error.message}`);
    return next;
  }

  async replace(userId: number, routeNames: string[]): Promise<void> {
    const payload = phpJsonEncode(routeNames);
    const { data: existing } = await this.#db
      .from('permissions').select('id').eq('admin_id', userId).maybeSingle();
    const { error } = existing
      ? await this.#db.from('permissions').update({ permissions: payload }).eq('admin_id', userId)
      : await this.#db.from('permissions').insert({ admin_id: userId, permissions: payload });
    if (error) throw new Error(`permissions.replace failed: ${error.message}`);
  }

  invalidate(): void { this.#rootAdminId = null; }
}
