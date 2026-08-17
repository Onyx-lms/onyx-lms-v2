/**
 * A-09 -- admin user CRUD across all three roles.
 *
 * Uses insert-then-select so a photo-processing failure cannot lose the user
 * row, which was the bug documented in TEST_RESULTS.md on the Laravel side.
 */
import type { Db } from '../db/client.ts';
import type { Database } from '@onyx/types';
import { hashPassword } from '../auth/password.ts';
import { HttpError } from '../http/errors.ts';
import { paginate, type PageQuery, type Paginated } from '../http/pagination.ts';

type UserUpdate = Database['public']['Tables']['users']['Update'];

export type UserRole = 'admin' | 'instructor' | 'student';

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  phone?: string;
  address?: string;
  status?: number;
}

export interface UserListFilters {
  role?: UserRole;
  search?: string;
}

const LIST_COLUMNS = 'id, name, email, role, status, phone, photo, email_verified_at, created_at';

export class UsersService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async list(filters: UserListFilters, page: PageQuery, path: string): Promise<Paginated<unknown>> {
    let query = this.#db.from('users').select(LIST_COLUMNS, { count: 'exact' });
    if (filters.role) query = query.eq('role', filters.role);
    if (filters.search) {
      const term = `%${filters.search}%`;
      query = query.or(`name.ilike.${term},email.ilike.${term}`);
    }
    const { data, count, error } = await query
      .order('id', { ascending: false })
      .range(page.from, page.to);
    if (error) throw new HttpError(500, `User list failed: ${error.message}`);
    return paginate(data ?? [], count ?? 0, page, path);
  }

  async find(id: number) {
    const { data } = await this.#db.from('users').select(LIST_COLUMNS).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'User not found.');
    return data;
  }

  async create(input: CreateUserInput) {
    const email = input.email.trim().toLowerCase();
    const { data: taken } = await this.#db
      .from('users').select('id').eq('email', email).maybeSingle();
    if (taken) {
      throw new HttpError(422, 'The given data was invalid.', {
        errors: { email: ['The email has already been taken.'] },
      });
    }

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('users').insert({
      name: input.name.trim(),
      email,
      role: input.role,
      status: input.status ?? 1,
      phone: input.phone ?? null,
      address: input.address ?? null,
      password: await hashPassword(input.password),
      // Admin-created accounts are trusted; Laravel did the same.
      email_verified_at: now,
      created_at: now,
      updated_at: now,
    }).select(LIST_COLUMNS).maybeSingle();

    if (error) throw new HttpError(500, `User creation failed: ${error.message}`);
    return data;
  }

  async update(id: number, patch: Partial<CreateUserInput>) {
    const row: UserUpdate = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.phone !== undefined) row.phone = patch.phone;
    if (patch.address !== undefined) row.address = patch.address;
    if (patch.role !== undefined) row.role = patch.role;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.email !== undefined) {
      const email = patch.email.trim().toLowerCase();
      const { data: taken } = await this.#db
        .from('users').select('id').eq('email', email).maybeSingle();
      if (taken && taken.id !== id) {
        throw new HttpError(422, 'The given data was invalid.', {
          errors: { email: ['The email has already been taken.'] },
        });
      }
      row.email = email;
    }
    if (patch.password) row.password = await hashPassword(patch.password);

    const { error } = await this.#db.from('users').update(row).eq('id', id);
    if (error) throw new HttpError(500, `User update failed: ${error.message}`);
    return this.find(id);
  }

  /**
   * Deleting the root admin would leave the permission system with no bypass
   * and silently promote whoever holds the next-lowest id, so it is refused.
   */
  async remove(id: number, rootAdminId: number | null): Promise<void> {
    if (rootAdminId !== null && id === rootAdminId) {
      throw new HttpError(403, 'The root administrator cannot be deleted.');
    }
    const { error } = await this.#db.from('users').delete().eq('id', id);
    if (error) throw new HttpError(500, `User deletion failed: ${error.message}`);
  }
}
