/**
 * WORKED TIME report helpers: month shortcuts, progress tone, the CSV. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daysOf, hoursOf, monthOf, progressTone, workedTimeCsvRows } from '../src/pages/reports/workedTime.ts'

test('monthOf gives first and last day, across year ends', () => {
  assert.deepEqual(monthOf('2026-11-15'), { from: '2026-11-01', to: '2026-11-30' })
  assert.deepEqual(monthOf('2026-01-10', -1), { from: '2025-12-01', to: '2025-12-31' })
  assert.deepEqual(monthOf('2028-02-03'), { from: '2028-02-01', to: '2028-02-29' })
})

test('progress tone', () => {
  assert.equal(progressTone(null), 'none')
  assert.equal(progressTone(100), 'ok')
  assert.equal(progressTone(95), 'ok')
  assert.equal(progressTone(80), 'warn')
  assert.equal(progressTone(79.9), 'low')
})

const row = (employeeId: number, fullName: string, workedMinutes: number) => ({
  employeeId,
  fullName,
  branchName: 'Hamra',
  departmentName: 'Bar',
  daysWorked: 2,
  workedMinutes,
  averageMinutes: workedMinutes / 2,
  overtimeMinutes: 30,
  missingPunchDays: 1,
  leaveDays: 0.5,
  holidayDays: 0,
  expectedMinutes: 960,
  progressPercent: Math.round((workedMinutes / 960) * 1000) / 10,
  notOnRosterDays: 0,
  notOnRosterMinutes: 0,
})

const report = {
  header: { from: '2026-11-01', to: '2026-11-02', countedTo: '2026-11-02', branchId: null, branchName: null, standardDayMinutes: 480, standardDaysPerMonth: 26, generatedUtc: '' },
  rows: [row(1, 'Lina "L" Saab', 900), row(2, 'Rami Khoury', 450)],
  totals: { ...row(0, '', 1350), expectedMinutes: 1920, progressPercent: 70.3 },
  days: [
    { employeeId: 2, workDate: '2026-11-02', branchName: 'Hamra', kind: 'Present', firstIn: null, lastOut: null, workedMinutes: 450, overtimeMinutes: 0, missingPunch: false, isManual: false, note: null },
    { employeeId: 1, workDate: '2026-11-02', branchName: 'Hamra', kind: 'Present', firstIn: null, lastOut: null, workedMinutes: 450, overtimeMinutes: 0, missingPunch: false, isManual: false, note: null },
    { employeeId: 1, workDate: '2026-11-01', branchName: 'Hamra', kind: 'Present', firstIn: null, lastOut: null, workedMinutes: 450, overtimeMinutes: 0, missingPunch: false, isManual: false, note: null },
  ],
}

test('the CSV has a line per employee and a totals line, hours as numbers', () => {
  const { header, rows } = workedTimeCsvRows(report, (k) => k)
  assert.equal(header.length, 14)
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[0].slice(0, 8), ['Lina "L" Saab', 'Hamra', 'Bar', 2, 15, 7.5, 16, 93.8])
  assert.deepEqual(rows[2].slice(0, 5), ['totals', '', '', 2, 22.5])
  assert.equal(hoursOf(445), 7.42)
})

test('daysOf keeps one employee, by date', () => {
  assert.deepEqual(daysOf(report, 1).map((d) => d.workDate), ['2026-11-01', '2026-11-02'])
})
