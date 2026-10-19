/**
 * The booking clock after midnight, as pure functions — no React, no i18n, so `npm test` runs them
 * (tests/bookingTimes.test.ts). QA3 BKG-2 / WEB-1.
 *
 * THE MODEL IS THE DATABASE'S (SQL 89, handoff §7.6): a booking is a DATE plus MINUTES FROM THAT
 * DATE'S MIDNIGHT. The rooms open 07:00 and close 01:00 the next day, so a day's window runs 420–1500
 * and a 22:00–01:00 booking is ONE row, 1320–1500. A close at or before 06:00 is the next morning
 * (CloseMin = 1440 + minutes), an end at or before the start is the next morning (EndMin = 1440 +
 * minutes), and nothing ends after 06:00 the next morning (EndMin ≤ 1800). A START after midnight is
 * stored on the NEXT date (the website sends Monday's "12:00 AM" as Tuesday 0–60) — on the calendar it
 * belongs to the previous day's column, at 1440–1500, where its night is.
 *
 * The calendar used clock times: 01:00 became minute 60 of the day, the window ended at 24:00, and a
 * room open 07:00–01:00 drew a grid of negative height. The forms refused 22:00–01:00 as "end before
 * start". Everything here works on the minutes instead.
 */

/** A close at or before this (06:00) is the next morning; so is a form's end at or before its start. */
export const NEXT_MORNING_LIMIT = 6 * 60

/** The latest any span may end: 06:00 the next morning, the procedures' own bound. */
export const MAX_END_MIN = 1440 + NEXT_MORNING_LIMIT

const DAY = 1440

/** 'HH:mm[:ss]' → minutes since midnight (0–1439). */
export function clockMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return (hours || 0) * 60 + (minutes || 0)
}

/** Minutes, possibly past midnight (1500), → the clock time 'HH:mm' ('01:00'). */
export function clockOf(minutes: number): string {
  const wrapped = ((Math.round(minutes) % DAY) + DAY) % DAY
  const hours = Math.floor(wrapped / 60)
  const rest = wrapped % 60
  return `${`${hours}`.padStart(2, '0')}:${`${rest}`.padStart(2, '0')}`
}

/** 'HH:mm' plus some minutes, wrapping past midnight: '23:30' + 60 → '00:30'. */
export function addClock(value: string, minutes: number): string {
  return clockOf(clockMinutes(value) + minutes)
}

/** A room's closing time in its day's minutes: 01:00 → 1500, 00:00 → 1440, 22:00 → 1320 (booking.ROOM_HOURS.CloseMin). */
export function closeMinOf(closeTime: string): number {
  const minutes = clockMinutes(closeTime)
  return minutes <= NEXT_MORNING_LIMIT ? DAY + minutes : minutes
}

/** Minutes from midnight of the item's own date. */
export interface Span {
  start: number
  end: number
}

/**
 * A booking's or block's span on its own date: the API's startMin/endMin when it sent them, else the
 * two clock times with the table's rule (an end at or before the start is the next day).
 */
export function spanOf(item: {
  startTime: string
  endTime: string
  startMin?: number | null
  endMin?: number | null
}): Span {
  if (typeof item.startMin === 'number' && typeof item.endMin === 'number' && item.endMin > item.startMin) {
    return { start: item.startMin, end: item.endMin }
  }
  const start = clockMinutes(item.startTime)
  const end = clockMinutes(item.endTime)
  return { start, end: end <= start ? end + DAY : end }
}

/**
 * The span a staff form means (New booking, Block room): an end at or before the start is the next
 * morning when it is 06:00 or earlier — 22:00 → 01:00 is 1320–1500, three hours. Null when there is
 * no such span: the same time twice, or a "next morning" after 06:00 (22:00 → 07:00). The API applies
 * the same rule (BookingsController.SpanProblem).
 */
export function formSpan(startTime: string, endTime: string): Span | null {
  if (!startTime || !endTime) return null
  const start = clockMinutes(startTime)
  const end = clockMinutes(endTime)
  if (end > start) return { start, end }
  if (end === start || end > NEXT_MORNING_LIMIT) return null
  return { start, end: end + DAY }
}

/** The hours a form's span lasts, 0 when it has none. */
export function formHours(startTime: string, endTime: string): number {
  const span = formSpan(startTime, endTime)
  return span ? (span.end - span.start) / 60 : 0
}

