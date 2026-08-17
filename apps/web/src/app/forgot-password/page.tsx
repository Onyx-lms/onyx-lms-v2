import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth-card';
import { AuthForm } from '@/components/auth-form';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="We will email you a link to choose a new one."
      footer={<Link href="/login/store" className="text-brand-600 hover:underline">Back to sign in</Link>}
    >
      {/* The response is identical whether or not the address exists, so this
          form cannot be used to discover who has an account. */}
      <AuthForm
        action="forgot"
        submitLabel="Email me a link"
        onDone="message"
        fields={[{ name: 'email', label: 'Email address', type: 'email', autoComplete: 'email' }]}
      />
    </AuthCard>
  );
}
