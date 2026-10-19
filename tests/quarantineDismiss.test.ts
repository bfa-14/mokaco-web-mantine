/**
 * SETTING ASIDE THE PUNCHES OF A PIN THAT BELONGS TO NOBODY (QA3). The request carries the device user and a reason;
 * without a reason nothing is sent, and the reason is trimmed and cut to the stored length. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DISMISS_NOTE_MAX, dismissRequestFor } from '../src/pages/attendance/quarantineDismiss.ts'

const ROW = { deviceId: 3, enrollPin: '9999' }

test('a blank or whitespace-only reason sends nothing', () => {
  assert.equal(dismissRequestFor(ROW, ''), null)
  assert.equal(dismissRequestFor(ROW, '   \n\t'), null)
})

test('the request names the device user and carries the trimmed reason', () => {
  assert.deepEqual(dismissRequestFor(ROW, '  a visitor tried the terminal  '), {
    deviceId: 3,
    enrollPin: '9999',
    note: 'a visitor tried the terminal',
  })
})

test('a reason longer than what is stored is cut to the stored length', () => {
  const request = dismissRequestFor(ROW, 'x'.repeat(DISMISS_NOTE_MAX + 50))
  assert.ok(request)
  assert.equal(request.note.length, DISMISS_NOTE_MAX)
})
