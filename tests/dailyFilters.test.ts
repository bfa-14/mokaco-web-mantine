/** Daily attendance quick filters, period shortcuts and the CSV export. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyQuickFilters, hhmmOf, periodShortcut, quickFilterCounts, toCsv } from '../src/pages/attendance/dailyFilters.ts'

const T = '2026-11-14'
const day = (over: object) => ({
  workDate: '2026-11-13T00:00:00', firstInUtc: '2026-11-13T08:00:00', lastOutUtc: '2026-11-13T16:00:00',
  hasAnomaly: false, status: 'Present', lateMinutes: 0, shortfallMinutes: 0, isFullDay: true, overtimeMinutes: 0, isManual: false, ...over,
})
const days = [
  day({ lateMinutes: 25 }),
  day({ isFullDay: false, shortfallMinutes: 60 }),
  day({ status: 'Absent', firstInUtc: null, lastOutUtc: null }),
  day({ hasAnomaly: true, lastOutUtc: null }),
  day({ workDate: `${T}T00:00:00`, firstInUtc: `${T}T08:00:00`, lastOutUtc: null, hasAnomaly: true, isFullDay: false, shortfallMinutes: 480 }),
  day({ overtimeMinutes: 40, isManual: true }),
  day({ status: 'RestDay', firstInUtc: null, lastOutUtc: null }),
]

test('each chip counts the days that answer it; today in progress is neither missing nor short', () => {
  assert.deepEqual(quickFilterCounts(days, T), { late: 1, short: 1, absent: 1, missing: 1, inProgress: 1, overtime: 1, manual: 1, off: 1 })
})

test('chips combine as "any of"; none chosen = every day', () => {
  assert.equal(applyQuickFilters(days, [], T).length, days.length)
  assert.equal(applyQuickFilters(days, ['late', 'absent'], T).length, 2)
})

test('period shortcuts, a week starting on Monday', () => {
  assert.deepEqual(periodShortcut('today', T), { from: T, to: T })
  assert.deepEqual(periodShortcut('yesterday', '2026-11-01'), { from: '2026-10-31', to: '2026-10-31' })
  // 14 Nov 2026 is a Saturday: the week began on Monday the 9th
  assert.deepEqual(periodShortcut('week', T), { from: '2026-11-09', to: T })
  assert.deepEqual(periodShortcut('week', '2026-11-09'), { from: '2026-11-09', to: '2026-11-09' })
  assert.deepEqual(periodShortcut('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' })
})

test('CSV for Excel: BOM, quoted text, numbers bare, CRLF', () => {
  assert.equal(toCsv(['Name', 'Late'], [['Rami "R" خوري', 25], ['x', null]]), '﻿"Name","Late"\r\n"Rami ""R"" خوري",25\r\n"x",\r\n')
  assert.equal(hhmmOf(485), '8:05')
  assert.equal(hhmmOf(0), '0:00')
})
