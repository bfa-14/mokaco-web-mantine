/**
 * A DAY THAT IS STILL BEING WORKED IS NOT A FAULT.
 *
 * The processor flags a day whose punches do not pair (HasAnomaly). During the day that is the normal
 * state of everybody at work: an In with no Out yet. Payroll readiness counts COMPLETED days only (up to
 * yesterday), so today's open day is shown as "in progress" and is left out of the "could not be read"
 * counts; from tomorrow the same record is a missing punch, exactly as before.
 *
 * Only a day that HAS an In can be in progress: an Out with no In does not put itself right.
 * "Today" is the company's day (Beirut), the day the server judges by, not the browser's.
 *
 * Pure, no imports: `npm test` reads this file directly.
 */

/** The four fields of an attendance day this rule reads (AttendanceRecord has them all). */
export interface DayProgressInput {
  workDate: string
  firstInUtc: string | null
  lastOutUtc: string | null
  hasAnomaly: boolean
}

export type DayProgress =
  /** An In and no Out at all: at work since `since` (the API's timestamp of the first In). */
  | { kind: 'onShift'; since: string }
  /** Ins and Outs that do not pair yet (back from a break, most often). */
  | { kind: 'inProgress' }

/** Today on the company's clock, 'yyyy-MM-dd'. */
export function companyToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(now)
}

/** What today's unpaired day is, or null when the record is not one (no flag, another day, no In). */
export function dayProgress(record: DayProgressInput, today: string): DayProgress | null {
  if (!record.hasAnomaly || !record.firstInUtc) return null
  if (record.workDate.slice(0, 10) !== today) return null
  return record.lastOutUtc ? { kind: 'inProgress' } : { kind: 'onShift', since: record.firstInUtc }
}

/** A flagged day that needs somebody: every anomaly except a day still in progress. */
export function isOpenAnomaly(record: DayProgressInput, today: string): boolean {
  return record.hasAnomaly && dayProgress(record, today) === null
}

/** The day before a 'yyyy-MM-dd' day. Calendar arithmetic in UTC, so no timezone can shift the answer. */
export function dayBefore(day: string): string {
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}
