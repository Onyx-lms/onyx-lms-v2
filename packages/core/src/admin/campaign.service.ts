/**
 * SET-07 / SET-08 / SET-09 -- newsletter campaigns, the page builder, and
 * become-an-instructor applications.
 *
 * `newsletters` stores the campaign (subject, description). There is no
 * send-log column, so "sent" is not a state the schema can hold -- a campaign
 * is a draft you can send repeatedly, which is what the original did too.
 *
 * `applications` arrived in migration 0009: the model and controller exist in
 * Laravel but no migration ever created the table.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import type { MailService } from '../mail/mail.service.ts';
import type { SettingsService } from '../settings/settings.service.ts';

const APPLICATION_COLUMNS = 'id, user_id, phone, description, document, status, created_at, updated_at';

export class CampaignService {
  #db: Db;
  #mail: MailService | null;
  #settings: SettingsService;
  constructor(db: Db, settings: SettingsService, mail?: MailService) {
    this.#db = db;
    this.#settings = settings;
    this.#mail = mail ?? null;
  }

  // ---- SET-07: newsletters ----

  async campaigns() {
    const { data } = await this.#db.from('newsletters')
      .select('id, subject, description, created_at').order('id', { ascending: false });
    return data ?? [];
  }

  async createCampaign(subject: string, description: string) {
    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('newsletters')
      .insert({ subject: subject.trim(), description, created_at: now, updated_at: now })
      .select('id, subject, description, created_at').maybeSingle();
    if (error) throw new HttpError(500, 'Could not save the campaign: ' + error.message);
    return data;
  }

  async removeCampaign(id: number): Promise<void> {
    const { data } = await this.#db.from('newsletters')
      .select('id').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Campaign not found.');
    await this.#db.from('newsletters').delete().eq('id', id);
  }

  async subscribers() {
    const { data } = await this.#db.from('newsletter_subscribers')
      .select('id, email, created_at').order('id', { ascending: false });
    return data ?? [];
  }

  async removeSubscriber(id: number): Promise<void> {
    await this.#db.from('newsletter_subscribers').delete().eq('id', id);
  }

  /**
   * SET-07 -- send a campaign.
   *
   * Recipients are the subscriber list, optionally plus registered users. Mail
   * goes out in batches with the result of each recorded, so one bad address
   * does not abandon the rest of the run -- the original sent in one loop and
   * stopped at the first failure.
   */
  async send(id: number, opts: { includeUsers?: boolean; batchSize?: number } = {}) {
    if (!this.#mail) throw new HttpError(500, 'Mail is not configured on this server.');
    const { data: campaign } = await this.#db.from('newsletters')
      .select('id, subject, description').eq('id', id).maybeSingle();
    if (!campaign) throw new HttpError(404, 'Campaign not found.');

    const recipients = new Set<string>();
    for (const s of await this.subscribers()) {
      if (s.email) recipients.add(String(s.email).toLowerCase());
    }
    if (opts.includeUsers) {
      const { data: users } = await this.#db.from('users').select('email').eq('status', 1);
      for (const u of users ?? []) {
        if (u.email) recipients.add(String(u.email).toLowerCase());
      }
    }
    if (!recipients.size) throw new HttpError(422, 'There is nobody to send this to.');

    const subject = String(campaign.subject ?? '');
    const html = String(campaign.description ?? '');
    const batch = Math.max(1, Math.min(opts.batchSize ?? 25, 100));

    const list = [...recipients];
    let sent = 0;
    const failed: string[] = [];
    for (let i = 0; i < list.length; i += batch) {
      const slice = list.slice(i, i + batch);
      const results = await Promise.all(slice.map(async (to) => {
        const result = await this.#mail!.send({ to, subject, html });
        return { to, ok: result.sent };
      }));
      for (const r of results) {
        if (r.ok) sent++;
        else failed.push(r.to);
      }
    }
    return { recipients: list.length, sent, failed: failed.length, failed_addresses: failed.slice(0, 20) };
  }

  // ---- SET-08: page builder ----

  /**
   * builder_pages was empty and HomeController disabled the feature outright
   * ("Page builder disabled when schema incomplete"), so nothing here is a
   * port of working behaviour -- it is the CRUD the table was designed for.
   */
  async pages() {
    const { data } = await this.#db.from('builder_pages')
      .select('id, is_permanent, edit_home_id, identifier, name, status, created_at')
      .order('id');
    return data ?? [];
  }

  async page(id: number) {
    const { data } = await this.#db.from('builder_pages')
      .select('id, is_permanent, edit_home_id, identifier, name, html, status')
      .eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Page not found.');
    return data;
  }

  async savePage(input: {
    id?: number; identifier: string; name: string; html?: string;
    is_permanent?: number; status?: number;
  }) {
    const now = new Date().toISOString();
    if (input.id) {
      await this.page(input.id);
      await this.#db.from('builder_pages').update({
        identifier: input.identifier.trim(), name: input.name.trim(),
        html: input.html ?? '', status: input.status ?? 1, updated_at: now,
      }).eq('id', input.id);
      return this.page(input.id);
    }
    const { data, error } = await this.#db.from('builder_pages').insert({
      identifier: input.identifier.trim(), name: input.name.trim(),
      html: input.html ?? '', is_permanent: input.is_permanent ?? 0,
      status: input.status ?? 1, created_at: now, updated_at: now,
    }).select('id').maybeSingle();
    if (error) throw new HttpError(500, 'Could not save the page: ' + error.message);
    return this.page(data!.id);
  }

  async removePage(id: number): Promise<void> {
    const page = await this.page(id);
    // A permanent page is part of the shipped theme, not user content.
    if (page.is_permanent) throw new HttpError(422, 'That page cannot be deleted.');
    await this.#db.from('builder_pages').delete().eq('id', id);
  }

  // ---- SET-09: become-an-instructor ----

  /** The toggle that decides whether the form is offered at all. */
  async applicationsOpen(): Promise<boolean> {
    const value = await this.#settings.get('instructor_application');
    return value === null || (value !== '0' && value !== 'false' && value !== '');
  }

  async myApplication(userId: number) {
    const { data } = await this.#db.from('applications')
      .select(APPLICATION_COLUMNS).eq('user_id', userId)
      .order('id', { ascending: false }).limit(1);
    return (data ?? [])[0] ?? null;
  }

  async apply(userId: number, input: {
    phone: string; description: string; document: string;
  }) {
    if (!(await this.applicationsOpen())) {
      throw new HttpError(403, 'Instructor applications are closed.');
    }
    const { data: user } = await this.#db.from('users')
      .select('id, role').eq('id', userId).maybeSingle();
    if (!user) throw new HttpError(404, 'Account not found.');
    if (user.role === 'instructor' || user.role === 'admin') {
      throw new HttpError(422, 'You can already publish courses.');
    }

    const existing = await this.myApplication(userId);
    // Laravel refused any second application, even after a rejection; a
    // pending one is the thing that should block, so that is what blocks.
    if (existing && !existing.status) {
      throw new HttpError(422, 'Your request is in process. Please wait for admin to response.');
    }

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('applications').insert({
      user_id: userId,
      phone: input.phone.trim(),
      description: input.description.trim(),
      document: input.document,
      status: 0,
      created_at: now, updated_at: now,
    }).select(APPLICATION_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not submit your application: ' + error.message);
    return data;
  }

  async applications(status?: number) {
    let query = this.#db.from('applications')
      .select(APPLICATION_COLUMNS).order('id', { ascending: false });
    if (status !== undefined) query = query.eq('status', status);
    const { data } = await query;
    const rows = data ?? [];

    const ids = [...new Set(rows.map((r) => Number(r.user_id)).filter(Boolean))];
    const { data: users } = ids.length
      ? await this.#db.from('users').select('id, name, email, role').in('id', ids)
      : { data: [] };
    const byId = new Map((users ?? []).map((u) => [u.id, u]));
    return rows.map((r) => ({ ...r, user: byId.get(Number(r.user_id)) ?? null }));
  }

  /** SET-09 -- approving promotes the applicant to instructor. */
  async approve(id: number) {
    const { data } = await this.#db.from('applications')
      .select(APPLICATION_COLUMNS).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Application not found.');
    if (data.status) throw new HttpError(422, 'That application is already approved.');

    const now = new Date().toISOString();
    await this.#db.from('applications')
      .update({ status: 1, updated_at: now }).eq('id', id);
    // Laravel promoted only if the status update reported a change; here the
    // promotion is the point, so it always follows a successful approval.
    await this.#db.from('users')
      .update({ role: 'instructor', updated_at: now }).eq('id', Number(data.user_id));
    return { id, user_id: Number(data.user_id), role: 'instructor' };
  }

  async removeApplication(id: number): Promise<void> {
    const { data } = await this.#db.from('applications')
      .select('id').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'Application not found.');
    await this.#db.from('applications').delete().eq('id', id);
  }
}
