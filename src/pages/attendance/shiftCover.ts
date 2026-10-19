/**
 * "SHIFTS TO COVER EVERY DAY" (D16) and the minimums beside it — the auto-roster drawer's staffing,
 * as pure functions: the editor's lines read from the setup, the rows one save writes, and the
 * setup as it stands after that save.
 *
 * WHERE THE COVER COMES FROM. A branch with stored per-shift rows is planned on them (a row with a
 * minimum of 0 is "this shift need not be covered"). A branch without any is planned on the shifts
 * it actually runs, which the server finds in its last 8 weeks (setup.shiftCoverDetected). The
 * editor opens on whichever applies, and a save keeps the difference:
 *
 *   · the editor not changed and the cover detected → no per-shift row at all, so the detection
 *     stays live and follows the branch when it starts or stops running a shift;
 *   · the editor changed, or the branch has rows of its own → one every-day row for EVERY active
 *     shift, ticked or not, so an unticked shift is stored as "need not be covered" rather than left
 *     to a detection that could tick it again. A stored rule for a single weekday, and the rule of a
 *     shift no longer active, are not on the editor and go back exactly as they came.
 *
 * The save REPLACES all of the branch's rows (PUT api/roster/auto/staffing), so the weekday
 * minimums travel in the same list and are built here too, as the drawer always built them.
 *
 * No imports but types, and no i18n: `npm test` runs it with nothing but Node. A problem comes back
 * as a code with its day or shift, and the drawer puts it into words.
 */
import type { AutoRosterSetup, AutoRosterSetupShift, StaffingRequirementDto } from '../../types/attendance'

/** One weekday's minimum/target as typed — '' is "not set", which is different from 0. */
export interface StaffingDay {
  min: number | ''
  target: number | ''
}

/** One active shift's line in "Shifts to cover every day", as typed. */
export interface ShiftCoverLine {
  shiftId: number
  /** "Cover every day" is ticked. */
  covered: boolean
  /** Kept while unticked, so that ticking again brings back what was typed. */
  min: number | ''
  target: number | ''
}

/** Why the staffing cannot be saved as typed. */
export type StaffingProblem =
  /** A weekday's target with no minimum: the row would be dropped with its day. */
  | { kind: 'targetWithoutMin'; dayOfWeek: number }
  | { kind: 'targetBelowMin'; dayOfWeek: number }
  /** A ticked shift without a minimum of 1 or more. */
  | { kind: 'shiftMin'; shiftId: number }
  | { kind: 'shiftTargetBelowMin'; shiftId: number }

export type StaffingSave =
  | { ok: true; rows: StaffingRequirementDto[] }
  | { ok: false; problem: StaffingProblem }

/**
 * The weekday rows the drawer edits: day-level rows only (no shift). A weekday row wins over an
 * every-day row, so an every-day row shows as the value of each day that has none of its own.
 */
export function staffingDays(rows: StaffingRequirementDto[]): StaffingDay[] {
  const dayRows = rows.filter((r) => r.shiftId == null)
  const everyDay = dayRows.find((r) => r.dayOfWeek == null)
  return [1, 2, 3, 4, 5, 6, 7].map((dow) => {
    const row = dayRows.find((r) => r.dayOfWeek === dow) ?? everyDay
    return { min: row ? row.minOnDuty : '', target: row?.targetOnDuty ?? '' }
  })
}

/**
 * What the setup says the days must cover, and whether that was found rather than stored. A server
 * from before D16 sends neither field: its own per-shift rows are then all there is.
 */
export function setupCover(setup: {
  staffing: StaffingRequirementDto[]
  shiftCover?: StaffingRequirementDto[] | null
  shiftCoverDetected?: boolean | null
}): {
  rows: StaffingRequirementDto[]
  detected: boolean
} {
  const stored = (setup.staffing ?? []).filter((r) => r.shiftId != null)
  const detected = setup.shiftCoverDetected ?? stored.length === 0
  return { rows: setup.shiftCover ?? (detected ? [] : stored), detected }
}

/**
 * The editor's lines: one per active shift, in the order given. A shift is ticked when its every-day
 * row asks for somebody (a minimum of 1 or more); a rule for a single weekday is not on the editor.
 */
export function shiftCoverLines(shifts: AutoRosterSetupShift[], cover: StaffingRequirementDto[]): ShiftCoverLine[] {
  return shifts.map((shift): ShiftCoverLine => {
    const row = cover.find((r) => r.shiftId === shift.shiftId && r.dayOfWeek == null)
    return row && row.minOnDuty > 0
      ? { shiftId: shift.shiftId, covered: true, min: row.minOnDuty, target: row.targetOnDuty ?? '' }
      : { shiftId: shift.shiftId, covered: false, min: '', target: '' }
  })
}

/** Tick or untick a line. Ticking starts the minimum at 1, unless one of 1 or more was typed before. */
export function setLineCovered(line: ShiftCoverLine, covered: boolean): ShiftCoverLine {
  if (!covered) return { ...line, covered }
  return { ...line, covered, min: line.min !== '' && line.min >= 1 ? line.min : 1 }
}

