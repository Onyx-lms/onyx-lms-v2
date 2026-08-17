/**
 * TP-03 / TP-04 -- buying a package, and filling its seats.
 *
 * TWO DEFECTS IN THE ORIGINAL, NOT CARRIED OVER.
 *
 * 1. Seats were shared between unrelated buyers.
 *    `reserved_team_members($package_id)` counts every row in
 *    team_package_members for the package, with no leader filter, and
 *    MyTeamPackageController compares that against `allocation`. Two customers
 *    who buy the same package therefore share ONE pool of seats: the second
 *    buyer can be locked out entirely by the first. Seats are counted per
 *    leader here, which is what buying a package is supposed to give you.
 *
 * 2. Removing a member deleted ANY enrolment on the course.
 *      Enrollment::where('course_id', ...)->where('user_id', ...)->delete();
 *    If the member had also bought that course themselves, taking them out of
 *    the classroom destroyed the enrolment they paid for. Only the enrolment
 *    this package granted (enrollment_type = 'team_package') is removed here.
 */
import type { Db } from '../db/client.ts';
import { HttpError } from '../http/errors.ts';
import type { SettingsService } from '../settings/settings.service.ts';

const MEMBER_COLUMNS = 'id, leader_id, team_package_id, member_id, created_at';
const PURCHASE_COLUMNS = 'id, user_id, package_id, price, tax, payment_method, invoice, payment_details, instructor_revenue, admin_revenue, status, created_at';

export class TeamMemberService {
  #db: Db;
  #settings: SettingsService;
  constructor(db: Db, settings: SettingsService) {
    this.#db = db;
    this.#settings = settings;
  }

  // ---- TP-03: purchase ----

  async hasPurchased(packageId: number, userId: number): Promise<boolean> {
    const { data } = await this.#db.from('team_package_purchases')
      .select('id').eq('package_id', packageId).eq('user_id', userId)
      .eq('status', 1).maybeSingle();
    return Boolean(data);
  }

  async purchasesFor(userId: number) {
    const { data } = await this.#db.from('team_package_purchases')
      .select(PURCHASE_COLUMNS).eq('user_id', userId).eq('status', 1)
      .order('id', { ascending: false });
    const rows = data ?? [];
    if (!rows.length) return [];

    const ids = [...new Set(rows.map((r) => Number(r.package_id)))];
    const { data: packages } = await this.#db.from('team_training_packages')
      .select('id, title, slug, thumbnail, course_id, allocation, expiry_type, expiry_date')
      .in('id', ids);
    const byId = new Map((packages ?? []).map((p) => [p.id, p]));

    // Seats used is per leader, so it is computed for this buyer only.
    return Promise.all(rows.map(async (r) => ({
      ...r,
      package: byId.get(Number(r.package_id)) ?? null,
      seats_used: await this.reservedSeats(Number(r.package_id), userId),
    })));
  }

  async byInvoice(invoice: string, userId: number, isAdmin: boolean) {
    const { data } = await this.#db.from('team_package_purchases')
      .select(PURCHASE_COLUMNS).eq('invoice', invoice).maybeSingle();
    if (!data) throw new HttpError(404, 'Invoice not found.');
    if (!isAdmin && Number(data.user_id) !== userId) {
      throw new HttpError(404, 'Invoice not found.');
    }
    const { data: pkg } = await this.#db.from('team_training_packages')
      .select('id, title, slug').eq('id', Number(data.package_id)).maybeSingle();
    const { data: buyer } = await this.#db.from('users')
      .select('id, name, email').eq('id', Number(data.user_id)).maybeSingle();
    return { ...data, package: pkg ?? null, user: buyer ?? null };
  }

