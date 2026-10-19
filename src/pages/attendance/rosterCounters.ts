/**
 * The roster's counters, as pure functions: per-employee work / rest / Saturday off / Sunday off,
 * the 6·5 week strip, the number on duty per day (and, under a draft, per shift to cover) and the
 * minimum it is measured against.
 *
 * WHY THEY ARE COMPUTED HERE AND NOT ONLY READ FROM THE PREVIEW. The counters are always visible —
 * on a saved month, and on a draft the manager is editing cell by cell without a server call. They
 * have to follow what is on the screen, so they are counted from the cells the grid draws. What the
 * client cannot know (the rhythm's type of a week, its rest quota, the weekend balance) still comes
 * from the server's preview and is only re-judged against the edited cells.
 *
 * No imports but types, and no Date in local time: run by `npm test` with nothing but Node, and a
 * 'yyyy-MM-dd' read as local midnight drifts a day in any timezone west of Greenwich.
 */
import type { StaffingRequirementDto } from '../../types/attendance'

/* ── calendar days, in UTC ── */

const MS_PER_DAY = 86_400_000

/** 'yyyy-MM-dd' (or a full API timestamp) → days since 1970-01-01. */
export function dayNumberOf(date: string): number {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number)
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY)
}

/** Days since 1970-01-01 → 'yyyy-MM-dd'. */
export function dateOfDayNumber(value: number): string {
  return new Date(value * MS_PER_DAY).toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  return dateOfDayNumber(dayNumberOf(date) + days)
}

/** ISO weekday, Monday first: 1 = Monday .. 7 = Sunday — the numbering of every mask and pattern here. */
export function dayOfWeek(date: string): number {
  const sundayFirst = new Date(dayNumberOf(date) * MS_PER_DAY).getUTCDay()
  return sundayFirst === 0 ? 7 : sundayFirst
}

export function isMonday(date: string): boolean {
  return dayOfWeek(date) === 1
}

/** The Monday on or before a day. */
export function mondayOf(date: string): string {
  return addDays(date, 1 - dayOfWeek(date))
}

/** 1900-01-01 was a Monday, so whole weeks counted from it never reset at a month or year end (D1). */
const WEEK_ZERO = dayNumberOf('1900-01-01')

/** W(d) = (d − 1900-01-01) div 7 — the planner's week number. */
export function weekIndex(date: string): number {
  return Math.floor((dayNumberOf(date) - WEEK_ZERO) / 7)
}

/** The planner's window for a month: the Monday on/before the 1st → the Sunday on/after the last day. */
export function rosterWindow(monthFrom: string, monthTo: string): { from: string; to: string } {
  return { from: mondayOf(monthFrom), to: addDays(mondayOf(monthTo), 6) }
}

/** The Mondays of every week that touches [from, to]. */
export function weekStartsBetween(from: string, to: string): string[] {
  const starts: string[] = []
  for (let monday = mondayOf(from); monday <= to; monday = addDays(monday, 7)) {
    starts.push(monday)
  }
  return starts
}

/* ── what a cell is, for counting ── */

export type DayState = 'work' | 'rest' | 'none'

/**
 * One employee-day as the counters see it. `undefined` from a CellOf means "not known" (not
 * employed, outside what was read) — different from `none`, which is a known day with no row.
 */
export interface CounterCell {
  state: DayState
  /**
   * Any leave that day, full or half: a rest row on it is not a rest day, and the week is not judged
   * on its shape (D5; the planner's CountsAsRest).
   */
  onLeave?: boolean
  /** A FULL-day leave: off duty whatever the row says. A half day is a working day (D5). */
  fullDayLeave?: boolean
}

export type CellOf = (date: string) => CounterCell | undefined

/** A rest row on a leave day — a half day too — counts neither as rest nor as a weekend day off (D5). */
function isRealRest(cell: CounterCell | undefined): boolean {
  return cell?.state === 'rest' && !cell.onLeave
}

export interface EmployeeCounts {
  /** Rostered working days — leave days with a working row included: that is what payroll prices (D14). */
  workDays: number
  restDays: number
  saturdaysOff: number
  sundaysOff: number
}

