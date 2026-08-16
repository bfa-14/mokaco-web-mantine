/**
 * Shared number/date formatting for the employee-profile tabs.
 *
 * WHY THIS FILE EXISTS. Each tab had its own `const fmtNum = (v: number) => v.toLocaleString(…)`,
 * typed as though the value could not be missing. That type is a promise the API does not keep:
 * add a column to a view and the frontend reads `undefined` for it until the server catches up, and
 * `undefined.toLocaleString()` does not render an empty cell — it throws, and React unmounts the
 * whole tab. One missing figure took out the entire profile page.
 *
 * So these are NULL-SAFE BY CONSTRUCTION and accept what actually arrives, not what the type
 * claims. A missing number reads as 0, which for a ledger balance is the truthful answer: nothing
 * has been posted. Every tab imports these rather than declaring its own, so the guarantee cannot
 * be re-lost one file at a time.
 */

/** What a JSON number field can really be before the API is caught up. */
type MaybeNumber = number | null | undefined

/** DX format="#,##0.##" — grouped thousands, up to two decimals. Missing reads as 0. */
export function fmtNumber(v: MaybeNumber): string {
  return (v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/**
 * The same figure with its SIGN KEPT — for adjustments, where the direction is the whole meaning.
 * A bare "2" cannot be told from "−2" at a glance, and the two are opposite facts about a balance.
 * Exact zero (and missing, which formats as zero) prints plain: "+0" would suggest something
 * happened when nothing did.
 */
export function fmtSigned(v: MaybeNumber): string {
  const n = v ?? 0
  return n > 0 ? `+${fmtNumber(n)}` : fmtNumber(n)
}

/** DX dataType="date" — the API timestamp shown as its plain date. Missing reads as empty. */
export function fmtDate(v: string | null | undefined): string {
  return v ? v.slice(0, 10) : ''
}

/** A byte count as B / KB / MB. Missing reads as 0 B rather than throwing on .toFixed. */
export function fmtBytes(bytes: MaybeNumber): string {
  const n = bytes ?? 0
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

/** An API timestamp as a local date+time. Missing reads as empty, never "Invalid Date". */
export function fmtDateTime(v: string | null | undefined): string {
  return v ? new Date(v).toLocaleString() : ''
}