  async record(input: {
    packageId: number; userId: number; invoice: string;
    price: number; tax?: number; paymentMethod: string; paymentDetails?: string | null;
  }) {
    const pkg = await this.#requirePurchasable(input.packageId, input.userId);

    const percent = Number((await this.#settings.get('instructor_revenue')) ?? 0);
    const instructorRevenue = pkg.pricing_type === 1
      ? Math.round(input.price * (percent / 100) * 100) / 100
      : 0;
    const adminRevenue = Math.round((input.price - instructorRevenue) * 100) / 100;

    const now = new Date().toISOString();
    const { data, error } = await this.#db.from('team_package_purchases').insert({
      user_id: input.userId,
      package_id: input.packageId,
      price: input.price,
      tax: input.tax ?? 0,
      payment_method: input.paymentMethod,
      invoice: input.invoice,
      payment_details: input.paymentDetails ?? null,
      instructor_revenue: instructorRevenue,
      admin_revenue: adminRevenue,
      status: 1,
      created_at: now, updated_at: now,
    }).select(PURCHASE_COLUMNS).maybeSingle();
    if (error) throw new HttpError(500, 'Could not record the purchase: ' + error.message);
    return data;
  }

  async claimFree(packageId: number, userId: number, invoice: string) {
    const pkg = await this.#requirePurchasable(packageId, userId);
    if (pkg.pricing_type === 1) throw new HttpError(422, 'This package is not free.');
    return this.record({
      packageId, userId, invoice, price: 0, tax: 0, paymentMethod: 'free',
    });
  }

