/**
 * A LINK TO ONE DAY OF ONE PERSON ON THE ROSTER.
 *
 * "Open roster" used to carry the month only, which left the reader to find one 32px cell in a grid of
 * thirty columns. The link now names the person, the day and the branch of that day; the Roster page
 * opens on that month and branch, scrolls the cell into view and flashes it.
 *
 * Pure, no imports: `npm test` reads this file directly.
 */

/** Where the Roster page should land. */
export interface RosterFocus {
  employeeId: number
  /** 'yyyy-MM-dd' */
  date: string
  branchId: number | null
}

/** /attendance/roster?period=yyyy-MM&employeeId=N&date=yyyy-MM-dd[&branchId=N] for a day ('yyyy-MM-dd…'). */
export function rosterDayLink(day: { employeeId: number; workDate: string; branchId?: number | null }): string {
  const date = day.workDate.slice(0, 10)
  const params = new URLSearchParams({ period: date.slice(0, 7), employeeId: String(day.employeeId), date })
  if (day.branchId != null) params.set('branchId', String(day.branchId))
  return `/attendance/roster?${params.toString()}`
}

/**
 * The focus a URL asks for, or null when it asks for none or asks badly (a person and a real date are
 * both required; a branch is optional). Never throws: a mangled link opens the roster as usual.
 */
export function rosterFocusOf(params: URLSearchParams): RosterFocus | null {
  const employeeId = Number(params.get('employeeId'))
  const date = params.get('date') ?? ''
  if (!Number.isInteger(employeeId) || employeeId <= 0) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const [year, month, day] = date.split('-').map(Number)
  const real = new Date(Date.UTC(year, month - 1, day))
  if (real.getUTCFullYear() !== year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) return null
  const branch = Number(params.get('branchId'))
  return { employeeId, date, branchId: Number.isInteger(branch) && branch > 0 ? branch : null }
}
