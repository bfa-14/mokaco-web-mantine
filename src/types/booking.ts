/**
 * Room booking — the shapes /api/bookings and /api/public/booking actually return.
 *
 * TWO WIRE CONVENTIONS TO KNOW, because both are easy to get wrong once and then everywhere:
 *
 *  · TIMES ARE 'HH:mm:ss' STRINGS. The API carries them as TimeSpan, which System.Text.Json writes
 *    as "11:00:00". They are NEVER parsed into a Date here — a time with no date attached has no
 *    meaningful Date, and constructing one is how a booking at 00:30 lands on the previous day.
 *    Compare and sort them as strings; 'HH:mm:ss' is lexicographically ordered already.
 *
 *  · DATES ARE ISO TIMESTAMPS at midnight — '2026-09-05T00:00:00' — because the column is a DATE
 *    and .NET has nowhere else to put it. Slice the first 10 characters to get 'yyyy-MM-dd'; going
 *    through `new Date()` re-introduces the timezone bug the rest of this app already avoids.
 */

/** Pending | Confirmed | Completed | Cancelled | NoShow — the five the API will ever send. */
export type BookingStatus =
  | 'Pending'
  | 'Confirmed'
  | 'Completed'
  | 'Cancelled'
  | 'NoShow'

/** Website | Manual — where the booking came from. */
export type BookingSource = 'Website' | 'Manual'

/**
 * Who cancelled a booking — and therefore what is owed back. Staff cancelling on the guest owes
 * everything they paid; a guest who asked keeps the deposit with the house and gets the rest.
 * The server works the amount out; this only says which rule it applied.
 */
export type CancelledBy = 'Staff' | 'Guest'

/**
 * Where the money owed back on a cancelled booking has got to. Absent (or 'None') on a booking
 * that owes nothing — an older API build sends none of the refund fields at all, so every reader
 * treats a missing value as 'None'.
 */
export type RefundStatus = 'None' | 'Due' | 'Partial' | 'Refunded'

/** PerHour | Fixed — how an add-on prices itself. */
export type AddonPriceType = 'PerHour' | 'Fixed'

export interface Room {
  roomId: number
  code: string
  name: string
  nameAr: string | null
  seats: number
  minPersons: number
  pricePerHour: number
  currencyCode: string
  /** What share of the total is taken up front. Stored per room, not global. */
  depositPercent: number
  /** null = fall back to the system's BookingMinHours setting. */
  minHours: number | null
  /** null = fall back to the system's BookingMaxHours setting. */
  maxHours: number | null
  description: string | null
  /** Free text the site renders as a list — "Whiteboard, 55&quot; screen". */
  features: string | null
  /** The cancellation/deposit terms, printed as the receipt's small print. */
  policyText: string | null
  photoKey: string | null
  sortOrder: number
  isActive: boolean
  /** Live bookings from today on. The number that makes deactivating a room an informed act. */
  futureBookings: number
}

export interface RoomHours {
  roomId: number
  /** 1 = Monday … 7 = Sunday. NOT JavaScript's getDay(), where Sunday is 0. */
  dayOfWeek: number
  openTime: string
  closeTime: string
  /** Closed all day. The times are still stored, so re-opening restores the old hours. */
  isClosed: boolean
}

export interface RoomAddon {
  addonId: number
  roomId: number
  name: string
  priceType: AddonPriceType
  price: number
  isActive: boolean
}

/** The three result sets of the rooms endpoint. They travel together because they are useless apart. */
export interface RoomCatalog {
  rooms: Room[]
  hours: RoomHours[]
  addons: RoomAddon[]
}

export interface PaymentMethod {
  paymentMethodId: number
  name: string
  isOnline: boolean
  isActive: boolean
}

export interface BookingRow {
  bookingId: number
  roomId: number
  bookDate: string
  startTime: string
  endTime: string
  persons: number
  guestName: string
  guestPhone: string
  guestEmail: string | null
  note: string | null
  /** Database-computed duration. Null only if the column ever came back empty. */
  hours: number | null
  totalAmount: number
  depositDue: number
  currencyCode: string
  status: BookingStatus
  source: BookingSource
  createdUtc: string
  createdByUserId: number | null
  decidedByUserId: number | null
  decidedUtc: string | null
  cancelReason: string | null
  roomName: string
  roomCode: string
  /** Sum of payments. Zero, never null. */
  paidAmount: number
  /** totalAmount − paidAmount, computed server-side so no two screens can disagree. */
  balanceDue: number
  decidedByUsername: string | null

  /* ── CANCELLATION AND REFUND. All optional: an older API omits them, and a booking that was
     never cancelled has nothing to say here. ── */
  /** Set on a Cancelled booking; decides how refundAmount was worked out. */
  cancelledBy?: CancelledBy | null
  /** What is owed back to the guest in total (not what is still outstanding — see the payments). */
  refundAmount?: number | null
  refundStatus?: RefundStatus | null
  /** When the refund was completed. Null until refundStatus is Refunded. */
  refundedUtc?: string | null
}

/**
 * One money line on a booking, as GET /api/bookings/{id} and POST /{id}/refunds return them.
 * A refund is a payment line with isRefund set — the amount is positive either way and the flag
 * says which direction the money went, so nothing here subtracts on the client.
 */
export interface BookingPaymentLine {
  paymentId: number
  amount: number
  isRefund?: boolean
  /** The method's name, or its id on a build that has not named it yet. */
  method?: string | number | null
  reference?: string | null
  paidUtc: string
}

/** GET /api/bookings/{id} — the row plus its individual payment lines. */
export interface BookingDetail extends BookingRow {
  payments?: BookingPaymentLine[]
}

