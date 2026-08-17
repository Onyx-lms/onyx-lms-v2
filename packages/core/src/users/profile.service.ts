/**
 * A-06 / A-07 -- profile management for students and instructors.
 *
 * `educations` and `social_links` are JSON-as-text columns, so every write goes
 * through phpJsonEncode. Using JSON.stringify here would change the bytes and
 * break any Laravel screen still reading the same row.
 */
import type { Db } from '../db/client.ts';
import type { Database } from '@onyx/types';
import { phpJsonDecode, phpJsonEncode } from '../json/php-json.ts';
import { verifyPassword, hashPassword } from '../auth/password.ts';
import { HttpError } from '../http/errors.ts';

type UserUpdate = Database['public']['Tables']['users']['Update'];

export interface Education {
  degree?: string;
  institute?: string;
  year?: string;
  [k: string]: unknown;
}

export interface ProfileUpdate {
  name?: string;
  phone?: string;
  address?: string;
  about?: string;
  skills?: string[];
  facebook?: string;
  twitter?: string;
  linkedin?: string;
  website?: string;
}

export class ProfileService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  async get(userId: number) {
    const { data } = await this.#db.from('users')
      .select('id, name, email, role, phone, address, about, photo, skills, social_links, educations, facebook, twitter, linkedin, website, email_verified_at')
      .eq('id', userId).maybeSingle();
    if (!data) throw new HttpError(404, 'User not found.');
    return {
      ...data,
      skills: phpJsonDecode<string[]>(data.skills, []),
      social_links: phpJsonDecode<Record<string, string>>(data.social_links, {}),
      educations: phpJsonDecode<Education[]>(data.educations, []),
    };
  }

  async update(userId: number, patch: ProfileUpdate): Promise<void> {
    const row: UserUpdate = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.phone !== undefined) row.phone = patch.phone;
    if (patch.address !== undefined) row.address = patch.address;
    if (patch.about !== undefined) row.about = patch.about;
    if (patch.facebook !== undefined) row.facebook = patch.facebook;
    if (patch.twitter !== undefined) row.twitter = patch.twitter;
    if (patch.linkedin !== undefined) row.linkedin = patch.linkedin;
    if (patch.website !== undefined) row.website = patch.website;
    if (patch.skills !== undefined) row.skills = phpJsonEncode(patch.skills);

    const { error } = await this.#db.from('users').update(row).eq('id', userId);
    if (error) throw new HttpError(500, `Profile update failed: ${error.message}`);
  }

  async changePassword(userId: number, current: string, next: string): Promise<void> {
    const { data } = await this.#db
      .from('users').select('id, password').eq('id', userId).maybeSingle();
    if (!data) throw new HttpError(404, 'User not found.');

    if (!(await verifyPassword(current, data.password))) {
      throw new HttpError(422, 'The given data was invalid.', {
        errors: { current_password: ['The provided password does not match your current password.'] },
      });
    }
    const { error } = await this.#db.from('users')
      .update({ password: await hashPassword(next), updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) throw new HttpError(500, `Password change failed: ${error.message}`);
  }

  async setPhoto(userId: number, storedPath: string): Promise<void> {
    await this.#db.from('users')
      .update({ photo: storedPath, updated_at: new Date().toISOString() }).eq('id', userId);
  }

  // ---- A-07: instructor resume ----

  async educations(userId: number): Promise<Education[]> {
    const { data } = await this.#db
      .from('users').select('educations').eq('id', userId).maybeSingle();
    return phpJsonDecode<Education[]>(data?.educations ?? null, []);
  }

  async addEducation(userId: number, entry: Education): Promise<Education[]> {
    const list = [...(await this.educations(userId)), entry];
    await this.#saveEducations(userId, list);
    return list;
  }

  /** Laravel addressed resume rows by array index; same contract kept. */
  async updateEducation(userId: number, index: number, entry: Education): Promise<Education[]> {
    const list = await this.educations(userId);
    if (index < 0 || index >= list.length) throw new HttpError(404, 'Education entry not found.');
    list[index] = entry;
    await this.#saveEducations(userId, list);
    return list;
  }

  async removeEducation(userId: number, index: number): Promise<Education[]> {
    const list = await this.educations(userId);
    if (index < 0 || index >= list.length) throw new HttpError(404, 'Education entry not found.');
    list.splice(index, 1);
    await this.#saveEducations(userId, list);
    return list;
  }

  async #saveEducations(userId: number, list: Education[]): Promise<void> {
    const { error } = await this.#db.from('users')
      .update({ educations: phpJsonEncode(list), updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) throw new HttpError(500, `Resume update failed: ${error.message}`);
  }
}
