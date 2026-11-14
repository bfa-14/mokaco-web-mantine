/** The payslip's short-days line is recognised, and a list that no longer adds up to it is flagged. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isShortDaysLine, listDiffersFromLine } from '../src/pages/payroll/payslipShortDays.ts'

test('the short-days line', () => {
  assert.equal(isShortDaysLine({ sourceType: 'Attendance', sourceId: null, note: '2.31 day(s) short across 4 date(s)' }), true)
  assert.equal(isShortDaysLine({ sourceType: 'Attendance', sourceId: null, note: 'Holiday work: 480 min' }), false)
  assert.equal(isShortDaysLine({ sourceType: 'Leave', sourceId: 4, note: '2 day(s) short across 2 date(s)' }), false)
})

test('a list that no longer matches the line', () => {
  assert.equal(listDiffersFromLine(2.3125, 2.3125), false)
  assert.equal(listDiffersFromLine(2.3125, 2.31), false)
  assert.equal(listDiffersFromLine(1.3125, 2.3125), true)
  assert.equal(listDiffersFromLine(1, null), false)
})
