/**
 * What a Mantine NumberInput actually hands its onChange — and why a form must hold it AS IS.
 *
 * While the box holds a value it cannot yet express as a number without losing what was typed —
 * "8." (trailing separator), "1500.70" (trailing zero), "-" or "" — Mantine passes the raw STRING,
 * and only a settled value like 8.2 arrives as a number. A handler that did
 * `typeof v === 'number' ? v : 0` therefore wrote 0 back the moment "." was pressed, the controlled
 * box re-rendered as "0", and the decimal could never be typed. That is the Exchange-rates bug.
 *
 * So the rule for every decimal field: the form state is `string | number` exactly as received,
 * the box is bound to it unchanged, and the figure is coerced ONCE, on submit, through
 * {@link parseDecimal} — which is where "not a number" becomes a field error instead of a silent 0.
 */
export type NumberInputValue = string | number

/**
 * The number a NumberInput's value stands for, or null when it holds nothing / nothing numeric.
 * A blank box is null, never 0 — 0 is a figure somebody typed.
 */
export function parseDecimal(value: NumberInputValue | null | undefined): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}
