'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Buy / enrol / wishlist buttons on a course page.
 *
 * Free courses enrol in one step; paid ones go to the cart. Both share the
 * server-side guards, so the button only decides which call to make.
 */
export function CourseActions({ courseId, slug, isPaid, isSignedIn, enrolled, wishlisted }: {
  courseId: number;
  slug: string;
  isPaid: boolean;
  isSignedIn: boolean;
  enrolled: 'valid' | 'expired' | false;
  wishlisted: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(wishlisted);
  const [message, setMessage] = useState('');

  async function post(path: string) {
    setBusy(true); setMessage('');
    const res = await fetch('/api/proxy' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ course_id: courseId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    return { ok: res.ok, body };
  }

  if (!isSignedIn) {
    return (
      <a href="/login/store" className="btn-primary w-full">
        Sign in to {isPaid ? 'buy this course' : 'enrol'}
      </a>
    );
  }

  if (enrolled === 'valid') {
    return <a href={`/play-course/${slug}`} className="btn-primary w-full">Go to course</a>;
  }

  return (
    <div className="space-y-2">
      <button
        className="btn-primary w-full disabled:opacity-60"
        disabled={busy}
        onClick={async () => {
          const { ok, body } = await post(isPaid ? '/cart' : '/enroll/free');
          if (!ok) { setMessage(body.message ?? 'Something went wrong.'); return; }
          router.push(isPaid ? '/cart' : '/my-courses');
          router.refresh();
        }}
      >
        {enrolled === 'expired'
          ? 'Renew access'
          : isPaid ? 'Add to cart' : 'Enrol for free'}
      </button>

      <button
        className="btn-ghost w-full disabled:opacity-60"
        disabled={busy}
        onClick={async () => {
          const { ok, body } = await post('/wishlist/toggle');
          if (ok) setSaved(Boolean(body.data?.wishlisted));
          else setMessage(body.message ?? 'Something went wrong.');
        }}
      >
        {saved ? 'Saved to wishlist' : 'Add to wishlist'}
      </button>

      {enrolled === 'expired' && (
        <p className="text-xs text-amber-700">
          Your access to this course has expired.
        </p>
      )}
      {message && <p className="text-xs text-red-600">{message}</p>}
    </div>
  );
}
