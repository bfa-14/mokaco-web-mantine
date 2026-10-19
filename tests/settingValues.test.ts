/**
 * A SWITCH ON THE SETTINGS PAGE IS STORED IN THE DIALECT ITS ROW ALREADY USES (QA3). Rows hold '1'/'0' or
 * 'true'/'false'; a row with no value yet gets '1'/'0', the value every reader understands (several
 * procedures test `= '1'` only). Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boolValue, isOn } from '../src/pages/settings/settingValues.ts'

test('either dialect reads as on or off', () => {
  for (const v of ['1', 'true', 'TRUE', ' yes ', 'on']) assert.equal(isOn(v), true, v)
  for (const v of ['0', 'false', '', 'no', 'off', 'maybe']) assert.equal(isOn(v), false, v)
})

test('a row keeps the dialect it already has', () => {
  assert.equal(boolValue('1', false), '0')
  assert.equal(boolValue('0', true), '1')
  assert.equal(boolValue('true', false), 'false')
  assert.equal(boolValue('False', true), 'true')
})

test('a row with no value yet is written as 1 or 0', () => {
  assert.equal(boolValue('', true), '1')
  assert.equal(boolValue('  ', false), '0')
})
