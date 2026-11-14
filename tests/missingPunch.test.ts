/** One step for a missing punch: which side is missing, which anomaly is corrected, what the field opens on. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findMissingAnomaly, missingSide, prefillTime } from '../src/pages/attendance/missingPunch.ts'

test('the missing side', () => {
  assert.equal(missingSide({ firstInUtc: '2026-11-13T08:03:00', lastOutUtc: null, hasAnomaly: true }), 'out')
  assert.equal(missingSide({ firstInUtc: null, lastOutUtc: '2026-11-13T16:00:00', hasAnomaly: true }), 'in')
  // both present but unpaired, or a clean day: not a one-step fix
  assert.equal(missingSide({ firstInUtc: '2026-11-13T08:00:00', lastOutUtc: '2026-11-13T16:00:00', hasAnomaly: true }), null)
  assert.equal(missingSide({ firstInUtc: '2026-11-13T08:00:00', lastOutUtc: null, hasAnomaly: false }), null)
})

const a = (over: object) => ({
  anomalyId: 1, attendanceId: 7, type: 'MissingPunch', decision: null,
  shiftStart: '2026-11-13T08:00:00', shiftEnd: '2026-11-13T16:00:00', punchIn: '2026-11-13T08:03:00', punchOut: null, ...over,
})

test('the anomaly to correct: this day, a missing punch, not already corrected', () => {
  assert.equal(findMissingAnomaly([a({ attendanceId: 8 }), a({ type: 'LateArrival', anomalyId: 2 }), a({ anomalyId: 3 })], 7)?.anomalyId, 3)
  assert.equal(findMissingAnomaly([a({ decision: 'Corrected' })], 7), null)
  // an excused or deducted one may still be corrected
  assert.equal(findMissingAnomaly([a({ decision: 'Excused' })], 7)?.anomalyId, 1)
})

test('the field opens on the shift time of the missing side', () => {
  assert.equal(prefillTime(a({}), 'out'), '2026-11-13T16:00:00')
  assert.equal(prefillTime(a({ punchIn: null, punchOut: '2026-11-13T16:05:00' }), 'in'), '2026-11-13T08:00:00')
  // no shift (a month that is not approved): the punch that is there, for its date
  assert.equal(prefillTime(a({ shiftEnd: null }), 'out'), '2026-11-13T08:03:00')
})
