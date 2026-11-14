/** The weekly shifts poster built from the roster. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWeeklyPoster, clock12, daysBetween, weekStart } from '../src/pages/attendance/weeklyShifts.ts'

const am = { shiftId: 1, shiftName: 'AM', startTime: '07:00:00', endTime: '14:00:00' }
const pm = { shiftId: 2, shiftName: 'PM', startTime: '14:00:00', endTime: '21:00:00' }
const row = (employeeId: number, fullName: string, date: string, s: typeof am | null) => ({
  employeeId, fullName, workDate: `${date}T00:00:00`, isRestDay: s === null,
  shiftId: s?.shiftId ?? null, shiftName: s?.shiftName ?? null, startTime: s?.startTime ?? null, endTime: s?.endTime ?? null,
})

test('one column per shift (by start time), names per day, OFF when nobody works, leave left out', () => {
  const days = daysBetween('2026-11-16', '2026-11-22')
  const poster = buildWeeklyPoster({
    days,
    assignments: [
      row(2, 'Nour Mhanna', '2026-11-16', pm), row(1, 'Rami Abi Haydar', '2026-11-16', am), row(3, 'Ali Serhan', '2026-11-16', am),
      row(1, 'Rami Abi Haydar', '2026-11-17', am), row(3, 'Ali Serhan', '2026-11-17', am),
      row(1, 'Rami Abi Haydar', '2026-11-22', null),
    ],
    leave: [{ employeeId: 3, date: '2026-11-17T00:00:00', daysOnLeave: 1 }],
  })
  assert.deepEqual(poster.columns.map((c) => c.name), ['AM', 'PM'])
  assert.deepEqual(poster.rows[0].cells[1], ['Ali Serhan', 'Rami Abi Haydar'])
  assert.deepEqual(poster.rows[0].cells[2], ['Nour Mhanna'])
  assert.deepEqual(poster.rows[1].cells[1], ['Rami Abi Haydar'])   // Ali is on leave
  assert.equal(poster.rows[6].off, true)                             // Sunday: a rest day only
  assert.equal(poster.rows.length, 7)
})

test('only the chosen shifts; first names unless two people share one', () => {
  const poster = buildWeeklyPoster({
    days: ['2026-11-16'],
    assignments: [row(1, 'Rami Abi Haydar', '2026-11-16', am), row(4, 'Rami Saad', '2026-11-16', am), row(3, 'Ali Serhan', '2026-11-16', am), row(2, 'Nour Mhanna', '2026-11-16', pm)],
    leave: [],
    onlyShifts: [1],
    firstNames: true,
  })
  assert.deepEqual(poster.columns.map((c) => c.shiftId), [1])
  assert.deepEqual(poster.rows[0].cells[1], ['Ali', 'Rami Abi Haydar', 'Rami Saad'])
})

test('dates and clocks', () => {
  assert.equal(weekStart('2026-11-14'), '2026-11-09')
  assert.equal(weekStart('2026-11-16'), '2026-11-16')
  assert.equal(clock12('07:00:00'), '7:00 AM')
  assert.equal(clock12('14:00'), '2:00 PM')
  assert.equal(clock12('00:30'), '12:30 AM')
  assert.equal(clock12('12:00'), '12:00 PM')
})
