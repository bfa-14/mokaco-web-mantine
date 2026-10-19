/**
 * "SHIFTS TO COVER EVERY DAY": WHAT THE DRAWER OPENS ON, AND WHAT ONE SAVE WRITES.
 *
 * The owner's rule (D16) is that every day each shift the branch runs is covered — not only a
 * headcount. The drawer shows the shifts to cover (the branch's own rows, or the ones the server
 * found in its last 8 weeks) and saves them with the weekday minimums in ONE list that replaces all
 * of the branch's rows. These pin what that list holds: a detected cover nobody changed is not
 * written, so the detection stays live; a changed or stored one is written for every active shift,
 * 0 for an unticked one; rules the editor does not show go back untouched; nothing invalid is sent;
 * and the setup after a save reopens the drawer on what was saved. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sameShiftCover,
  setLineCovered,
  setupAfterStaffingSave,
  setupCover,
  shiftCoverLines,
  shiftInText,
  staffingDays,
  staffingToSave,
  weekdayShiftRules,
} from '../src/pages/attendance/shiftCover.ts'
import type { ShiftCoverLine, StaffingDay } from '../src/pages/attendance/shiftCover.ts'
import type { AutoRosterSetup, StaffingRequirementDto } from '../src/types/attendance.ts'

const MORNING = 1
const EVENING = 2
const NIGHT = 3
/** A shift retired since its rule was stored: not active, so not on the editor. */
const RETIRED = 9

const SHIFTS = [
  { shiftId: MORNING, name: 'Morning' },
  { shiftId: EVENING, name: 'Evening' },
  { shiftId: NIGHT, name: 'Night' },
]

/** No weekday minimum typed. */
const NO_DAYS: StaffingDay[] = staffingDays([])

function setupWith(overrides: Partial<AutoRosterSetup>): AutoRosterSetup {
  return {
    branchId: 4,
    monthDate: '2026-12-01',
    settings: {} as AutoRosterSetup['settings'],
    staff: [],
    staffing: [],
    shiftCover: [],
    shiftCoverDetected: true,
    holidays: [],
    shifts: SHIFTS,
    ...overrides,
  }
}

function rowsOf(result: ReturnType<typeof staffingToSave>): StaffingRequirementDto[] {
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.ok ? result.rows : []
}

function perShift(rows: StaffingRequirementDto[]): StaffingRequirementDto[] {
  return rows.filter((r) => r.shiftId != null)
}

/** What the server detects for a branch that works mornings and evenings. */
const DETECTED: StaffingRequirementDto[] = [
  { dayOfWeek: null, shiftId: MORNING, minOnDuty: 1, targetOnDuty: null },
  { dayOfWeek: null, shiftId: EVENING, minOnDuty: 1, targetOnDuty: null },
]

test('the editor opens on the every-day rows: a minimum of 1 or more is ticked, 0 or none is not', () => {
  const lines = shiftCoverLines(SHIFTS, [
    { dayOfWeek: null, shiftId: MORNING, minOnDuty: 2, targetOnDuty: 3 },
    { dayOfWeek: null, shiftId: EVENING, minOnDuty: 0, targetOnDuty: null }, // "need not be covered"
    { dayOfWeek: 6, shiftId: NIGHT, minOnDuty: 2, targetOnDuty: null }, // a Saturday-only rule
  ])
  assert.deepEqual(lines, [
    { shiftId: MORNING, covered: true, min: 2, target: 3 },
    { shiftId: EVENING, covered: false, min: '', target: '' },
    { shiftId: NIGHT, covered: false, min: '', target: '' },
  ])
  // One line per active shift, in the order given, whatever order the rows came in.
  assert.deepEqual(shiftCoverLines(SHIFTS, [...DETECTED].reverse()).map((l) => [l.shiftId, l.covered]), [
    [MORNING, true],
    [EVENING, true],
    [NIGHT, false],
  ])
})

test('ticking starts the minimum at 1 and brings back what was typed; unticking keeps it', () => {
  const blank: ShiftCoverLine = { shiftId: NIGHT, covered: false, min: '', target: '' }
  assert.deepEqual(setLineCovered(blank, true), { shiftId: NIGHT, covered: true, min: 1, target: '' })
  const typed: ShiftCoverLine = { shiftId: NIGHT, covered: true, min: 3, target: 4 }
  const off = setLineCovered(typed, false)
  assert.deepEqual(off, { shiftId: NIGHT, covered: false, min: 3, target: 4 })
  assert.deepEqual(setLineCovered(off, true), typed)
  // A minimum below 1 is not one to come back to.
  assert.equal(setLineCovered({ shiftId: NIGHT, covered: false, min: 0, target: '' }, true).min, 1)
})