export interface BookingBlock {
  blockId: number
  roomId: number
  blockDate: string
  startTime: string
  endTime: string
  /** Internal only — the public availability feed never carries it. */
  reason: string | null
  createdByUserId: number | null
  createdUtc: string
  roomName: string
  createdByUsername: string | null
}

/** GET /api/bookings — the calendar needs both lists or it paints free time over a shut room. */
export interface BookingRange {
  bookings: BookingRow[]
  blocks: BookingBlock[]
}

/** What a create returns. `status` is NOT predictable from the request — render what comes back. */
export interface BookingCreated {
  bookingId: number
  totalAmount: number
  depositDue: number
  currencyCode: string
  status: BookingStatus
}

export interface BookingStatusChanged {
  bookingId: number
  status: BookingStatus
  cancelledBy?: CancelledBy | null
  refundAmount?: number | null
  refundStatus?: RefundStatus | null
}

/** POST /api/bookings/{id}/refunds — the position AFTER the refund, never to be computed here. */
export interface RefundRecorded {
  payments?: BookingPaymentLine[]
  refundAmount?: number | null
  refundStatus?: RefundStatus | null
  refundedUtc?: string | null
}

export interface PaymentAdded {
  paymentId: number
  paidTotal: number
  balanceDue: number
}

export interface BlockCreated {
  blockId: number
}

/* ── receipt ─────────────────────────────────────────────────────────────────────────────────── */

export interface ReceiptHeader {
  bookingId: number
  bookDate: string
  startTime: string
  endTime: string
  persons: number
  hours: number | null
  guestName: string
  guestPhone: string
  guestEmail: string | null
  status: BookingStatus
  source: BookingSource
  totalAmount: number
  depositDue: number
  currencyCode: string
  note: string | null
  roomName: string
  /** The room's CURRENT rate. Only the amounts on a receipt are historical, not the terms. */
  pricePerHour: number
  policyText: string | null
  paidAmount: number
  /** Zero prints PAID; anything above prints BALANCE DUE. */
  balanceDue: number
}

/** An add-on line AS CHARGED — name and amount were copied onto the booking, so a rename never moves it. */
export interface ReceiptAddon {
  name: string
  amount: number
}

export interface ReceiptPayment {
  paymentId: number
  amount: number
  /** Money that went BACK to the guest. Absent on an older build, which never records one. */
  isRefund?: boolean
  reference: string | null
  paidUtc: string
  methodName: string
  receivedBy: string | null
}

export interface BookingReceipt {
  header: ReceiptHeader | null
  addons: ReceiptAddon[]
  payments: ReceiptPayment[]
}

/* ── report ──────────────────────────────────────────────────────────────────────────────────── */

export interface BookingReportBucket {
  /** '2026-09-02' for day, '2026-W36' for week, '2026-09' for month. */
  bucket: string
  bookings: number
  cancelled: number
  noShows: number
  /** Hours on Confirmed and Completed bookings — what the room actually sold. */
  hoursSold: number
  /** Value of Confirmed and Completed bookings. */
  revenue: number
  /**
   * Payments received, WHATEVER became of the booking. Deliberately a different population from
   * revenue: money taken against a booking that was later cancelled is still in the till.
   */
  collected: number
}

export interface BookingReportRoom {
  roomName: string
  bookings: number
  hoursSold: number
  revenue: number
  collected: number
}

export interface BookingReport {
  buckets: BookingReportBucket[]
  rooms: BookingReportRoom[]
}

/* ── request bodies ──────────────────────────────────────────────────────────────────────────── */

export interface BookingCreatePayload {
  roomId: number
  /** 'yyyy-MM-dd'. */
  bookDate: string
  /** 'HH:mm:ss' — the API wants seconds, so the ':00' is appended at the call site. */
  startTime: string
  endTime: string
  persons: number
  guestName: string
  guestPhone: string
  guestEmail?: string | null
  note?: string | null
  addonIds?: number[]
}

export interface BookingStatusPayload {
  status: BookingStatus
  /** Cancelling only: which refund rule applies. The server refuses a cancellation without it. */
  cancelledBy?: CancelledBy | null
  /** Cancelling only: kept on the booking and printed on the receipt. */
  note?: string | null
  /**
   * The older spelling of `note`. Still accepted by the server (reason = note), and still sent —
   * the build this page may be talking to REQUIRES it on a cancellation and refuses an empty one
   * by name. Sending both costs nothing and works against either.
   */
  reason?: string | null
}

export interface BookingRefundPayload {
  amount: number
  /** A PaymentMethodId from GET /api/bookings/payment-methods. */
  method: number
  reference?: string | null
}

export interface BookingPaymentPayload {
  paymentMethodId: number
  amount: number
  reference?: string | null
}

export interface BlockCreatePayload {
  roomId: number
  blockDate: string
  startTime: string
  endTime: string
  reason?: string | null
}

export interface RoomUpsertPayload {
  code: string
  name: string
  nameAr?: string | null
  seats: number
  minPersons: number
  pricePerHour: number
  currencyCode: string
  depositPercent: number
  minHours?: number | null
  maxHours?: number | null
  description?: string | null
  features?: string | null
  policyText?: string | null
  photoKey?: string | null
  sortOrder: number
  isActive: boolean
}

export interface RoomHoursPayload {
  /** 1 = Monday … 7 = Sunday. */
  dayOfWeek: number
  openTime: string
  closeTime: string
  isClosed: boolean
}

export interface RoomAddonUpsertPayload {
  name: string
  priceType: AddonPriceType
  price: number
  isActive: boolean
}
