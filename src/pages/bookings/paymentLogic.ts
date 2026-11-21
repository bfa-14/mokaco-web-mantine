import type { GatewayTestStatus, PaymentEvent, PaymentRow, PayState } from '../../types/payments'

/**
 * THE WORDS AND COLOURS OF AN ONLINE PAYMENT, decided in one place and with no translation in it: every function here
 * answers with a KEY (the page translates) or a tone, so the rules can be tested without a screen.
 */

export const PAY_PERMISSIONS = {
  view: 'BOOKING_PAYMENTS',
  manage: 'BOOKING_PAYMENTS_MANAGE',
  admin: 'GATEWAY_ADMIN',
} as const

export type Tone = 'good' | 'bad' | 'warn' | 'plain'

/** Green = the money is in. Amber = somebody should look. Red = money owed back. Grey = nothing happened. */
export function stateTone(state: PayState): Tone {
  switch (state) {
    case 'Paid':
      return 'good'
    case 'Unconfirmed':
    case 'NeedsStaff':
      return 'warn'
    case 'RefundDue':
      return 'bad'
    default:
      return 'plain'
  }
}

/** The states that wait on a member of staff. */
export const ATTENTION_STATES: PayState[] = ['Unconfirmed', 'NeedsStaff', 'RefundDue']

export function needsAttention(row: Pick<PaymentRow, 'state'>): boolean {
  return ATTENTION_STATES.includes(row.state)
}

/** What was really received: a test payment moved no money, whatever it says. */
export function isTestPayment(row: Pick<PaymentRow, 'mode'>): boolean {
  return row.mode === 'test'
}

const PAID_OUTCOMES = ['Confirmed', 'Recorded', 'PaidButClosed', 'SlotClash', 'Replay']
const CHECK_SOURCES = ['Return', 'Callback', 'Job', 'Staff', 'Guest', 'Website']
const ANSWERS = ['Unconfirmed', 'Failed', 'NotPaid', 'NoChange', 'Paid', 'CallbackReceived', 'Opened', 'Refunded', 'Unknown']

/** The translation key of a log line's sentence. */
export function eventKey(event: Pick<PaymentEvent, 'type' | 'source' | 'outcome'>): string {
  switch (event.type) {
    case 'Opened':
      return 'payments.event.opened'
    case 'OpenFailed':
      return 'payments.event.openFailed'
    case 'Paid':
      return `payments.event.paid${PAID_OUTCOMES.includes(event.outcome ?? '') ? event.outcome : 'Recorded'}`
    case 'Released':
      return 'payments.event.released'
    case 'Alerted':
      return 'payments.event.alerted'
    case 'Refunded':
      return 'payments.event.refunded'
    case 'RefundFailed':
      return 'payments.event.refundFailed'
    case 'Checked':
      return `payments.event.checked${CHECK_SOURCES.includes(event.source) ? event.source : 'Job'}`
    default:
      return 'payments.event.other'
  }
}

/** For a "the gateway was asked" line: the key of what came of it; null for any other line. */
export function answerKey(event: Pick<PaymentEvent, 'type' | 'outcome'>): string | null {
  if (event.type !== 'Checked') return null
  return `payments.answer.${ANSWERS.includes(event.outcome ?? '') ? event.outcome : 'Unknown'}`
}

export function eventTone(event: Pick<PaymentEvent, 'type' | 'outcome'>): Tone {
  switch (event.type) {
    case 'Paid':
      return event.outcome === 'PaidButClosed' || event.outcome === 'SlotClash' ? 'warn' : 'good'
    case 'Refunded':
      return 'good'
    case 'OpenFailed':
    case 'RefundFailed':
      return 'bad'
    case 'Alerted':
      return 'warn'
    case 'Checked':
      return event.outcome === 'Unconfirmed' || event.outcome === 'Unknown' ? 'warn' : 'plain'
    default:
      return 'plain'
  }
}

export function testTone(status: GatewayTestStatus): Tone {
  switch (status) {
    case 'Paid':
    case 'Refunded':
      return 'good'
    case 'Error':
      return 'bad'
    case 'Unknown':
      return 'warn'
    default:
      return 'plain'
  }
}

/** A test can still be paid, so the page keeps asking about it. */
export function testIsOpen(status: GatewayTestStatus): boolean {
  return status === 'Opened'
}

/** How many times the page asks about an open test on its own (every few seconds), before leaving it to the button. */
export const TEST_POLLS = 80
export const TEST_POLL_MS = 5000

/** 'card' | 'whish' | '' from a filter value. */
export function gatewayParam(value: string): string {
  return value === 'card' || value === 'whish' ? value : ''
}
