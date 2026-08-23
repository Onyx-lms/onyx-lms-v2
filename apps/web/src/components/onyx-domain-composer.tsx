'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { Modal } from '@/components/onyx-modal';
import { Icon } from '@/components/onyx-ui';

/**
 * Adding a domain to Live Classes.
 *
 * Deliberately NOT a `CreatePanel`, and the reason is worth writing down so it
 * is not re-proposed: `CreatePanel.toBody` is a synchronous FormData-to-JSON map
 * with a single `pending` boolean. A thumbnail needs three steps in order --
 * sign, PUT, then post the key -- with its own staged progress and two
 * different failure messages, because "could not be uploaded" and "could not be
 * saved" send an author to different places. `CreatePanel` also has around
 * twenty callers, so widening its field types widens the contract for all of
 * them. Both `onyx-create.tsx` and `onyx-lesson-composer.tsx` already say a file
 * needs its own component; this is that component.
 *
 * The upload leg is `LessonComposer`'s, pointed at the domains ticket route.
 * The browser PUTs straight to storage because Vercel rejects a request body
 * over about 4.5 MB before a handler ever runs.
 */

/**
 * A tile thumbnail, not a photograph library. Somebody will otherwise pick the
 * 40 MB original off a camera, wait two minutes, and get a slower page for it.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const field = 'mt-1.5 block min-h-[42px] w-full rounded-xl border border-line bg-white px-3 '
  + 'text-[14px] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-600/20';
const label = 'block text-[13px] font-semibold text-slate-700';

export function DomainComposer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  function close() {
    setOpen(false); setError(null); setStage(null); setFile(null);
  }

  /** Ticket, then PUT, then the key. Failures name the step that failed. */
  async function uploadAndGetPath(picked: File): Promise<string> {
    setStage('Preparing…');
    const ticketRes = await fetch('/api/proxy/onyx/domains/uploads/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: picked.name }),
    });
    const ticket = await ticketRes.json().catch(() => ({ ok: false }));
    if (!ticket.ok) throw new Error(ticket.message ?? 'Could not start the upload.');

    setStage('Uploading ' + picked.name + '…');
    const put = await fetch(ticket.data.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': picked.type || 'application/octet-stream' },
      body: picked,
    });
    if (!put.ok) throw new Error('The image could not be uploaded. Check your connection.');

    return ticket.data.path as string;
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-brand-600 px-4
                   text-[14.5px] font-bold text-white shadow-card hover:bg-brand-700">
        <Icon name="plus" className="h-4 w-4" aria-hidden="true" />
        Add a domain
      </button>
    );
  }

  return (
    <Modal title="Add a domain" onClose={close} wide>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setError(null);
          start(async () => {
            try {
              const picked = file;
              const image_path = picked ? await uploadAndGetPath(picked) : null;

              setStage('Saving…');
              const res = await fetch('/api/proxy/onyx/domains', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  title: String(data.get('title') ?? ''),
                  summary: String(data.get('summary') ?? ''),
                  curriculum_url: String(data.get('curriculum_url') ?? ''),
                  certificate: String(data.get('certificate') ?? ''),
                  duration_label: String(data.get('duration_label') ?? ''),
                  // Typed in rupees, stored in paise.
                  price_minor: Math.round(Number(data.get('price_rupees') || 0) * 100),
                  ...(image_path ? { image_path } : {}),
                }),
              });
              const body = await res.json().catch(() => ({ ok: false }));
              if (!body.ok) throw new Error(body.message ?? 'The domain could not be saved.');

              close();
              router.refresh();
            } catch (err) {
              setStage(null);
              setError(err instanceof Error ? err.message : 'That did not work.');
            }
          });
        }}
      >
        {error ? (
          <p role="alert" className="sm:col-span-2 rounded-xl bg-rose-50 px-3 py-2 text-[13px]
                                     text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="sm:col-span-2">
          <label className={label} htmlFor="dm-title">Course name</label>
          <input id="dm-title" name="title" required maxLength={200} className={field} />
        </div>

        <div className="sm:col-span-2">
          <label className={label} htmlFor="dm-image">Photo of the domain</label>
          <input
            id="dm-image" ref={fileInput} type="file" accept="image/*"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              if (picked && picked.size > MAX_IMAGE_BYTES) {
                setError('That image is larger than 5 MB. A tile only needs a small one.');
                e.target.value = '';
                setFile(null);
                return;
              }
              setError(null);
              setFile(picked);
            }}
            className="mt-1.5 block w-full text-[13.5px] file:mr-3 file:rounded-lg
                       file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-[13px]
                       file:font-semibold file:text-brand-700"
          />
          <p className="mt-1 text-[12px] text-muted">
            Optional. Shown on the tile — a wide image works best. Up to 5 MB.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className={label} htmlFor="dm-summary">About this domain</label>
          <textarea id="dm-summary" name="summary" rows={4} maxLength={4000}
            className={field} />
          <p className="mt-1 text-[12px] text-muted">What it covers, in a few sentences.</p>
        </div>

        <div className="sm:col-span-2">
          <label className={label} htmlFor="dm-url">Curriculum link</label>
          <input id="dm-url" name="curriculum_url" type="url" maxLength={500}
            placeholder="onyxedutech.com/curriculum/…" className={field} />
          <p className="mt-1 text-[12px] text-muted">
            The curriculum on the Onyx EduTech site. Opens in a new tab from the domain page.
          </p>
        </div>

        <div>
          <label className={label} htmlFor="dm-cert">Certificate</label>
          <input id="dm-cert" name="certificate" maxLength={200}
            placeholder="Certificate in Data Science" className={field} />
          <p className="mt-1 text-[12px] text-muted">Leave blank if none is awarded.</p>
        </div>

        <div>
          <label className={label} htmlFor="dm-duration">Duration</label>
          <input id="dm-duration" name="duration_label" maxLength={80}
            placeholder="12 weeks" className={field} />
        </div>

        <div>
          <label className={label} htmlFor="dm-price">Price</label>
          {/* Rupees, with the symbol in the field. This asked for paise and
              explained the conversion underneath, which is a form asking
              somebody to do arithmetic it could do itself -- and getting it
              wrong by two zeroes is the difference between ₹1,499 and
              ₹149,900. The value is still sent as minor units. */}
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute left-3 top-1/2
                                         -translate-y-1/2 text-[15px] font-semibold text-muted">
              ₹
            </span>
            <input id="dm-price" name="price_rupees" type="number" inputMode="decimal"
              step="0.01" min={0} defaultValue={0} className={field + ' pl-7'} />
          </div>
          <p className="mt-1 text-[12px] text-muted">Leave it at 0 for a free class.</p>
        </div>

        <div className="flex items-center gap-2 sm:col-span-2">
          <button type="submit" disabled={pending}
            className="min-h-[42px] rounded-xl bg-brand-600 px-4 text-[14px] font-bold
                       text-white hover:bg-brand-700 disabled:opacity-50">
            {pending ? (stage ?? 'Saving…') : 'Add the domain'}
          </button>
          <button type="button" onClick={close}
            className="min-h-[42px] rounded-xl border border-slate-300 px-4 text-[14px]
                       font-semibold hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
