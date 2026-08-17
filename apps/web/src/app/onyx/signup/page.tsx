import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth-card';
import { OnyxBrand } from '@/components/onyx-brand';

export const metadata: Metadata = { title: 'Creating an institution', robots: 'noindex' };

/**
 * Self-service institution creation is gone.
 *
 * This page used to carry a form that posted, unauthenticated, to
 * POST /api/onyx/tenants — so anyone who found it could bring an institution
 * into existence and become its administrator. Institutions are now created
 * by a platform admin, from the platform console, and nowhere else.
 *
 * The route is kept rather than deleted because it was linked from the sign-in
 * page and may sit in somebody's bookmarks or an old email; a 404 would leave
 * them guessing. It explains what changed and points at the two things that
 * are actually useful — signing in, or asking the people who can do this.
 */
export default function OnyxSignupClosedPage() {
  return (
    <AuthCard
      logo={<OnyxBrand className="mb-6" />}
      title="Institutions are set up for you"
      subtitle="This is no longer something you can do yourself."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/onyx/login" className="text-brand-600 underline">Sign in</Link>
        </>
      }
    >
      <div className="space-y-4 text-sm text-muted">
        <p>
          An institution and its first administrator are created by the Onyx
          platform team, so that an account with authority over a whole
          institution is never issued by whoever asked for it first.
        </p>
        <p>
          If your institution should be on Onyx, or you believe you should
          administer one that already is, ask the platform team — they can set
          it up and hand you the administrator account.
        </p>
        <Link href="/onyx/login" className="btn-primary block w-full text-center">
          Go to sign in
        </Link>
      </div>
    </AuthCard>
  );
}
