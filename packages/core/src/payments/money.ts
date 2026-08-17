/**
 * PAY-07 -- money handling.
 *
 * All arithmetic happens in MINOR UNITS (integer cents). Floating point money
 * is how you end up charging 9.999999 for a 10.00 course, and the difference
 * only shows up in reconciliation weeks later.
 */

/** Currencies that have no minor unit, so amounts are passed as whole numbers. */
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
  'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

export function isZeroDecimal(currency: string): boolean {
  return ZERO_DECIMAL.has((currency ?? '').toUpperCase());
}

/** 10.5 USD -> 1050 ; 1050 JPY -> 1050 */
export function toMinorUnits(amount: number, currency: string): number {
  const value = Number(amount ?? 0);
  return isZeroDecimal(currency) ? Math.round(value) : Math.round(value * 100);
}

export function fromMinorUnits(minor: number, currency: string): number {
  return isZeroDecimal(currency) ? Math.round(minor) : Math.round(minor) / 100;
}

/** Rounds a display amount to 2dp without floating-point drift. */
export function round2(amount: number): number {
  return Math.round((Number(amount ?? 0) + Number.EPSILON) * 100) / 100;
}

export interface TaxResult { rate: number; amount: number }

/**
 * Tax is a percentage from settings, applied to the post-discount subtotal --
 * the same order the Laravel cart used.
 */
export function calculateTax(taxableAmount: number, ratePercent: number | null | undefined): TaxResult {
  const rate = Math.max(0, Number(ratePercent ?? 0));
  if (!rate) return { rate: 0, amount: 0 };
  return { rate, amount: round2((taxableAmount * rate) / 100) };
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  taxRate: number;
  total: number;
}

export function computeTotals(
  subtotal: number, discount: number, taxRatePercent: number | null | undefined,
): OrderTotals {
  const sub = round2(subtotal);
  // A coupon can never make the order negative.
  const disc = Math.min(round2(discount), sub);
  const taxable = round2(sub - disc);
  const { rate, amount } = calculateTax(taxable, taxRatePercent);
  return {
    subtotal: sub,
    discount: disc,
    taxable,
    tax: amount,
    taxRate: rate,
    total: round2(taxable + amount),
  };
}

export interface RevenueSplit { adminRevenue: number; instructorRevenue: number }

/**
 * PAY-05 -- revenue split for ONE item.
 *
 * CORRECTS A LARAVEL BUG. PurchaseCourse::purchase_course computes the split
 * inside the per-item loop but uses `payable_amount` -- the whole order total --
 * for every item. A two-item cart therefore books the entire order value as
 * revenue twice. Here the split is computed from the item's own amount.
 *
 * Preserved: a course authored by an admin gives the platform 100%; otherwise
 * the instructor takes the configured percentage.
 */
export function splitRevenue(
  itemAmount: number, instructorSharePercent: number | null | undefined, creatorIsAdmin: boolean,
): RevenueSplit {
  const amount = round2(itemAmount);
  if (creatorIsAdmin) return { adminRevenue: amount, instructorRevenue: 0 };
  const share = Math.min(100, Math.max(0, Number(instructorSharePercent ?? 0)));
  const instructorRevenue = round2((amount * share) / 100);
  return { adminRevenue: round2(amount - instructorRevenue), instructorRevenue };
}

/**
 * Distributes an order-level discount across items in proportion to price, so
 * per-item revenue still sums to what the customer actually paid. The last item
 * absorbs any rounding remainder rather than leaving the books a cent short.
 */
export function allocateDiscount(prices: number[], discount: number): number[] {
  const subtotal = prices.reduce((a, b) => a + b, 0);
  if (subtotal <= 0 || discount <= 0) return prices.map(() => 0);

  const capped = Math.min(discount, subtotal);
  const allocations = prices.map((p) => round2((p / subtotal) * capped));
  const drift = round2(capped - allocations.reduce((a, b) => a + b, 0));
  if (drift !== 0 && allocations.length > 0) {
    allocations[allocations.length - 1] = round2(allocations[allocations.length - 1]! + drift);
  }
  return allocations;
}
