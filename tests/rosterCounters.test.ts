/**
 * THE ROSTER'S COUNTERS COUNT WHAT THE GRID SHOWS.
 *
 * Work / Rest / Sat off / Sun off, the 6·5 strip and the on-duty footer are worked out in the
 * browser from the cells on screen, so a manager editing the draft sees them move without a server
 * call. These pin the rules they share with the planner (docs/AUTO_ROSTER.md): weeks are Monday
 * first, a rest row on a leave day is not a rest day, a weekday staffing row beats an every-day
 * one. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays,
  dayOfWeek,
  employeeCounts,
  mondayOf,
  onDutyByDay,
  onDutyUnderDraft,
  rosterWindow,
  staffingForDay,
  stripText,
  weekIndex,
  weekStartsBetween,
  weekStrip,
} from '../src/pages/attendance/rosterCounters.ts'
import type { CounterCell } from '../src/pages/attendance/rosterCounters.ts'

/**
 * A week (Mon..Sun) as letters: W work, R rest, N no row, L rest on a full-day leave, K work on a
 * full-day leave, H work on a half-day leave, h rest on a half-day leave, ? unknown.
 */
function weekCells(start: string, pattern: string): Map<string, CounterCell | undefined> {
  const map = new Map<string, CounterCell | undefined>()
  ;[...pattern].forEach((letter, i) => {
    const date = addDays(start, i)
    const cell: CounterCell | undefined =
      letter === 'W' ? { state: 'work' }
      : letter === 'R' ? { state: 'rest' }
      : letter === 'N' ? { state: 'none' }
      : letter === 'L' ? { state: 'rest', onLeave: true, fullDayLeave: true }
      : letter === 'K' ? { state: 'work', onLeave: true, fullDayLeave: true }
      : letter === 'H' ? { state: 'work', onLeave: true }
      : letter === 'h' ? { state: 'rest', onLeave: true }
      : undefined
    map.set(date, cell)
  })
  return map
}

function merge(...maps: Map<string, CounterCell | undefined>[]): (date: string) => CounterCell | undefined {
  return (date) => {
    for (const map of maps) if (map.has(date)) return map.get(date)
    return undefined
  }
}

test('weeks are Monday first, in UTC, whatever the month', () => {
  assert.equal(dayOfWeek('2026-11-30'), 1) // Monday
  assert.equal(dayOfWeek('2026-11-01'), 7) // Sunday
  assert.equal(mondayOf('2026-11-01'), '2026-10-26')
  assert.equal(mondayOf('2026-06-01'), '2026-06-01') // June 2026 starts on a Monday
  assert.equal(addDays('2026-02-28', 1), '2026-03-01')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
})

test('the week number never resets at a month or year end', () => {
  assert.equal(weekIndex('1900-01-01'), 0)
  assert.equal(weekIndex('1900-01-07'), 0)
  assert.equal(weekIndex('1900-01-08'), 1)
  assert.equal(weekIndex('2026-12-28'), weekIndex('2027-01-03'))
  assert.equal(weekIndex('2027-01-04') - weekIndex('2026-12-28'), 1)
})

test('the window is whole Monday–Sunday weeks around the month', () => {
  assert.deepEqual(rosterWindow('2026-12-01', '2026-12-31'), { from: '2026-11-30', to: '2027-01-03' })
  assert.deepEqual(rosterWindow('2026-11-01', '2026-11-30'), { from: '2026-10-26', to: '2026-12-06' })
  assert.deepEqual(weekStartsBetween('2026-11-01', '2026-11-30'), [
    '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30',
  ])
})

test('work, rest and weekend days off are counted from the cells; rest on leave is not rest', () => {
  // Week of Mon 7 Dec 2026: rest on Sat, rest-on-leave on Sun, a holiday with no row on Wed.
  const cells = weekCells('2026-12-07', 'WWNWWRL')
  const days = [...cells.keys()]
  assert.deepEqual(employeeCounts(days, (d) => cells.get(d)), {
    workDays: 4,
    restDays: 1,
    saturdaysOff: 1,
    sundaysOff: 0,
  })
  // A working row under leave is a rostered working day (it is what the leave is priced on).
  const leaveWeek = weekCells('2026-12-14', 'KKKKKRR')
  assert.equal(employeeCounts([...leaveWeek.keys()], (d) => leaveWeek.get(d)).workDays, 5)
  assert.equal(employeeCounts([...leaveWeek.keys()], (d) => leaveWeek.get(d)).sundaysOff, 1)
})

test('a rest row on a HALF-day leave is not a rest day either, as the planner counts it', () => {
  // The planner's CountsAsRest wants no leave at all on the day; a half day is still leave.
  const cells = weekCells('2026-12-07', 'WWHWWhR')
  const counts = employeeCounts([...cells.keys()], (d) => cells.get(d))
  assert.deepEqual(counts, { workDays: 5, restDays: 1, saturdaysOff: 0, sundaysOff: 1 })
  // The preview saw 1 rest for that week; the strip counts the same and keeps its verdict.
  const strip = weekStrip(['2026-12-07'], (d) => cells.get(d), [
    { weekStart: '2026-12-07', workDays: 6, rests: 1, quota: 1, ok: true },
  ])
  assert.equal(strip[0].rests, 1)
  assert.equal(strip[0].ok, true)
})

