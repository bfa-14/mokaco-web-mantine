/**
 * "OPEN ROSTER" LANDS ON THE PERSON AND THE DAY. The link carries the month, the person, the day and the
 * branch of that day; the Roster page reads them back, and a link it cannot read opens the roster as usual.
 * Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rosterDayLink, rosterFocusOf } from '../src/pages/attendance/rosterLink.ts'

test('the link names the month, the person, the day and the branch of the day', () => {
  assert.equal(
    rosterDayLink({ employeeId: 7, workDate: '2026-11-07T00:00:00', branchId: 2 }),
    '/attendance/roster?period=2026-11&employeeId=7&date=2026-11-07&branchId=2',
  )
})

test('without a branch the link leaves the branch to the page', () => {
  assert.equal(
    rosterDayLink({ employeeId: 7, workDate: '2026-11-07' }),
    '/attendance/roster?period=2026-11&employeeId=7&date=2026-11-07',
  )
})

test('the page reads back exactly what the link carried', () => {
  const url = new URL(`http://x${rosterDayLink({ employeeId: 7, workDate: '2026-11-07T00:00:00', branchId: 2 })}`)
  assert.deepEqual(rosterFocusOf(url.searchParams), { employeeId: 7, date: '2026-11-07', branchId: 2 })
})

test('a link with no person or no real date asks for no focus', () => {
  assert.equal(rosterFocusOf(new URLSearchParams('period=2026-11')), null)
  assert.equal(rosterFocusOf(new URLSearchParams('employeeId=7')), null)
  assert.equal(rosterFocusOf(new URLSearchParams('employeeId=x&date=2026-11-07')), null)
  assert.equal(rosterFocusOf(new URLSearchParams('employeeId=7&date=2026-02-30')), null)
  assert.equal(rosterFocusOf(new URLSearchParams('employeeId=7&date=07/11/2026')), null)
  assert.equal(rosterFocusOf(new URLSearchParams('employeeId=-3&date=2026-11-07')), null)
})

test('a branch that is not a number is left out, the focus still stands', () => {
  assert.deepEqual(rosterFocusOf(new URLSearchParams('employeeId=7&date=2026-11-07&branchId=abc')), {
    employeeId: 7,
    date: '2026-11-07',
    branchId: null,
  })
})
