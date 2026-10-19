/**
 * THE DECISION DIALOG SENDS WHAT THE DECISION MEANS (QA3 WEB-6, WEB-7). "Ask the employee" holds the
 * request waiting on the requester; "Hand to someone else" is offered only when there is somebody to
 * hand to, and names them. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  candidateLabel,
  holdWaitsOnRequester,
  offerableDecisions,
  offersDelegate,
} from '../src/pages/workflow/decisionRules.ts'

test('a hold waits on the requester exactly when the decision says so', () => {
  assert.equal(holdWaitsOnRequester({ waitingOnRequester: true }), true)
  assert.equal(holdWaitsOnRequester({ waitingOnRequester: false }), false)
})

test('the hand-over is offered only when somebody can receive it', () => {
  const decisions = [
    { code: 'APPROVE', engineAction: 'Approve' },
    { code: 'HAND_OVER', engineAction: 'Delegate' },
    { code: 'ASK', engineAction: 'Hold' },
  ]
  assert.deepEqual(offerableDecisions(decisions, 0).map((d) => d.code), ['APPROVE', 'ASK'])
  assert.deepEqual(offerableDecisions(decisions, 2).map((d) => d.code), ['APPROVE', 'HAND_OVER', 'ASK'])
  assert.equal(offersDelegate(decisions), true)
  assert.equal(offersDelegate([{ engineAction: 'Approve' }]), false)
})

test('a person reads as their name with the account beside it, or the account alone', () => {
  assert.equal(candidateLabel({ userId: 3, username: 'rana.hr', fullName: 'Rana Haddad' }), 'Rana Haddad (rana.hr)')
  assert.equal(candidateLabel({ userId: 4, username: 'owner', fullName: null }), 'owner')
  assert.equal(candidateLabel({ userId: 5, username: 'gm', fullName: '  ' }), 'gm')
})
