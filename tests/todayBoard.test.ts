/**
 * THE TODAY BOARD sorts every person of today into one list: not in yet, in now, left, not on the
 * roster, on leave, rest day. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTodayBoard, companyNow } from '../src/pages/attendance/todayBoard.ts'

const T = '2026-11-14'
const shift = (employeeId: number, fullName: string, start = '08:00:00', end = '16:00:00') => ({
  employeeId,
  fullName,
  workDate: `${T}T00:00:00`,
  isRestDay: false,
  shiftName: 'Morning',
  startTime: start,
  endTime: end,
})
const record = (employeeId: number, fullName: string, firstIn: string | null, lastOut: string | null, hasAnomaly = false) => ({
  attendanceId: employeeId * 10,
  employeeId,
  fullName,
  workDate: `${T}T00:00:00`,
  firstInUtc: firstIn ? `${T}T${firstIn}:00` : null,
  lastOutUtc: lastOut ? `${T}T${lastOut}:00` : null,
  hasAnomaly,
  lateMinutes: 0,
  workedMinutes: 0,
  status: 'Present',
})

test('each person lands in exactly one list', () => {
  const board = buildTodayBoard({
    today: T,
    now: `${T}T09:30`,
    roster: [
      shift(1, 'Lina'),
      shift(2, 'Ahmad'),
      shift(3, 'Rami'),
      shift(4, 'Nour', '14:00:00', '22:00:00'),
      { ...shift(5, 'Ziad'), isRestDay: true, shiftName: null, startTime: null, endTime: null },
      shift(6, 'Maya'),
      shift(7, 'Hala', '06:00:00', '09:00:00'),
    ],
    records: [record(1, 'Lina', '08:01', null, true), record(2, 'Ahmad', '07:58', '09:10'), record(9, 'Joe', '08:30', null, true)],
    leave: [{ employeeId: 6, date: `${T}T00:00:00`, daysOnLeave: 0.5 }],
    offRoster: [
      { employeeId: 8, employeeName: 'Sami', workDate: `${T}T00:00:00`, firstPunch: `${T}T08:02:00`, lastPunch: `${T}T08:02:00`, punchCount: 1, state: 'Open' },
      { employeeId: 10, employeeName: 'Dismissed', workDate: `${T}T00:00:00`, firstPunch: `${T}T08:02:00`, lastPunch: `${T}T08:02:00`, punchCount: 1, state: 'Dismissed' },
    ],
  })
  const names = (g: keyof typeof board.groups) => board.groups[g].map((p) => p.name)
  assert.deepEqual(names('in'), ['Lina', 'Joe'])
  assert.deepEqual(names('left'), ['Ahmad'])
  // Hala's shift is over (09:00), Rami's started 90 minutes ago, Nour starts at 14:00.
  assert.deepEqual(names('notYet'), ['Hala', 'Rami', 'Nour'])
  assert.equal(board.groups.notYet[0].shiftOver, true)
  assert.equal(board.groups.notYet[1].minutesFromStart, 90)
  assert.equal(board.groups.notYet[2].minutesFromStart, -270)
  assert.deepEqual(names('leave'), ['Maya'])
  assert.equal(board.groups.leave[0].halfDay, true)
  assert.deepEqual(names('rest'), ['Ziad'])
  assert.deepEqual(names('offRoster'), ['Sami'])
  assert.deepEqual([board.arrived, board.notYet, board.off, board.offRoster], [3, 3, 2, 1])
})

test('back from a break (ins and outs that do not pair yet) is still in', () => {
  const board = buildTodayBoard({
    today: T,
    now: `${T}T12:00`,
    roster: [shift(1, 'Lina')],
    records: [record(1, 'Lina', '08:00', '11:00', true)],
    leave: [],
    offRoster: [],
  })
  assert.equal(board.groups.in.length, 1)
})

test('a rest day with punches counts as arrived, marked as a rest day', () => {
  const board = buildTodayBoard({
    today: T,
    now: `${T}T12:00`,
    roster: [{ ...shift(1, 'Lina'), isRestDay: true }],
    records: [record(1, 'Lina', '08:00', null, true)],
    leave: [],
    offRoster: [],
  })
  assert.equal(board.groups.in[0].onRestDay, true)
})

test('an overnight shift is never over on its first day', () => {
  const board = buildTodayBoard({
    today: T,
    now: `${T}T23:30`,
    roster: [shift(1, 'Night', '22:00:00', '06:00:00')],
    records: [],
    leave: [],
    offRoster: [],
  })
  assert.equal(board.groups.notYet[0].shiftOver, false)
  assert.equal(board.groups.notYet[0].minutesFromStart, 90)
})

test('other days are ignored', () => {
  const board = buildTodayBoard({
    today: T,
    now: `${T}T12:00`,
    roster: [{ ...shift(1, 'Lina'), workDate: '2026-11-13T00:00:00' }],
    records: [{ ...record(2, 'Ahmad', '08:00', null), workDate: '2026-11-13T00:00:00' }],
    leave: [],
    offRoster: [],
  })
  assert.equal(board.arrived + board.notYet + board.off + board.offRoster, 0)
})

test("Beirut's wall clock", () => {
  // 06:16 UTC in November is 08:16 in Beirut (UTC+2).
  assert.equal(companyNow(new Date('2026-11-14T06:16:42Z')), '2026-11-14T08:16')
})