test('the editor is changed only when a tick, or a ticked figure, moves', () => {
  const opened = shiftCoverLines(SHIFTS, DETECTED)
  assert.equal(sameShiftCover(opened, shiftCoverLines(SHIFTS, DETECTED)), true)
  // Ticked and unticked again: no change, whatever the untick left in the boxes.
  const back = opened.map((l) => (l.shiftId === NIGHT ? setLineCovered(setLineCovered(l, true), false) : l))
  assert.equal(sameShiftCover(back, opened), true)
  assert.equal(sameShiftCover(opened.map((l) => (l.shiftId === EVENING ? setLineCovered(l, false) : l)), opened), false)
  assert.equal(sameShiftCover(opened.map((l) => (l.shiftId === MORNING ? { ...l, min: 2 } : l)), opened), false)
  assert.equal(sameShiftCover(opened.map((l) => (l.shiftId === MORNING ? { ...l, target: 2 } : l)), opened), false)
})

test('a detected cover nobody changed writes no per-shift row, so the detection stays live', () => {
  const days = staffingDays([{ dayOfWeek: 1, shiftId: null, minOnDuty: 3, targetOnDuty: null }])
  const rows = rowsOf(
    staffingToSave({
      days,
      lines: shiftCoverLines(SHIFTS, DETECTED),
      stored: [],
      coverChanged: false,
      coverDetected: true,
    }),
  )
  assert.deepEqual(rows, [{ dayOfWeek: 1, shiftId: null, minOnDuty: 3, targetOnDuty: null }])
})

test('a changed cover is written for every active shift: the ticked minimum, 0 for an unticked one', () => {
  // The manager unticks Evening and gives Morning a target.
  const lines = shiftCoverLines(SHIFTS, DETECTED).map((l) =>
    l.shiftId === EVENING ? setLineCovered(l, false) : l.shiftId === MORNING ? { ...l, target: 2 } : l,
  )
  const rows = rowsOf(staffingToSave({ days: NO_DAYS, lines, stored: [], coverChanged: true, coverDetected: true }))
  assert.deepEqual(rows, [
    { dayOfWeek: null, shiftId: MORNING, minOnDuty: 1, targetOnDuty: 2 },
    { dayOfWeek: null, shiftId: EVENING, minOnDuty: 0, targetOnDuty: null },
    { dayOfWeek: null, shiftId: NIGHT, minOnDuty: 0, targetOnDuty: null },
  ])
})

test('an unticked shift sends no target, whatever its boxes still hold', () => {
  const lines: ShiftCoverLine[] = [
    { shiftId: MORNING, covered: true, min: 2, target: '' },
    { shiftId: EVENING, covered: false, min: 3, target: 5 },
  ]
  const rows = rowsOf(staffingToSave({ days: NO_DAYS, lines, stored: [], coverChanged: true, coverDetected: true }))
  assert.deepEqual(perShift(rows), [
    { dayOfWeek: null, shiftId: MORNING, minOnDuty: 2, targetOnDuty: null },
    { dayOfWeek: null, shiftId: EVENING, minOnDuty: 0, targetOnDuty: null },
  ])
})

test('a branch with its own rows writes them with every save, even when only a weekday changed', () => {
  const stored: StaffingRequirementDto[] = [
    { dayOfWeek: null, shiftId: MORNING, minOnDuty: 2, targetOnDuty: null },
    { dayOfWeek: null, shiftId: EVENING, minOnDuty: 1, targetOnDuty: 2 },
  ]
  const lines = shiftCoverLines(SHIFTS, stored)
  const days = staffingDays([]).map((d, i) => (i === 5 ? { min: 4, target: '' as const } : d))
  const rows = rowsOf(staffingToSave({ days, lines, stored, coverChanged: false, coverDetected: false }))
  assert.deepEqual(rows, [
    { dayOfWeek: 6, shiftId: null, minOnDuty: 4, targetOnDuty: null },
    { dayOfWeek: null, shiftId: MORNING, minOnDuty: 2, targetOnDuty: null },
    { dayOfWeek: null, shiftId: EVENING, minOnDuty: 1, targetOnDuty: 2 },
    // Night had no row: stored now as "need not be covered", which is what it already meant.
    { dayOfWeek: null, shiftId: NIGHT, minOnDuty: 0, targetOnDuty: null },
  ])
})

