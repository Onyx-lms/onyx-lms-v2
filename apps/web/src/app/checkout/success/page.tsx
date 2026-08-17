import type { Metadata } from 'next';
import { requireSession } from '@/lib/session';
import { CheckoutConfirm } from '@/components/checkout-confirm';

export const metadata: Metadata = { title: 'Completing your order' };

/**
 * The gateway redirects here. Landing on this page is NOT proof of payment --
 * the confirm call verifies with the provider before anything is granted.
 */
export default async function CheckoutSuccess(
  { searchParams }: { searchParams: Promise<Record<string, string>> },
) {
  await requireSession();
  const params = await searchParams;
  return (
    <div className="container-page py-16">
      <div className="mx-auto max-w-lg">
        <CheckoutConfirm params={params} />
      </div>
    </div>
  );
}
