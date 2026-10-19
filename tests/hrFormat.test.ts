/**
 * A SERVER TIMESTAMP IS UTC, EVEN WITHOUT A ZONE ON THE WIRE (QA3 WEB-11).
 * '2026-10-19T21:30:00' was shown as 21:30 Beirut time; it is 00:30 on the 20th. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtDateTime, fmtLocalDate, parseUtcStamp } from '../src/pages/hr/hrFormat.ts'

// Beirut, so a zoneless string read as LOCAL time (the bug) cannot pass for UTC by accident on a UTC
// machine. node --test runs every test file in its own process: this does not leak.
process.env.TZ = 'Asia/Beirut'

test('this process really is on Beirut time (the premise of the tests below)', () => {
  assert.notEqual(new Date('2026-10-19T21:30:00').getTime(), Date.UTC(2026, 9, 19, 21, 30, 0))
})

test('a zoneless date-time is read as UTC', () => {
  assert.equal(parseUtcStamp('2026-10-19T21:30:00')?.getTime(), Date.UTC(2026, 9, 19, 21, 30, 0))
  assert.equal(parseUtcStamp('2026-10-19T21:30:00.1234567')?.getTime(), Date.UTC(2026, 9, 19, 21, 30, 0, 123))
})

test('a value that carries its zone is taken as it is', () => {
  assert.equal(parseUtcStamp('2026-10-19T21:30:00Z')?.getTime(), Date.UTC(2026, 9, 19, 21, 30, 0))
  assert.equal(parseUtcStamp('2026-10-20T00:30:00+03:00')?.getTime(), Date.UTC(2026, 9, 19, 21, 30, 0))
})

test('missing or unreadable is empty, never Invalid Date', () => {
  assert.equal(parseUtcStamp(null), null)
  assert.equal(parseUtcStamp(''), null)
  assert.equal(parseUtcStamp('not a date'), null)
  assert.equal(fmtDateTime(undefined), '')
  assert.equal(fmtLocalDate('garbage'), '')
})

test('the local date of a late-evening UTC stamp is already the next day in Beirut', () => {
  assert.equal(fmtLocalDate('2026-10-19T21:30:00', 'en-GB'), '20/10/2026')
  assert.equal(fmtDateTime('2026-10-19T21:30:00', 'en-GB'), '20/10/2026, 00:30:00')
})
