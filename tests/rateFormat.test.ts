/**
 * AN EXCHANGE RATE KEEPS 12 DECIMALS (QA3 CON-9): LBP -> USD at 89,500 is 0.000011173184, which four
 * decimals turned into 0. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatRate, inverseRate, RATE_DECIMALS } from '../src/pages/core/rateFormat.ts'

test('a rate keeps 12 decimals: 1/89,500 is 0.000011173184, not 0', () => {
  assert.equal(RATE_DECIMALS, 12)
  assert.equal(formatRate(1 / 89500, 'en-US'), '0.000011173184')
  assert.equal(formatRate(89500, 'en-US'), '89,500')
  assert.equal(Math.round(inverseRate(0.000011173184)!), 89500)
  assert.equal(inverseRate(0), null)
  assert.equal(inverseRate(null), null)
})