test('a saved month reads 6·5 from the shape of each week and marks a broken alternation', () => {
  const starts = ['2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28']
  const cellOf = merge(
    weekCells('2026-12-07', 'WWWWWWR'), // 1 rest → 6
    weekCells('2026-12-14', 'WWRWWWR'), // 2 rests → 5
    weekCells('2026-12-21', 'WWWWWRW'), // 1 rest → 6
    weekCells('2026-12-28', 'WWWWRWW'), // 1 rest → 6 again: broken
  )
  const strip = weekStrip(starts, cellOf)
  assert.deepEqual(strip.map((w) => w.type), [6, 5, 6, 6])
  assert.deepEqual(strip.map((w) => w.ok), [true, true, true, false])
  assert.equal(stripText(strip), '6·5·6·6')
})

test('a holiday off does not use up the week: 5 worked + 1 rest + the holiday is a 6-day week', () => {
  const strip = weekStrip(['2026-12-21'], merge(weekCells('2026-12-21', 'WWWWNWR')))
  assert.equal(strip[0].type, 6)
  assert.equal(strip[0].ok, true)
})

test('weeks with an unknown day or with leave are not judged', () => {
  const strip = weekStrip(
    ['2026-11-30', '2026-12-07', '2026-12-14'],
    merge(
      weekCells('2026-11-30', '?WWWWWR'), // Monday 30 Nov not read
      weekCells('2026-12-07', 'KKKKKKK'), // a whole week of leave: rest absorbed
      weekCells('2026-12-14', 'WWWWWWW'), // no rest at all: broken
    ),
  )
  assert.deepEqual(strip.map((w) => w.ok), [null, null, false])
  assert.equal(strip[0].type, null)
  assert.equal(stripText(strip), '–·–·–')
})

test("with the preview's weeks, the server's type and quota rule; an edited week is re-judged", () => {
  const server = [
    { weekStart: '2026-12-07', workDays: 6, rests: 1, quota: 1, ok: true },
    // Rest absorbed by a leave: 0 rests, quota 2, and the server still says ok.
    { weekStart: '2026-12-14', workDays: 5, rests: 0, quota: 2, ok: true },
    { weekStart: '2026-12-21', workDays: 6, rests: 1, quota: 1, ok: true },
  ]
  const cellOf = merge(
    weekCells('2026-12-07', 'WWWWWWR'),
    weekCells('2026-12-14', 'KKKKKKK'),
    weekCells('2026-12-21', 'WWWWWRR'), // the manager added a second rest: 2 ≠ quota 1
  )
  const strip = weekStrip(['2026-12-07', '2026-12-14', '2026-12-21'], cellOf, server)
  assert.deepEqual(strip.map((w) => w.type), [6, 5, 6])
  assert.deepEqual(strip.map((w) => w.ok), [true, true, false])
  assert.deepEqual(strip.map((w) => w.quota), [1, 2, 1])
})

test('on duty counts working rows, not rest, not full-day leave; a half day is on duty', () => {
  const rows = new Map<string, CounterCell>([
    ['1|2026-12-07', { state: 'work' }],
    ['2|2026-12-07', { state: 'work', onLeave: true, fullDayLeave: true }],
    ['3|2026-12-07', { state: 'rest' }],
    ['4|2026-12-07', { state: 'work' }],
    ['5|2026-12-07', { state: 'work', onLeave: true }],
    ['1|2026-12-08', { state: 'none' }],
  ])
  const duty = onDutyByDay(['2026-12-07', '2026-12-08'], [1, 2, 3, 4, 5], (e, d) => rows.get(`${e}|${d}`))
  assert.equal(duty.get('2026-12-07'), 3)
  assert.equal(duty.get('2026-12-08'), 0)
})

test("under a draft the footer is the preview's count, moved only by the days edited since", () => {
  const grid = new Map([
    ['2026-12-07', 4],
    ['2026-12-08', 4],
    ['2026-12-09', 2],
  ])
  // The preview counted a pending half-day leave as on duty on the 7th; the grid cannot tell.
  const preview = new Map([
    ['2026-12-07', 5],
    ['2026-12-08', 4],
  ])
  const duty = onDutyUnderDraft(grid, preview, [
    { date: '2026-12-08', was: true, now: false }, // a working day made a rest day
    { date: '2026-12-07', was: true, now: true }, // a shift swapped: still on duty
    { date: '2026-12-09', was: false, now: true }, // not in the preview: the grid already counts it
  ])
  assert.deepEqual([...duty], [
    ['2026-12-07', 5],
    ['2026-12-08', 3],
    ['2026-12-09', 2],
  ])
})

test('staffing: a weekday row beats an every-day row; per-shift minimums add up', () => {
  const rows = [
    { dayOfWeek: null, shiftId: null, minOnDuty: 3, targetOnDuty: 4 },
    { dayOfWeek: 6, shiftId: null, minOnDuty: 5, targetOnDuty: null },
  ]
  assert.deepEqual(staffingForDay(rows, '2026-12-07'), { min: 3, target: 4 }) // Monday: every-day row
  assert.deepEqual(staffingForDay(rows, '2026-12-12'), { min: 5, target: null }) // Saturday: its own row

  const perShift = [
    { dayOfWeek: null, shiftId: 1, minOnDuty: 2, targetOnDuty: 3 },
    { dayOfWeek: null, shiftId: 2, minOnDuty: 2, targetOnDuty: null },
    { dayOfWeek: 7, shiftId: 2, minOnDuty: 1, targetOnDuty: null },
  ]
  assert.deepEqual(staffingForDay(perShift, '2026-12-07'), { min: 4, target: 5 })
  assert.deepEqual(staffingForDay(perShift, '2026-12-13'), { min: 3, target: 4 }) // Sunday: shift 2 needs 1
  assert.deepEqual(staffingForDay([], '2026-12-07'), { min: null, target: null })
})
