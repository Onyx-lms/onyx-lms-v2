import { currency } from '@/lib/format';

export interface BootcampCard {
  id: number; title: string | null; slug: string | null; short_description: string | null;
  thumbnail: string | null; is_paid: number | null; price: number | null;
  discount_flag: number | null; discounted_price: number | null;
  instructor: { id: number; name: string | null } | null;
  category: { id: number; title: string; slug: string } | null;
}

/**
 * BC-06 pricing. For a workshop `discounted_price` is the amount TAKEN OFF,
 * unlike a course where the same column holds the final price. That difference
 * is in the Laravel source, not a mistake here -- see
 * packages/core/src/bootcamp/purchase.service.ts.
 */
export function workshopPrice(
  b: Pick<BootcampCard, 'is_paid' | 'price' | 'discount_flag' | 'discounted_price'>,
  position: string,
) {
  if (!b.is_paid) return { label: 'Free', was: null as string | null };
  const list = Number(b.price ?? 0);
  if (!b.discount_flag) return { label: currency(list, position), was: null };
  const net = Math.max(0, list - Number(b.discounted_price ?? 0));
  return { label: currency(net, position), was: currency(list, position) };
}
