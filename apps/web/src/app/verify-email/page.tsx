import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth-card';
import { VerifyEmailClient } from '@/components/verify-email-client';

export const metadata: Metadata = { title: 'Verify email' };

export default async function VerifyEmailPage(
  { searchParams }: { searchParams: Promise<{ token?: string }> },
) {
  const { token = '' } = await searchParams;
  return (
    <AuthCard title="Verify your email"
      footer={<Link href="/login/store" className="text-brand-600 hover:underline">Go to sign in</Link>}>
      <VerifyEmailClient token={token} />
    </AuthCard>
  );
}
