/**
 * TRAP 6: A DECIMAL IS KEPT AS TYPED AND CONVERTED ONCE (QA3 WEB-5).
 * The day-fraction box turned 0.5 into a whole day, the adjustment amount 12.50 into 50, and the
 * leave-policy grid 1.5 into 15. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBoundedDecimal, parseRowCells } from '../src/components/decimalInputs.ts'
import { parseDecimal } from '../src/components/numeric.ts'

test('what the box holds while a decimal is being typed still converts to the figure', () => {
  // Mantine hands these over as STRINGS; the old handlers wrote null (or 0) back for them.
  assert.equal(parseDecimal('0.'), 0)
  assert.equal(parseDecimal('12.5'), 12.5)
  assert.equal(parseDecimal('12.50'), 12.5)
  assert.equal(parseDecimal(12.5), 12.5)
  assert.equal(parseDecimal(''), null)
  assert.equal(parseDecimal('-'), null)
})

test('a day fraction: blank keeps the computed value, 0..1 is a fraction, anything else is refused', () => {
  assert.equal(parseBoundedDecimal('', 0, 1), null)
  assert.equal(parseBoundedDecimal('  ', 0, 1), null)
  assert.equal(parseBoundedDecimal(null, 0, 1), null)
  assert.equal(parseBoundedDecimal('0.5', 0, 1), 0.5)
  assert.equal(parseBoundedDecimal(0.25, 0, 1), 0.25)
  assert.equal(parseBoundedDecimal('0', 0, 1), 0)
  assert.equal(parseBoundedDecimal('1', 0, 1), 1)
  assert.equal(parseBoundedDecimal('1.5', 0, 1), 'invalid')
  assert.equal(parseBoundedDecimal('-0.1', 0, 1), 'invalid')
  assert.equal(parseBoundedDecimal('abc', 0, 1), 'invalid')
})

test('a grid row converts its number cells once and keeps its text cells as text', () => {
  const columns = [{ field: 'minServiceYears' }, { field: 'annualDays' }] as const
  assert.deepEqual(parseRowCells({ minServiceYears: '5', annualDays: '1.5' }, columns), { minServiceYears: 5, annualDays: 1.5 })
  assert.deepEqual(parseRowCells({ minServiceYears: 0, annualDays: 21 }, columns), { minServiceYears: 0, annualDays: 21 })
  const relations = [{ field: 'relation', type: 'text' as const }, { field: 'days' }]
  assert.deepEqual(parseRowCells({ relation: '  Spouse ', days: '3.' }, relations), { relation: 'Spouse', days: 3 })
})

test('a grid row with a blank or unreadable cell is not ready to save', () => {
  const columns = [{ field: 'minServiceYears' }, { field: 'annualDays' }]
  assert.equal(parseRowCells({ minServiceYears: '5', annualDays: '' }, columns), null)
  assert.equal(parseRowCells({ minServiceYears: '5' }, columns), null)
  assert.equal(parseRowCells({ minServiceYears: '5', annualDays: '1.5x' }, columns), null)
  assert.equal(parseRowCells({ relation: '   ', days: 2 }, [{ field: 'relation', type: 'text' }, { field: 'days' }]), null)
})
