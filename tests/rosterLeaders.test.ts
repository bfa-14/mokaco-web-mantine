/**
 * THE SHIFT LEADERS picker of the auto-roster drawer: who it offers, what it sends, when it counts as changed, and the
 * rotation's leads that are leaders anyway. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leaderIds, leaderOptions, rotationLeads, sameLeaders } from '../src/pages/attendance/rosterLeaders.ts'

const staff = [
  { employeeId: 1, fullName: 'Lina' },
  { employeeId: 2, fullName: 'Rami' },
  { employeeId: 3, fullName: 'Maya' },
]

test('the picker offers the people of the month, then a stored leader who is not among them', () => {
  const leaders = [
    { employeeId: 2, fullName: 'Rami', isStored: true, leadSlot: null },
    { employeeId: 9, fullName: 'Nour (moved)', isStored: true, leadSlot: null },
    { employeeId: 8, fullName: 'Karim', isStored: false, leadSlot: 'L1' as const }, // a rotation lead of another month
  ]
  assert.deepEqual(
    leaderOptions(staff, leaders).map((o) => [o.value, o.label]),
    [['1', 'Lina'], ['2', 'Rami'], ['3', 'Maya'], ['9', 'Nour (moved)']],
  )
  assert.deepEqual(leaderOptions([], []), [])
})

test('the picker sends each person once, as numbers, in the order picked', () => {
  assert.deepEqual(leaderIds(['3', '1', '3']), [3, 1])
  assert.deepEqual(leaderIds(['x', '0', '-2', '2']), [2])
  assert.deepEqual(leaderIds([]), [])
})

test('the same people in another order is no change', () => {
  assert.equal(sameLeaders([1, 2], [2, 1]), true)
  assert.equal(sameLeaders([1, 2, 2], [2, 1]), true)
  assert.equal(sameLeaders([1], [1, 2]), false)
  assert.equal(sameLeaders([], []), true)
  assert.equal(sameLeaders([3], [4]), false)
})

test('the rotation leads are listed Lead 1 first and only them', () => {
  const leaders = [
    { employeeId: 1, fullName: 'Lina', isStored: true, leadSlot: 'L2' as const },
    { employeeId: 2, fullName: 'Rami', isStored: true, leadSlot: null },
    { employeeId: 3, fullName: 'Maya', isStored: false, leadSlot: 'L1' as const },
  ]
  assert.deepEqual(rotationLeads(leaders).map((l) => [l.fullName, l.leadSlot]), [['Maya', 'L1'], ['Lina', 'L2']])
  assert.deepEqual(rotationLeads([{ employeeId: 2, fullName: 'Rami', isStored: true }]), [])
})
