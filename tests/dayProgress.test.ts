/**
 * A DAY STILL BEING WORKED IS NOT A FAULT. Today's record with an In and no pairing yet is "in progress":
 * it is not counted with the days that "could not be read" and is not drawn as a warning. Any other day,
 * and a day with an Out but no In, stays an anomaly. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { companyToday, dayBefore, dayProgress, isOpenAnomaly } from '../src/pages/attendance/dayProgress.ts'

const TODAY = '2026-11-14'
const day = (over: Partial<Parameters<typeof dayProgress>[0]>) => ({
  workDate: `${TODAY}T00:00:00`,
  firstInUtc: `${TODAY}T08:04:00`,
  lastOutUtc: null,
  hasAnomaly: true,
  ...over,
})

test('today, an In and no Out: on shift since the first In', () => {
  assert.deepEqual(dayProgress(day({}), TODAY), { kind: 'onShift', since: `${TODAY}T08:04:00` })
  assert.equal(isOpenAnomaly(day({}), TODAY), false)
})

test('today, Ins and Outs that do not pair yet: in progress, not a fault', () => {
  const backFromBreak = day({ lastOutUtc: `${TODAY}T12:00:00` })
  assert.deepEqual(dayProgress(backFromBreak, TODAY), { kind: 'inProgress' })
  assert.equal(isOpenAnomaly(backFromBreak, TODAY), false)
})

test('the same record tomorrow is a missing punch again', () => {
  assert.equal(dayProgress(day({}), '2026-11-15'), null)
  assert.equal(isOpenAnomaly(day({}), '2026-11-15'), true)
})

test('an Out with no In does not put itself right: it stays an anomaly even today', () => {
  const outOnly = day({ firstInUtc: null, lastOutUtc: `${TODAY}T17:00:00` })
  assert.equal(dayProgress(outOnly, TODAY), null)
  assert.equal(isOpenAnomaly(outOnly, TODAY), true)
})

test('a day that pairs is neither in progress nor an anomaly', () => {
  const clean = day({ lastOutUtc: `${TODAY}T16:00:00`, hasAnomaly: false })
  assert.equal(dayProgress(clean, TODAY), null)
  assert.equal(isOpenAnomaly(clean, TODAY), false)
})

test('a plain date (no time part) is read the same way', () => {
  assert.deepEqual(dayProgress(day({ workDate: TODAY }), TODAY), { kind: 'onShift', since: `${TODAY}T08:04:00` })
})

test('today is the company day (Beirut), not the UTC or browser day', () => {
  // 22:30 UTC on the 13th is already 00:30 on the 14th in Beirut (UTC+2 in November)
  assert.equal(companyToday(new Date('2026-11-13T22:30:00Z')), '2026-11-14')
  // 21:30 UTC in July is 00:30 the next day in Beirut (UTC+3 in summer)
  assert.equal(companyToday(new Date('2026-07-01T21:30:00Z')), '2026-07-02')
  assert.equal(companyToday(new Date('2026-07-01T20:30:00Z')), '2026-07-01')
})

test('the day before, across a month end, a year end and a leap day', () => {
  assert.equal(dayBefore('2026-11-14'), '2026-11-13')
  assert.equal(dayBefore('2026-11-01'), '2026-10-31')
  assert.equal(dayBefore('2027-01-01'), '2026-12-31')
  assert.equal(dayBefore('2028-03-01'), '2028-02-29')
  assert.equal(dayBefore('2026-11-14T00:00:00'), '2026-11-13')
})
