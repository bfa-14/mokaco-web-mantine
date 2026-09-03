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
  /** Required by the server when cancelling; it refuses an empty one by name. */
  reason?: string | null
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
