import { t } from '../../i18n/t'
import type { BookingStatus, RoomHours } from '../../types/booking'

/**
 * The handful of ideas every Bookings screen shares: the two permissions, the date and time
 * arithmetic the calendar runs on, and how a status is coloured and named.
 *
 * Pure functions only — no components, so Fast Refresh keeps working and so the calendar's hot
 * inner loops can call these without dragging React in.
 *
 * NOTHING HERE CONSTRUCTS A `Date` FROM AN API STRING. Dates are sliced as text and times are
 * compared as text, for the reason the attendance formatters already document: a 'yyyy-MM-dd'
 * parsed as UTC and printed west of Greenwich comes back as the day before. The only `Date` objects
 * in this file are built from explicit year/month/day numbers, which is safe.
 */

/* ── permissions ─────────────────────────────────────────────────────────────────────────────── */

/** Read the calendar, a receipt and the report. */
export const BOOKING_VIEW = 'BOOKING_VIEW'

/** Take, decide and collect against bookings; block rooms; edit the catalogue. */
export const BOOKING_MANAGE = 'BOOKING_MANAGE'

export const PERMISSIONS = { view: BOOKING_VIEW, manage: BOOKING_MANAGE } as const

/* ── dates ───────────────────────────────────────────────────────────────────────────────────── */

/** A Date as 'yyyy-MM-dd', built from its local parts so no timezone can shift it. */
export function isoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Today, 'yyyy-MM-dd'. */
export function today(): string {
  return isoDate(new Date())
}

/** 'yyyy-MM-dd' → a local Date at midnight. Parsed part by part, never by `new Date(string)`. */
export function fromIso(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** N days after (or, negative, before) an ISO day — still 'yyyy-MM-dd'. */
export function addDays(value: string, days: number): string {
  const date = fromIso(value)
  date.setDate(date.getDate() + days)
  return isoDate(date)
}

/**
 * The MONDAY of the week containing this day.
 *
 * Monday-first because the rooms' opening hours are stored 1=Monday..7=Sunday, and a week view whose
 * columns disagreed with the hours table would show a room open on the wrong day. JavaScript's
 * getDay() is Sunday=0, so the shift is `(day + 6) % 7`.
 */
export function startOfWeek(value: string): string {
  const date = fromIso(value)
  const shift = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - shift)
  return isoDate(date)
}

