/**
 * THE REQUEST PAGE OFFERS A REVERSAL EXACTLY WHERE THE SERVER WOULD HONOUR IT (QA3 WF-3, WF-5, WF-13,
 * WF-14). "Retract my decision" on a closed request goes to the retract endpoint and is the last
 * signer's, the same BEIRUT day; on an open one it is the step's withdrawal; the GM + Owner reopen
 * needs a standing decision and two different people; HR reopens cancelled requests only; Cancel is
 * for HR and Admin besides the requester and the employee. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  beirutDay,
  canHrReopen,
  gmReopenAction,
  holdsCancelRole,
  isDecidedAMomentAgo,
  isSameBeirutDay,
  lastStandingDecision,
  moveNeedsConfirmation,
  parseUtc,
  reopenRoleOf,
  retractKind,
  serverSentence,
} from '../src/pages/workflow/reversalRules.ts'
import type { RequestReversal, SignatureLogEntry } from '../src/types/workflow.ts'

function sig(over: Partial<SignatureLogEntry>): SignatureLogEntry {
  return {
    signatureId: 1,
    stepNo: 1,
    action: 'Approved',
    actedByUserId: 7,
    actedByUsername: 'hr1',
    actedAt: '2026-10-19T08:00:00',
    comment: null,
    hasSignatureImage: false,
    retractedAt: null,
    retractedReason: null,
    ...over,
  }
}

function reversal(over: Partial<RequestReversal>): RequestReversal {
  return {
    reversalId: 1,
    kind: 'Reopen',
    reason: 'wrong person',
    firstSignUserId: 50,
    firstSignUsername: 'owner',
    firstSignRole: 'Owner',
    secondSignUserId: null,
    secondSignUsername: null,
    secondSignRole: null,
    completedAt: null,
    createdAt: '2026-10-19T08:00:00',
    ...over,
  }
}

test('timestamps without a zone are UTC; ones with a zone are taken as they are', () => {
  assert.equal(parseUtc('2026-10-19T21:30:00')?.toISOString(), '2026-10-19T21:30:00.000Z')
  assert.equal(parseUtc('2026-10-19T21:30:00Z')?.toISOString(), '2026-10-19T21:30:00.000Z')
  assert.equal(parseUtc('2026-10-19T23:30:00+02:00')?.toISOString(), '2026-10-19T21:30:00.000Z')
  assert.equal(parseUtc(null), null)
  assert.equal(parseUtc('not a date'), null)
})

test('the day is Beirut’s: half past midnight in Beirut is already tomorrow (summer and winter time)', () => {
  // October 2026 is still summer time (UTC+3): 21:30Z is 00:30 on the 20th in Beirut
  assert.equal(beirutDay(new Date('2026-10-19T21:30:00Z')), '2026-10-20')
  assert.equal(beirutDay(new Date('2026-10-19T20:59:00Z')), '2026-10-19')
  // December is winter time (UTC+2): 22:30Z is 00:30 on the 16th
  assert.equal(beirutDay(new Date('2026-12-15T22:30:00Z')), '2026-12-16')
  assert.equal(beirutDay(new Date('2026-12-15T21:30:00Z')), '2026-12-15')
})

test('same day means the same Beirut date, not the same UTC date', () => {
  const now = new Date('2026-10-20T08:00:00Z') // 11:00 on the 20th in Beirut
  // signed at 00:30 Beirut on the 20th — still the 19th in UTC: same day
  assert.equal(isSameBeirutDay('2026-10-19T21:30:00', now), true)
  // signed at 23:30 Beirut on the 19th: an earlier day, although the UTC date would have matched at 20:30Z
  assert.equal(isSameBeirutDay('2026-10-19T20:30:00', new Date('2026-10-19T21:30:00Z')), false)
  assert.equal(isSameBeirutDay(null, now), false)
})

test('the decision a retract takes back is the newest one still standing', () => {
  const history = [
    sig({ signatureId: 1, stepNo: null, action: 'Submitted', actedAt: '2026-10-19T07:00:00' }),
    sig({ signatureId: 2, stepNo: 1, actedAt: '2026-10-19T08:00:00' }),
    sig({ signatureId: 3, stepNo: 2, actedAt: '2026-10-19T09:00:00', retractedAt: '2026-10-19T09:30:00' }),
    sig({ signatureId: 4, stepNo: 2, actedAt: '2026-10-19T08:00:00' }),
  ]
  // 3 is struck; 2 and 4 share a second, and the higher id wins as in the procedure
  assert.equal(lastStandingDecision(history)?.signatureId, 4)
  assert.equal(lastStandingDecision([sig({ stepNo: null, action: 'Submitted' })]), null)
})

test('a closed request: the last signer retracts it the same Beirut day, through the retract endpoint', () => {
  const now = new Date('2026-10-19T12:00:00Z')
  const mine = sig({ actedByUserId: 7, actedAt: '2026-10-19T08:00:00' })
  for (const status of ['Approved', 'Rejected']) {
    assert.equal(retractKind({ status, lastDecision: mine, userId: 7, steps: [], now }), 'retract')
    // somebody else's decision is not mine to take back
    assert.equal(retractKind({ status, lastDecision: mine, userId: 8, steps: [], now }), null)
    // yesterday's needs the General Manager and the Owner
    assert.equal(
      retractKind({ status, lastDecision: mine, userId: 7, steps: [], now: new Date('2026-10-20T12:00:00Z') }),
      null,
    )
  }
})

test('a cancelled request has no decision to retract (HR reopens it)', () => {
  const mine = sig({ actedByUserId: 7 })
  assert.equal(
    retractKind({ status: 'Cancelled', lastDecision: mine, userId: 7, steps: [], now: new Date('2026-10-19T12:00:00Z') }),
    null,
  )
})

test('an open request: my decision is withdrawn where the server still lets me', () => {
  const mine = sig({ stepNo: 1, actedByUserId: 7 })
  const steps = [{ stepNo: 1, canWithdraw: true }]
  assert.equal(retractKind({ status: 'Pending', lastDecision: mine, userId: 7, steps }), 'withdraw')
  assert.equal(retractKind({ status: 'OnHold', lastDecision: mine, userId: 7, steps }), 'withdraw')
  // somebody acted after me: the server says no, so nothing is offered
  assert.equal(
    retractKind({ status: 'Pending', lastDecision: mine, userId: 7, steps: [{ stepNo: 1, canWithdraw: false }] }),
    null,
  )
})

test('the reopen role is the procedure’s: the Owner first, then either spelling of the General Manager', () => {
  assert.equal(reopenRoleOf(['Owner', 'General Manager']), 'Owner')
  assert.equal(reopenRoleOf(['General Manager']), 'GeneralManager')
  assert.equal(reopenRoleOf(['GeneralManager']), 'GeneralManager')
  assert.equal(reopenRoleOf(['HR']), null)
})

test('GM + Owner reopen: offered on a standing decision, countersigned by the other person in the other role', () => {
  const history = [sig({ signatureId: 2, stepNo: 1 })]
  const base = { status: 'Approved', history, reversals: [] as RequestReversal[] }

  assert.equal(gmReopenAction({ ...base, roles: ['Owner'], userId: 50 }), 'sign')
  assert.equal(gmReopenAction({ ...base, roles: ['HR'], userId: 9 }), null)
  // approved automatically — no standing decision: the server refuses the first half, so not offered
  assert.equal(gmReopenAction({ ...base, history: [], roles: ['Owner'], userId: 50 }), null)
  // a cancelled request is HR's to reopen
  assert.equal(gmReopenAction({ ...base, status: 'Cancelled', roles: ['Owner'], userId: 50 }), null)

  const pending = [reversal({ firstSignUserId: 50, firstSignRole: 'Owner' })]
  assert.equal(gmReopenAction({ ...base, reversals: pending, roles: ['General Manager'], userId: 60 }), 'countersign')
  // the first signer cannot complete their own reopen, nor can a second person in the same role
  assert.equal(gmReopenAction({ ...base, reversals: pending, roles: ['Owner'], userId: 50 }), 'waiting')
  assert.equal(gmReopenAction({ ...base, reversals: pending, roles: ['Owner'], userId: 51 }), 'waiting')
  assert.equal(
    gmReopenAction({
      ...base,
      reversals: [reversal({ firstSignUserId: 60, firstSignRole: 'GeneralManager' })],
      roles: ['General Manager'],
      userId: 61,
    }),
    'waiting',
  )
})

test('HR’s single-signature reopen is for cancelled requests only', () => {
  assert.equal(canHrReopen('Cancelled', true), true)
  assert.equal(canHrReopen('Rejected', true), false)
  assert.equal(canHrReopen('Approved', true), false)
  assert.equal(canHrReopen('Cancelled', false), false)
})

test('Cancel is offered to HR and Admin (the Owner is not one of the API’s roles)', () => {
  assert.equal(holdsCancelRole(['hr']), true)
  assert.equal(holdsCancelRole(['Admin']), true)
  assert.equal(holdsCancelRole(['Owner']), false)
  assert.equal(holdsCancelRole([]), false)
})

test('the two 409s are told apart by their sentences', () => {
  assert.equal(isDecidedAMomentAgo(409, 'This step was decided a moment ago — reload.'), true)
  assert.equal(isDecidedAMomentAgo(400, 'This step was decided a moment ago — reload.'), false)
  assert.equal(
    moveNeedsConfirmation(409, 'Moving this request to version 3 leaves no step to sign - it would be approved at once. Confirm the move to approve it.'),
    true,
  )
  assert.equal(moveNeedsConfirmation(409, 'This step was decided a moment ago — reload.'), false)
})

test('the server’s own sentence is read out of the error body when it sent one', () => {
  assert.equal(serverSentence({ error: 'Reopening a closed request needs the General Manager and the Owner.' }),
    'Reopening a closed request needs the General Manager and the Owner.')
  assert.equal(serverSentence({ error: '' }), null)
  assert.equal(serverSentence('Forbidden'), null)
  assert.equal(serverSentence(null), null)
})