/** Work / Rest / Sat off / Sun off over the given days (the month's columns). */
export function employeeCounts(days: string[], cellOf: CellOf): EmployeeCounts {
  const counts: EmployeeCounts = { workDays: 0, restDays: 0, saturdaysOff: 0, sundaysOff: 0 }
  for (const date of days) {
    const cell = cellOf(date)
    if (cell?.state === 'work') counts.workDays++
    if (!isRealRest(cell)) continue
    counts.restDays++
    const dow = dayOfWeek(date)
    if (dow === 6) counts.saturdaysOff++
    if (dow === 7) counts.sundaysOff++
  }
  return counts
}

/* ── the 6·5 strip ── */

/** What the server said about one week (AutoRosterWeekCounter's shape). */
export interface ServerWeek {
  weekStart: string
  workDays: number
  rests: number
  quota: number
  ok: boolean
}

export interface StripWeek {
  /** A Monday. */
  weekStart: string
  /** Rest days the week holds now (rests on leave days, half days included, left out). */
  rests: number
  /** 6 or 5; null when it cannot be told (a week not fully known, or neither 1 nor 2 rests). */
  type: 6 | 5 | null
  /** The rest days the week should hold, when the server said so. */
  quota: number | null
  /** true = holds; false = broken (drawn red); null = not judged (part of the week unknown, or leave in it). */
  ok: boolean | null
}

/**
 * One entry per Monday-first week.
 *
 * WITH THE SERVER'S WEEKS (a preview), the server's type and quota are the rule: the rhythm is a
 * stored anchor the client cannot derive. A week whose rest count is still the one the server saw
 * keeps the server's verdict (which knows a shortfall absorbed by leave); an edited week is
 * re-judged as rests = quota.
 *
 * WITHOUT THEM (a saved month), the strip reads the week's shape: 1 rest day is a 6-day week, 2 a
 * 5-day week. A week with an unknown day or a leave day is not judged — an employee hired on a
 * Thursday, or on leave, has a legitimately odd week. Two judged weeks in a row of the same type
 * break the alternation, and the second is marked.
 */
export function weekStrip(weekStarts: string[], cellOf: CellOf, server?: ServerWeek[]): StripWeek[] {
  const byStart = new Map((server ?? []).map((w) => [w.weekStart.slice(0, 10), w]))
  const strip: StripWeek[] = []
  let previous: StripWeek | null = null

  for (const weekStart of weekStarts) {
    let rests = 0
    let unknown = 0
    let leave = 0
    for (let i = 0; i < 7; i++) {
      const cell = cellOf(addDays(weekStart, i))
      if (cell === undefined) unknown++
      else if (cell.onLeave) leave++
      if (isRealRest(cell)) rests++
    }

    const told = byStart.get(weekStart)
    let entry: StripWeek
    if (told) {
      const type = told.workDays === 6 ? 6 : told.workDays === 5 ? 5 : null
      entry = {
        weekStart,
        rests,
        type,
        quota: told.quota,
        ok: rests === told.rests ? told.ok : rests === told.quota,
      }
    } else {
      const type = rests === 1 ? 6 : rests === 2 ? 5 : null
      const judged = unknown === 0 && leave === 0
      entry = { weekStart, rests, type: unknown === 0 ? type : null, quota: null, ok: judged ? type !== null : null }
      const previousJudged = previous != null && previous.quota === null && previous.ok !== null
      if (judged && entry.type !== null && previousJudged && previous?.type === entry.type) {
        entry.ok = false
      }
    }
    strip.push(entry)
    previous = entry
  }
  return strip
}

/** The strip as the summary column prints it: '6·5·6·5'. Unjudged weeks read '–'. */
export function stripText(strip: StripWeek[]): string {
  return strip.map((w) => (w.type == null ? '–' : String(w.type))).join('·')
}

/* ── on duty per day ── */

/** A cell of the grid by employee and day. */
export type GridCellOf = (employeeId: number, date: string) => CounterCell | undefined

/** People on a working row that day and not on full-day leave (a half day is on duty). */
export function onDutyByDay(days: string[], employeeIds: number[], cellOf: GridCellOf): Map<string, number> {
  const result = new Map<string, number>()
  for (const date of days) {
    let count = 0
    for (const employeeId of employeeIds) {
      const cell = cellOf(employeeId, date)
      if (cell?.state === 'work' && !cell.fullDayLeave) count++
    }
    result.set(date, count)
  }
  return result
}

