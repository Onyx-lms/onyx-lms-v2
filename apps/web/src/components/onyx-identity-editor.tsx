'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Icon, SectionHead } from '@/components/onyx-ui';

/**
 * Who this account is: a name, a number, and a face.
 *
 * These three were the only things on a profile a person could not change.
 * Everything else -- headline, bio, skills, visibility -- has been editable;
 * the name an administrator typed on the day the account was created was not,
 * and neither was a picture, because nothing in the product ever wrote to the
 * `photo` column that has been sitting on `onyx_users` all along.
 *
 * A name matters more than it looks. It is on every roster, every register,
 * every certificate and every transcript. People marry, transition, correct a
 * misspelling, or simply go by something other than what a registrar typed --
 * and telling them to raise a ticket for that is a small cruelty a product
 * this size should not be committing.
 *
 * Separate from ProfileEditor rather than folded into it, because the two
 * answer different questions and one of them is riskier. That one is about
 * what a person chooses to say publicly; this is their identity inside the
 * institution, it shows up on documents other people rely on, and the picture
 * half needs an upload with its own two failure modes. Keeping them apart also
 * means somebody fixing their name does not have to scroll past a bio to do it.
 */

/** Anything bigger is a photograph nobody needed at that size. */
const MAX_BYTES = 5 * 1024 * 1024;

export interface Identity {
  name: string;
  email: string;
  phone: string;
  /** Already resolved to something an <img> can use, or null. */
  photo_url: string | null;
}

export function IdentityEditor({ identity, institution }: {
  identity: Identity;
  /** Named in the copy, so it is clear where this name is going to appear. */
  institution: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(identity.name);
  const [phone, setPhone] = useState(identity.phone);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const initials = (identity.name || identity.email)
    .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

  const patch = (body: Record<string, unknown>, then?: () => void) => start(async () => {
    setError(null);
    setSaved(false);
    const res = await fetch('/api/proxy/onyx/my/profile-details', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const answer = await res.json().catch(() => ({}));
    if (!answer.ok) { setError(answer.message ?? 'That did not save.'); return; }
    setSaved(true);
    then?.();
    router.refresh();
  });

  /**
   * Sign, PUT, then save the key.
   *
   * The browser uploads straight to storage because Vercel rejects request
   * bodies over about 4.5 MB and a photograph off a phone is routinely larger.
   * The two steps fail differently and say so differently: a refused ticket is
   * this institution's storage not being set up, and a refused PUT is the
   * network between here and the bucket.
   */
  const pickPhoto = async (file: File) => {
    setError(null);
    setSaved(false);
    if (!file.type.startsWith('image/')) {
      setError('That is not an image.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That picture is larger than 5 MB. A smaller one will look the same here.');
      return;
    }

    setUploading(true);
    try {
      const ticket = await fetch('/api/proxy/onyx/my/avatar/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name }),
      });
      const signed = await ticket.json().catch(() => ({}));
      if (!signed.ok) {
        setError(signed.message ?? 'Could not start the upload.');
        return;
      }

      const put = await fetch(signed.data.signedUrl as string, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!put.ok) {
        setError('The picture did not reach storage. Check your connection and try again.');
        return;
      }

      patch({ photo: signed.data.path as string });
    } catch {
      setError('The picture did not upload.');
    } finally {
      setUploading(false);
      // So choosing the same file twice in a row still fires a change event.
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const dirty = name.trim() !== identity.name || phone.trim() !== identity.phone;

  return (
    <Card className="p-4 sm:p-5">
      <SectionHead title="Your details" />

      <div className="mt-3 flex flex-wrap items-start gap-5">
        {/* The picture, and the two things you can do to it. */}
        <div className="flex flex-col items-center gap-2">
          {identity.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={identity.photo_url} alt=""
              className="h-24 w-24 rounded-full border border-line object-cover" />
          ) : (
            <span aria-hidden="true"
              className="grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br
                         from-brand-500 to-brand-700 text-[28px] font-bold text-white">
              {initials}
            </span>
          )}

          <input
            ref={fileRef} type="file" accept="image/*" className="sr-only"
            id="pf-photo" name="photo"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pickPhoto(file);
            }}
          />
          <label htmlFor="pf-photo"
            className="cursor-pointer rounded-xl border border-line px-3 py-1.5 text-[12.5px]
                       font-semibold text-slate-700 hover:bg-brand-50">
            {uploading ? 'Uploading…' : identity.photo_url ? 'Change picture' : 'Add a picture'}
          </label>
          {identity.photo_url ? (
            <button type="button" disabled={pending}
              onClick={() => patch({ photo: null })}
              className="text-[12px] font-semibold text-muted hover:text-red-700
                         disabled:opacity-50">
              Remove
            </button>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 space-y-3.5">
          <div>
            <label htmlFor="pf-name"
              className="block text-[13.5px] font-semibold text-slate-700">
              Your name
            </label>
            <input
              id="pf-name" name="name" value={name} maxLength={120}
              onChange={(e) => { setName(e.target.value); setSaved(false); }}
              className="mt-1.5 block w-full rounded-xl border border-line bg-white px-3.5 py-2.5
                         text-[14px] focus:border-brand-500 focus:outline-none
                         focus:ring-2 focus:ring-brand-600/20"
            />
            <p className="mt-1.5 text-[12.5px] text-muted">
              This is the name on your registers, results and certificates at {institution}.
            </p>
          </div>

          <div>
            <label htmlFor="pf-phone"
              className="block text-[13.5px] font-semibold text-slate-700">
              Phone
            </label>
            <input
              id="pf-phone" name="phone" value={phone} maxLength={40} inputMode="tel"
              onChange={(e) => { setPhone(e.target.value); setSaved(false); }}
              placeholder="Optional"
              className="mt-1.5 block w-full rounded-xl border border-line bg-white px-3.5 py-2.5
                         text-[14px] focus:border-brand-500 focus:outline-none
                         focus:ring-2 focus:ring-brand-600/20"
            />
            <p className="mt-1.5 text-[12.5px] text-muted">
              Seen by your institution, and by an employer only if you put it on your resume.
            </p>
          </div>

          <div>
            <span className="block text-[13.5px] font-semibold text-slate-700">
              Email address
            </span>
            {/* Shown and not editable: it is what signs you in and what
                identifies your institution, so changing it is a different act
                with different consequences. Saying so beats an input that
                silently refuses. */}
            <p className="mt-1.5 text-[14px]">{identity.email}</p>
            <p className="mt-1 text-[12.5px] text-muted">
              This is how you sign in and how we know which institution you belong to.
              Ask your institution if it needs to change.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              disabled={pending || uploading || !dirty || !name.trim()}
              onClick={() => patch({ name: name.trim(), phone: phone.trim() })}
              className="min-h-[42px] rounded-xl bg-brand-600 px-4 text-sm font-bold text-white
                         hover:bg-brand-700 disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
            {error ? (
              <span role="alert" className="text-[13px] text-red-700">{error}</span>
            ) : saved ? (
              <span role="status"
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted">
                <Icon name="check" className="h-4 w-4" />
                Saved.
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
}
