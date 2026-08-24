/**
 * An amount of money, written the way the person reading it writes it.
 *
 * Five screens had grown the same three lines -- `currency + ' ' + rupees +
 * '.' + paise` -- and all five printed "INR 300.00" on a product whose price
 * fields, catalogue and fee tables all say "₹300.00". A buy button is the
 * worst place to be the odd one out: it is the last thing somebody reads
 * before they are charged, and a currency CODE reads like a bank statement
 * where the symbol reads like a price.
 *
 * The code is still what appears for anything that is not INR, because there
 * is no symbol worth guessing at and "USD 40.00" is unambiguous where "$40.00"
 * would quietly conflate several dollars.
 */

/** Symbols worth showing. Everything else keeps its ISO code. */
const SYMBOLS: Record<string, string> = { INR: '₹' };

/**
 * @param minor  integer minor units -- paise, cents. The only form money
 *               takes in this product, because floating-point rupees is how
 *               a ledger ends up a paisa out.
 */
export function money(minor: number, currency: string = 'INR'): string {
  const code = String(currency || 'INR').toUpperCase();
  const symbol = SYMBOLS[code];
  const whole = Math.floor(Math.abs(minor) / 100).toLocaleString('en-IN');
  const paise = String(Math.abs(minor) % 100).padStart(2, '0');
  const sign = minor < 0 ? '-' : '';
  return symbol
    ? sign + symbol + whole + '.' + paise
    : sign + code + ' ' + whole + '.' + paise;
}
