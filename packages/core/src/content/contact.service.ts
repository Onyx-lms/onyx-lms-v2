/**
 * C-08 -- contact form and newsletter signup.
 * M-06 -- the admin side of the contact inbox.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import type { MailService } from '../mail/mail.service.ts';
import { contactReplyTemplate } from '../mail/templates.ts';
import type { SettingsService } from '../settings/settings.service.ts';

export interface ContactInput {
  name: string;
  email: string;
  phone?: string;
  address?: string;
  message: string;
}

const CONTACT_COLUMNS = 'id, name, email, phone, address, message, has_read, replied, created_at';

export class ContactService {
  #db: Db;
  #mail: MailService | null;
  #settings: SettingsService | null;

  constructor(db: Db, mail?: MailService, settings?: SettingsService) {
    this.#db = db;
    this.#mail = mail ?? null;
    this.#settings = settings ?? null;
  }

  async submit(input: ContactInput): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.#db.from('contacts').insert({
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone ?? null,
      address: input.address ?? null,
      message: input.message.trim(),
      has_read: 0,
      replied: 0,
      created_at: now,
      updated_at: now,
    });
    if (error) throw new HttpError(500, `Contact submission failed: ${error.message}`);
  }

  /**
   * M-06 -- the admin list.
   *
   * Laravel marked everything read on every page load, before filtering. That
   * is kept: opening the inbox is what "reading" means here, and a search must
   * not leave unsearched enquiries looking new. What is not kept is the
   * `where('has_read', null)` predicate -- new rows are written with 0, not
   * null, so the original update matched nothing and the badge never cleared.
   */
  async list(search?: string) {
    await this.#db.from('contacts')
      .update({ has_read: 1, updated_at: new Date().toISOString() }).eq('has_read', 0);

    let query = this.#db.from('contacts').select(CONTACT_COLUMNS);
    if (search?.trim()) {
      const like = '%' + search.trim() + '%';
      query = query.or('name.ilike.' + like + ',email.ilike.' + like
        + ',phone.ilike.' + like + ',address.ilike.' + like + ',message.ilike.' + like);
    }
    const { data, error } = await query.order('id', { ascending: false });
    if (error) throw new HttpError(500, 'contacts.list failed: ' + error.message);
    return data ?? [];
  }

  async find(id: number) {
    const { data } = await this.#db.from('contacts')
      .select(CONTACT_COLUMNS).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Contact not found.');
    return data;
  }

  /** M-06 -- reply by email, then flag the enquiry as replied. */
  async reply(id: number, message: string, subject?: string) {
    const contact = await this.find(id) as { email: string | null };
    if (!contact.email) throw new HttpError(422, 'This enquiry has no email address.');
    if (!this.#mail) throw new HttpError(500, 'Mail is not configured on this server.');

    const siteTitle = (await this.#settings?.get('system_title')) || 'Support';
    const template = contactReplyTemplate(siteTitle, message);
    const result = await this.#mail.send({
      to: contact.email,
      // Laravel sent the raw body with the site title as the subject; an admin
      // may override it, otherwise the shared reply template names the site.
      subject: subject?.trim() || template.subject,
      html: template.html,
      text: message,
    });
    // The original flipped `replied` whether or not the mail went out, so a
    // failed send looked answered. Only a delivered mail marks it replied.
    if (!result.sent) {
      throw new HttpError(502, 'The reply could not be sent: ' + (result.error ?? 'unknown error'));
    }

    await this.#db.from('contacts')
      .update({ replied: 1, has_read: 1, updated_at: new Date().toISOString() }).eq('id', id);
    return this.find(id);
  }

  async remove(id: number): Promise<void> {
    await this.find(id);
    const { error } = await this.#db.from('contacts').delete().eq('id', id);
    if (error) throw new HttpError(500, 'contacts.delete failed: ' + error.message);
  }
}

export class NewsletterService {
  #db: Db;
  constructor(db: Db) { this.#db = db; }

  /**
   * @returns false when the address was already subscribed. Re-subscribing is
   * not an error -- the UI shows the same confirmation either way so the form
   * cannot be used to probe who is on the list.
   */
  async subscribe(email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    const { data: existing } = await this.#db
      .from('newsletter_subscribers').select('id').eq('email', normalized).maybeSingle();
    if (existing) return false;

    const now = new Date().toISOString();
    const { error } = await this.#db
      .from('newsletter_subscribers').insert({ email: normalized, created_at: now, updated_at: now });
    if (error) throw new HttpError(500, `Subscription failed: ${error.message}`);
    return true;
  }
}