/** An edited draft day, for the footer: on duty in the preview (`was`) and now (`now`). */
export interface DutyMove {
  date: string
  was: boolean
  now: boolean
}

/**
 * On duty per day under a draft: the preview's own count, moved by every day edited since. The
 * preview knows what the page cannot (which leave is a half day); counting the grid again would
 * disagree with it on exactly those days. A day the preview did not count keeps the grid's count.
 */
export function onDutyUnderDraft(
  gridCount: Map<string, number>,
  previewCount: Map<string, number>,
  moves: Iterable<DutyMove>,
): Map<string, number> {
  const result = new Map<string, number>()
  for (const [date, counted] of gridCount) result.set(date, previewCount.get(date) ?? counted)
  for (const move of moves) {
    if (move.was === move.now || !previewCount.has(move.date) || !result.has(move.date)) continue
    result.set(move.date, (result.get(move.date) ?? 0) + (move.now ? 1 : -1))
  }
  return result
}

/* ── on duty per shift, under a draft (D16) ── */

/** One shift a day must cover, as the preview counted it (AutoRosterShiftCounter's shape). */
export interface ShiftDuty {
  shiftId: number
  onDuty: number
  min: number
  target?: number | null
}

/**
 * An edited draft day, for the rows per shift: the shift it was on duty on in the preview (`was`)
 * and now (`now`) — null when on none: a rest day, no row, or away on a full-day leave.
 */
export interface ShiftMove {
  date: string
  was: number | null
  now: number | null
}

/**
 * On duty per shift and day under a draft: the preview's count of each shift a day must cover,
 * moved by every day edited since — a day taken off a shift is one fewer on it, a day put on one is
 * one more. The same rule as onDutyUnderDraft, shift by shift, and for the same reason: the preview
 * knows which leave is a half day. Only the shifts the preview lists for a day are counted; a shift
 * the day need not cover has no minimum to be measured against.
 */
export function onShiftUnderDraft(
  previewDays: Iterable<{ date: string; shifts?: ShiftDuty[] | null }>,
  moves: Iterable<ShiftMove>,
): Map<string, Map<number, number>> {
  const result = new Map<string, Map<number, number>>()
  for (const day of previewDays) {
    result.set(day.date.slice(0, 10), new Map((day.shifts ?? []).map((s) => [s.shiftId, s.onDuty])))
  }
  for (const move of moves) {
    if (move.was === move.now) continue
    const counts = result.get(move.date.slice(0, 10))
    if (!counts) continue
    if (move.was != null && counts.has(move.was)) {
      counts.set(move.was, Math.max(0, (counts.get(move.was) ?? 0) - 1))
    }
    if (move.now != null && counts.has(move.now)) counts.set(move.now, (counts.get(move.now) ?? 0) + 1)
  }
  return result
}

/**
 * The minimum (and target) on duty a day is measured against, from the branch's staffing rows.
 *
 * A weekday row beats an every-day row (the same ShiftId), as the planner reads them. A day-level
 * row (no shift) answers outright; without one, the per-shift minimums are added up — every shift
 * needing two is a day needing the sum. Null when nothing is set: there is no minimum to fall below.
 */
export function staffingForDay(
  rows: StaffingRequirementDto[],
  date: string,
): { min: number | null; target: number | null } {
  const dow = dayOfWeek(date)
  const resolved = new Map<number | null, StaffingRequirementDto>()
  for (const row of rows) {
    if (row.dayOfWeek != null && row.dayOfWeek !== dow) continue
    const shift = row.shiftId ?? null
    const current = resolved.get(shift)
    // A weekday row replaces an every-day row; never the other way round.
    if (!current || (current.dayOfWeek == null && row.dayOfWeek != null)) resolved.set(shift, row)
  }

  const day = resolved.get(null)
  if (day) return { min: day.minOnDuty, target: day.targetOnDuty ?? null }

  const perShift = [...resolved.values()]
  if (perShift.length === 0) return { min: null, target: null }
  const min = perShift.reduce((sum, row) => sum + row.minOnDuty, 0)
  const anyTarget = perShift.some((row) => row.targetOnDuty != null)
  const target = anyTarget
    ? perShift.reduce((sum, row) => sum + (row.targetOnDuty ?? row.minOnDuty), 0)
    : null
  return { min, target }
}
