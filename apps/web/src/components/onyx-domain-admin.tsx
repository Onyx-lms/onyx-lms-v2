'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/onyx-ui';
import { DangerPanel } from '@/components/onyx-danger';
import type { OnyxDomainRow } from '@/lib/onyx-domains';

/**
 * Editing and removing one domain, on that domain's own page.
 *
 * The destructive control is at the foot of the panel for the record it
 * destroys, never on a tile in a grid -- the same rule the operator console and
 * the administrator's roster were both put on. By the time "Remove domain" is on
 * screen, the person has opened the one they mean.
 *
 * The form sends only what it shows. `image_path` is deliberately absent: the
 * thumbnail is set when the domain is created, and a PATCH that omitted the
 * field would leave it alone anyway (see DomainsService.update). Replacing a
 * photograph is a separate job and a separate control.
 */

const field = 'mt-1.5 block min-h-[40px] w-full rounded-xl border border-line bg-white px-3 '
  + 'text-[14px] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-600/20';
const label = 'block text-[12.5px] font-semibold text-slate-700';

export function DomainAdmin({ domain }: { domain: OnyxDomainRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="rounded-2xl border border-line bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold">Manage this domain</h2>
        <button type="button" onClick={() => setOpen(!open)}
          className="inline-flex min-h-[38px] items-center gap-2 rounded-xl border
                     border-slate-300 px-3.5 text-[13px] font-semibold hover:border-brand-300
                     hover:text-brand-700">
          <Icon name="edit" className="h-4 w-4" />
          {open ? 'Close' : 'Edit details'}
        </button>
      </div>

      {open ? (
        <form
          className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            setError(null);
            start(async () => {
              const res = await fetch('/api/proxy/onyx/domains/' + domain.id, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  title: String(data.get('title') ?? ''),
                  summary: String(data.get('summary') ?? ''),
                  curriculum_url: String(data.get('curriculum_url') ?? ''),
                  certificate: String(data.get('certificate') ?? ''),
                  duration_label: String(data.get('duration_label') ?? ''),
                  price_minor: Number(data.get('price_minor') || 0),
                  status: Number(data.get('status')),
                }),
              });
              const body = await res.json().catch(() => ({ ok: false }));
              if (!body.ok) { setError(body.message ?? 'That did not work.'); return; }
              setOpen(false);
              router.refresh();
            });
          }}
        >
          {error ? (
            <p role="alert" className="sm:col-span-2 text-[13px] text-rose-700">{error}</p>
          ) : null}

          <div className="sm:col-span-2">
            <label className={label} htmlFor="da-title">Course name</label>
            <input id="da-title" name="title" defaultValue={domain.title} required
              maxLength={200} className={field} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="da-summary">About this domain</label>
            <textarea id="da-summary" name="summary" rows={4} maxLength={4000}
              defaultValue={domain.summary} className={field} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="da-url">Curriculum link</label>
            <input id="da-url" name="curriculum_url" type="url" maxLength={500}
              defaultValue={domain.curriculum_url} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="da-cert">Certificate</label>
            <input id="da-cert" name="certificate" maxLength={200}
              defaultValue={domain.certificate} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="da-duration">Duration</label>
            <input id="da-duration" name="duration_label" maxLength={80}
              defaultValue={domain.duration_label} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="da-price">Price in paise</label>
            <input id="da-price" name="price_minor" type="number" min={0}
              defaultValue={domain.price_minor} className={field} />
            <p className="mt-1 text-[12px] text-muted">149900 is ₹1,499.00. Use 0 for free.</p>
          </div>
          <div>
            <label className={label} htmlFor="da-status">Shown on Live Classes</label>
            <select id="da-status" name="status" defaultValue={domain.status}
              className={field}>
              <option value={1}>Yes</option>
              <option value={0}>Hidden</option>
            </select>
          </div>

          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={pending}
              className="min-h-[40px] rounded-xl bg-brand-600 px-4 text-[13.5px] font-bold
                         text-white hover:bg-brand-700 disabled:opacity-50">
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setOpen(false)}
              className="min-h-[40px] rounded-xl border border-slate-300 px-4 text-[13.5px]
                         font-semibold hover:bg-slate-50">
              Cancel
            </button>
          </div>

          <div className="sm:col-span-2">
            <DangerPanel
              heading="Remove this domain"
              what={<>
                Takes <strong className="text-slate-700">{domain.title}</strong> off Live
                Classes for good, along with its photograph. Nothing else is affected — a
                domain has no roster and no marks. To take it down without losing it, set
                &ldquo;Shown on Live Classes&rdquo; to <em>Hidden</em> above instead.
              </>}
              cta="Remove domain"
              onConfirm={async () => {
                const res = await fetch('/api/proxy/onyx/domains/' + domain.id,
                  { method: 'DELETE' });
                const body = await res.json().catch(() => ({ ok: false }));
                if (body.ok) { router.push('/onyx/domains'); router.refresh(); }
                return body;
              }}
            />
          </div>
        </form>
      ) : null}
    </section>
  );
}
