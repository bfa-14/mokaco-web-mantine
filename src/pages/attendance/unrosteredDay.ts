/**
 * A DAY WITH PUNCHES THAT THE APPROVED ROSTER DOES NOT KNOW - the rules of the "Not on roster" list
 * that do not need the server (the server decides who may decide, and checks everything again).
 *
 * Pure, type imports only: `npm test` reads this file directly.
 */
import type { UnrosteredDay, UnrosteredDecision } from '../../types/attendance'

/** The note of a dismissal is kept with the decision (attendance.UNROSTERED_DAY_DECISION.Note, NVARCHAR(400)). */
export const DECISION_NOTE_MAX = 400

/** A note as it is sent: trimmed, cut to what is stored; null when there is nothing to send. */
export function decisionNote(note: string): string | null {
  const text = note.trim()
  return text ? text.slice(0, DECISION_NOTE_MAX) : null
}

/**
 * Why a decision cannot be SENT yet, or null when it can. "Not work" needs its reason: the punches
 * stop counting for payroll readiness on that word alone.
 */
export function decisionProblem(
  decision: UnrosteredDecision,
  shiftId: number | null,
  note: string,
): 'shift' | 'note' | null {
  if (decision === 'Shift' && shiftId == null) return 'shift'
  if (decision === 'Dismiss' && decisionNote(note) === null) return 'note'
  return null
}

/**
 * What stands in the way of ADDING the day to the roster (a dismissal is still possible):
 *   outsideEmployment  before the hire date or after the termination date
 *   rosterWaiting      the roster of the branch-month is waiting for approval
 */
export function addBlockedBy(day: Pick<UnrosteredDay, 'outsideEmployment' | 'openRosterRequestId'>): 'outsideEmployment' | 'rosterWaiting' | null {
  if (day.outsideEmployment) return 'outsideEmployment'
  if (day.openRosterRequestId != null) return 'rosterWaiting'
  return null
}

/** Minutes since midnight of an API time ('07:00:00') or timestamp ('2026-11-07T08:02:00'); null when unreadable. */
function minutesOfDay(value: string): number | null {
  const clock = value.includes('T') ? value.split('T')[1] : value
  const match = /^(\d{1,2}):(\d{2})/.exec(clock ?? '')
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
}

/**
 * The shift to PROPOSE for a day: the active one that starts closest to the first punch (around the
 * clock, so 23:50 is ten minutes from a midnight start). Only a proposal - a person confirms or changes
 * it; the system never adds a roster row on a guess. Null when there is nothing to propose.
 */
export function suggestShift(
  firstPunch: string,
  shifts: readonly { shiftId: number; startTime: string; isActive: boolean }[],
): number | null {
  const punched = minutesOfDay(firstPunch)
  if (punched === null) return null
  let best: { shiftId: number; distance: number } | null = null
  for (const shift of shifts) {
    if (!shift.isActive) continue
    const start = minutesOfDay(shift.startTime)
    if (start === null) continue
    const apart = Math.abs(start - punched)
    const distance = Math.min(apart, 1440 - apart)
    if (best === null || distance < best.distance || (distance === best.distance && shift.shiftId < best.shiftId)) {
      best = { shiftId: shift.shiftId, distance }
    }
  }
  return best?.shiftId ?? null
}

/**
 * The punches behind one listed day, out of the raw punches of its date(s): this employee's, between
 * the first and the last punch the list showed (an overnight day ends on the next calendar date).
 * Timestamps are the terminal's wall clock as text, so they compare as text.
 */
export function punchesOfDay<T extends { employeeId: number | null; punchTimeUtc: string }>(
  punches: readonly T[],
  day: Pick<UnrosteredDay, 'employeeId' | 'firstPunch' | 'lastPunch'>,
): T[] {
  const from = day.firstPunch.slice(0, 19)
  const to = day.lastPunch.slice(0, 19)
  return punches
    .filter((punch) => punch.employeeId === day.employeeId)
    .filter((punch) => {
      const at = punch.punchTimeUtc.slice(0, 19)
      return at >= from && at <= to
    })
    .sort((a, b) => a.punchTimeUtc.localeCompare(b.punchTimeUtc))
}

/** The calendar dates ('yyyy-MM-dd') a listed day's punches fall on: one, or two for an overnight day. */
export function punchDates(day: Pick<UnrosteredDay, 'firstPunch' | 'lastPunch'>): string[] {
  const first = day.firstPunch.slice(0, 10)
  const last = day.lastPunch.slice(0, 10)
  return first === last ? [first] : [first, last]
}

/** Open days first (they are the work), then newest first; dismissed ones after, newest first. */
export function inWorkOrder<T extends Pick<UnrosteredDay, 'state' | 'workDate' | 'employeeName'>>(days: readonly T[]): T[] {
  return [...days].sort((a, b) => {
    if (a.state !== b.state) return a.state === 'Open' ? -1 : 1
    if (a.workDate !== b.workDate) return a.workDate < b.workDate ? 1 : -1
    return a.employeeName.localeCompare(b.employeeName)
  })
}
