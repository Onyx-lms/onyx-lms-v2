import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth-card';
import { AuthForm } from '@/components/auth-form';
import { getSession, homeForRole } from '@/lib/session';

export const metadata: Metadata = { title: 'Create an account' };

export default async function RegisterPage() {
  const session = await getSession();
  if (session) redirect(homeForRole(session.app_role));

  return (
    <AuthCard
      title="Create your account"
      subtitle="Start learning in a couple of minutes."
      footer={
        <>
          Already registered?{' '}
          <Link href="/login/store" className="text-brand-600 hover:underline">Sign in</Link>
        </>
      }
    >
      <AuthForm
        action="register"
        submitLabel="Create account"
        redirectTo="/login/store"
        onDone="message"
        fields={[
          { name: 'name', label: 'Full name', autoComplete: 'name' },
          { name: 'email', label: 'Email address', type: 'email', autoComplete: 'email' },
          { name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password' },
        ]}
      />
      <p className="mt-4 text-xs text-slate-500">
        Registration creates a student account. You can apply to teach later from
        your profile.
      </p>
    </AuthCard>
  );
}