test("rules the editor does not show go back untouched: a single weekday's, a retired shift's", () => {
  const saturdayEvening = { dayOfWeek: 6, shiftId: EVENING, minOnDuty: 3, targetOnDuty: 4 }
  const sundayNight = { dayOfWeek: 7, shiftId: NIGHT, minOnDuty: 0, targetOnDuty: null }
  const retired = { dayOfWeek: null, shiftId: RETIRED, minOnDuty: 2, targetOnDuty: null }
  const stored: StaffingRequirementDto[] = [
    { dayOfWeek: 1, shiftId: null, minOnDuty: 3, targetOnDuty: null },
    { dayOfWeek: null, shiftId: MORNING, minOnDuty: 1, targetOnDuty: null },
    saturdayEvening,
    sundayNight,
    retired,
  ]
  assert.deepEqual(weekdayShiftRules(stored), [saturdayEvening, sundayNight])

  const lines = shiftCoverLines(SHIFTS, stored).map((l) => (l.shiftId === MORNING ? { ...l, min: 2 } : l))
  const rows = rowsOf(
    staffingToSave({ days: staffingDays(stored), lines, stored, coverChanged: true, coverDetected: false }),
  )
  assert.ok(rows.includes(saturdayEvening))
  assert.ok(rows.includes(sundayNight))
  assert.ok(rows.includes(retired))
  // The editor's own every-day row replaces the stored one rather than joining it: the save refuses
  // two rows for the same weekday and shift.
  const keys = rows.map((r) => `${r.dayOfWeek ?? '*'}|${r.shiftId ?? '*'}`)
  assert.equal(new Set(keys).size, keys.length)
  assert.deepEqual(
    rows.find((r) => r.dayOfWeek == null && r.shiftId === MORNING),
    { dayOfWeek: null, shiftId: MORNING, minOnDuty: 2, targetOnDuty: null },
  )
})

test('the weekday minimums go as typed: an every-day row shows on each day, a day left empty has no row', () => {
  const days = staffingDays([
    { dayOfWeek: null, shiftId: null, minOnDuty: 2, targetOnDuty: 3 },
    { dayOfWeek: 6, shiftId: null, minOnDuty: 4, targetOnDuty: null },
    { dayOfWeek: null, shiftId: MORNING, minOnDuty: 1, targetOnDuty: null }, // a shift's row, not a day's
  ])
  assert.deepEqual(days[0], { min: 2, target: 3 })
  assert.deepEqual(days[5], { min: 4, target: '' })
  const edited = days.map((d, i) => (i === 6 ? { min: '' as const, target: '' as const } : d))
  const rows = rowsOf(
    staffingToSave({ days: edited, lines: [], stored: [], coverChanged: false, coverDetected: true }),
  )
  assert.deepEqual(
    rows.map((r) => [r.dayOfWeek, r.minOnDuty, r.targetOnDuty]),
    [
      [1, 2, 3],
      [2, 2, 3],
      [3, 2, 3],
      [4, 2, 3],
      [5, 2, 3],
      [6, 4, null],
    ],
  )
})

test('nothing invalid is sent: a weekday target needs a minimum not above it', () => {
  const withoutMin = NO_DAYS.map((d, i) => (i === 2 ? { min: '' as const, target: 2 } : d))
  assert.deepEqual(
    staffingToSave({ days: withoutMin, lines: [], stored: [], coverChanged: false, coverDetected: true }),
    { ok: false, problem: { kind: 'targetWithoutMin', dayOfWeek: 3 } },
  )
  const below = NO_DAYS.map((d, i) => (i === 4 ? { min: 3, target: 2 } : d))
  assert.deepEqual(
    staffingToSave({ days: below, lines: [], stored: [], coverChanged: false, coverDetected: true }),
    { ok: false, problem: { kind: 'targetBelowMin', dayOfWeek: 5 } },
  )
})