/** Two editors that ask the same: the same shifts ticked, with the same figures. An unticked line's figures do not count. */
export function sameShiftCover(a: ShiftCoverLine[], b: ShiftCoverLine[]): boolean {
  const byShift = new Map(b.map((line) => [line.shiftId, line]))
  return (
    a.length === b.length &&
    a.every((line) => {
      const other = byShift.get(line.shiftId)
      if (!other || other.covered !== line.covered) return false
      return !line.covered || (other.min === line.min && other.target === line.target)
    })
  )
}

/** The stored rules for a single weekday of a shift — kept as they are, and named under the editor. */
export function weekdayShiftRules(stored: StaffingRequirementDto[]): StaffingRequirementDto[] {
  return stored.filter((r) => r.shiftId != null && r.dayOfWeek != null)
}

/**
 * THE ROWS ONE SAVE WRITES — the branch's complete list, since the save replaces them all.
 *
 * The seven weekdays as typed (a day with no minimum has no row), then the shifts: one every-day row
 * per line (a ticked line's minimum, and its target when set; 0 for an unticked one) and the stored
 * per-shift rows the editor does not show — or no per-shift row at all while the editor asks for
 * what it opened on and that was detected (see the top of this file).
 */
export function staffingToSave({
  days,
  lines,
  stored,
  coverChanged,
  coverDetected,
}: {
  days: StaffingDay[]
  lines: ShiftCoverLine[]
  /** The branch's stored rows (setup.staffing). */
  stored: StaffingRequirementDto[]
  /** The editor asks for something other than the cover it opened on (or last saved). */
  coverChanged: boolean
  /** That cover was detected, not stored. */
  coverDetected: boolean
}): StaffingSave {
  const rows: StaffingRequirementDto[] = []
  for (let i = 0; i < 7; i++) {
    const { min, target } = days[i]
    const dayOfWeek = i + 1
    // A target alone would be dropped with its day — said here rather than lost on save.
    if (min === '' && target !== '') return { ok: false, problem: { kind: 'targetWithoutMin', dayOfWeek } }
    if (min === '') continue
    if (target !== '' && target < min) return { ok: false, problem: { kind: 'targetBelowMin', dayOfWeek } }
    rows.push({ dayOfWeek, shiftId: null, minOnDuty: min, targetOnDuty: target === '' ? null : target })
  }

  for (const line of lines) {
    if (!line.covered) continue
    if (line.min === '' || line.min < 1) return { ok: false, problem: { kind: 'shiftMin', shiftId: line.shiftId } }
    if (line.target !== '' && line.target < line.min) {
      return { ok: false, problem: { kind: 'shiftTargetBelowMin', shiftId: line.shiftId } }
    }
  }

  if (!coverChanged && coverDetected) return { ok: true, rows }

  const onEditor = new Set(lines.map((line) => line.shiftId))
  for (const line of lines) {
    rows.push({
      dayOfWeek: null,
      shiftId: line.shiftId,
      minOnDuty: line.covered && line.min !== '' ? line.min : 0,
      targetOnDuty: line.covered && line.target !== '' ? line.target : null,
    })
  }
  for (const row of stored) {
    if (row.shiftId == null || (row.dayOfWeek == null && onEditor.has(row.shiftId))) continue
    rows.push(row)
  }
  return { ok: true, rows }
}

/**
 * THE SETUP AFTER A SAVE, without reading it again: the page measures its footer on it, and the
 * drawer's next opening starts from it. Rows with a shift make the cover the branch's own, read as
 * the server reads it (its active shifts' rows, every-day rows first). None leaves the detection in
 * charge, and a save does not change what that finds — it reads the roster, not the staffing.
 */
export function setupAfterStaffingSave(setup: AutoRosterSetup, rows: StaffingRequirementDto[]): AutoRosterSetup {
  const perShift = rows.filter((r) => r.shiftId != null)
  if (perShift.length === 0) {
    // Stored before and nothing written now happens only without an active shift — and without
    // one, the detection finds nothing either.
    const before = setupCover(setup)
    return { ...setup, staffing: rows, shiftCover: before.detected ? before.rows : [], shiftCoverDetected: true }
  }
  const order = new Map((setup.shifts ?? []).map((shift, index) => [shift.shiftId, index]))
  const rank = (row: StaffingRequirementDto) => order.get(row.shiftId ?? -1) ?? 0
  const shiftCover = perShift
    .filter((row) => order.has(row.shiftId ?? -1))
    .sort((a, b) => (a.dayOfWeek ?? 0) - (b.dayOfWeek ?? 0) || rank(a) - rank(b))
  return { ...setup, staffing: rows, shiftCover, shiftCoverDetected: false }
}

/**
 * A shift's name inside a sentence, in Unicode isolates (FSI … PDI). HR types the names, often in
 * English: inside an Arabic sentence, a name with a digit or a bracket is otherwise reordered.
 */
export function shiftInText(name: string): string {
  return `⁨${name}⁩`
}
