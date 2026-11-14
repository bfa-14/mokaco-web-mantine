/** Server timestamps (UTC) shown on Beirut's clock. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { utcToCompany } from '../src/pages/attendance/companyClock.ts'

test('UTC to Beirut, winter (UTC+2) and summer (UTC+3)', () => {
  assert.deepEqual(utcToCompany('2026-11-14T08:01:23.456'), { day: '14/11/2026', time: '10:01' })
  assert.deepEqual(utcToCompany('2026-11-13T22:30:00Z'), { day: '14/11/2026', time: '00:30' })
  assert.deepEqual(utcToCompany('2026-07-01T08:00:00'), { day: '01/07/2026', time: '11:00' })
})

test('nothing to show', () => {
  assert.equal(utcToCompany(null), null)
  assert.equal(utcToCompany('not a date'), null)
})
