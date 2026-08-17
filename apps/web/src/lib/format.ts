/**
 * Mirrors currency() from the Laravel helper, including the quirk that 12.50
 * renders as "12.5" -- prices must match the original site exactly.
 */
export function currency(
  price: number | null | undefined,
  position: string | null = 'left',
  symbol = '$',
): string {
  const rounded = Math.max(0, Math.round(Number(price ?? 0) * 100) / 100);
  const n = String(rounded);
  if (position === 'right') return n + symbol;
  if (position === 'right-space') return n + ' ' + symbol;
  if (position === 'left-space') return symbol + ' ' + n;
  return symbol + n;
}

export function coursePrice(
  c: { is_paid: number | null; price: number | null; discount_flag: number | null; discounted_price: number | null },
  position: string | null,
): { label: string; was: string | null } {
  if (!c.is_paid) return { label: 'Free', was: null };
  if (c.discount_flag && c.discounted_price != null) {
    return { label: currency(c.discounted_price, position), was: currency(c.price, position) };
  }
  return { label: currency(c.price, position), was: null };
}
