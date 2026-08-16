/**
 * Small shared bits for the report pages. Kept as pure functions/constants (no components) so it
 * can sit beside the component-bearing ReportShell without tangling Fast Refresh.
 */

/**
 * All three reports are read-only and gated on ONE code of their own.
 *
 * They used to ride on ATTENDANCE_VIEW, which was wrong in the direction that costs access: the
 * leave-balance report is not an attendance screen, so anyone who needed a single balance figure had
 * to be handed the raw punch data to get at it. REPORT_VIEW separates the two.
 */
export const REPORT_VIEW = 'REPORT_VIEW'

/** Re-exported for the pages' convenience, so a page imports permissions from one place. */
export const PERMISSIONS = { view: REPORT_VIEW } as const

/** The current period, 'yyyy-MM'. */
export function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}`
}

/**
 * The last N months as 'yyyy-MM', newest first — the period picker's options.
 *
 * Built by walking back a month at a time rather than subtracting from the month number, so
 * December→January rolls the year correctly instead of producing '2026-00'.
 */
export function lastMonths(count: number): string[] {
  const out: string[] = []
  const d = new Date()
  d.setDate(1)
  for (let i = 0; i < count; i++) {
    out.push(`${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`)
    d.setMonth(d.getMonth() - 1)
  }
  return out
}

/** Today as 'yyyy-MM-dd' — the daily sheet's default date. */
export function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`
}

/* ── formatting (kept here, not in ReportShell, so that file exports only components) ── */

/** An API date/timestamp as a plain date: '2026-06-03T00:00:00' → '2026-06-03'. */
export function reportDate(value: string | null | undefined): string {
  if (!value) return '—'
  return value.slice(0, 10)
}

/** An API UTC timestamp as a readable local date-and-time, for the "Generated on" line. */
export function reportDateTime(value: string): string {
  const parsed = new Date(value.endsWith('Z') ? value : `${value}Z`)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

/** Minutes as 'Nh Nm' — reports show hours, because a manager reads a timesheet in hours, not minutes. */
export function reportMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return '—'
  if (minutes === 0) return '0'
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}
