'use client';

import { useRouter } from 'next/navigation';
import { DangerPanel } from '@/components/onyx-danger';

/**
 * Cancelling a paper, from the paper's own page.
 *
 * There was no way to remove one from the institution's side at all. A paper
 * set by mistake, or a draft that drew nothing and never would, stayed on the
 * list for ever with an Edit button and nothing else — and the only route that
 * could delete one belonged to the platform console, so a lecturer tidying up
 * after themselves needed an operator.
 *
 * On the paper's own page rather than beside its row in the list, which is the
 * rule `DangerPanel` exists to hold: a destructive control never sits on a list
 * row, where the fastest thing to reach on a screen full of records would be
 * the one action that cannot be undone.
 *
 * No count of who has sat it is shown, deliberately. This page fetches only the
 * VIEWER's own attempts, and for staff that list is always empty — so a count
 * taken from it would have told a lecturer "nobody has sat this" on a paper
 * thirty people had sat, which is worse than saying nothing. The server knows
 * the real number, refuses on it, and its refusal is what appears here.
 */
export function PaperDanger({ assessmentId, title }: {
  assessmentId: number;
  title: string;
}) {
  const router = useRouter();

  return (
    <DangerPanel
      heading="Cancel this paper"
      what={'“' + title + '” and its sections are removed. The question banks it draws '
        + 'from are not touched. If anybody has already sat it this is refused, because '
        + 'removing it would take their answers and their marks with it — close its window '
        + 'instead to stop anybody else sitting it.'}
      cta="Remove this paper"
      onConfirm={async () => {
        const res = await fetch('/api/proxy/onyx/assessments/' + assessmentId,
          { method: 'DELETE' });
        const body = await res.json().catch(() => ({ ok: false }));
        if (!body.ok) return { ok: false, message: body.message ?? 'That did not work.' };
        // Back to the list: staying on the page of a paper that no longer
        // exists would render a 404 the moment anything refreshed.
        router.push('/onyx/assessments');
        router.refresh();
        return { ok: true };
      }}
    />
  );
}
