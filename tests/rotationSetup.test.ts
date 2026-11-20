/**
 * THE FIXED ROTATION's setup: the list, the proposal for somebody new, what stops a save, and the days off of a
 * week - held against the same spreadsheet values as the server's rule. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  daysOffInWeek,
  proposeLine,
  mondayOnOrBefore,
  moveLine,
  rotationKey,
  rotationLines,
  rotationProblem,
  rotationToSave,
  weekdayOf,
} from '../src/pages/attendance/rotationSetup.ts'

const staff = [
  { employeeId: 1, fullName: 'Lina' },
  { employeeId: 2, fullName: 'Rami' },
  { employeeId: 3, fullName: 'Maya' },
  { employeeId: 4, fullName: 'Nour' },
]

test('weekdays are Monday-first, and a Monday is found', () => {
  assert.equal(weekdayOf('2026-11-30'), 0)
  assert.equal(weekdayOf('2026-12-06'), 6)
  assert.equal(mondayOnOrBefore('2026-12-03'), '2026-11-30')
  assert.equal(mondayOnOrBefore('2026-11-30'), '2026-11-30')
})

test('the list opens on the stored order, then proposes the others; off-rotation people are left out', () => {
  const stored = [
    { employeeId: 3, group: 1, singleRestDay: 3, pairRestDay: 1, leadSlot: 'L2' as const, sortOrder: 2 },
    { employeeId: 1, group: 0, singleRestDay: 0, pairRestDay: 5, leadSlot: 'L1' as const, sortOrder: 1 },
    { employeeId: 9, group: 0, singleRestDay: 0, pairRestDay: 0, leadSlot: null, sortOrder: 0 }, // left the branch
  ]
  const lines = rotationLines(staff, stored, new Set([4]))
  assert.deepEqual(lines.map((l) => [l.employeeId, l.isNew]), [[1, false], [3, false], [2, true]])
  assert.equal(lines[0].leadSlot, 'L1')
  assert.deepEqual([lines[2].group, lines[2].leadSlot], [0, null])
})

test('a line moves up and down, and stays at the ends', () => {
  const lines = rotationLines(staff, [], new Set())
  assert.deepEqual(moveLine(lines, 0, 1).map((l) => l.employeeId), [2, 1, 3, 4])
  assert.deepEqual(moveLine(lines, 3, -1).map((l) => l.employeeId), [1, 2, 4, 3])
  assert.equal(moveLine(lines, 0, -1), lines)
  assert.equal(moveLine(lines, 3, 1), lines)
})

test('what stops a save', () => {
  const lines = rotationLines(staff, [], new Set())
  assert.equal(rotationProblem(null, 2, 3, lines), 'start')
  assert.equal(rotationProblem('2026-12-01', 2, 3, lines), 'notMonday')
  assert.equal(rotationProblem('2026-11-30', null, 3, lines), 'shifts')
  assert.equal(rotationProblem('2026-11-30', 2, 2, lines), 'sameShift')
  assert.equal(rotationProblem('2026-11-30', 2, 3, []), 'empty')
  assert.equal(rotationProblem('2026-11-30', 2, 3, lines.map((l) => ({ ...l, leadSlot: 'L1' as const }))), 'twoL1')
  assert.equal(rotationProblem('2026-11-30', 2, 3, lines), null)
})

test('the save numbers the list in its order, and the key changes with any value', () => {
  const lines = moveLine(rotationLines(staff, [], new Set()), 0, 1)
  const saved = rotationToSave(7, '2026-11-30', 2, 3, lines)
  assert.deepEqual(saved.members.map((m) => [m.employeeId, m.sortOrder]), [[2, 1], [1, 2], [3, 3], [4, 4]])
  const key = rotationKey('2026-11-30', 2, 3, lines)
  assert.equal(key, rotationKey('2026-11-30', 2, 3, [...lines]))
  assert.notEqual(key, rotationKey('2026-11-30', 2, 3, lines.map((l, i) => (i === 0 ? { ...l, group: 1 - l.group } : l))))
  assert.notEqual(key, rotationKey('2026-12-07', 2, 3, lines))
})

test('the days off of a week follow the spreadsheet', () => {
  // The sheet's first person: group 0, single Monday (0), pair Saturday (5). Start 2026-11-30.
  const lead = { group: 0, singleRestDay: 0, pairRestDay: 5 }
  assert.deepEqual(daysOffInWeek('2026-11-30', lead, '2026-12-02'), [5, 6]) // week 0: Saturday + Sunday
  assert.deepEqual(daysOffInWeek('2026-11-30', lead, '2026-12-07'), [0]) // week 1: Monday
  assert.deepEqual(daysOffInWeek('2026-11-30', lead, '2026-12-14'), [0, 1]) // week 2: moved two weekdays
  assert.deepEqual(daysOffInWeek('2026-11-30', lead, '2026-12-21'), [2]) // week 3: Wednesday
  // Before the start date the rule still holds (the sheet: OFF on 19 and 20 November, week -2).
  assert.deepEqual(daysOffInWeek('2026-11-30', lead, '2026-11-16'), [3, 4])
  // The second person: group 1, single Thursday (3), pair Tuesday (1): week 0 is a one-day week.
  assert.deepEqual(daysOffInWeek('2026-11-30', { group: 1, singleRestDay: 3, pairRestDay: 1 }, '2026-11-30'), [3])
})

test('a proposal never starts the two days off on a Sunday, and the groups alternate', () => {
  const proposals = Array.from({ length: 20 }, (_, i) => proposeLine(i))
  assert.ok(proposals.every((p) => p.pairRestDay >= 0 && p.pairRestDay <= 5))
  assert.ok(proposals.every((p) => p.singleRestDay >= 0 && p.singleRestDay <= 6))
  assert.deepEqual(proposals.slice(0, 4).map((p) => p.group), [0, 1, 0, 1])
  // A stored Sunday pair is Monday and Sunday of the same week.
  assert.deepEqual(daysOffInWeek('2026-11-30', { group: 0, singleRestDay: 0, pairRestDay: 6 }, '2026-11-30'), [0, 6])
})
