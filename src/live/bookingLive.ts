import { useEffect, useRef } from 'react'
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr'
import { API_BASE_URL } from '../config'
import { tokenStorage } from '../auth/tokenStorage'

/**
 * Live booking updates: the staff side of /hubs/booking.
 *
 * A SECOND CONNECTION, NOT A TOPIC ON THE FIRST. /hubs/live carries signals only ("payroll moved,
 * refetch") and deliberately no data. A new website booking has to say WHICH booking — the toast
 * names its reference and opens its drawer — so it travels on the booking hub, which the API gates
 * by BOOKING_VIEW / BOOKING_MANAGE: a connection without either right is accepted and simply never
 * hears anything.
 *
 * ONE CONNECTION FOR THE WHOLE TAB, reference-counted by its listeners: the toast host keeps it open
 * for as long as somebody who may see bookings is signed in, and the calendar and the list add
 * themselves while they are on screen. It closes when the last listener leaves (logout included).
 *
 * IT CAN ONLY MAKE A PAGE FRESHER, NEVER WRONG. A message triggers the same refetch the page does on
 * its own; if the socket never connects, the pages behave exactly as they did before this file.
 */

/** BookingChanged, as MokaCo.HRMS.API/Hubs/BookingLivePublisher sends it to the group "staff". */
export interface BookingChangedMessage {
  bookingId: number
  ref: string
  status: string
  roomCode: string
  /** yyyy-MM-dd, the café's calendar day. */
  date: string
  startMin: number
  endMin: number
  guestName: string
  source: string
}

type Handler = (message: BookingChangedMessage) => void

/**
 * CalendarChanged, to the group "staff": something WITHOUT a booking changed — a staff block was laid
 * or lifted ('block'), or a room, its hours or its add-ons were edited ('room'). QA3 BKG-14: these
 * used to publish nothing, so another till's calendar showed a room free that had just been blocked.
 */
export interface CalendarChangedMessage {
  kind: 'block' | 'room' | string
  roomId: number | null
  /** yyyy-MM-dd for a block; null for a catalogue edit. */
  date: string | null
}

type CalendarHandler = (message: CalendarChangedMessage) => void

/**
 * Reconnect with backoff, and never give up: 0 s, 2 s, 5 s, 10 s, then every 30 s. SignalR's default
 * policy stops after four tries (about forty seconds), which a café's Wi-Fi outlasts daily — and a
 * calendar that silently stopped being live is worse than one that never was.
 */
const RETRY_DELAYS_MS = [0, 2_000, 5_000, 10_000, 30_000]
const retryDelay = (attempt: number) => RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]

const handlers = new Set<Handler>()
const calendarHandlers = new Set<CalendarHandler>()
let connection: HubConnection | null = null

/** Everybody listening, for either message: the connection lives while this is above zero. */
const listeners = () => handlers.size + calendarHandlers.size
let startTimer: ReturnType<typeof setTimeout> | null = null

function build(): HubConnection {
  const built = new HubConnectionBuilder()
    .withUrl(`${API_BASE_URL}/hubs/booking`, {
      // Read at call time, so a token refreshed since the last attempt is the one that is sent.
      accessTokenFactory: () => tokenStorage.getAccessToken() ?? '',
    })
    .withAutomaticReconnect({
      nextRetryDelayInMilliseconds: (context) => retryDelay(context.previousRetryCount),
    })
    .configureLogging(LogLevel.Error)
    .build()

  built.on('BookingChanged', (message: BookingChangedMessage) => {
    if (!message || typeof message.bookingId !== 'number') return
    handlers.forEach((handler) => handler(message))
  })

  built.on('CalendarChanged', (message: CalendarChangedMessage) => {
    if (!message || typeof message.kind !== 'string') return
    calendarHandlers.forEach((handler) => handler(message))
  })

  return built
}

/**
 * withAutomaticReconnect only covers a connection that was once established; the FIRST start is
 * ours to retry, with the same delays. Stops as soon as nobody is listening any more.
 */
function start(attempt = 0): void {
  if (listeners() === 0) return
  connection ??= build()
  if (connection.state !== HubConnectionState.Disconnected) return

  const current = connection
  current.start().catch(() => {
    if (connection !== current || listeners() === 0) return
    startTimer = setTimeout(() => start(attempt + 1), retryDelay(attempt + 1))
  })
}

function stop(): void {
  if (startTimer) clearTimeout(startTimer)
  startTimer = null
  const closing = connection
  connection = null
  if (closing) void closing.stop().catch(() => undefined)
}

export const bookingLive = {
  /** Listen for booking changes. Opens the connection for the first listener; returns the unsubscribe. */
  onBookingChanged(handler: Handler): () => void {
    handlers.add(handler)
    start()
    return () => {
      handlers.delete(handler)
      if (listeners() === 0) stop()
    }
  },

  /** Listen for block and catalogue changes (staff only). Shares the one connection. */
  onCalendarChanged(handler: CalendarHandler): () => void {
    calendarHandlers.add(handler)
    start()
    return () => {
      calendarHandlers.delete(handler)
      if (listeners() === 0) stop()
    }
  },
}

/**
 * Calls `handler` for every BookingChanged while the component is mounted and `enabled`.
 * The handler is kept in a ref, so a page can pass its latest `load` without re-subscribing on
 * every render (and without the connection flapping when it is the only listener).
 */
export function useBookingChanged(handler: Handler, enabled = true): void {
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  }, [handler])

  useEffect(() => {
    if (!enabled) return
    return bookingLive.onBookingChanged((message) => latest.current(message))
  }, [enabled])
}

/**
 * Calls `handler` for every CalendarChanged while the component is mounted and `enabled` — a block
 * laid or lifted, a room, its hours or its add-ons edited at another till (QA3 BKG-14). Same
 * latest-handler ref as useBookingChanged.
 */
export function useCalendarChanged(handler: CalendarHandler, enabled = true): void {
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  }, [handler])

  useEffect(() => {
    if (!enabled) return
    return bookingLive.onCalendarChanged((message) => latest.current(message))
  }, [enabled])
}
