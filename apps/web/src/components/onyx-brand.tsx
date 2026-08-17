/**
 * The Onyx mark, from the proposal at onyx.proposal.ezil.work.
 *
 * A plain `<img>` rather than `next/image`, matching the rest of this app
 * (see blog-card.tsx): the file ships in `public/` so there is no remote-host
 * allowlist to configure, and no build-time optimisation this small an asset
 * needs.
 */
export function OnyxMark({ className = 'h-8 w-auto' }: { className?: string }) {
  return <img src="/onyx-mark.png" alt="" className={className} />;
}

/** The mark plus the wordmark, for the auth pages and the shell's sidebar. */
export function OnyxBrand({ className = '' }: { className?: string }) {
  return (
    <div className={'flex items-center gap-2 ' + className}>
      <OnyxMark className="h-7 w-auto" />
      <span className="text-lg font-semibold tracking-tight text-slate-900">Onyx LMS</span>
    </div>
  );
}
