// Shared Stripe minor-unit conversion for the business<->customer payment
// rail (appointments and invoices). Zero-decimal currencies are charged in
// whole units; everything else in cents.

const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG",
  "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

export function toMinorUnits(amount: number, currency: string): number {
  return Math.round(amount * (ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100));
}
