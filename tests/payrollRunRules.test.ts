/**
 * THE RUN AND PAYSLIP PAGES OFFER AN ACT EXACTLY WHERE THE SERVER WOULD HONOUR IT (QA3 PAY-3, PAY-5,
 * PAY-12, WEB-14, WEB-15): Approve & lock for the Owner only; an early lock only before the period's last
 * day is over in Beirut, and only once confirmed; the out-of-date banner naming each employee's changed
 * sources; Record payment for PAYROLL_APPROVE on an approved, unpaid payslip. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  approveBody,
  beirutDay,
  canOfferApprove,
  canRecordPayment,
  dayAfter,
  dayBefore,
  earlyLockCutoff,
  isEarlyLock,
  netParts,
  summarizeStaleness,
} from '../src/pages/payroll/payrollRunRules.ts'
import type { PayrollRunStaleInput } from '../src/types/payroll.ts'

test('Approve & lock is offered to the Owner holding PAYROLL_APPROVE, nobody else', () => {
  assert.equal(canOfferApprove(['Owner'], true), true)
  assert.equal(canOfferApprove(['HR', 'Owner'], true), true)
  // A General Manager holds PAYROLL_APPROVE (it records payments) but the procedure admits the Owner alone.
  assert.equal(canOfferApprove(['General Manager'], true), false)
  assert.equal(canOfferApprove(['Admin'], true), false)
  // The role without the code: the API would 403 before the procedure is asked.
  assert.equal(canOfferApprove(['Owner'], false), false)
  assert.equal(canOfferApprove(undefined, true), false)
})

test('a period is over once its last day has ended in Beirut', () => {
  const august = { runType: 'Primary', periodEnd: '2026-08-31T00:00:00' }
  // 31 August 20:59 UTC is 23:59 in Beirut (UTC+3): still the last day — an early lock.
  assert.equal(isEarlyLock(august, new Date('2026-08-31T20:59:00Z')), true)
  // 31 August 21:00 UTC is midnight in Beirut: 1 September — the month is over.
  assert.equal(isEarlyLock(august, new Date('2026-08-31T21:00:00Z')), false)
  assert.equal(isEarlyLock(august, new Date('2026-08-15T09:00:00Z')), true)
  // A supplemental pays signed adjustments only: never an early lock.
  assert.equal(isEarlyLock({ runType: 'Supplemental', periodEnd: '2026-08-31' }, new Date('2026-08-15T09:00:00Z')), false)
})

test('the early-lock cut-off is the last day the generation counted, else yesterday in Beirut', () => {
  assert.equal(earlyLockCutoff('2026-08-27T00:00:00', new Date('2026-08-29T10:00:00Z')), '2026-08-27')
  assert.equal(earlyLockCutoff(null, new Date('2026-08-29T10:00:00Z')), '2026-08-28')
  // 22:30 UTC on the 29th is already the 30th in Beirut: yesterday is the 29th.
  assert.equal(earlyLockCutoff(undefined, new Date('2026-08-29T22:30:00Z')), '2026-08-29')
})

test('the approve body carries the flag only for an early lock the Owner confirmed', () => {
  assert.deepEqual(approveBody(true, true), { allowEarlyLock: true })
  assert.deepEqual(approveBody(true, false), { allowEarlyLock: false })
  assert.deepEqual(approveBody(false, true), { allowEarlyLock: false })
  assert.deepEqual(approveBody(false, false), { allowEarlyLock: false })
})

test('day arithmetic crosses month and year ends', () => {
  assert.equal(dayBefore('2026-03-01'), '2026-02-28')
  assert.equal(dayBefore('2028-03-01'), '2028-02-29')
  assert.equal(dayAfter('2026-12-31'), '2027-01-01')
  assert.equal(beirutDay(new Date('2026-12-31T22:00:00Z')), '2027-01-01')
})

test('the out-of-date banner names each employee once, sources in a fixed order, run-wide changes apart', () => {
  const items: PayrollRunStaleInput[] = [
    { employeeId: 7, employeeName: 'Rami', source: 'Leave' },
    { employeeId: 7, employeeName: 'Rami', source: 'Advances' },
    { employeeId: 3, employeeName: 'Hadi', source: 'Attendance' },
    { employeeId: 7, employeeName: 'Rami', source: 'Leave' },
    { employeeId: null, employeeName: null, source: 'Settings' },
    { employeeId: 9, employeeName: 'Nour', source: 'Missing' },
  ]
  const s = summarizeStaleness(items, 2)
  assert.equal(s.isStale, true)
  assert.equal(s.runWide, true)
  assert.equal(s.peopleCount, 3)
  assert.deepEqual(s.people.map((p) => p.name), ['Hadi', 'Nour'])
  assert.equal(s.morePeople, 1)
  const all = summarizeStaleness(items)
  assert.deepEqual(all.people.find((p) => p.name === 'Rami')?.sources, ['Leave', 'Advances'])
  assert.equal(all.morePeople, 0)
})

test('nothing changed: no banner', () => {
  assert.equal(summarizeStaleness([]).isStale, false)
  assert.equal(summarizeStaleness(null).isStale, false)
  const onlySettings = summarizeStaleness([{ employeeId: null, employeeName: null, source: 'Settings' }])
  assert.equal(onlySettings.isStale, true)
  assert.equal(onlySettings.peopleCount, 0)
})

test('Record payment: PAYROLL_APPROVE, an approved run, not yet paid', () => {
  assert.equal(canRecordPayment(true, 'Approved', null), true)
  assert.equal(canRecordPayment(false, 'Approved', null), false)
  assert.equal(canRecordPayment(true, 'Review', null), false)
  assert.equal(canRecordPayment(true, 'Approved', '2026-09-02T10:00:00'), false)
})

test('the nets are two figures, never merged; a zero one is left out', () => {
  assert.deepEqual(netParts({ netUsd: 500, netLbp: 0 }), [{ currency: 'USD', amount: 500 }])
  assert.deepEqual(netParts({ netUsd: 0, netLbp: 6000000 }), [{ currency: 'LBP', amount: 6000000 }])
  assert.deepEqual(netParts({ netUsd: 500, netLbp: 6000000 }).map((p) => p.currency), ['USD', 'LBP'])
  assert.deepEqual(netParts({ netUsd: 0, netLbp: 0 }), [])
})
