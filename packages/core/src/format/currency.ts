/**
 * Port of currency() from app/Helpers/Common_helper.php.
 *
 * Quirk preserved on purpose: PHP concatenates the rounded float, so 12.50
 * renders as "$12.5", not "$12.50". Formatting it "properly" here would make
 * every price on the site differ from the Laravel original.
 */
export type CurrencyPosition = 'left' | 'right' | 'left-space' | 'right-space';

export function currency(
  price: number | null | undefined,
  opts: { position?: CurrencyPosition | null; symbol?: string | null } = {},
): string {
  const position = (opts.position || 'left') as CurrencyPosition;
  const symbol = opts.symbol || '$';

  const rounded = Math.max(0, Math.round(Number(price ?? 0) * 100) / 100);
  const n = String(rounded);

  switch (position) {
    case 'right': return n + symbol;
    case 'right-space': return n + ' ' + symbol;
    case 'left-space': return symbol + ' ' + n;
    default: return symbol + n;
  }
}
