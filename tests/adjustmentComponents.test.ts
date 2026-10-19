/**
 * A PAYROLL ADJUSTMENT OFFERS THE ACTIVE COMPONENT TYPES (QA3 WEB-10). Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adjustmentComponentOptions } from '../src/pages/workflow/adjustmentComponents.ts'

test('deactivated types are not offered; an absent flag means active', () => {
  const list = adjustmentComponentOptions([
    { componentTypeId: 1, name: 'Bonus', category: 'Earning', sign: 1, isActive: true },
    { componentTypeId: 2, name: 'Old allowance', category: 'Earning', sign: 1, isActive: false },
    { componentTypeId: 3, name: 'Fine', category: 'Deduction', sign: -1 },
  ])
  assert.deepEqual(list.map((c) => c.componentTypeId), [3, 1])
})

test('grouped by category, then by name', () => {
  const list = adjustmentComponentOptions([
    { componentTypeId: 1, name: 'Tips', category: 'Earning', sign: 1 },
    { componentTypeId: 2, name: 'Bonus', category: 'Earning', sign: 1 },
    { componentTypeId: 3, name: 'Loan', category: 'Deduction', sign: -1 },
  ])
  assert.deepEqual(list.map((c) => c.name), ['Loan', 'Bonus', 'Tips'])
})
