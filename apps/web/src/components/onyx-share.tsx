'use client';

import { useState } from 'react';
import { Icon } from '@/components/onyx-ui';

/**
 * Copy the address of the thing you are looking at.
 *
 * Every record here already has a URL that works -- a paper, an exam, a course
 * -- and a lecturer sharing one was reading it out of the address bar. The
 * button does two things that saves: it copies the whole absolute address
 * rather than the path, and it is a visible statement that the link is meant to
 * be sent.
 *
 * Access is unchanged and deliberately so. The link is not a key: whoever
 * follows it signs in as themselves and gets exactly what their role allows,
 * which for a paper they are not enrolled on is a refusal. Sharing an address
 * is not sharing a permission.
 */
export function ShareLink({ label = 'Copy link' }: { label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(window.location.href);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-line
                 bg-white px-3 text-[13px] font-semibold hover:border-brand-300
                 hover:text-brand-700"
    >
      <Icon name={copied ? 'check' : 'external'} className="h-4 w-4" />
      {copied ? 'Link copied' : label}
    </button>
  );
}
