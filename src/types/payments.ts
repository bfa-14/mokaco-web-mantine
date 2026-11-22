/**
 * ONLINE PAYMENTS (script 119): the booking deposits paid by card (Bank of Beirut) or by Whish, their log, the
 * gateways' keys and the test payments an admin opens from HRMS. Shapes as the API sends them.
 *
 * EVERY INSTANT IS UTC WITH ITS Z; the screens show them in the reader's own clock. A KEY NEVER COMES BACK FROM THE
 * API: `shown` carries addresses and ids in full and a secret as "••••" plus its last four characters at most.
 */

export type GatewayName = 'card' | 'whish'
export type GatewayMode = 'test' | 'live'

/** One state per payment, in the order a person asks about them. */
export type PayState =
  | 'Paid'
  | 'RefundDue'
  | 'Refunded'
  | 'NeedsStaff'
  | 'Open'
  | 'Unconfirmed'
  | 'NotPaid'

export const PAY_STATES: PayState[] = [
  'Paid',
  'Open',
  'Unconfirmed',
  'NeedsStaff',
  'RefundDue',
  'Refunded',
  'NotPaid',
]

export interface PaymentRow {
  bookingId: number
  ref: string
  guestName: string
  guestPhone: string | null
  roomName: string
  date: string
  startMin: number
  endMin: number
  bookingStatus: string
  gateway: GatewayName
  mode: GatewayMode | null
  state: PayState
  deposit: number
  total: number
  currency: string
  paidAmount: number | null
  paidAt: string | null
  openedAt: string | null
  checkedAt: string | null
  activityAt: string | null
  holdExpiresAt: string | null
  attempts: number
  payerPhone: string | null
  gatewayOrderId: string | null
  transactionId: string | null
  refundDue: number
  refundStatus: string | null
  refundedAmount: number
  refundedAt: string | null
  gatewayRefunded: boolean
  lastEvent: { type: string; outcome: string | null; detail: string | null; at: string | null } | null
}

export interface PaymentMoney {
  currency: string
  received: number
  card: number
  whish: number
  refunded: number
  refundDue: number
  payments: number
}

export interface PaymentTotals {
  count: number
  waiting: number
  needAttention: number
  notPaid: number
  testPayments: number
  money: PaymentMoney[]
}

export interface PaymentList {
  timeZone: string
  from: string
  to: string
  totals: PaymentTotals
  payments: PaymentRow[]
}

export interface PaymentEvent {
  id: number
  gateway: GatewayName
  mode: GatewayMode | null
  gatewayOrderId: string | null
  type: string
  source: string
  outcome: string | null
  gatewayStatus: string | null
  detail: string | null
  amount: number | null
  currency: string | null
  repeats: number
  at: string
  lastAt: string
  by: string | null
}

export interface PaymentLine {
  paymentId: number
  amount: number
  isRefund: boolean
  method: string
  reference: string | null
  paidAt: string
  receivedBy: string | null
  gatewayOrderId: string | null
  transactionId: string | null
}

export interface PaymentDetail {
  timeZone: string
  payment: PaymentRow
  /** Why "Refund on Whish" is not offered, in a sentence; null when it is. */
  refundRefusal: string | null
  events: PaymentEvent[]
  lines: PaymentLine[]
}

export interface GatewayFact {
  label: string
  value: string
}

/** What "Ask the gateway now" and "Refund" answer with. */
export interface PaymentActionResult {
  ok: boolean
  message: string
  changed: boolean
  facts: GatewayFact[] | null
  payment: PaymentDetail | null
}

/* ── the gateways' keys ─────────────────────────────────────────────────────────────────────── */

export interface GatewayModeView {
  mode: GatewayMode
  /** settings = saved in HRMS, server = the server file, none = no keys. */
  source: 'settings' | 'server' | 'none'
  hasKeys: boolean
  unreadable: boolean
  ready: boolean
  problem: string | null
  shown: Record<string, string | null>
  savedAt: string | null
  savedBy: string | null
}

export interface GatewayView {
  gateway: GatewayName
  activeMode: GatewayMode
  /** What was chosen in HRMS; null = the gateway follows the server file. */
  chosenMode: GatewayMode | null
  serverMode: GatewayMode | null
  ready: boolean
  problem: string | null
  modeChangedAt: string | null
  modeChangedBy: string | null
  modes: GatewayModeView[]
}

export interface GatewayHistoryRow {
  id: number
  gateway: GatewayName
  mode: GatewayMode | null
  type: string
  outcome: string | null
  detail: string | null
  at: string
  by: string | null
}

export interface GatewayOverview {
  timeZone: string
  card: GatewayView
  whish: GatewayView
  whishOnWebsite: boolean
  depositsRequired: boolean
  /** This is the live system: a gateway in test mode cannot be offered to guests here. */
  production: boolean
  siteUrl: string | null
  apiPublicUrl: string | null
  maxTestAmount: { usd: number; lbp: number }
  history: GatewayHistoryRow[]
}

export interface GatewayKeysPayload {
  channel?: string
  secret?: string
  websiteUrl?: string
  baseUrl?: string
  merchantId?: string
  apiPassword?: string
  apiVersion?: string
}

export interface GatewayCheckResult {
  ok: boolean
  message: string
  ms: number | null
}

/* ── test payments ──────────────────────────────────────────────────────────────────────────── */

export type GatewayTestStatus = 'Opened' | 'Paid' | 'NotPaid' | 'Unknown' | 'Refunded' | 'Error'

export interface GatewayTest {
  id: number
  ref: string
  gateway: GatewayName
  mode: GatewayMode
  amount: number
  currency: string
  status: GatewayTestStatus
  gatewayStatus: string | null
  detail: string | null
  /** Where the tester pays; only while the test is still open. */
  payUrl: string | null
  payerPhone: string | null
  transactionId: string | null
  callbackAt: string | null
  returnedAt: string | null
  checkedAt: string | null
  refundedAt: string | null
  createdAt: string
  createdBy: string | null
}

export interface GatewayTestResult {
  ok: boolean
  message: string
  test: GatewayTest
  facts?: GatewayFact[] | null
}

export interface GatewayLookupResult {
  ok: boolean
  message: string
  ms: number | null
  facts: GatewayFact[]
}
