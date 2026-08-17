import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth-card';
import { AuthForm } from '@/components/auth-form';
import { getSession, homeForRole } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in to the store' };

/**
 * The storefront's sign-in, moved here from /login.
 *
 * /login now sends people to Onyx, because that is the product this deployment
 * is for and the two doors were being confused. This form is untouched and
 * everything behind it still works -- the catalogue, cart, checkout, purchases
 * and messages all run on this session, which is separate from Onyx's.
 *
 * The subtitle says which of the two you are at. Somebody who followed a link
 * expecting their institution should be able to tell in one line rather than by
 * failing to sign in.
 */
export default async function StoreLoginPage() {
  const session = await getSession();
  if (session) redirect(homeForRole(session.app_role));

  return (
    <AuthCard
      title="Sign in"
      subtitle="For course purchases and bookings. Signing in to your institution? Use Onyx."
      footer={
        <>
          Do not have an account?{' '}
          <Link href="/register" className="text-brand-600 hover:underline">Create one</Link>
        </>
      }
    >
      <AuthForm
        action="login"
        submitLabel="Sign in"
        fields={[
          { name: 'email', label: 'Email address', type: 'email', autoComplete: 'email' },
          { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
        ]}
      />
      <p className="mt-4 text-center text-sm">
        <Link href="/forgot-password" className="text-slate-600 hover:text-brand-600">
          Forgot your password?
        </Link>
      </p>
      {/* The way out for anybody who landed here by mistake. Without it the
          only signal that they are at the wrong door is a rejected password. */}
      <p className="mt-2 text-center text-sm">
        <Link href="/onyx/login" className="text-brand-600 hover:underline">
          Sign in to your institution instead
        </Link>
      </p>
    </AuthCard>
  );
}
