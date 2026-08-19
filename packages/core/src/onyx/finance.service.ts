/**
 * CMP-03 -- fee structures, invoicing, payment and reconciliation.
 *
 * Two acceptance criteria, and both are about a document staying true:
 *
 *   * "An invoice's lines reconcile to the fee structure that produced it."
 *   * "A replayed webhook never double-credits an invoice."
 *
 * **Lines are copied, not joined.** An invoice raised in June against a
 * structure edited in August must still show June's numbers -- somebody has
 * already paid against it. So issuing copies each line onto the invoice, and
 * `reconcile()` compares the copy against the structure and reports the
 * difference rather than hiding it. A drift is not a bug here; it is what
 * happens when fees change, and the useful thing is to be able to see it.
 *
 * **Idempotency is a unique constraint, not a check.** A gateway replays
 * webhooks -- that is normal operation. `UNIQUE (tenant_id, gateway, reference)`
 * means the second insert cannot happen, so the replay path is a lookup that
 * returns the original payment. Doing it with "select, then insert if absent"
 * would leave a window between the two, and payment webhooks arrive in pairs
 * precisely often enough to find it.
 *
 * **Money is integer minor units throughout.** Rupees in a float is a rounding
 * error waiting for a reconciliation report to discover it.
 */
import type { OnyxDb } from './db.ts';
import type { Role } from '@onyx/types';
import { HttpError } from '../http/errors.ts';
import type { AuditService } from './audit.service.ts';

const HEAD_COLUMNS = 'id, tenant_id, code, name, category, refundable, created_at';
const STRUCTURE_COLUMNS = 'id, tenant_id, program_id, semester_id, name, currency, instalments, status, created_at, updated_at';
const STRUCTURE_LINE_COLUMNS = 'id, tenant_id, structure_id, head_id, amount_minor, created_at';
const INVOICE_COLUMNS = 'id, tenant_id, user_id, structure_id, number, instalment_no, currency, total_minor, paid_minor, status, due_at, issued_at, created_at, updated_at';
const INVOICE_LINE_COLUMNS = 'id, tenant_id, invoice_id, head_id, description, amount_minor, created_at';
const PAYMENT_COLUMNS = 'id, tenant_id, invoice_id, user_id, gateway, reference, amount_minor, currency, status, method, raw, captured_at, created_at';

const FINANCE: Role[] = ['admin'];
const canManageFees = (role: Role) => FINANCE.includes(role);

/** Paise to a readable string. Presentation only; nothing is stored this way. */
export const formatMinor = (minor: number, currency = 'INR') =>
  currency + ' ' + (minor / 100).toFixed(2);

export class FinanceService {
  #db: OnyxDb;
  #audit: AuditService;
  #now: () => number;

  constructor(db: OnyxDb, audit: AuditService, now: () => number = Date.now) {
    this.#db = db;
    this.#audit = audit;
    this.#now = now;
  }

  // -------------------------------------------------------------------------
  // Heads and structures
  // -------------------------------------------------------------------------

