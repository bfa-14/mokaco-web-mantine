import { apiRequest } from '../api/client'
import type {
  BlockCreatePayload,
  BlockCreated,
  BookingCreatePayload,
  BookingCreated,
  BookingDetail,
  BookingRefundPayload,
  BookingPaymentPayload,
  BookingRange,
  BookingReceipt,
  BookingReport,
  BookingStatusChanged,
  BookingStatusPayload,
  PaymentAdded,
  PaymentMethod,
  RefundRecorded,
  RoomAddonUpsertPayload,
  RoomCatalog,
  RoomHoursPayload,
  RoomUpsertPayload,
  Room,
} from '../types/booking'

/**
 * The management booking API. Everything here is BOOKING_VIEW to read and BOOKING_MANAGE to write,
 * enforced server-side; routeAccess.ts holds the courtesy copy that decides what the nav shows.
 *
 * SERVER 400s CARRY THE SENTENCE THAT MATTERS and every caller renders it. The rules live in stored
 * procedures and their RAISERROR text is written to be read — "Amount exceeds the balance — 45.00
 * remains", "This booking is already closed (Cancelled)", "Real bookings exist in that period" —
 * so pages pass them through getErrorMessage() rather than replacing them with a house apology.
 */
export const bookingsService = {
  /**
   * Bookings AND staff blocks over a range. Both lists always come back; a calendar drawn from the
   * bookings alone paints free time over a room that is shut.
   */
  getRange: (
    from: string,
    to: string,
    roomId?: number | null,
    status?: string | null,
  ) =>
    apiRequest<BookingRange>(
      `/api/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` +
        (roomId ? `&roomId=${roomId}` : '') +
        (status ? `&status=${encodeURIComponent(status)}` : ''),
    ),

  /** A booking typed in by staff: Confirmed on arrival, exempt from the website's lead-time rules. */
  createManual: (payload: BookingCreatePayload) =>
    apiRequest<BookingCreated>('/api/bookings/manual', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** One booking with its refund position and individual payment lines (refunds flagged). */
  getOne: (bookingId: number) => apiRequest<BookingDetail>(`/api/bookings/${bookingId}`),

  /**
   * Confirm / Complete / Cancel / NoShow. A cancellation has to say WHO cancelled — that is what
   * decides the refund — and the server refuses one without it.
   */
  setStatus: (bookingId: number, payload: BookingStatusPayload) =>
    apiRequest<BookingStatusChanged>(`/api/bookings/${bookingId}/status`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  /**
   * Money handed BACK on a cancelled booking. The server caps it at what is still due and answers
   * with the position after it — the lines, the total owed and Due / Partial / Refunded.
   */
  recordRefund: (bookingId: number, payload: BookingRefundPayload) =>
    apiRequest<RefundRecorded>(`/api/bookings/${bookingId}/refunds`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Records money. Returns the position AFTER it — never subtract on the client. */
  addPayment: (bookingId: number, payload: BookingPaymentPayload) =>
    apiRequest<PaymentAdded>(`/api/bookings/${bookingId}/payments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Everything a printed receipt needs, in one call. */
  getReceipt: (bookingId: number) =>
    apiRequest<BookingReceipt>(`/api/bookings/${bookingId}/receipt`),

  createBlock: (payload: BlockCreatePayload) =>
    apiRequest<BlockCreated>('/api/bookings/blocks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteBlock: (blockId: number) =>
    apiRequest<void>(`/api/bookings/blocks/${blockId}`, { method: 'DELETE' }),

  /** groupBy is 'day' | 'week' | 'month'; the server refuses anything else by name. */
  getReport: (from: string, to: string, groupBy: string) =>
    apiRequest<BookingReport>(
      `/api/bookings/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` +
        `&groupBy=${encodeURIComponent(groupBy)}`,
    ),
}

/**
 * The room catalogue and the ways money can be taken.
 *
 * GET rooms is BOOKING_VIEW, not BOOKING_MANAGE — the calendar draws a column per room and cannot
 * render without it. Everything that WRITES here is BOOKING_MANAGE.
 */
export const roomsService = {
  /**
   * Rooms, hours and add-ons in one call. Retired rooms are included by DEFAULT, because this is
   * also the screen on which a retired room is edited back into service.
   */
  getCatalog: (includeInactive = true) =>
    apiRequest<RoomCatalog>(
      `/api/bookings/rooms?includeInactive=${includeInactive ? 'true' : 'false'}`,
    ),

  create: (payload: RoomUpsertPayload) =>
    apiRequest<Room>('/api/bookings/rooms', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  update: (roomId: number, payload: RoomUpsertPayload) =>
    apiRequest<Room>(`/api/bookings/rooms/${roomId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  /**
   * Sets the room's week in ONE request. The server applies it a day at a time and is not
   * transactional, so a refused day stops the run with the earlier days already stored — which is
   * why the message it returns names the problem rather than just failing.
   */
  setHours: (roomId: number, hours: RoomHoursPayload[]) =>
    apiRequest<void>(`/api/bookings/rooms/${roomId}/hours`, {
      method: 'PUT',
      body: JSON.stringify(hours),
    }),

  createAddon: (roomId: number, payload: RoomAddonUpsertPayload) =>
    apiRequest<void>(`/api/bookings/rooms/${roomId}/addons`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAddon: (roomId: number, addonId: number, payload: RoomAddonUpsertPayload) =>
    apiRequest<void>(`/api/bookings/rooms/${roomId}/addons/${addonId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  /** Active methods only — this list exists to be chosen from. */
  getPaymentMethods: () =>
    apiRequest<PaymentMethod[]>('/api/bookings/payment-methods'),
}
