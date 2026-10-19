/**
 * THE LEAVE FORM WARNS WHEN THE SERVER WILL REFUSE (QA3): over the balance LESS what requests still waiting were
 * promised, only for a type whose balance the server enforces. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { overBalance } from '../src/pages/workflow/leaveOverBalance.ts'
import { isDeletableLedgerRow } from '../src/pages/hr/leaveLedgerRows.ts'

test('pending requests are counted: 5 left, 3 promised, 3 more asked -> warned', () => {
  const r = overBalance({ days: 3, balance: 5, pendingDays: 3, balanceEnforced: true })
  assert.equal(r.over, true)
  assert.equal(r.available, 2)
  assert.equal(r.pending, 3)
})

test('within what is left after the pending requests -> no warning', () => {
  assert.equal(overBalance({ days: 2, balance: 5, pendingDays: 3, balanceEnforced: true }).over, false)
})

test('exactly what is left is allowed, like the server (days > balance - pending)', () => {
  assert.equal(overBalance({ days: 2.5, balance: 5, pendingDays: 2.5, balanceEnforced: true }).over, false)
  assert.equal(overBalance({ days: 3, balance: 5, pendingDays: 2.5, balanceEnforced: true }).over, true)
})

test('half days and tenths compare exactly', () => {
  assert.equal(overBalance({ days: 0.3, balance: 0.4, pendingDays: 0.1, balanceEnforced: true }).over, false)
})

test('a type the server does not enforce (unpaid, discretionary, negative allowed) is never warned', () => {
  assert.equal(overBalance({ days: 40, balance: 1, pendingDays: 0, balanceEnforced: false }).over, false)
})

test('an older API without the new figures warns on the bare balance, as before', () => {
  assert.equal(overBalance({ days: 6, balance: 5 }).over, true)
  assert.equal(overBalance({ days: 5, balance: 5 }).over, false)
})

test('nothing to compare yet -> no warning', () => {
  assert.equal(overBalance({ days: null, balance: 5, pendingDays: 1, balanceEnforced: true }).over, false)
  assert.equal(overBalance({ days: 3, balance: null, pendingDays: 1, balanceEnforced: true }).over, false)
  assert.equal(overBalance({ days: 3, balance: null }).available, null)
})

test('only a manual adjustment offers the delete', () => {
  assert.equal(isDeletableLedgerRow({ canDelete: true }), true)
  assert.equal(isDeletableLedgerRow({ canDelete: false }), false)
  assert.equal(isDeletableLedgerRow({}), false)
  assert.equal(isDeletableLedgerRow({ canDelete: null }), false)
})
