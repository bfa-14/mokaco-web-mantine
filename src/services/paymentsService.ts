import { apiRequest } from '../api/client'
import type {
  GatewayCheckResult,
  GatewayKeysPayload,
  GatewayLookupResult,
  GatewayMode,
  GatewayName,
  GatewayOverview,
  GatewayTest,
  GatewayTestResult,
  PaymentActionResult,
  PaymentDetail,
  PaymentList,
} from '../types/payments'

/**
 * The Payments page (Bookings > Payments). Reading needs BOOKING_PAYMENTS; asking the gateway again and refunding
 * need BOOKING_PAYMENTS_MANAGE. Both are enforced by the server; routeAccess.ts holds the courtesy copy.
 */
export const paymentsService = {
  list: (filter: { from: string; to: string; gateway?: string; state?: string; q?: string }) => {
    const query = new URLSearchParams({ from: filter.from, to: filter.to })
    if (filter.gateway) query.set('gateway', filter.gateway)
    if (filter.state) query.set('state', filter.state)
    if (filter.q) query.set('q', filter.q)
    return apiRequest<PaymentList>(`/api/booking-payments?${query.toString()}`)
  },

  get: (bookingId: number) => apiRequest<PaymentDetail>(`/api/booking-payments/${bookingId}`),

  /** Reads what the gateway holds and, when the payment is not on the books yet, settles it. Safe to press twice. */
  check: (bookingId: number) =>
    apiRequest<PaymentActionResult>(`/api/booking-payments/${bookingId}/check`, { method: 'POST' }),

  /** Gives the whole Whish payment back to the payer and records the refund on the booking. */
  refund: (bookingId: number, reason: string) =>
    apiRequest<PaymentActionResult>(`/api/booking-payments/${bookingId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
}

/**
 * The gateways' keys, mode and tests - GATEWAY_ADMIN only. A key is sent once, when it is typed, and never comes
 * back: the answers carry the end of a secret at most.
 */
export const gatewaysService = {
  get: () => apiRequest<GatewayOverview>('/api/payment-gateways'),

  saveKeys: (gateway: GatewayName, mode: GatewayMode, keys: GatewayKeysPayload) =>
    apiRequest<{ ok: boolean; message: string }>(`/api/payment-gateways/${gateway}/${mode}/keys`, {
      method: 'PUT',
      body: JSON.stringify(keys),
    }),

  deleteKeys: (gateway: GatewayName, mode: GatewayMode) =>
    apiRequest<{ ok: boolean; message: string }>(`/api/payment-gateways/${gateway}/${mode}/keys`, {
      method: 'DELETE',
    }),

  /** mode null = follow the server file again. */
  setMode: (gateway: GatewayName, mode: GatewayMode | null) =>
    apiRequest<{ ok: boolean; message: string }>(`/api/payment-gateways/${gateway}/mode`, {
      method: 'PUT',
      body: JSON.stringify({ mode }),
    }),

  /** Asks the gateway with the keys of that mode. Moves no money. A refusal is an answer (ok: false), not an error. */
  check: (gateway: GatewayName, mode: GatewayMode) =>
    apiRequest<GatewayCheckResult>(`/api/payment-gateways/${gateway}/${mode}/check`, { method: 'POST' }),

  listTests: () => apiRequest<GatewayTest[]>('/api/payment-gateways/tests'),

  openTest: (payload: { gateway: GatewayName; mode: GatewayMode; amount: number; currency: string }) =>
    apiRequest<GatewayTestResult>('/api/payment-gateways/tests', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  checkTest: (ref: string) =>
    apiRequest<GatewayTestResult>(`/api/payment-gateways/tests/${encodeURIComponent(ref)}/check`, {
      method: 'POST',
    }),

  refundTest: (ref: string) =>
    apiRequest<GatewayTestResult>(`/api/payment-gateways/tests/${encodeURIComponent(ref)}/refund`, {
      method: 'POST',
    }),

  lookup: (payload: { gateway: GatewayName; mode: GatewayMode; reference: string; currency: string }) =>
    apiRequest<GatewayLookupResult>('/api/payment-gateways/lookup', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
}