  async createHead(tenantId: number, actor: { role: Role }, input: {
    code: string; name: string;
    category?: 'tuition' | 'exam' | 'hostel' | 'transport' | 'library' | 'misc';
    refundable?: boolean;
  }) {
    if (!canManageFees(actor.role)) throw new HttpError(403, 'Only an administrator can define fees.');
    const code = input.code.trim().toUpperCase();
    if (!code) throw new HttpError(422, 'A fee head needs a code.');

    const { data, error } = await this.#db.from('onyx_fee_heads').insert({
      tenant_id: tenantId, code, name: input.name.trim(),
      category: input.category ?? 'tuition', refundable: input.refundable ?? false,
    }).select(HEAD_COLUMNS).maybeSingle();
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        throw new HttpError(409, 'A fee head with the code ' + code + ' already exists.');
      }
      throw new HttpError(500, 'Could not create the fee head: ' + error.message);
    }
    return data;
  }

  async heads(tenantId: number) {
    const { data } = await this.#db.from('onyx_fee_heads').select(HEAD_COLUMNS)
      .eq('tenant_id', tenantId).order('code', { ascending: true });
    return data ?? [];
  }

  async createStructure(tenantId: number, actor: { userId: string; role: Role }, input: {
    name: string; program_id?: number | null; semester_id?: number | null;
    instalments?: number; currency?: string;
    lines: { head_id: number; amount_minor: number }[];
  }) {
    if (!canManageFees(actor.role)) throw new HttpError(403, 'Only an administrator can define fees.');
    if (!input.lines.length) throw new HttpError(422, 'A fee structure needs at least one line.');
    const instalments = input.instalments ?? 1;
    if (instalments < 1 || instalments > 12) {
      throw new HttpError(422, 'Instalments must be between 1 and 12.');
    }

    const heads = await this.heads(tenantId);
    const known = new Set(heads.map((h) => Number(h.id)));
    for (const line of input.lines) {
      if (!known.has(Number(line.head_id))) {
        throw new HttpError(422, 'No such fee head: ' + line.head_id + '.');
      }
      if (!Number.isInteger(line.amount_minor) || line.amount_minor < 0) {
        throw new HttpError(422, 'An amount is a whole number of paise, and not negative.');
      }
    }

    const { data, error } = await this.#db.from('onyx_fee_structures').insert({
      tenant_id: tenantId,
      program_id: input.program_id ?? null,
      semester_id: input.semester_id ?? null,
      name: input.name.trim(),
      currency: input.currency ?? 'INR',
      instalments,
      status: 'draft',
    }).select(STRUCTURE_COLUMNS).maybeSingle();
    if (error || !data) {
      throw new HttpError(500, 'Could not create the structure: ' + (error?.message ?? 'no row'));
    }

    const { error: lineError } = await this.#db.from('onyx_fee_structure_lines').insert(
      input.lines.map((l) => ({
        tenant_id: tenantId, structure_id: Number(data.id),
        head_id: l.head_id, amount_minor: l.amount_minor,
      })));
    if (lineError) {
      if (/duplicate key|unique/i.test(lineError.message)) {
        throw new HttpError(422, 'The same fee head appears twice in that structure.');
      }
      throw new HttpError(500, 'Could not write the lines: ' + lineError.message);
    }

    await this.#audit.record(
      { tenant_id: tenantId, user_id: actor.userId },
      { action: 'fee.updated', entityType: 'fee_structure', entityId: Number(data.id),
        after: { name: data.name, lines: input.lines.length } });
    return data;
  }

  async structure(tenantId: number, id: number) {
    const { data } = await this.#db.from('onyx_fee_structures').select(STRUCTURE_COLUMNS)
      .eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'No such fee structure.');

    const { data: lines } = await this.#db.from('onyx_fee_structure_lines')
      .select(STRUCTURE_LINE_COLUMNS)
      .eq('tenant_id', tenantId).eq('structure_id', id).order('id', { ascending: true });

    const heads = await this.heads(tenantId);
    const byId = new Map(heads.map((h) => [Number(h.id), h]));

    const withNames = (lines ?? []).map((l) => ({
      ...l,
      head_code: byId.get(Number(l.head_id))?.code ?? null,
      head_name: byId.get(Number(l.head_id))?.name ?? null,
    }));

    return {
      ...data,
      lines: withNames,
      total_minor: withNames.reduce((sum, l) => sum + Number(l.amount_minor), 0),
    };
  }

  async structures(tenantId: number) {
    const { data } = await this.#db.from('onyx_fee_structures').select(STRUCTURE_COLUMNS)
      .eq('tenant_id', tenantId).order('id', { ascending: false });
    return data ?? [];
  }

  async publishStructure(tenantId: number, id: number, actor: { userId: string; role: Role }) {
    if (!canManageFees(actor.role)) throw new HttpError(403, 'Only an administrator can publish fees.');
    const structure = await this.structure(tenantId, id);
    if (!structure.lines.length) throw new HttpError(422, 'That structure has no lines.');

    const { data } = await this.#db.from('onyx_fee_structures')
      .update({ status: 'published', updated_at: new Date(this.#now()).toISOString() })
      .eq('tenant_id', tenantId).eq('id', id).select(STRUCTURE_COLUMNS).maybeSingle();
    return data;
  }

  // -------------------------------------------------------------------------
  // Invoicing
  // -------------------------------------------------------------------------

  /**
   * Raise one instalment of a structure against one learner.
   *
   * The lines are copied onto the invoice here. Dividing across instalments
   * uses integer division with the remainder on the first instalment, so the
   * instalments always sum back to the total -- three-way splits of an odd
   * number are where a rupee usually goes missing.
   */
  async issueInvoice(tenantId: number, actor: { userId: string; role: Role }, input: {
    user_id: string; structure_id: number; instalment_no?: number; due_at?: string | null;
  }) {
    if (!canManageFees(actor.role)) throw new HttpError(403, 'Only an administrator can raise an invoice.');
    const structure = await this.structure(tenantId, input.structure_id);
    if (structure.status !== 'published') {
      throw new HttpError(422, 'That fee structure is still a draft.');
    }

    const { data: membership } = await this.#db.from('onyx_memberships').select('id')
      .eq('tenant_id', tenantId).eq('user_id', input.user_id).eq('status', 1).maybeSingle();
    if (!membership) throw new HttpError(404, 'No such member of this institution.');

    const instalmentNo = input.instalment_no ?? 1;
    const instalments = Number(structure.instalments);
    if (instalmentNo < 1 || instalmentNo > instalments) {
      throw new HttpError(422, 'That structure has ' + instalments + ' instalment'
        + (instalments === 1 ? '' : 's') + '.');
    }

    const { data: already } = await this.#db.from('onyx_invoices').select('id')
      .eq('tenant_id', tenantId).eq('user_id', input.user_id)
      .eq('structure_id', input.structure_id).eq('instalment_no', instalmentNo)
      .neq('status', 'void').maybeSingle();
    if (already) {
      throw new HttpError(409, 'Instalment ' + instalmentNo
        + ' has already been raised for that learner (invoice ' + already.id + ').');
    }

    // Split each line, remainder on the first instalment so the parts sum back.
    const lines = structure.lines.map((l) => {
      const base = Math.floor(Number(l.amount_minor) / instalments);
      const remainder = Number(l.amount_minor) - base * instalments;
      return {
        head_id: Number(l.head_id),
        description: (l.head_name ?? 'Fee') + (instalments > 1
          ? ' (instalment ' + instalmentNo + ' of ' + instalments + ')' : ''),
        amount_minor: base + (instalmentNo === 1 ? remainder : 0),
      };
    });
    const total = lines.reduce((sum, l) => sum + l.amount_minor, 0);

    const number = 'INV-' + tenantId + '-' + Date.now().toString(36).toUpperCase()
      + '-' + instalmentNo;

    const { data: invoice, error } = await this.#db.from('onyx_invoices').insert({
      tenant_id: tenantId,
      user_id: input.user_id,
      structure_id: input.structure_id,
      number,
      instalment_no: instalmentNo,
      currency: structure.currency,
      total_minor: total,
      paid_minor: 0,
      status: 'issued',
      due_at: input.due_at ?? null,
    }).select(INVOICE_COLUMNS).maybeSingle();
    if (error || !invoice) {
      throw new HttpError(500, 'Could not raise the invoice: ' + (error?.message ?? 'no row'));
    }

    await this.#db.from('onyx_invoice_lines').insert(lines.map((l) => ({
      tenant_id: tenantId, invoice_id: Number(invoice.id),
      head_id: l.head_id, description: l.description, amount_minor: l.amount_minor,
    })));

    await this.#audit.record(
      { tenant_id: tenantId, user_id: actor.userId },
      { action: 'invoice.issued', entityType: 'invoice', entityId: Number(invoice.id),
        after: { number, user_id: input.user_id, total_minor: total } });
    return invoice;
  }

  async invoice(tenantId: number, id: number, viewer: { userId: string; role: Role }) {
    const { data } = await this.#db.from('onyx_invoices').select(INVOICE_COLUMNS)
      .eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!data) throw new HttpError(404, 'No such invoice.');
    if (String(data.user_id) !== viewer.userId && !canManageFees(viewer.role)) {
      throw new HttpError(403, 'That invoice is not yours.');
    }

    const [{ data: lines }, { data: payments }] = await Promise.all([
      this.#db.from('onyx_invoice_lines').select(INVOICE_LINE_COLUMNS)
        .eq('tenant_id', tenantId).eq('invoice_id', id).order('id', { ascending: true }),
      this.#db.from('onyx_payments').select(PAYMENT_COLUMNS)
        .eq('tenant_id', tenantId).eq('invoice_id', id).order('id', { ascending: true }),
    ]);

    return { ...data, lines: lines ?? [], payments: payments ?? [] };
  }

  async invoicesFor(tenantId: number, userId: string, viewer: { userId: string; role: Role }) {
    if (userId !== viewer.userId && !canManageFees(viewer.role)) {
      throw new HttpError(403, 'Those are not your invoices.');
    }
    const { data } = await this.#db.from('onyx_invoices').select(INVOICE_COLUMNS)
      .eq('tenant_id', tenantId).eq('user_id', userId).order('issued_at', { ascending: false });
    return data ?? [];
  }

  /**
   * Does this invoice still add up, and does it still match its structure?
   *
   * Three answers rather than one boolean, because they fail for different
   * reasons: the lines might not sum to the header (a bug), or the structure
   * might have changed since (normal, and worth seeing).
   */
  async reconcile(tenantId: number, invoiceId: number, viewer: { role: Role }) {
    if (!canManageFees(viewer.role)) throw new HttpError(403, 'Only an administrator can reconcile.');

    const { data: invoice } = await this.#db.from('onyx_invoices').select(INVOICE_COLUMNS)
      .eq('tenant_id', tenantId).eq('id', invoiceId).maybeSingle();
    if (!invoice) throw new HttpError(404, 'No such invoice.');

    const { data: lines } = await this.#db.from('onyx_invoice_lines').select(INVOICE_LINE_COLUMNS)
      .eq('tenant_id', tenantId).eq('invoice_id', invoiceId);
    const lineTotal = (lines ?? []).reduce((sum, l) => sum + Number(l.amount_minor), 0);

    const { data: payments } = await this.#db.from('onyx_payments').select(PAYMENT_COLUMNS)
      .eq('tenant_id', tenantId).eq('invoice_id', invoiceId).eq('status', 'captured');
    const captured = (payments ?? []).reduce((sum, p) => sum + Number(p.amount_minor), 0);

    let structureTotal: number | null = null;
    let matchesStructure: boolean | null = null;
    if (invoice.structure_id) {
      const structure = await this.structure(tenantId, Number(invoice.structure_id));
      const instalments = Number(structure.instalments);
      const share = structure.lines.reduce((sum, l) => {
        const base = Math.floor(Number(l.amount_minor) / instalments);
        const remainder = Number(l.amount_minor) - base * instalments;
        return sum + base + (Number(invoice.instalment_no) === 1 ? remainder : 0);
      }, 0);
      structureTotal = share;
      matchesStructure = share === Number(invoice.total_minor);
    }

    return {
      invoice_id: invoiceId,
      number: invoice.number,
      header_total_minor: Number(invoice.total_minor),
      line_total_minor: lineTotal,
      /** The invariant that must always hold: lines sum to the header. */
      lines_balance: lineTotal === Number(invoice.total_minor),
      structure_total_minor: structureTotal,
      /** False after a fee change. Informational, not an error. */
      matches_structure: matchesStructure,
      captured_minor: captured,
      recorded_paid_minor: Number(invoice.paid_minor),
      payments_balance: captured === Number(invoice.paid_minor),
    };
  }

  // -------------------------------------------------------------------------
  // CMP-03b: payment
  // -------------------------------------------------------------------------

  /**
   * Record a captured payment against an invoice.
   *
   * Idempotent on (gateway, reference). A replay finds the unique violation,
   * looks the original up, and returns it with `replayed: true` -- the invoice
   * is not touched a second time.
   */
  async recordPayment(tenantId: number, input: {
    invoice_id: number; gateway: string; reference: string; amount_minor: number;
    method?: string | null; raw?: unknown; status?: 'captured' | 'failed' | 'pending';
  }) {
    const { data: invoice } = await this.#db.from('onyx_invoices').select(INVOICE_COLUMNS)
      .eq('tenant_id', tenantId).eq('id', input.invoice_id).maybeSingle();
    if (!invoice) throw new HttpError(404, 'No such invoice.');
    if (invoice.status === 'void') throw new HttpError(409, 'That invoice has been voided.');
    // Idempotency covers a replayed reference; it does nothing for a second,
    // different reference against an invoice that is already settled -- that
    // is a fresh insert and would over-credit the ledger. Checked before the
    // insert so a duplicate-reference replay (handled below, after the
    // insert) is still reached first for an invoice that was fully paid by
    // the very payment being replayed.
    if (invoice.status === 'paid') {
      const { data: existing } = await this.#db.from('onyx_payments').select('id')
        .eq('tenant_id', tenantId).eq('gateway', input.gateway)
        .eq('reference', input.reference.trim()).maybeSingle();
      if (!existing) {
        throw new HttpError(409, 'That invoice is already settled in full.');
      }
    }

    const reference = input.reference.trim();
    if (!reference) throw new HttpError(422, 'A payment needs a gateway reference.');
    if (!Number.isInteger(input.amount_minor) || input.amount_minor <= 0) {
      throw new HttpError(422, 'A payment is a whole number of paise, and above zero.');
    }

    const status = input.status ?? 'captured';
    const { data: payment, error } = await this.#db.from('onyx_payments').insert({
      tenant_id: tenantId,
      invoice_id: input.invoice_id,
      user_id: String(invoice.user_id),
      gateway: input.gateway,
      reference,
      amount_minor: input.amount_minor,
      currency: invoice.currency,
      status,
      method: input.method ?? null,
      raw: (input.raw ?? {}) as never,
      captured_at: status === 'captured' ? new Date(this.#now()).toISOString() : null,
    }).select(PAYMENT_COLUMNS).maybeSingle();

    if (error) {
      // The replay path. The constraint did the work; this just reports it.
      if (/duplicate key|unique/i.test(error.message)) {
        const { data: original } = await this.#db.from('onyx_payments').select(PAYMENT_COLUMNS)
          .eq('tenant_id', tenantId).eq('gateway', input.gateway).eq('reference', reference)
          .maybeSingle();
        return { payment: original, replayed: true, invoice: await this.#reload(tenantId, input.invoice_id) };
      }
      throw new HttpError(500, 'Could not record the payment: ' + error.message);
    }

    if (status === 'captured') {
      await this.#applyToInvoice(tenantId, input.invoice_id);
      await this.#audit.record(
        { tenant_id: tenantId, user_id: String(invoice.user_id) },
        { action: 'payment.recorded', entityType: 'invoice', entityId: input.invoice_id,
          after: { reference, amount_minor: input.amount_minor, gateway: input.gateway } });
    }

    return { payment, replayed: false, invoice: await this.#reload(tenantId, input.invoice_id) };
  }

  /**
   * Recompute an invoice's paid total from its captured payments.
   *
   * A sum rather than an increment. Incrementing is correct exactly once and
   * wrong forever after a refund, a correction or a partial replay; a sum is
   * correct every time it runs.
   */
  async #applyToInvoice(tenantId: number, invoiceId: number) {
    const { data: payments } = await this.#db.from('onyx_payments').select('amount_minor')
      .eq('tenant_id', tenantId).eq('invoice_id', invoiceId).eq('status', 'captured');
    const paid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount_minor), 0);

    const { data: invoice } = await this.#db.from('onyx_invoices').select('total_minor')
      .eq('tenant_id', tenantId).eq('id', invoiceId).maybeSingle();
    const total = Number(invoice?.total_minor ?? 0);

    await this.#db.from('onyx_invoices').update({
      paid_minor: paid,
      status: paid >= total ? 'paid' : paid > 0 ? 'part_paid' : 'issued',
      updated_at: new Date(this.#now()).toISOString(),
    }).eq('tenant_id', tenantId).eq('id', invoiceId);
  }

  async #reload(tenantId: number, invoiceId: number) {
    const { data } = await this.#db.from('onyx_invoices').select(INVOICE_COLUMNS)
      .eq('tenant_id', tenantId).eq('id', invoiceId).maybeSingle();
    return data;
  }

  /** What is owed, for the finance office. */
  /**
   * Every rupee that has come in, both ways it can arrive.
   *
   * An institution takes money twice over in this product and they were never
   * in one place: a FEE payment settles an invoice raised from a fee structure
   * (tuition, examination, library), and a COURSE PURCHASE buys a locked course
   * outright. An administrator asking "who has paid us, and for what" had to
   * read two screens and add up, and one of the two had no screen at all.
   *
   * The rows are unified deliberately rather than returned as two lists: they
   * answer the same question, and a report a person has to interleave by hand
   * is a report they will get wrong. What tells them apart is `kind`, and the
   * reference each carries -- an invoice number for a fee, a gateway reference
   * for a purchase -- because "which payment was that?" is asked with one of
   * those two strings in hand.
   *
   * Read-only, and admin-only at the route. No pagination: an institution's
   * takings for a term are hundreds of rows, and a cap that silently truncated
   * a financial report would be worse than the query costing a moment.
   */
  async receipts(tenantId: number, opts: { userId?: string } = {}) {
    let paymentQuery = this.#db.from('onyx_payments')
      .select('id, invoice_id, user_id, amount_minor, currency, status, method, gateway, '
        + 'reference, captured_at, created_at')
      .eq('tenant_id', tenantId);
    if (opts.userId) paymentQuery = paymentQuery.eq('user_id', opts.userId);

    let purchaseQuery = this.#db.from('onyx_course_purchases')
      .select('id, course_id, user_id, amount_minor, currency, status, gateway, reference, '
        + 'created_at')
      .eq('tenant_id', tenantId);
    if (opts.userId) purchaseQuery = purchaseQuery.eq('user_id', opts.userId);

    const [{ data: payments }, { data: purchases }] = await Promise.all([
      paymentQuery.order('id', { ascending: false }),
      purchaseQuery.order('id', { ascending: false }),
    ]);

    interface PaymentRow {
      id: number; invoice_id: number | null; user_id: string; amount_minor: number;
      currency: string | null; status: string; method: string | null; gateway: string | null;
      reference: string | null; captured_at: string | null; created_at: string;
    }
    interface PurchaseRow {
      id: number; course_id: number; user_id: string; amount_minor: number;
      currency: string | null; status: string; gateway: string; reference: string;
      created_at: string;
    }
    const paymentRows = (payments ?? []) as unknown as PaymentRow[];
    const purchaseRows = (purchases ?? []) as unknown as PurchaseRow[];

    // The names, invoice numbers and course titles those rows point at. Three
    // lookups for the whole report rather than one per row.
    const userIds = [...new Set([...paymentRows, ...purchaseRows]
      .map((r) => String(r.user_id)).filter(Boolean))];
    const invoiceIds = [...new Set(paymentRows.map((r) => Number(r.invoice_id)).filter(Boolean))];
    const courseIds = [...new Set(purchaseRows.map((r) => Number(r.course_id)).filter(Boolean))];

    const [{ data: users }, { data: invoices }, { data: courses }] = await Promise.all([
      userIds.length
        ? this.#db.from('onyx_users').select('id, name, email').in('id', userIds)
        : Promise.resolve({ data: [] as { id: string; name: string; email: string }[] }),
      invoiceIds.length
        ? this.#db.from('onyx_invoices').select('id, number, total_minor, status')
          .in('id', invoiceIds)
        : Promise.resolve({ data: [] as { id: number; number: string }[] }),
      courseIds.length
        ? this.#db.from('onyx_courses').select('id, code, title').in('id', courseIds)
        : Promise.resolve({ data: [] as { id: number; code: string; title: string }[] }),
    ]);

    const byUser = new Map((users ?? []).map((u) => [String(u.id), u]));
    const byInvoice = new Map((invoices ?? []).map((i) => [Number(i.id), i]));
    const byCourse = new Map((courses ?? []).map((c) => [Number(c.id), c]));

    // Roll numbers, because an institution looks people up by them.
    const { data: memberships } = userIds.length
      ? await this.#db.from('onyx_memberships').select('user_id, roll_number')
        .eq('tenant_id', tenantId).in('user_id', userIds)
      : { data: [] as { user_id: string; roll_number: string | null }[] };
    const rollOf = new Map((memberships ?? [])
      .map((m) => [String(m.user_id), m.roll_number ?? null]));

    const person = (id: string) => ({
      id,
      name: byUser.get(id)?.name ?? null,
      email: byUser.get(id)?.email ?? null,
      roll_number: rollOf.get(id) ?? null,
    });

    const rows = [
      ...paymentRows.map((p) => {
        const invoice = byInvoice.get(Number(p.invoice_id));
        return {
          kind: 'fee' as const,
          id: 'payment-' + p.id,
          at: String(p.captured_at ?? p.created_at),
          learner: person(String(p.user_id)),
          /** What it was for, in the words the screen shows. */
          what: invoice ? 'Invoice ' + invoice.number : 'Fee payment',
          /** The string somebody quotes when they ring up about it. */
          reference: invoice?.number ?? String(p.reference ?? ''),
          gateway_reference: p.reference ? String(p.reference) : null,
          invoice_id: p.invoice_id ? Number(p.invoice_id) : null,
          course: null as null | { id: number; code: string; title: string },
          amount_minor: Number(p.amount_minor),
          currency: String(p.currency ?? 'INR'),
          method: p.method ? String(p.method) : String(p.gateway ?? ''),
          status: String(p.status),
        };
      }),
      ...purchaseRows.map((p) => {
        const course = byCourse.get(Number(p.course_id));
        return {
          kind: 'course' as const,
          id: 'purchase-' + p.id,
          at: String(p.created_at),
          learner: person(String(p.user_id)),
          what: course ? course.code + ' · ' + course.title : 'Course purchase',
          reference: String(p.reference),
          gateway_reference: String(p.reference),
          invoice_id: null,
          course: course ? { id: Number(course.id), code: String(course.code), title: String(course.title) } : null,
          amount_minor: Number(p.amount_minor),
          currency: String(p.currency ?? 'INR'),
          method: String(p.gateway),
          status: String(p.status),
        };
      }),
    ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    const settled = rows.filter((r) => r.status === 'captured' || r.status === 'paid');
    return {
      rows,
      summary: {
        count: rows.length,
        collected_minor: settled.reduce((n, r) => n + r.amount_minor, 0),
        from_fees_minor: settled.filter((r) => r.kind === 'fee')
          .reduce((n, r) => n + r.amount_minor, 0),
        from_courses_minor: settled.filter((r) => r.kind === 'course')
          .reduce((n, r) => n + r.amount_minor, 0),
        learners: new Set(settled.map((r) => r.learner.id)).size,
      },
    };
  }

  async outstanding(tenantId: number, viewer: { role: Role }) {
    if (!canManageFees(viewer.role)) throw new HttpError(403, 'Only an administrator can see this.');
    const { data } = await this.#db.from('onyx_invoices').select(INVOICE_COLUMNS)
      .eq('tenant_id', tenantId).in('status', ['issued', 'part_paid'])
      .order('due_at', { ascending: true, nullsFirst: false });

    const rows = data ?? [];
    const names = new Map<string, string>();
    if (rows.length) {
      const { data: people } = await this.#db.from('onyx_users').select('id, name')
        .in('id', rows.map((r) => String(r.user_id)));
      for (const p of people ?? []) names.set(String(p.id), String(p.name));
    }
    const now = this.#now();

    return {
      total_minor: rows.reduce((s, r) => s + (Number(r.total_minor) - Number(r.paid_minor)), 0),
      invoices: rows.map((r) => ({
        ...r,
        name: names.get(String(r.user_id)) ?? null,
        balance_minor: Number(r.total_minor) - Number(r.paid_minor),
        overdue: Boolean(r.due_at && Date.parse(String(r.due_at)) < now),
      })),
    };
  }
}
