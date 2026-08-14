/**
 * Formatting helpers shared across the Attendance pages.
 *
 * These live together because the same handful of ideas — a duration, a fraction of a day,
 * a period — appear on nearly every screen, and they must read identically on all of them.
 * A user who learns what "0.89 of a day" means on one page should not have to relearn it
 * on the next.
 *
 * Pure functions only. The display components that use them live in attendanceShared.tsx,
 * which is kept separate so Fast Refresh keeps working.
 */
import { t } from '../../i18n/t'
import { currentLocale } from '../../i18n'
import './attendance.css'

/* ── durations ── */

/**
 * Minutes as a human duration: 430 → "7h 10m". People do not think in minutes, and
 * "430" on a payroll screen invites somebody to divide by 60 in their head and get it
 * wrong.
 */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return t('common.dash')
  if (minutes === 0) return t('common.zeroMinutes')

  const sign = minutes < 0 ? '-' : ''
  const total = Math.abs(minutes)
  const hours = Math.floor(total / 60)
  const mins = total % 60

  if (hours === 0) return sign + t('common.minutesOnly', { minutes: mins })
  if (mins === 0) return sign + t('common.hoursOnly', { hours })
  return sign + t('common.hoursMinutes', { hours, minutes: mins })
}

/** An API timestamp as a clock time: '2026-06-03T08:05:00' → '08:05'. */
export function formatTime(value: string | null | undefined): string {
  if (!value) return t('common.dash')
  const time = value.split('T')[1]
  return time ? time.slice(0, 5) : t('common.dash')
}

/** An API date/timestamp as a plain date: '2026-06-03T00:00:00' → '2026-06-03'. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return t('common.dash')
  return value.slice(0, 10)
}

/**
 * A day as people here read it: '2026-08-14' → '14/08/2026'.
 *
 * The same shape every DatePickerInput in the app shows (`valueFormat="DD/MM/YYYY"`), so a day
 * NAMED in a button or a sentence matches the day sitting in the picker beside it. Reshuffles the
 * string rather than going through `Date`: a 'yyyy-MM-dd' parsed as UTC and printed in a local
 * timezone behind Greenwich comes back as the previous day, which is precisely the class of bug
 * this page exists to make visible.
 */
export function formatDayLabel(value: string | null | undefined): string {
  if (!value) return t('common.dash')
  const [year, month, day] = value.slice(0, 10).split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}

/**
 * A day status as the words StatusBadge puts on screen. Extracted from the badge so the grids'
 * filter row can offer — and match — exactly the labels the user is reading, rather than the
 * 'RestDay'-style codes underneath them. An unknown status renders as its own code.
 */
export function statusText(status: string): string {
  return t(`attendance.status.${status}`, { defaultValue: status })
}

/* ── periods ── */

/** A Date as the 'yyyy-MM-dd' string the API expects. */
export function toDateString(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** The current payroll period, 'yyyy-MM'. */
export function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}`
}

/** The first and last day of a 'yyyy-MM' period, as API date strings. */
export function periodRange(period: string): { from: string; to: string } {
  const [year, month] = period.split('-').map(Number)
  return {
    from: toDateString(new Date(year, month - 1, 1)),
    // Day 0 of the next month is the last day of this one, leap years included.
    to: toDateString(new Date(year, month, 0)),
  }
}

/** '2026-06' → 'June 2026', for prose like "June is ready to pay". */
export function periodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number)
  if (!year || !month) return period
  // The APP's language, not 'en-US' and not the browser's — an Arabic page must not headline an
  // English month name. Western digits come with the locale; see src/i18n/lang.ts.
  return new Date(year, month - 1, 1).toLocaleString(currentLocale(), {
    month: 'long',
    year: 'numeric',
  })
}

/** 'yyyy-MM' of the month before the given period — what "copy previous month" copies FROM. */
export function previousPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number)
  const date = new Date(year, month - 2, 1)
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`
}

/** Every day in a period, as API date strings — the columns of the roster matrix. */
export function daysInPeriod(period: string): string[] {
  const [year, month] = period.split('-').map(Number)
  const last = new Date(year, month, 0).getDate()
  const days: string[] = []
  for (let day = 1; day <= last; day++) {
    days.push(toDateString(new Date(year, month - 1, day)))
  }
  return days
}

/** Mon…Sun initial for a date string, for the roster matrix header. */
export function weekdayInitial(date: string): string {
  // Keyed by JavaScript's own 0=Sunday index, so the table stays a plain lookup in both languages.
  return t(`attendance.weekdayInitial.${new Date(`${date}T00:00:00`).getDay()}`)
}

/** Saturday or Sunday — shaded in the roster so the weeks are readable at a glance. */
export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00`).getDay()
  return day === 0 || day === 6
}

/**
 * Says WHY a day is anomalous, in words. "punched in at 08:00, never punched out" tells
 * somebody what to do; a flag called HasAnomaly does not.
 */
export function describeAnomaly(record: {
  firstInUtc: string | null
  lastOutUtc: string | null
  punchPairs: number
  status: string
}): string {
  const { firstInUtc, lastOutUtc, punchPairs } = record

  if (firstInUtc && !lastOutUtc) {
    return t('attendance.anomalyText.neverOut', { time: formatTime(firstInUtc) })
  }
  if (!firstInUtc && lastOutUtc) {
    return t('attendance.anomalyText.neverIn', { time: formatTime(lastOutUtc) })
  }
  if (!firstInUtc && !lastOutUtc) {
    return t('attendance.anomalyText.none')
  }
  if (punchPairs === 0) {
    return t('attendance.anomalyText.unpaired', {
      in: formatTime(firstInUtc),
      out: formatTime(lastOutUtc),
    })
  }
  return t('attendance.anomalyText.leftOver', { count: punchPairs })
}
