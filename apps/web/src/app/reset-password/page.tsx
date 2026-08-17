import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth-card';
import { AuthForm } from '@/components/auth-form';

export const metadata: Metadata = { title: 'Reset password' };

export default async function ResetPasswordPage(
  { searchParams }: { searchParams: Promise<{ token?: string; email?: string }> },
) {
  const { token = '', email = '' } = await searchParams;

  if (!token) {
    return (
      <AuthCard title="Reset link required"
        subtitle="Open the link from your email to reset your password."
        footer={<Link href="/forgot-password" className="text-brand-600 hover:underline">Request a new link</Link>}>
        <p className="text-sm text-slate-600">This page needs a valid reset token.</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" subtitle="Reset links expire after 60 minutes."
      footer={<Link href="/login/store" className="text-brand-600 hover:underline">Back to sign in</Link>}>
      <AuthForm
        action="reset"
        submitLabel="Update password"
        redirectTo="/login/store"
        onDone="message"
        fields={[
          { name: 'email', label: 'Email address', type: 'email', defaultValue: email },
          { name: 'password', label: 'New password', type: 'password', autoComplete: 'new-password' },
          { name: 'token', label: 'Reset token', type: 'hidden', defaultValue: token },
        ]}
      />
    </AuthCard>
  );
}