  async #requirePurchasable(packageId: number, userId: number) {
    const { data: pkg } = await this.#db.from('team_training_packages')
      .select('id, user_id, pricing_type, price, status, allocation, course_id')
      .eq('id', packageId).maybeSingle();
    if (!pkg || pkg.status !== 1) throw new HttpError(404, 'Package not found.');
    if (Number(pkg.user_id) === userId) throw new HttpError(422, 'You own this item.');
    if (await this.hasPurchased(packageId, userId)) {
      throw new HttpError(422, 'Item is already purchased.');
    }
    return pkg;
  }

  // ---- TP-04: seats and members ----

  /**
   * Ports reserved_team_members(), but scoped to one leader.
   *
   * The original counted every member of the package regardless of who added
   * them, so a second buyer inherited the first buyer's used seats.
   */
  async reservedSeats(packageId: number, leaderId: number): Promise<number> {
    const { count } = await this.#db.from('team_package_members')
      .select('id', { count: 'exact', head: true })
      .eq('team_package_id', packageId).eq('leader_id', leaderId);
    return count ?? 0;
  }

  async members(packageId: number, leaderId: number) {
    const { data } = await this.#db.from('team_package_members')
      .select(MEMBER_COLUMNS)
      .eq('team_package_id', packageId).eq('leader_id', leaderId).order('id');
    const rows = data ?? [];
    if (!rows.length) return [];

    const ids = [...new Set(rows.map((r) => Number(r.member_id)))];
    const { data: users } = await this.#db.from('users')
      .select('id, name, email, photo').in('id', ids);
    const byId = new Map((users ?? []).map((u) => [u.id, u]));
    return rows.map((r) => ({ ...r, member: byId.get(Number(r.member_id)) ?? null }));
  }

  /** TP-04 -- find someone to add, flagging who is already in the classroom. */
  async searchCandidates(packageId: number, leaderId: number, term: string, limit = 10) {
    const needle = term.trim();
    if (!needle) return [];
    const like = '%' + needle + '%';
    const { data } = await this.#db.from('users')
      .select('id, name, email, photo')
      .or('name.ilike.' + like + ',email.ilike.' + like)
      .limit(limit + 2);

    const existing = new Set((await this.members(packageId, leaderId))
      .map((m) => Number(m.member_id)));
    return (data ?? [])
      // A leader is not a member of their own classroom.
      .filter((u) => u.id !== leaderId)
      .slice(0, limit)
      .map((u) => ({ ...u, already_member: existing.has(u.id) }));
  }

  /**
   * TP-04 -- add a member and grant them the course.
   *
   * An existing enrolment is extended rather than replaced, keeping whichever
   * expiry is further out, exactly as Laravel did.
   */
  async addMember(packageId: number, leaderId: number, memberId: number) {
    const pkg = await this.#requireLeader(packageId, leaderId);
    if (memberId === leaderId) {
      throw new HttpError(422, 'You cannot add yourself to your own classroom.');
    }
    const { data: user } = await this.#db.from('users')
      .select('id').eq('id', memberId).maybeSingle();
    if (!user) throw new HttpError(404, 'That person does not exist.');

    const { data: already } = await this.#db.from('team_package_members')
      .select('id').eq('team_package_id', packageId)
      .eq('leader_id', leaderId).eq('member_id', memberId).maybeSingle();
    if (already) throw new HttpError(422, 'Member already exists in the classroom.');

    if (await this.reservedSeats(packageId, leaderId) >= Number(pkg.allocation)) {
      throw new HttpError(422, 'Not enough space to add a member.');
    }

    const now = new Date().toISOString();
    const { error } = await this.#db.from('team_package_members').insert({
      leader_id: leaderId, team_package_id: packageId, member_id: memberId,
      created_at: now, updated_at: now,
    });
    if (error) throw new HttpError(500, 'Could not add the member: ' + error.message);

    await this.#grantCourse(pkg, memberId);
    return { added: true };
  }

  async #grantCourse(pkg: {
    course_id: number | null; expiry_type: string | null; expiry_date: number | null;
  }, memberId: number): Promise<void> {
    const courseId = Number(pkg.course_id);
    if (!courseId) return;

    const limited = pkg.expiry_type === 'limited' && pkg.expiry_date != null;
    // team_training_packages.expiry_date is a UNIX INTEGER, but
    // enrollments.expiry_date is a datetime. Laravel wrote the raw integer into
    // the datetime column, which SQLite tolerated and Postgres will not.
    const expiryMs = limited ? Number(pkg.expiry_date) * 1000 : null;

    const { data: existing } = await this.#db.from('enrollments')
      .select('id, expiry_date, enrollment_type')
      .eq('course_id', courseId).eq('user_id', memberId).maybeSingle();

    const now = new Date().toISOString();
    if (!existing) {
      await this.#db.from('enrollments').insert({
        course_id: courseId, user_id: memberId,
        enrollment_type: 'team_package',
        entry_date: Math.floor(Date.now() / 1000),
        expiry_date: expiryMs === null ? null : new Date(expiryMs).toISOString(),
        created_at: now, updated_at: now,
      } as never);
      return;
    }
    // Already enrolled: keep whichever access runs longer, and never shorten it.
    // A null expiry is lifetime, which always wins.
    if (expiryMs !== null && existing.expiry_date != null) {
      const current = new Date(String(existing.expiry_date)).getTime();
      if (Number.isFinite(current) && expiryMs > current) {
        await this.#db.from('enrollments')
          .update({ expiry_date: new Date(expiryMs).toISOString(), updated_at: now })
          .eq('id', existing.id);
      }
    }
  }

  /**
   * TP-04 -- remove a member.
   *
   * Only an enrolment this package granted is withdrawn. The original deleted
   * any enrolment on the course, destroying access the member had bought.
   */
  async removeMember(packageId: number, leaderId: number, memberId: number) {
    const pkg = await this.#requireLeader(packageId, leaderId);

    const { data: row } = await this.#db.from('team_package_members')
      .select('id').eq('team_package_id', packageId)
      .eq('leader_id', leaderId).eq('member_id', memberId).maybeSingle();
    if (!row) throw new HttpError(404, 'Member not found in the classroom.');

    await this.#db.from('team_package_members').delete().eq('id', row.id);

    const courseId = Number(pkg.course_id);
    if (courseId) {
      await this.#db.from('enrollments').delete()
        .eq('course_id', courseId).eq('user_id', memberId)
        .eq('enrollment_type', 'team_package');
    }
    return { removed: true };
  }

  /** The package, if this user actually bought it. */
  async #requireLeader(packageId: number, leaderId: number) {
    const { data: pkg } = await this.#db.from('team_training_packages')
      .select('id, user_id, course_id, allocation, expiry_type, expiry_date, status')
      .eq('id', packageId).maybeSingle();
    if (!pkg) throw new HttpError(404, 'Package not found.');
    if (!(await this.hasPurchased(packageId, leaderId))) {
      throw new HttpError(403, 'Forbidden! Access denied.');
    }
    return pkg;
  }
}