/** One weekday's hours as the API sends them. */
export interface HoursLike {
  openTime: string
  closeTime: string
  isClosed: boolean
}

/** Fallback window when nothing on screen is open: the 09:00–22:00 a new room is born with. */
export const DEFAULT_WINDOW: Span = { start: 9 * 60, end: 22 * 60 }

/**
 * The vertical window the calendar draws, in the minutes of a column's own date: the earliest
 * opening to the latest closing of the hours on screen (a 01:00 close is 1500), widened to whole hours
 * and then to cover every span that has to be drawn; never below 0 or past 1800.
 */
export function calendarWindow(hours: HoursLike[], spans: Span[] = []): Span {
  const open = hours.filter((h) => !h.isClosed)
  let start = open.length ? Math.min(...open.map((h) => clockMinutes(h.openTime))) : DEFAULT_WINDOW.start
  let end = open.length ? Math.max(...open.map((h) => closeMinOf(h.closeTime))) : DEFAULT_WINDOW.end
  for (const span of spans) {
    start = Math.min(start, span.start)
    end = Math.max(end, span.end)
  }
  start = Math.max(0, Math.floor(start / 60) * 60)
  end = Math.min(MAX_END_MIN, Math.ceil(end / 60) * 60)
  return { start, end: Math.max(end, start + 60) }
}

/** The ISO day before / after ('yyyy-MM-dd'), computed at UTC midnight so no timezone can shift it. */
export function shiftDay(isoDay: string, days: number): string {
  const [year, month, day] = isoDay.slice(0, 10).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

/** Where an item lands: the column's day, and its span in THAT day's minutes. */
export interface Placed<T> extends Span {
  day: string
  item: T
}

/**
 * Which column each item is drawn in, and where.
 *
 * An item is drawn in its own date's column — unless it STARTS before the window (the earliest
 * opening on screen), its previous date is on screen and it fits in that date's late window: then it is
 * the after-midnight part of the previous night and is drawn there, 1440 minutes on (the website's
 * Tuesday 00:00–01:00 appears under Monday at 24:00–25:00, after Monday 23:00–00:00). An item whose
 * column is not on screen is not drawn (the extra day the calendar fetches for exactly this).
 *
 * `window` is the window of the HOURS (calendarWindow without spans), so the rule does not depend
 * on what else happens to be booked.
 */
export function placeInColumns<T>(
  items: T[],
  dayOf: (item: T) => string,
  spanOfItem: (item: T) => Span,
  days: string[],
  window: Span,
): Placed<T>[] {
  const onScreen = new Set(days)
  const placed: Placed<T>[] = []
  for (const item of items) {
    const day = dayOf(item).slice(0, 10)
    const { start, end } = spanOfItem(item)
    const previous = shiftDay(day, -1)
    if (start < window.start && onScreen.has(previous) && start + DAY < window.end) {
      placed.push({ day: previous, item, start: start + DAY, end: Math.min(end + DAY, MAX_END_MIN) })
    } else if (onScreen.has(day)) {
      placed.push({ day, item, start, end })
    }
  }
  return placed
}

/**
 * What a slot chosen on the calendar means to the forms: a start at or after midnight (1440+) of a
 * column is the NEXT date's clock time — how the API and the website store it; a span running past
 * midnight keeps its date and ends "the next morning" (the forms' rule).
 */
export function slotToForm(columnDay: string, startMin: number, endMin: number): { date: string; start: string; end: string } {
  if (startMin >= DAY) {
    return { date: shiftDay(columnDay, 1), start: clockOf(startMin - DAY), end: clockOf(endMin - DAY) }
  }
  return { date: columnDay.slice(0, 10), start: clockOf(startMin), end: clockOf(endMin) }
}

/**
 * Where the red "now" line goes in a column, or null: today's column at the current minute, and —
 * after midnight, while the previous night's window is still running — yesterday's column at 1440+.
 */
export function nowInColumn(columnDay: string, todayIso: string, nowMinutes: number, window: Span): number | null {
  if (columnDay === todayIso) return nowMinutes >= window.start && nowMinutes <= window.end ? nowMinutes : null
  if (columnDay === shiftDay(todayIso, -1)) {
    const late = nowMinutes + DAY
    return late >= window.start && late <= window.end ? late : null
  }
  return null
}
