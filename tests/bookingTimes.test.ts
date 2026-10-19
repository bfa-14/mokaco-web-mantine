/**
 * THE BOOKING CALENDAR AND FORMS AFTER MIDNIGHT (QA3 BKG-2 / WEB-1).
 *
 * The rooms open 07:00 and close 01:00 the next day. The calendar drew from clock times, so the
 * window became 07:00–"01:00" (a grid of negative height), a 22:00–01:00 booking was an 18px sliver,
 * Tuesday's 00:00–01:00 (the website's "12:00 AM" of Monday night) sat above the grid, and both forms
 * refused 22:00–01:00 as "end before start". These pin the minutes model the database uses (SQL 89):
 * a close or an end at or before 06:00 is the next morning, a start after midnight is the next date,
 * drawn in the previous night's column. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addClock,
  calendarWindow,
  clockOf,
  closeMinOf,
  formHours,
  formSpan,
  nowInColumn,
  placeInColumns,
  shiftDay,
  slotToForm,
  spanOf,
} from '../src/pages/bookings/bookingTimes.ts'

const day = (openTime: string, closeTime: string, isClosed = false) => ({ openTime, closeTime, isClosed })

test('a close at or before 06:00 is the next morning', () => {
  assert.equal(closeMinOf('01:00:00'), 1500)
  assert.equal(closeMinOf('00:00:00'), 1440)
  assert.equal(closeMinOf('06:00'), 1800)
  assert.equal(closeMinOf('23:00'), 1380)
})

test("the reviewer's rooms, 07:00-01:00 every day, draw a window 07:00 to 01:00 the next day", () => {
  const window = calendarWindow([day('07:00:00', '01:00:00'), day('07:00:00', '01:00:00')])
  assert.deepEqual(window, { start: 420, end: 1500 })      // was { start: 420, end: 60 }: negative height
})

test('one room closing 23:00 and another 01:00: the window reaches 01:00', () => {
  assert.deepEqual(calendarWindow([day('07:00', '23:00'), day('09:00', '01:00')]), { start: 420, end: 1500 })
  assert.deepEqual(calendarWindow([day('07:00', '23:00', true)]), { start: 540, end: 1320 })   // nothing open: the default
})

test('the window widens to whatever has to be drawn, never past 06:00 the next morning', () => {
  assert.deepEqual(calendarWindow([day('07:00', '01:00')], [{ start: 330, end: 400 }]), { start: 300, end: 1500 })
  assert.deepEqual(calendarWindow([day('07:00', '01:00')], [{ start: 1380, end: 1800 }]), { start: 420, end: 1800 })
})

test('a span comes from startMin/endMin, else from the clock times with the next-day rule', () => {
  assert.deepEqual(spanOf({ startTime: '22:00:00', endTime: '01:00:00', startMin: 1320, endMin: 1500 }), { start: 1320, end: 1500 })
  assert.deepEqual(spanOf({ startTime: '22:00:00', endTime: '01:00:00' }), { start: 1320, end: 1500 })
  assert.deepEqual(spanOf({ startTime: '10:00:00', endTime: '12:00:00' }), { start: 600, end: 720 })
  assert.deepEqual(spanOf({ startTime: '00:00:00', endTime: '01:00:00' }), { start: 0, end: 60 })
})

test('the forms read an end at or before the start as the next morning, up to 06:00', () => {
  assert.deepEqual(formSpan('22:00', '01:00'), { start: 1320, end: 1500 })
  assert.equal(formHours('22:00', '01:00'), 3)            // was -21, and the submit button stayed off
  assert.equal(formHours('23:00', '00:00'), 1)            // was -23
  assert.equal(formHours('10:00', '12:30'), 2.5)
  assert.equal(formSpan('22:00', '07:00'), null)          // 07:00 is not "the next morning"
  assert.equal(formSpan('10:00', '10:00'), null)
  assert.equal(formSpan('', '10:00'), null)
  assert.equal(formHours('22:00', '07:00'), 0)
})

test('clock arithmetic wraps past midnight', () => {
  assert.equal(addClock('23:30', 60), '00:30')            // was clamped to 23:59
  assert.equal(addClock('09:00', 60), '10:00')
  assert.equal(clockOf(1500), '01:00')
  assert.equal(clockOf(1440), '00:00')
  assert.equal(shiftDay('2026-10-31', 1), '2026-11-01')
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28')
})

type Item = { id: string; date: string; startTime: string; endTime: string; startMin?: number; endMin?: number }

const place = (items: Item[], days: string[], window = { start: 420, end: 1500 }) =>
  placeInColumns(items, (i) => i.date, spanOf, days, window).map((p) => `${p.item.id}@${p.day}:${p.start}-${p.end}`)

test("Tuesday 00:00-01:00 (Monday night's 12:00 AM) is drawn under Monday at 24:00-25:00", () => {
  const items: Item[] = [
    { id: 'late', date: '2026-11-02', startTime: '22:00:00', endTime: '01:00:00', startMin: 1320, endMin: 1500 },
    { id: 'midnight', date: '2026-11-03', startTime: '00:00:00', endTime: '01:00:00', startMin: 0, endMin: 60 },
    { id: 'morning', date: '2026-11-03', startTime: '10:00:00', endTime: '12:00:00' },
  ]
  assert.deepEqual(place(items, ['2026-11-02', '2026-11-03']), [
    'late@2026-11-02:1320-1500',
    'midnight@2026-11-02:1440-1500',
    'morning@2026-11-03:600-720',
  ])
})

test("the last day's after-midnight booking comes from the extra day fetched; the extra day's own bookings are not drawn", () => {
  const items: Item[] = [
    { id: 'midnight', date: '2026-11-09', startTime: '00:00:00', endTime: '01:00:00' },
    { id: 'nextDay', date: '2026-11-09', startTime: '10:00:00', endTime: '11:00:00' },
  ]
  assert.deepEqual(place(items, ['2026-11-08']), ['midnight@2026-11-08:1440-1500'])
})

test('without the previous night on screen, an early booking stays on its own date and the window grows to show it', () => {
  const items: Item[] = [{ id: 'midnight', date: '2026-11-03', startTime: '00:00:00', endTime: '01:00:00' }]
  const placed = placeInColumns(items, (i) => i.date, spanOf, ['2026-11-03'], { start: 420, end: 1500 })
  assert.deepEqual(placed.map((p) => [p.day, p.start, p.end]), [['2026-11-03', 0, 60]])
  assert.deepEqual(calendarWindow([day('07:00', '01:00')], placed), { start: 0, end: 1500 })
})

test("a booking that does not fit in the previous night's window stays on its own date", () => {
  // the previous night closes at 23:00: Tuesday 00:00 cannot be its after-midnight part
  const items: Item[] = [{ id: 'early', date: '2026-11-03', startTime: '00:00:00', endTime: '01:00:00' }]
  assert.deepEqual(place(items, ['2026-11-02', '2026-11-03'], { start: 420, end: 1380 }), ['early@2026-11-03:0-60'])
})

test('a slot chosen after midnight is the next date for the forms', () => {
  assert.deepEqual(slotToForm('2026-11-02', 1440, 1500), { date: '2026-11-03', start: '00:00', end: '01:00' })
  assert.deepEqual(slotToForm('2026-11-02', 1380, 1500), { date: '2026-11-02', start: '23:00', end: '01:00' })
  assert.deepEqual(slotToForm('2026-11-02', 600, 660), { date: '2026-11-02', start: '10:00', end: '11:00' })
})

test("after midnight, the now line is in yesterday's column", () => {
  const window = { start: 420, end: 1500 }
  assert.equal(nowInColumn('2026-11-03', '2026-11-03', 630, window), 630)
  assert.equal(nowInColumn('2026-11-02', '2026-11-03', 30, window), 1470)     // 00:30 is Monday night
  assert.equal(nowInColumn('2026-11-03', '2026-11-03', 30, window), null)     // not on Tuesday's 07:00 grid
  assert.equal(nowInColumn('2026-11-02', '2026-11-03', 120, window), null)    // 02:00: Monday's window is over
})
