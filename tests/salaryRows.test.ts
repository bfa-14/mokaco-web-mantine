/**
 * THE SALARY TAB CHANGES A SALARY FROM A DATE AND ENDS IT ON ONE, NEVER IN PLACE (QA3 PAY-6 / REL-2);
 * THE COMPONENT TYPES PAYROLL WRITES ARE LOCKED (QA3 PAY-10). Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assignableTypes,
  canEndOn,
  isBasicType,
  isComputedType,
  isOpenRow,
  isSystemType,
  salaryRowState,
  sortSalaryRows,
} from '../src/pages/hr/salaryRows.ts'

const row = (over: Partial<{ salaryComponentId: number; componentName: string; effectiveFrom: string; effectiveTo: string | null }>) => ({
  salaryComponentId: 1,
  componentName: 'Basic Salary',
  effectiveFrom: '2026-01-01T00:00:00',
  effectiveTo: null as string | null,
  ...over,
})

test('a row is ended, scheduled or current on a given day', () => {
  assert.equal(salaryRowState(row({ effectiveTo: '2026-03-15' }), '2026-04-01'), 'ended')
  assert.equal(salaryRowState(row({ effectiveTo: '2026-04-30' }), '2026-04-01'), 'current')
  assert.equal(salaryRowState(row({ effectiveFrom: '2026-05-16' }), '2026-04-01'), 'scheduled')
  assert.equal(salaryRowState(row({}), '2026-04-01'), 'current')
})

test('only an open row can be changed or ended, and not before it starts', () => {
  assert.equal(isOpenRow(row({})), true)
  assert.equal(isOpenRow(row({ effectiveTo: '2026-03-15' })), false)
  assert.equal(canEndOn(row({ effectiveFrom: '2026-03-16' }), '2026-03-31'), true)
  assert.equal(canEndOn(row({ effectiveFrom: '2026-03-16' }), '2026-03-15'), false)
  assert.equal(canEndOn(row({ effectiveTo: '2026-03-31' }), '2026-04-30'), false)
})

test('the form offers the basic salary and the hand-assigned types, never what payroll computes', () => {
  const types = [
    { componentTypeId: 1, name: 'Basic Salary', systemCode: 'BASIC', isSystem: true, isActive: true },
    { componentTypeId: 2, name: 'Overtime', systemCode: 'OVERTIME', isSystem: true, isActive: true },
    { componentTypeId: 3, name: 'Transport', systemCode: null, isSystem: false, isActive: true },
    { componentTypeId: 4, name: 'Old allowance', systemCode: null, isSystem: false, isActive: false },
    { componentTypeId: 5, name: 'NSSF Employee Share', systemCode: 'NSSF_EMPLOYEE', isSystem: true, isActive: true },
  ]
  assert.deepEqual(assignableTypes(types).map((t) => t.componentTypeId), [1, 3])
  // the type of the row being changed stays in the box even when it is no longer offered
  assert.deepEqual(assignableTypes(types, 4).map((t) => t.componentTypeId), [1, 3, 4])
  assert.equal(isComputedType(types[0]), false)
  assert.equal(isComputedType(types[1]), true)
})

test('the basic salary is found by its code, by its name only when the API sends no code', () => {
  assert.equal(isBasicType({ name: 'Monthly salary', systemCode: 'BASIC' }), true)
  assert.equal(isBasicType({ name: 'Basic bonus', systemCode: 'TIPS' }), false)
  assert.equal(isBasicType({ name: 'Basic Salary', systemCode: undefined }), true)
  assert.equal(isBasicType(undefined), false)
})

test('a system type is locked; a type without a code is not', () => {
  assert.equal(isSystemType({ systemCode: 'OVERTIME', isSystem: true }), true)
  assert.equal(isSystemType({ systemCode: 'BASIC' }), true)
  assert.equal(isSystemType({ systemCode: null, isSystem: false }), false)
  assert.equal(isSystemType({}), false)
})

test('open rows first by component, then the history newest first', () => {
  const rows = [
    row({ salaryComponentId: 1, componentName: 'Basic Salary', effectiveFrom: '2025-01-01', effectiveTo: '2026-03-15' }),
    row({ salaryComponentId: 2, componentName: 'Basic Salary', effectiveFrom: '2026-03-16' }),
    row({ salaryComponentId: 3, componentName: 'Allowance', effectiveFrom: '2026-01-01' }),
    row({ salaryComponentId: 4, componentName: 'Allowance', effectiveFrom: '2024-01-01', effectiveTo: '2025-12-31' }),
  ]
  assert.deepEqual(sortSalaryRows(rows).map((r) => r.salaryComponentId), [3, 2, 1, 4])
})
