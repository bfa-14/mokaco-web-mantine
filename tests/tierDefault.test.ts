/**
 * A NEW EMPLOYEE WITHOUT A CHOSEN TIER STANDS ON THE LOWEST TIER, NEVER ON 1 (QA3 LEAD-1).
 * Tier 1 is the head since decision D6. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectiveTier, lowestTier } from '../src/hr/tierDefault.ts'

const dictionary = [{ tierNo: 1 }, { tierNo: 2 }, { tierNo: 3 }, { tierNo: 4 }, { tierNo: 5 }, { tierNo: 9 }]

test('the lowest tier is the highest number, whatever the order the list arrives in', () => {
  assert.equal(lowestTier(dictionary), 9)
  assert.equal(lowestTier([{ tierNo: 7 }, { tierNo: 2 }, { tierNo: 11 }, { tierNo: 1 }]), 11)
  assert.equal(lowestTier([{ tierNo: 1 }]), 1)
})

test('no dictionary yet means no tier at all, not tier 1', () => {
  assert.equal(lowestTier([]), null)
  assert.equal(effectiveTier(null, false, []), null)
})

test('on create an untouched tier is the lowest one', () => {
  assert.equal(effectiveTier(null, false, dictionary), 9)
})

test('a chosen tier always wins, tier 1 included', () => {
  assert.equal(effectiveTier(3, false, dictionary), 3)
  assert.equal(effectiveTier(1, false, dictionary), 1)
  assert.equal(effectiveTier(4, true, dictionary), 4)
})

test('on edit nothing is invented', () => {
  assert.equal(effectiveTier(null, true, dictionary), null)
})
