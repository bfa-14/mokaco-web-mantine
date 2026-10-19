/**
 * WEB-17: the booking calendar fetched without a stale-response guard, so paging from one week to the
 * next and back (or a live message arriving mid-page) could draw an OLDER answer over the newer range.
 * The calendar, the New booking quote and the rooms page now apply an answer only while it is the
 * latest request's (src/pages/bookings/latestOnly.ts). Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { latestOnly } from '../src/pages/bookings/latestOnly.ts'

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('an older answer that arrives last is dropped', async () => {
  const latest = latestOnly()
  const drawn: string[] = []
  const load = async (range: string, answersAfterMs: number) => {
    const isLatest = latest.begin()
    await later(answersAfterMs)
    if (isLatest()) drawn.push(range)
  }
  // "this week" is asked first and answers last; "next week" was asked after it.
  await Promise.all([load('this week', 30), load('next week', 5)])
  assert.deepEqual(drawn, ['next week'])        // without the guard: ['next week', 'this week']
})

test('answers that come back in order are all applied, the last one last', async () => {
  const latest = latestOnly()
  const drawn: string[] = []
  for (const range of ['week 1', 'week 2']) {
    const isLatest = latest.begin()
    await later(1)
    if (isLatest()) drawn.push(range)
  }
  assert.deepEqual(drawn, ['week 1', 'week 2'])
})

test('cancel makes every request in flight stale (the page was closed)', () => {
  const latest = latestOnly()
  const first = latest.begin()
  assert.equal(first(), true)
  latest.cancel()
  assert.equal(first(), false)
  assert.equal(latest.begin()(), true)
})
