import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSession, apiAuthSafe } from '@/lib/session';
import { CartClient } from '@/components/cart-client';
import { CheckoutButton } from '@/components/checkout-button';
import { OfflinePaymentForm } from '@/components/offline-payment-form';
import { currency } from '@/lib/format';

export const metadata: Metadata = { title: 'Your cart' };

export interface CartItem {
  id: number; cart_id: number; title: string | null; slug: string | null;
  thumbnail: string | null; effective_price: number;
  is_paid: number | null; price: number | null;
  discount_flag: number | null; discounted_price: number | null;
}
export interface CartSummary {
  items: CartItem[]; subtotal: number; discount: number; total: number;
  coupon: { code: string; discount: number; amount_off: number } | null;
  coupon_error?: string;
}

export default async function CartPage(
  { searchParams }: { searchParams: Promise<{ coupon?: string }> },
) {
  await requireSession();
  const { coupon = '' } = await searchParams;
  const qs = coupon ? `?coupon=${encodeURIComponent(coupon)}` : '';
  const [cart, gateways] = await Promise.all([
    apiAuthSafe<CartSummary>('/api/cart' + qs),
    apiAuthSafe<{ identifier: string; title: string | null; test_mode: boolean }[]>(
      '/api/payment/gateways'),
  ]);

  if (!cart || cart.items.length === 0) {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="text-2xl font-semibold">Your cart is empty</h1>
        <p className="mt-2 text-sm text-slate-600">Find something to learn next.</p>
        <Link href="/courses" className="btn-primary mt-6">Browse courses</Link>
      </div>
    );
  }

  return (
    <div className="container-page grid gap-8 py-10 lg:grid-cols-[1fr_320px]">
      <section>
        <h1 className="text-2xl font-semibold">Your cart</h1>
        <p className="mt-1 text-sm text-slate-500">
          {cart.items.length} {cart.items.length === 1 ? 'course' : 'courses'}
        </p>
        <ul className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200">
          {cart.items.map((item) => (
            <li key={item.cart_id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <Link href={`/course/${item.slug}`} className="font-medium hover:text-brand-600">
                  {item.title}
                </Link>
                <div className="mt-1 text-sm text-slate-500">
                  {item.discount_flag && item.discounted_price != null && (
                    <s className="mr-2">{currency(item.price)}</s>
                  )}
                  {item.effective_price === 0 ? 'Free' : currency(item.effective_price)}
                </div>
              </div>
              <CartClient mode="remove" courseId={item.id} />
            </li>
          ))}
        </ul>
      </section>

      <aside className="card h-fit p-5">
        <h2 className="text-sm font-semibold">Order summary</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt><dd>{currency(cart.subtotal)}</dd>
          </div>
          {cart.discount > 0 && (
            <div className="flex justify-between text-green-700">
              <dt>Discount ({cart.coupon?.discount}%)</dt>
              <dd>-{currency(cart.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
            <dt>Total</dt><dd>{currency(cart.total)}</dd>
          </div>
        </dl>

        <CartClient mode="coupon" applied={cart.coupon?.code ?? ''}
          error={cart.coupon_error ?? ''} />

        <CheckoutButton gateways={gateways ?? []} coupon={coupon} />
        <OfflinePaymentForm coupon={coupon} />
      </aside>
    </div>
  );
}
