import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { PlatformLoginForm } from '@/components/onyx-platform-forms';
import { OnyxAuthSplit } from '@/components/onyx-auth-split';
import { Icon } from '@/components/onyx-ui';
import { getPlatformSession } from '@/lib/onyx-platform-session';

export const metadata: Metadata = { title: 'Platform sign in' };

/**
 * A separate door from /onyx/login on purpose. A platform admin is not
 * signing in to an institution -- there is no tenant picker here, and no
 * tenant to land in. See onyx-platform-session.ts for why the two sessions
 * do not share a cookie or a claims shape.
 *
 * Two doors one path segment apart is a thing an operator can get wrong at a
 * glance, so this one does not merely differ, it declares itself: ink rather
 * than teal, and the same `PLATFORM` badge the console wears in its own
 * header. The consequence of confusing them is not symmetrical -- every other
 * screen in this product acts on one institution and this one acts on all of
 * them -- which is why the difference is stated in words as well as colour,
 * and why the ink panel is not merely a recolour of the teal one: the claim
 * and the three lines under it are about reach and accountability, not about
 * what a student gets.
 *
 * `PlatformLoginForm` is untouched: same fields, same error announcement, same
 * POST to /api/onyx-platform/login and the same platform cookie back.
 */
export default async function OnyxPlatformLoginPage() {
  if (await getPlatformSession()) redirect('/onyx/platform');

  return (
    <OnyxAuthSplit
      tone="platform"
      title="Platform console"
      subtitle="For operators, not for any one institution."
      claim="Every institution, and the record of what was done to it."
      points={[
        { icon: 'building', text: 'Create institutions and their first administrator' },
        { icon: 'chart', text: 'See usage and health across the estate' },
        { icon: 'shield', text: 'Every action written to the platform audit log' },
      ]}
      note="This session belongs to no institution and can act on all of them."
      footer={
        /* Said before the password rather than after the mistake. */
        <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-canvas p-4
                        text-[13px] leading-relaxed text-muted">
          <span className="text-ink">
            <Icon name="shield" className="mt-0.5 h-4 w-4" />
          </span>
          <p className="min-w-0 flex-1">
            This session belongs to no institution and can act on every one of them. If you
            meant to sign in to your own, the door is{' '}
            <span className="font-semibold text-ink">/onyx/login</span>.
          </p>
        </div>
      }
    >
      <PlatformLoginForm />
    </OnyxAuthSplit>
  );
}