/** The seven ISO days of the week containing this one, Monday first. */
export function weekDays(value: string): string[] {
  const monday = startOfWeek(value)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/**
 * The room-hours weekday number for an ISO day: 1 = Monday … 7 = Sunday.
 *
 * The one conversion between JavaScript's Sunday-first week and the database's Monday-first one.
 * Written once here because getting it wrong shifts a whole room's opening hours by a day, silently.
 */
export function dayOfWeek(value: string): number {
  return ((fromIso(value).getDay() + 6) % 7) + 1
}

/** '2026-09-05' → '05/09/2026', the shape every date picker in this app displays. */
export function dayLabel(value: string | null | undefined): string {
  if (!value) return t('common.dash')
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

/** The weekday's name, from the shared 1..7 table the rest of the app already uses. */
export function weekdayName(isoDay: string): string {
  return t(`common.weekday.${dayOfWeek(isoDay)}`)
}

/** An API UTC timestamp as readable local text, for "received on" lines. */
export function stamp(value: string | null | undefined): string {
  if (!value) return t('common.dash')
  const parsed = new Date(value.endsWith('Z') ? value : `${value}Z`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

/* ── times ───────────────────────────────────────────────────────────────────────────────────── */

/** 'HH:mm:ss' (or 'HH:mm') → 'HH:mm'. The form every screen shows. */
export function hhmm(value: string | null | undefined): string {
  if (!value) return t('common.dash')
  return value.slice(0, 5)
}

/** 'HH:mm[:ss]' → minutes since midnight. The calendar's whole geometry is built on this. */
export function minutesOf(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + (minutes || 0)
}

/** Minutes since midnight → 'HH:mm'. */
export function fromMinutes(total: number): string {
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return `${`${hours}`.padStart(2, '0')}:${`${minutes}`.padStart(2, '0')}`
}

/**
 * 'HH:mm' → 'HH:mm:00'.
 *
 * The API carries times as TimeSpan and the inputs produce 'HH:mm', so the seconds are appended at
 * the boundary — the same convention the shift and roster screens use.
 */
export function withSeconds(value: string): string {
  return value.length === 5 ? `${value}:00` : value
}

/** Two half-open intervals sharing any minute. Touching ends (10:00–11:00, 11:00–12:00) do NOT overlap. */
export function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && aEnd > bStart
}

/* ── the calendar's window ───────────────────────────────────────────────────────────────────── */

/** Fallback opening window when a room has no hours at all — the same 09:00–22:00 a new room is born with. */
export const DEFAULT_OPEN_MINUTES = 9 * 60
export const DEFAULT_CLOSE_MINUTES = 22 * 60

/** The calendar's row height, in pixels per hour. Also what turns a booking's minutes into a block. */
export const PIXELS_PER_HOUR = 56

/**
 * The vertical window the calendar draws: the earliest open and latest close across the rooms and
 * days on screen, widened to whole hours.
 *
 * COMPUTED FROM THE HOURS ACTUALLY SHOWN rather than fixed at 00:00–24:00, because a grid with
 * fourteen empty small hours at the top pushes the working day off the screen. Rooms that are closed
 * on every day in view contribute nothing, which is why the default window is the fallback.
 */
export function visibleWindow(hours: RoomHours[]): { start: number; end: number } {
  const open = hours.filter((h) => !h.isClosed)
  if (open.length === 0) {
    return { start: DEFAULT_OPEN_MINUTES, end: DEFAULT_CLOSE_MINUTES }
  }

  const earliest = Math.min(...open.map((h) => minutesOf(h.openTime)))
  const latest = Math.max(...open.map((h) => minutesOf(h.closeTime)))

  return {
    start: Math.floor(earliest / 60) * 60,
    end: Math.min(24 * 60, Math.ceil(latest / 60) * 60),
  }
}

/* ── status ──────────────────────────────────────────────────────────────────────────────────── */

/** The five statuses, in the order a filter should offer them. */
export const BOOKING_STATUSES: BookingStatus[] = [
  'Pending',
  'Confirmed',
  'Completed',
  'Cancelled',
  'NoShow',
]

/**
 * The Mantine colour each status wears, everywhere it appears.
 *
 * Amber for Pending because it is the one status that is WAITING for somebody — the calendar's job
 * is to make those findable. Cancelled and NoShow share red; they are told apart by the strike-through
 * the calendar and the grid both apply, not by hue, because two shades of red is not a distinction
 * anyone can read at a glance.
 */
export const STATUS_COLOR: Record<BookingStatus, string> = {
  Pending: 'yellow',
  Confirmed: 'green',
  Completed: 'gray',
  Cancelled: 'red',
  NoShow: 'red',
}

/** The CSS modifier for a booking block, matching the colours above. */
export const STATUS_CLASS: Record<BookingStatus, string> = {
  Pending: 'bk-ev--pending',
  Confirmed: 'bk-ev--confirmed',
  Completed: 'bk-ev--completed',
  Cancelled: 'bk-ev--cancelled',
  NoShow: 'bk-ev--noshow',
}

/** Struck through in the calendar and the grid: the booking happened to nobody. */
export function isStruck(status: BookingStatus): boolean {
  return status === 'Cancelled' || status === 'NoShow'
}

/** A status is CLOSED when nothing further can be decided about it — the server refuses to move it. */
export function isClosed(status: BookingStatus): boolean {
  return status === 'Cancelled' || status === 'Completed' || status === 'NoShow'
}

/** The translated name of a status. */
export function statusLabel(status: BookingStatus): string {
  return t(`booking.status.${status}`)
}

/* ── money ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * '45.00 USD'. Two decimals always, because these are DECIMAL(10,2) columns and a total that
 * renders as "45" beside one that renders as "45.50" reads like two different kinds of number.
 */
export function money(amount: number | null | undefined, currency: string): string {
  if (amount == null) return t('common.dash')
  return `${amount.toFixed(2)} ${currency}`
}

/** Hours as the report and the receipt print them: 2 → '2', 2.5 → '2.5'. */
export function hoursLabel(value: number | null | undefined): string {
  if (value == null) return t('common.dash')
  return `${Number(value)}`
}
