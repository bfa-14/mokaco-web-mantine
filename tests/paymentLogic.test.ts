import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerKey,
  eventKey,
  eventTone,
  gatewayParam,
  isTestPayment,
  needsAttention,
  stateTone,
  testIsOpen,
  testTone,
} from '../src/pages/bookings/paymentLogic.ts'
import { PAY_STATES } from '../src/types/payments.ts'
import en from '../src/i18n/en.json' with { type: 'json' }
import ar from '../src/i18n/ar.json' with { type: 'json' }

type Tree = { [key: string]: string | Tree }

function lookup(tree: Tree, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Tree | undefined)?.[part], tree)
}

test('only the three states that wait on staff need attention', () => {
  const waiting = PAY_STATES.filter((state) => needsAttention({ state }))
  assert.deepEqual(waiting.sort(), ['NeedsStaff', 'RefundDue', 'Unconfirmed'])
})

test('green is money received and nothing else', () => {
  assert.deepEqual(PAY_STATES.filter((state) => stateTone(state) === 'good'), ['Paid'])
  assert.equal(stateTone('RefundDue'), 'bad')
  assert.equal(stateTone('Open'), 'plain')
  assert.equal(stateTone('NotPaid'), 'plain')
})

test('a payment made in test mode is a test payment; an older one with no mode is not', () => {
  assert.equal(isTestPayment({ mode: 'test' }), true)
  assert.equal(isTestPayment({ mode: 'live' }), false)
  assert.equal(isTestPayment({ mode: null }), false)
})

test('every state has its words and its explanation in both languages', () => {
  for (const state of PAY_STATES) {
    for (const tree of [en, ar] as Tree[]) {
      assert.equal(typeof lookup(tree, `payments.state.${state}`), 'string', state)
      assert.equal(typeof lookup(tree, `payments.stateHelp.${state}`), 'string', state)
    }
  }
})

test('every line the log can hold has a sentence in both languages', () => {
  const events = [
    { type: 'Opened', source: 'Website', outcome: 'Opened' },
    { type: 'OpenFailed', source: 'Website', outcome: 'GatewayError' },
    { type: 'Paid', source: 'Return', outcome: 'Confirmed' },
    { type: 'Paid', source: 'Job', outcome: 'Recorded' },
    { type: 'Paid', source: 'Job', outcome: 'PaidButClosed' },
    { type: 'Paid', source: 'Job', outcome: 'SlotClash' },
    { type: 'Paid', source: 'Job', outcome: 'Replay' },
    { type: 'Paid', source: 'Job', outcome: 'SomethingNew' },
    { type: 'Released', source: 'Job', outcome: 'Released' },
    { type: 'Alerted', source: 'Job', outcome: 'StaffEmailed' },
    { type: 'Refunded', source: 'Staff', outcome: 'Refunded' },
    { type: 'RefundFailed', source: 'Staff', outcome: 'Failed' },
    ...['Return', 'Callback', 'Job', 'Staff', 'Guest', 'Website', 'Elsewhere'].flatMap((source) =>
      ['Unconfirmed', 'Failed', 'NotPaid', 'NoChange', 'Paid', 'CallbackReceived', 'Opened', 'Refunded', 'Unknown', 'New'].map(
        (outcome) => ({ type: 'Checked', source, outcome }),
      ),
    ),
    { type: 'NeverHeardOf', source: 'Job', outcome: null },
  ]

  for (const event of events) {
    const keys = [eventKey(event), answerKey(event)].filter((key): key is string => key != null)
    for (const key of keys) {
      for (const tree of [en, ar] as Tree[]) {
        assert.equal(typeof lookup(tree, key), 'string', `${key} for ${JSON.stringify(event)}`)
      }
    }
  }
})

test('an outcome nobody has heard of still reads as a sentence, never as a missing key', () => {
  assert.equal(eventKey({ type: 'Paid', source: 'Job', outcome: 'Odd' }), 'payments.event.paidRecorded')
  assert.equal(eventKey({ type: 'Checked', source: 'Odd', outcome: null }), 'payments.event.checkedJob')
  assert.equal(answerKey({ type: 'Checked', outcome: 'Odd' }), 'payments.answer.Unknown')
  assert.equal(answerKey({ type: 'Paid', outcome: 'Confirmed' }), null)
})

test('a payment that needs staff is amber in the log, a failure red', () => {
  assert.equal(eventTone({ type: 'Paid', outcome: 'Confirmed' }), 'good')
  assert.equal(eventTone({ type: 'Paid', outcome: 'SlotClash' }), 'warn')
  assert.equal(eventTone({ type: 'Paid', outcome: 'PaidButClosed' }), 'warn')
  assert.equal(eventTone({ type: 'RefundFailed', outcome: 'Failed' }), 'bad')
  assert.equal(eventTone({ type: 'Checked', outcome: 'Unconfirmed' }), 'warn')
  assert.equal(eventTone({ type: 'Checked', outcome: 'NotPaid' }), 'plain')
})

test('a gateway test: only an opened one is followed; every status has words in both languages', () => {
  const statuses = ['Opened', 'Paid', 'NotPaid', 'Unknown', 'Refunded', 'Error'] as const
  assert.deepEqual(statuses.filter(testIsOpen), ['Opened'])
  assert.equal(testTone('Paid'), 'good')
  assert.equal(testTone('Error'), 'bad')
  assert.equal(testTone('Unknown'), 'warn')
  for (const status of statuses) {
    for (const tree of [en, ar] as Tree[]) {
      assert.equal(typeof lookup(tree, `gatewayTest.status.${status}`), 'string', status)
    }
  }
})

test('the filter sends a gateway only when one is chosen', () => {
  assert.equal(gatewayParam('all'), '')
  assert.equal(gatewayParam('card'), 'card')
  assert.equal(gatewayParam('whish'), 'whish')
  assert.equal(gatewayParam('anything'), '')
})

test('the three screens say the same things in Arabic as in English, key for key', () => {
  const keys = (tree: Tree, prefix = ''): string[] =>
    Object.entries(tree).flatMap(([key, value]) =>
      typeof value === 'string' ? [prefix + key] : keys(value, `${prefix}${key}.`),
    )
  for (const section of ['payments', 'gateways', 'gatewayTest']) {
    assert.deepEqual(keys((ar as Tree)[section] as Tree).sort(), keys((en as Tree)[section] as Tree).sort(), section)
  }
})
