/**
 * EXCHANGE RATES AT FULL PRECISION (QA3 CON-9, item 2 of unit E).
 *
 * core.EXCHANGE_RATE.Rate is DECIMAL(28,12) since script 103, and the API's writes go to procedures that
 * take 12 decimals. A rate below 1 is ordinary — LBP -> USD is 1/89,500 = 0.000011173184 — and with four
 * decimals the box and the grid turned it into 0, the figure that once priced every LBP amount of a
 * locked run at zero. The box takes 12 decimals and the grid shows what is stored.
 *
 * No imports, nothing that reads the browser: `npm test` runs this with Node alone.
 */
export const RATE_DECIMALS = 12

/** Thousands separators, up to 12 decimals, trailing zeros dropped. `locale` is for tests; the page passes none. */
export function formatRate(value: number, locale?: string): string {
  return value.toLocaleString(locale, { maximumFractionDigits: RATE_DECIMALS })
}

/** The other direction of a rate, for the hint under the box ("1 USD = 89,500 LBP"); null when it cannot be. */
export function inverseRate(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  return 1 / value
}
