import type { ShiftChange } from '../../types/attendance'

/**
 * A SHIFT'S CHANGE LOG IN PLAIN WORDS (script 122): one line per change, newest first —
 * "22 Nov 2026, Reda: hours 08:00–16:00 → 09:00–17:00 from 1 Dec 2026".
 *
 * Pure: the words come in through `ChangeLogWords` (the page passes i18next's `t` and its own date and duration
 * formatters), so the same lines are checked by the node tests without a translation framework.
 */

export type Translate = (key: string, options?: Record<string, unknown>) => string

export interface ChangeLogWords {
  t: Translate
  /** 'yyyy-MM-dd' → the day as the reader says it ('22 Nov 2026'). */
  day: (isoDate: string) => string
  /** A number of minutes as the app prints it ('30m', '1h 30m'). */
  minutes: (minutes: number) => string
}

export const CHANGE_LOG_KEYS = 'attendance.shiftsPage.changeLog.'
const K = CHANGE_LOG_KEYS

/** A shift's first hours are dated 2000-01-01: they count for every day before any change. */
export const FIRST_HOURS_DAY = '2000-01-01'

/** The two notes the database writes itself on a shift's first hours (script 117): the line already says it. */
const FIRST_HOURS_NOTES = ['The hours the shift was created with', 'The hours the shift had when its history began']

/** The note script 117 writes on the version that brings the hours back after a change for a period. */
const BACK_NOTE = /^Back to the hours before the change of (\d{2})\/(\d{2})\/(\d{4})$/

const ymd = (value: string | null | undefined): string | null => (value ? value.slice(0, 10) : null)
const clock = (time: string | null | undefined): string => (time ? time.slice(0, 5) : '')

/** '22:00–06:00 (overnight)' — the overnight mark only when the shift crosses midnight. */
export function hoursText(start: string | null, end: string | null, crossesMidnight: boolean | null, w: ChangeLogWords): string {
  const span = `${clock(start)}–${clock(end)}`
  return crossesMidnight ? `${span} ${w.t(`${K}overnight`)}` : span
}

/** A shift's grace: its own minutes, or the company's tolerance setting (null). */
function graceText(minutes: number | null, w: ChangeLogWords): string {
  return minutes == null ? w.t(`${K}graceSetting`) : w.minutes(minutes)
}

/** When the hours apply: "for every day", "from 1 Dec 2026", "from 1 Dec 2026 to 31 Dec 2026". */
function periodText(change: ShiftChange, w: ChangeLogWords): string {
  const from = ymd(change.effectiveFrom)
  if (!from) return ''
  if (from === FIRST_HOURS_DAY) return w.t(`${K}allDays`)
  const to = ymd(change.effectiveTo)
  return to ? w.t(`${K}fromTo`, { from: w.day(from), to: w.day(to) }) : w.t(`${K}fromDay`, { day: w.day(from) })
}

/** What an hours line changed: the hours, the break, the grace — only the parts that differ. */
function hoursParts(change: ShiftChange, w: ChangeLogWords): string[] {
  const after = hoursText(change.newStartTime, change.newEndTime, change.newCrossesMidnight, w)
  if (change.oldStartTime == null) return [w.t(`${K}hoursSet`, { to: after })]

  const parts: string[] = []
  const before = hoursText(change.oldStartTime, change.oldEndTime, change.oldCrossesMidnight, w)
  if (before !== after) parts.push(w.t(`${K}hours`, { from: before, to: after }))
  const oldBreak = change.oldBreakMinutes ?? 0
  const newBreak = change.newBreakMinutes ?? 0
  if (oldBreak !== newBreak) parts.push(w.t(`${K}break`, { from: w.minutes(oldBreak), to: w.minutes(newBreak) }))
  if ((change.oldGraceMinutes ?? null) !== (change.newGraceMinutes ?? null)) {
    parts.push(w.t(`${K}grace`, { from: graceText(change.oldGraceMinutes, w), to: graceText(change.newGraceMinutes, w) }))
  }
  return parts
}

/** What happened, without the date and the person: "hours 08:00–16:00 → 09:00–17:00 from 1 Dec 2026". */
export function describeShiftChange(change: ShiftChange, w: ChangeLogWords): string {
  switch (change.action) {
    case 'Created':
      return w.t(`${K}created`, { hours: hoursText(change.newStartTime, change.newEndTime, change.newCrossesMidnight, w) })
    case 'HoursChanged': {
      const parts = hoursParts(change, w)
      const what = parts.length > 0 ? parts.join(w.t(`${K}joiner`)) : w.t(`${K}hoursRewritten`)
      const period = periodText(change, w)
      return period ? `${what} ${period}` : what
    }
    case 'HoursRemoved': {
      const from = ymd(change.effectiveFrom)
      const day = !from ? '' : from === FIRST_HOURS_DAY ? w.t(`${K}allDays`) : w.day(from)
      const removed = hoursText(change.oldStartTime, change.oldEndTime, change.oldCrossesMidnight, w)
      return change.newStartTime
        ? w.t(`${K}removed`, { day, hours: removed, back: hoursText(change.newStartTime, change.newEndTime, change.newCrossesMidnight, w) })
        : w.t(`${K}removedNone`, { day, hours: removed })
    }
    case 'Renamed':
      return w.t(`${K}renamed`, { from: change.oldName ?? '', to: change.newName ?? '' })
    case 'Deactivated':
      return w.t(`${K}deactivated`)
    case 'Activated':
      return w.t(`${K}activated`)
    case 'DaysNotRederived': {
      const from = ymd(change.effectiveFrom)
      const to = ymd(change.effectiveTo) ?? from
      return w.t(`${K}daysNotRederived`, { count: change.daysCount ?? 0, from: from ? w.day(from) : '', to: to ? w.day(to) : '' })
    }
    default:
      return change.action
  }
}

/** The whole line: "22 Nov 2026, Reda: …" (or "22 Nov 2026: …" when nobody is known). */
export function shiftChangeLine(change: ShiftChange, w: ChangeLogWords): string {
  const date = w.day(change.changedOn.slice(0, 10))
  const what = describeShiftChange(change, w)
  return change.changedBy ? w.t(`${K}lineBy`, { date, who: change.changedBy, what }) : w.t(`${K}line`, { date, what })
}

/**
 * The note worth printing under a line: the reason a person typed. The database's own notes are said by the line
 * already (the first hours, the days not worked out again) or are put in the reader's language (the hours coming
 * back after a period).
 */
export function shiftChangeNote(change: ShiftChange, w: ChangeLogWords): string | null {
  const note = change.note?.trim()
  if (!note || change.action === 'DaysNotRederived' || FIRST_HOURS_NOTES.includes(note)) return null
  const back = BACK_NOTE.exec(note)
  if (back) return w.t(`${K}noteBack`, { day: w.day(`${back[3]}-${back[2]}-${back[1]}`) })
  return note
}

/** A day the way the change log says it: '22 Nov 2026' in English, the Arabic month name in Arabic. */
export function changeLogDay(isoDate: string, locale: string): string {
  const day = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(day.getTime())) return isoDate
  // 'en' alone is month-first (Nov 22, 2026); the day-month-year order is what people here read.
  const tag = locale === 'en' || locale.startsWith('en-') ? 'en-GB' : locale
  return new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(day)
}