test('nothing invalid is sent: a ticked shift needs a minimum of 1 or more, and a target not below it', () => {
  const save = (line: ShiftCoverLine) =>
    staffingToSave({ days: NO_DAYS, lines: [line], stored: [], coverChanged: true, coverDetected: true })
  assert.deepEqual(save({ shiftId: EVENING, covered: true, min: '', target: '' }), {
    ok: false,
    problem: { kind: 'shiftMin', shiftId: EVENING },
  })
  assert.deepEqual(save({ shiftId: EVENING, covered: true, min: 0, target: '' }), {
    ok: false,
    problem: { kind: 'shiftMin', shiftId: EVENING },
  })
  assert.deepEqual(save({ shiftId: EVENING, covered: true, min: 2, target: 1 }), {
    ok: false,
    problem: { kind: 'shiftTargetBelowMin', shiftId: EVENING },
  })
  // A target equal to the minimum is fine, and an unticked line is never judged.
  assert.equal(save({ shiftId: EVENING, covered: true, min: 2, target: 2 }).ok, true)
  assert.equal(save({ shiftId: EVENING, covered: false, min: '', target: 1 }).ok, true)
})

test('after a save the setup holds what was written, so the drawer reopens on it', () => {
  const before = setupWith({ shiftCover: DETECTED, shiftCoverDetected: true })
  const lines = shiftCoverLines(SHIFTS, DETECTED).map((l) => (l.shiftId === EVENING ? { ...l, min: 2 } : l))
  const rows = rowsOf(staffingToSave({ days: NO_DAYS, lines, stored: [], coverChanged: true, coverDetected: true }))

  const after = setupAfterStaffingSave(before, [{ dayOfWeek: 6, shiftId: EVENING, minOnDuty: 3 }, ...rows])
  assert.equal(after.shiftCoverDetected, false)
  assert.equal(after.staffing.length, rows.length + 1)
  // Every-day rows first, then by the shifts' order; Saturday's rule after them.
  assert.deepEqual(
    after.shiftCover.map((r) => [r.dayOfWeek ?? null, r.shiftId, r.minOnDuty]),
    [
      [null, MORNING, 1],
      [null, EVENING, 2],
      [null, NIGHT, 0],
      [6, EVENING, 3],
    ],
  )
  const reopened = shiftCoverLines(after.shifts, setupCover(after).rows)
  assert.equal(sameShiftCover(reopened, lines), true)
  // And the next save writes the cover again: it is the branch's own now.
  assert.equal(setupCover(after).detected, false)
})

test('a save without per-shift rows leaves the detected cover as it was', () => {
  const before = setupWith({ shiftCover: DETECTED, shiftCoverDetected: true })
  const weekdayOnly = [{ dayOfWeek: 1, shiftId: null, minOnDuty: 2, targetOnDuty: null }]
  const after = setupAfterStaffingSave(before, weekdayOnly)
  assert.deepEqual(after.staffing, weekdayOnly)
  assert.equal(after.shiftCoverDetected, true)
  assert.deepEqual(after.shiftCover, DETECTED)
})

test('a rule of a retired shift is saved but is not part of the cover the drawer shows', () => {
  const after = setupAfterStaffingSave(setupWith({}), [
    { dayOfWeek: null, shiftId: RETIRED, minOnDuty: 2, targetOnDuty: null },
    { dayOfWeek: null, shiftId: MORNING, minOnDuty: 1, targetOnDuty: null },
  ])
  assert.deepEqual(after.shiftCover.map((r) => r.shiftId), [MORNING])
  assert.equal(after.shiftCoverDetected, false)
})

test('a server from before D16 sends no cover: its per-shift rows are the cover, and none means none stored', () => {
  const stored = [
    { dayOfWeek: 1, shiftId: null, minOnDuty: 2, targetOnDuty: null },
    { dayOfWeek: null, shiftId: EVENING, minOnDuty: 1, targetOnDuty: null },
  ]
  assert.deepEqual(setupCover({ staffing: stored }), { rows: [stored[1]], detected: false })
  assert.deepEqual(setupCover({ staffing: [stored[0]] }), { rows: [], detected: true })
  // The server's own answer wins when it gives one — an empty detection included.
  assert.deepEqual(setupCover({ staffing: [], shiftCover: [], shiftCoverDetected: true }), { rows: [], detected: true })
})

test("a shift's name in a sentence is isolated, so an Arabic sentence keeps its order", () => {
  assert.equal(shiftInText('Evening (2)'), '⁨Evening (2)⁩')
})
