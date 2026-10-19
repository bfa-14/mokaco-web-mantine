/**
 * THE MONTH-WIDE ROSTER ACTIONS WORK ON ONE BRANCH (QA3 ROS-3, ROS-8, REL-16).
 *
 * Copy previous month / Apply weekly patterns / Re-derive month are sent with the branch on screen
 * and are off under "All branches"; the gap banner counts the gaps of the branch of the DAY. Run with
 * `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gapsOfBranch, oneBranchOf, rederiveBlocked } from '../src/pages/attendance/rosterBranch.ts'
import type { RosterGap } from '../src/types/attendance.ts'

const branches = [
  { branchId: 1, isActive: true },
  { branchId: 2, isActive: true },
  { branchId: 3, isActive: false },
]

test('the branch filter is the branch the month-wide actions work on', () => {
  assert.equal(oneBranchOf(2, branches), 2)
  // a retired branch picked in the filter is still that branch (its months can still be looked at)
  assert.equal(oneBranchOf(3, branches), 3)
})

test('"All branches" with more than one active branch has no branch: the actions are off', () => {
  assert.equal(oneBranchOf(null, branches), null)
  assert.equal(oneBranchOf(null, []), null)
})

test('with ONE active branch the filter is not offered, and "all" is that branch', () => {
  assert.equal(oneBranchOf(null, [{ branchId: 7, isActive: true }, { branchId: 8, isActive: false }]), 7)
})

const gap = (employeeId: number, workDate: string, branchId?: number | null): RosterGap => ({
  employeeId,
  fullName: `E${employeeId}`,
  workDate,
  branchId,
})

test('under a branch filter the banner counts the gaps of that branch by the branch of the day', () => {
  // employee 5 moved from branch 1 to branch 2 on the 15th: the gap of the 10th is branch 1's, the 20th branch 2's
  const gaps = [gap(5, '2026-10-10', 1), gap(5, '2026-10-20', 2), gap(6, '2026-10-03', 2)]
  const onGrid = new Set([5, 6])
  assert.deepEqual(
    gapsOfBranch(gaps, 2, onGrid).map((g) => g.workDate),
    ['2026-10-20', '2026-10-03'],
  )
  assert.deepEqual(gapsOfBranch(gaps, 1, onGrid).map((g) => g.workDate), ['2026-10-10'])
})

test('"All branches" counts every gap', () => {
  const gaps = [gap(5, '2026-10-10', 1), gap(6, '2026-10-03', 2)]
  assert.equal(gapsOfBranch(gaps, null, new Set()).length, 2)
})

test('a gap from an older API without its branch falls back to the people on the grid', () => {
  const gaps = [gap(5, '2026-10-10'), gap(9, '2026-10-11', null)]
  assert.deepEqual(gapsOfBranch(gaps, 1, new Set([5])).map((g) => g.employeeId), [5])
})

test('re-deriving needs a branch and a month with a completed day', () => {
  assert.equal(rederiveBlocked(null, '2026-09', '2026-10-19'), 'branch')
  assert.equal(rederiveBlocked(1, '2026-09', '2026-10-19'), null)
  assert.equal(rederiveBlocked(1, '2026-10', '2026-10-19'), null)
  // on the 1st, yesterday is last month: nothing of this month is completed yet
  assert.equal(rederiveBlocked(1, '2026-10', '2026-10-01'), 'notStarted')
  assert.equal(rederiveBlocked(1, '2026-11', '2026-10-19'), 'notStarted')
  assert.equal(rederiveBlocked(1, '2026-10', '2026-10-02T08:00:00'), null)
})
