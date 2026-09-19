import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ActionIcon,
  Button,
  Loader,
  LoadingOverlay,
  Popover,
  Select,
  Switch,
  useMantineTheme,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import {
  IconChevronLeft,
  IconChevronRight,
  IconLock,
  IconPlus,
} from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import { getErrorMessage } from '../../api/errorMessage'
import { DateRangeField } from '../../components/DateRangeField'
import { PageHelp } from '../../components/PageHelp'
import { bookingsService, roomsService } from '../../services/bookingService'
import { settingsService } from '../../services/settingsService'
import {
  BOOKING_MIN_HOURS_KEY,
  BOOKING_SLOT_MINUTES_KEY,
} from '../../types/settings'
import type {
  BookingBlock,
  BookingRow,
  Room,
  RoomCatalog,
  RoomHours,
} from '../../types/booking'
import {
  addDays,
  dayCount,
  dayLabel,
  dayOfWeek,
  DEFAULT_MIN_HOURS,
  DEFAULT_SLOT_MINUTES,
  eachDay,
  endOfMonth,
  fromMinutes,
  hasRefund,
  hhmm,
  isStruck,
  laneLayout,
  MAX_GRID_DAYS,
  minutesOf,
  nowMinutes,
  PERMISSIONS,
  PIXELS_PER_HOUR,
  refundLabel,
  refundStatusOf,
  roomPalette,
  startOfMonth,
  startOfWeek,
  STATUS_CLASS,
  statusLabel,
  today,
  visibleWindow,
  weekdayName,
} from './bookingShared'
import { BookingDrawer } from './BookingDrawer'
import { useBookingChanged } from '../../live/bookingLive'
import { NewBookingModal } from './NewBookingModal'
import { BlockRoomModal } from './BlockRoomModal'
import './bookings.css'

/**
 * The room calendar — the page this whole area exists for.
 *
 * WHY IT IS ABSOLUTE POSITIONING AND NOT A CSS GRID. A booking is a span of MINUTES. 10:30–12:15
 * has to begin and end where it actually does, and a grid quantised to the hour would round it into
 * something that is not true. So each column is a `position: relative` box of known height and every
 * event is placed from its own minutes; the rules behind it are decoration.
 *
 * WHAT A COLUMN IS DEPENDS ON THE RANGE, and that is the whole shape of this screen. A week used to
 * mean one column per ROOM per DAY — four rooms over seven days is twenty-eight columns, which no
 * screen holds, so the page scrolled sideways and the week could never be seen at once. Now:
 *
 *   · two days or more → ONE COLUMN PER DAY, every visible room's bookings sharing the column and
 *     telling themselves apart by a colour stripe and the room's short code. Seven columns, always.
 *   · a single day     → ONE COLUMN PER ROOM, the resource view, which is what "today" wants to be.
 *
 * Either way the column count is bounded by the days on screen, never multiplied by the rooms, and
 * the grid is given the viewport's height and scrolls INSIDE itself. Nothing scrolls sideways.
 *
 * THE RANGE AND THE ROOM LIVE IN THE URL. A calendar is the thing people link each other to — "look
 * at next week" — and it is the thing they reload when the phone rings. ?from=&to=&room= means both
 * survive, and the back button walks the ranges rather than leaving the page.
 *
 * BLOCKS ARE DRAWN FROM THE SAME FETCH AND ARE NOT BOOKINGS. Grey and striped, they say "Blocked"
 * and carry the reason, because a block has no guest and no money and colouring it like a status
 * would invite the wrong action on it.
 *
 * CANCELLED IS THE ONE THING HIDDEN BY DEFAULT, behind a switch in the toolbar. It is not a filter
 * in the list-page sense: every other status stays, because a calendar exists to show what the room
 * is doing and hiding a completed booking would leave time looking free that somebody stood in. A
 * cancellation, though, freed the room — drawing it keeps a slot looking taken that is now for sale.
 */
export default function BookingCalendarPage() {
  const { t } = useTranslation()
  const theme = useMantineTheme()
  const { hasPermission } = useAuth()
  const canView = hasPermission(PERMISSIONS.view)
  const canManage = hasPermission(PERMISSIONS.manage)
  /** Whether /api/settings is readable at all by this user — see the settings effect below. */
  const canReadSettings = hasPermission(PERMISSION.SETTING_MANAGE)

  /* ── the range, the room: URL first ────────────────────────────────────────────────────────── */

  const [searchParams, setSearchParams] = useSearchParams()

  /** Monday–Sunday of the current week, which is what the page opens on when the URL says nothing. */
  const defaultFrom = startOfWeek(today())
  const defaultTo = addDays(defaultFrom, 6)

  const paramFrom = searchParams.get('from')
  const paramTo = searchParams.get('to')
  const roomParam = searchParams.get('room')

  /* A URL carrying only ?from= means ONE DAY. Widening it to a week would show a different answer
     than the link promised, so only the no-parameters case gets the default week. */
  const rangeFrom = paramFrom || defaultFrom
  const rawTo = paramTo || paramFrom || defaultTo
  /* An inverted range cannot be picked in the control, but it CAN be typed into the address bar. */
  const rangeTo = rawTo >= rangeFrom ? rawTo : rangeFrom
  const roomFilter = roomParam ? Number(roomParam) : null

  const setRange = useCallback(
    (nextFrom: string, nextTo: string) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current)
          params.set('from', nextFrom)
          params.set('to', nextTo)
          return params
        },
        // Replace, not push: dragging across a date picker should not bury the page the user
        // arrived from under a dozen history entries.
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const setRoomFilter = useCallback(
    (value: number | null) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current)
          if (value == null) params.delete('room')
          else params.set('room', String(value))
          return params
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  /**
   * The half-picked range, held only while the second click is still to come.
   *
   * The picker is controlled from the URL, and a range picker that refuses the (start, null) state
   * can never reach the (start, end) one — the first click would be thrown away and the second read
   * as another first. So the intermediate pair lives here and the URL only ever sees a whole range.
   */
  const [pendingRange, setPendingRange] = useState<[string | null, string | null] | null>(null)

  const spanDays = dayCount(rangeFrom, rangeTo)
  const tooLong = spanDays > MAX_GRID_DAYS

  /* ── data ──────────────────────────────────────────────────────────────────────────────────── */

  const [catalog, setCatalog] = useState<RoomCatalog>({ rooms: [], hours: [], addons: [] })
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [blocks, setBlocks] = useState<BookingBlock[]>([])
  const [loading, setLoading] = useState(true)
  /** True until the first range has arrived. Only THAT one blanks the page; the rest dim it. */
  const [firstLoad, setFirstLoad] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /** BookingSlotMinutes / BookingMinHours, when this user is allowed to read them. See settings.ts. */
  const [slotMinutes, setSlotMinutes] = useState(DEFAULT_SLOT_MINUTES)
  const [systemMinHours, setSystemMinHours] = useState(DEFAULT_MIN_HOURS)

  const [showCancelled, setShowCancelled] = useState(false)
  /** Rooms switched OFF in the legend. Client-side only — the fetch is unchanged by it. */
  const [hiddenRooms, setHiddenRooms] = useState<number[]>([])

  const [selectedBooking, setSelectedBooking] = useState<BookingRow | null>(null)
  const [selectedBlock, setSelectedBlock] = useState<BookingBlock | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const [newOpen, setNewOpen] = useState(false)
  const [blockOpen, setBlockOpen] = useState(false)
  const [prefill, setPrefill] = useState<{
    roomId: number | null
    date: string | null
    start: string | null
    end: string | null
  }>({ roomId: null, date: null, start: null, end: null })

  /* The catalogue: rooms, their weekly hours, their add-ons. Loaded once — a room's opening hours
     do not change while somebody is paging through a month. */
  useEffect(() => {
    let cancelled = false
    roomsService
      .getCatalog(true)
      .then((result) => {
        if (!cancelled) setCatalog(result)
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  /* The two grid settings, and ONLY for somebody who may read them.
     /api/settings is SETTING_MANAGE, which most of the people who live on this page do not have —
     asking anyway would put a guaranteed 403 in the console on every load and buy nothing, because
     a refusal and a skipped call leave exactly the same defaults standing. Nothing a booking
     depends on is decided by these two: they rule the grid and seed a form, and the server still
     owns every rule. See BOOKING_SLOT_MINUTES_KEY. */
  useEffect(() => {
    if (!canReadSettings) return

    let cancelled = false
    settingsService
      .getAll()
      .then((rows) => {
        if (cancelled) return
        const slot = Number(
          rows.find((row) => row.settingKey === BOOKING_SLOT_MINUTES_KEY)?.settingValue,
        )
        if (Number.isFinite(slot) && slot >= 5 && slot <= 120) setSlotMinutes(slot)

        const min = Number(
          rows.find((row) => row.settingKey === BOOKING_MIN_HOURS_KEY)?.settingValue,
        )
        if (Number.isFinite(min) && min > 0 && min <= 24) setSystemMinHours(min)
      })
      .catch(() => {
        /* A settings outage must not cost anyone the calendar. The defaults are the answer. */
      })
    return () => {
      cancelled = true
    }
  }, [canReadSettings])

  const load = useCallback(async () => {
    if (tooLong) {
      // A range past the cap is not drawn, so it is not fetched either — the point of the cap is
      // that a quarter of bookings is a report, not a screenful.
      setLoading(false)
      setFirstLoad(false)
      return
    }

    setLoading(true)
    try {
      const result = await bookingsService.getRange(rangeFrom, rangeTo, roomFilter)
      setBookings(result.bookings)
      setBlocks(result.blocks)
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
      setBookings([])
      setBlocks([])
    } finally {
      setLoading(false)
      setFirstLoad(false)
    }
  }, [rangeFrom, rangeTo, roomFilter, tooLong])

  useEffect(() => {
    if (!canView) return
    void load()
  }, [canView, load])

  /* LIVE: a booking made on the website, or decided / paid / cancelled at another till, redraws the
     grid without a reload. The message is only the trigger; the blocks still come from the same GET. */
  useBookingChanged(() => void load(), canView)

  /* ── which rooms, which days ───────────────────────────────────────────────────────────────── */

  /** Every active room, in SortOrder — the order the colours follow. Retired rooms never get a
   *  column, because nothing can be booked in one. */
  const activeRooms: Room[] = useMemo(
    () =>
      catalog.rooms
        .filter((room) => room.isActive)
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder || a.roomId - b.roomId),
    [catalog.rooms],
  )

  /**
   * The colour a room wears, fixed by its place in SortOrder and read from the theme.
   *
   * Computed over ALL active rooms, not the filtered ones, so narrowing to a single room does not
   * repaint it — the chip in the legend and the stripe on a card mean the same thing in every view.
   */
  const roomColor = useMemo(() => {
    const map = new Map<number, string>()
    activeRooms.forEach((room, index) => {
      const palette = theme.colors[roomPalette(index)]
      map.set(room.roomId, palette?.[6] ?? theme.colors.gray[6])
    })
    return map
  }, [activeRooms, theme.colors])

  const filteredRooms = useMemo(
    () => activeRooms.filter((room) => roomFilter == null || room.roomId === roomFilter),
    [activeRooms, roomFilter],
  )

  /** What the grid actually draws: the filtered rooms minus the ones switched off in the legend. */
  const visibleRooms = useMemo(
    () => filteredRooms.filter((room) => !hiddenRooms.includes(room.roomId)),
    [filteredRooms, hiddenRooms],
  )

  /* ── shape: day columns or room columns ────────────────────────────────────────────────────── */

  /**
   * Below md the grid is FORCED to a single day.
   *
   * Seven day-columns on a phone is 40px each, which holds no name and no time — a week that cannot
   * be read is not a week view. So the small screen gets the resource view for one day and a stepper
   * to walk the range, which is the shape a phone can actually show.
   */
  const isSmall = useMediaQuery('(max-width: 62em)', false, { getInitialValueInEffect: false })

  const rangeDays = useMemo(
    () => (tooLong ? [rangeFrom] : eachDay(rangeFrom, rangeTo)),
    [rangeFrom, rangeTo, tooLong],
  )

  /**
   * The day the small-screen stepper is parked on.
   *
   * An OVERRIDE rather than the truth: the range is still the range, and today (when the range holds
   * it) is still where the eye should land. The override only exists once somebody has stepped.
   */
  const [dayOverride, setDayOverride] = useState<string | null>(null)

  const focusDay = useMemo(() => {
    if (dayOverride && dayOverride >= rangeFrom && dayOverride <= rangeTo) return dayOverride
    const now = today()
    return now >= rangeFrom && now <= rangeTo ? now : rangeFrom
  }, [dayOverride, rangeFrom, rangeTo])

  /** One column per room when there is one day to show; one per day when there are several. */
  const roomColumns = isSmall || rangeDays.length === 1

  const days = useMemo(
    () => (roomColumns ? [focusDay] : rangeDays),
    [roomColumns, focusDay, rangeDays],
  )

  /** Hours for the rooms and weekdays actually on screen — the time axis is computed from these. */
  const relevantHours: RoomHours[] = useMemo(() => {
    const roomIds = new Set(visibleRooms.map((r) => r.roomId))
    const dows = new Set(days.map(dayOfWeek))
    return catalog.hours.filter((h) => roomIds.has(h.roomId) && dows.has(h.dayOfWeek))
  }, [catalog.hours, visibleRooms, days])

  const viewWindow = useMemo(() => visibleWindow(relevantHours), [relevantHours])
  const totalMinutes = viewWindow.end - viewWindow.start
  const bodyHeight = (totalMinutes / 60) * PIXELS_PER_HOUR

  /** Minutes since midnight → pixels from the top of a column. */
  const toTop = useCallback(
    (minutes: number) => ((minutes - viewWindow.start) / 60) * PIXELS_PER_HOUR,
    [viewWindow.start],
  )

  /** The hour marks, and the faint slot rules between them. */
  const hourMarks = useMemo(() => {
    const marks: number[] = []
    for (let m = viewWindow.start; m <= viewWindow.end; m += 60) marks.push(m)
    return marks
  }, [viewWindow.start, viewWindow.end])

  const slotMarks = useMemo(() => {
    const marks: number[] = []
    if (slotMinutes >= 60) return marks
    for (let m = viewWindow.start; m < viewWindow.end; m += slotMinutes) {
      if (m % 60 !== 0) marks.push(m)
    }
    return marks
  }, [viewWindow.start, viewWindow.end, slotMinutes])

  /**
   * The columns, however the range decided to shape them.
   *
   * ONE DESCRIPTOR EITHER WAY, so the drawing below has a single path. What changes between the two
   * views is only what a column CONTAINS — a day's worth of every room, or one room's day — and the
   * opening window it is drawn against, which is the union of its rooms' hours for that weekday.
   */
  const columns: CalColumn[] = useMemo(() => {
    function windowFor(day: string, rooms: Room[]) {
      const dow = dayOfWeek(day)
      const open = rooms
        .map((room) => catalog.hours.find((h) => h.roomId === room.roomId && h.dayOfWeek === dow))
        .filter((h): h is RoomHours => !!h && !h.isClosed)

      if (open.length === 0) return { openMin: 0, closeMin: 0, closedAllDay: true }
      return {
        openMin: Math.min(...open.map((h) => minutesOf(h.openTime))),
        closeMin: Math.max(...open.map((h) => minutesOf(h.closeTime))),
        closedAllDay: false,
      }
    }

    if (roomColumns) {
      const day = days[0]
      return visibleRooms.map((room) => ({
        key: `room-${room.roomId}`,
        day,
        rooms: [room],
        title: room.name,
        sub: t('booking.calendar.seats', { count: room.seats }),
        accent: roomColor.get(room.roomId),
        defaultRoomId: room.roomId,
        ...windowFor(day, [room]),
      }))
    }

    return days.map((day) => ({
      key: `day-${day}`,
      day,
      rooms: visibleRooms,
      title: weekdayName(day),
      // Day and month only. A day column is a seventh of the width and the year is the one part
      // of the date that every column on screen already agrees on.
      sub: dayLabel(day).slice(0, 5),
      accent: undefined,
      defaultRoomId: visibleRooms[0]?.roomId ?? null,
      ...windowFor(day, visibleRooms),
    }))
  }, [roomColumns, days, visibleRooms, catalog.hours, roomColor, t])

  /* ── the events in each column ─────────────────────────────────────────────────────────────── */

  const eventsByColumn = useMemo(() => {
    const map = new Map<string, PlacedEvent[]>()

    for (const column of columns) {
      const roomIds = new Set(column.rooms.map((r) => r.roomId))

      const raw: CalEvent[] = [
        ...blocks
          .filter((b) => roomIds.has(b.roomId) && b.blockDate.slice(0, 10) === column.day)
          .map((b) => ({
            kind: 'block' as const,
            key: `block-${b.blockId}`,
            roomId: b.roomId,
            start: minutesOf(b.startTime),
            end: minutesOf(b.endTime),
            block: b,
          })),
        ...bookings
          .filter(
            (b) =>
              roomIds.has(b.roomId) &&
              b.bookDate.slice(0, 10) === column.day &&
              (showCancelled || b.status !== 'Cancelled'),
          )
          .map((b) => ({
            kind: 'booking' as const,
            key: `bk-${b.bookingId}`,
            roomId: b.roomId,
            start: minutesOf(b.startTime),
            end: minutesOf(b.endTime),
            booking: b,
          })),
      ].sort((a, b) => a.start - b.start || a.end - b.end)

      const lanes = laneLayout(raw)
      map.set(
        column.key,
        raw.map((event, index) => ({ ...event, ...lanes[index] })),
      )
    }

    return map
  }, [columns, bookings, blocks, showCancelled])

  /* ── the grid's own height and its scroll position ─────────────────────────────────────────── */

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [gridHeight, setGridHeight] = useState(520)
  /** The height last applied, so a measurement that has barely moved can be ignored. See below. */
  const appliedHeight = useRef(520)

  /**
   * The grid takes what is left of the pane it sits in and scrolls inside itself.
   *
   * MEASURED RATHER THAN A calc(). What sits above the grid is not fixed — the help panel collapses,
   * the toolbar wraps at some widths and not others, the legend grows a row when cancelled bookings
   * are switched on — so any constant subtracted from 100vh would be wrong on most screens. The
   * element's own top edge is the only honest number.
   *
   * THE 8px DEADBAND IS NOT A TIDINESS MEASURE. `.app-content` is the scroller, and a height that
   * makes the page fit EXACTLY removes its scrollbar — which widens the pane, which can unwrap the
   * toolbar, which lifts the grid, which makes the page overflow and brings the scrollbar back. A
   * measurement that has moved by less than a scrollbar is ignored, so that loop cannot start.
   */
  const measure = useCallback(() => {
    const element = scrollRef.current
    if (!element) return

    /* The viewport's bottom is also the content pane's: `.app-shell` is exactly 100vh and the pane
       inside it is the scroller, so there is nothing below the fold to leave room for. */
    const next = Math.max(
      320,
      Math.round(window.innerHeight - element.getBoundingClientRect().top - 16),
    )

    if (Math.abs(next - appliedHeight.current) < 8) return
    appliedHeight.current = next
    setGridHeight(next)
  }, [])

  /* Re-measured after EVERY render, with no dependency list, because the things that move the grid's
     top edge are not enumerable — a wrapped toolbar, a collapsed help panel, a second legend row.
     Setting the height it already has is a no-op React discards, so this cannot loop. */
  useLayoutEffect(measure)

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  /**
   * Land on the hour that matters: NOW when the range contains today, opening time otherwise.
   *
   * Keyed on the range and the window ONLY — not on the data — so a refetch after confirming a
   * booking leaves the scroll exactly where the operator left it. That is the whole reason the grid
   * is dimmed during a reload rather than replaced by a spinner: an unmounted grid has no scroll
   * position to keep.
   */
  useEffect(() => {
    const element = scrollRef.current
    if (!element || firstLoad || tooLong) return

    const now = today()
    const target =
      now >= rangeFrom && now <= rangeTo ? nowMinutes() : viewWindow.start
    const clamped = Math.min(Math.max(target, viewWindow.start), viewWindow.end)
    element.scrollTop = Math.max(0, toTop(clamped) - PIXELS_PER_HOUR)
  }, [rangeFrom, rangeTo, viewWindow.start, viewWindow.end, firstLoad, tooLong, toTop])

  /* ── the red now line ──────────────────────────────────────────────────────────────────────── */

  const [minuteTick, setMinuteTick] = useState(() => nowMinutes())
  useEffect(() => {
    const timer = window.setInterval(() => setMinuteTick(nowMinutes()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  /* ── drag-to-select ────────────────────────────────────────────────────────────────────────── */

  /**
   * The span being dragged over empty time.
   *
   * MIRRORED IN A REF because the pointerup that commits it is on the WINDOW — a drag that ends off
   * the grid, which is most of them, never reaches a handler on the slot. A listener registered once
   * would otherwise close over the first render's null.
   */
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  useEffect(() => {
    dragRef.current = drag
  }, [drag])

  const openNewAt = useCallback(
    (column: CalColumn, startMin: number, endMin: number) => {
      setPrefill({
        roomId: column.defaultRoomId,
        date: column.day,
        start: fromMinutes(startMin),
        end: fromMinutes(endMin),
      })
      setNewOpen(true)
    },
    [],
  )

  /** The shortest booking to propose from a single click: the room's own minimum, or the system's. */
  const minHoursFor = useCallback(
    (roomId: number | null) => {
      const room = roomId == null ? null : activeRooms.find((r) => r.roomId === roomId)
      return room?.minHours ?? systemMinHours
    },
    [activeRooms, systemMinHours],
  )

  const commitDrag = useCallback(() => {
    const current = dragRef.current
    setDrag(null)
    if (!current) return

    const column = columns.find((c) => c.key === current.columnKey)
    if (!column) return

    const first = Math.min(current.anchor, current.current)
    const last = Math.max(current.anchor, current.current)

    // A click is a drag of one slot, and it proposes the room's MINIMUM booking rather than one
    // slot — half an hour is how the grid is ruled, not how a room is sold.
    const dragged = first !== last
    const rawEnd = dragged
      ? last + slotMinutes
      : first + minHoursFor(column.defaultRoomId) * 60

    // Clamp to closing, but never past the start: a room closing in ten minutes still gets a form
    // with a sane span in it, and the server is the one that refuses the booking.
    const end = Math.max(first + slotMinutes, Math.min(rawEnd, column.closeMin))
    openNewAt(column, first, end)
  }, [columns, slotMinutes, minHoursFor, openNewAt])

  useEffect(() => {
    if (!drag) return
    function onUp() {
      commitDrag()
    }
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [drag, commitDrag])

  /* ── opening things ────────────────────────────────────────────────────────────────────────── */

  function openBooking(row: BookingRow) {
    setSelectedBlock(null)
    setSelectedBooking(row)
    setDrawerOpen(true)
  }

  function openBlock(row: BookingBlock) {
    setSelectedBooking(null)
    setSelectedBlock(row)
    setDrawerOpen(true)
  }

  function toggleRoom(roomId: number) {
    setHiddenRooms((current) =>
      current.includes(roomId)
        ? current.filter((id) => id !== roomId)
        : [...current, roomId],
    )
  }

  /** ‹ › move the range by its OWN length, so a fortnight steps a fortnight and a day steps a day. */
  function shiftRange(direction: 1 | -1) {
    const step = spanDays * direction
    setRange(addDays(rangeFrom, step), addDays(rangeTo, step))
    setDayOverride(null)
  }

  /** The small-screen stepper. Walking off the end of the range makes that day the new range. */
  function stepDay(direction: 1 | -1) {
    const next = addDays(focusDay, direction)
    if (next >= rangeFrom && next <= rangeTo) setDayOverride(next)
    else {
      setRange(next, next)
      setDayOverride(next)
    }
  }

  const quickRanges = useMemo(() => {
    const now = today()
    const thisWeek = startOfWeek(now)
    const nextWeek = addDays(thisWeek, 7)
    return [
      { key: 'today', label: t('booking.calendar.today'), from: now, to: now },
      {
        key: 'thisWeek',
        label: t('booking.calendar.thisWeek'),
        from: thisWeek,
        to: addDays(thisWeek, 6),
      },
      {
        key: 'nextWeek',
        label: t('booking.calendar.nextWeek'),
        from: nextWeek,
        to: addDays(nextWeek, 6),
      },
      {
        key: 'thisMonth',
        label: t('booking.calendar.thisMonth'),
        from: startOfMonth(now),
        to: endOfMonth(now),
      },
    ]
  }, [t])

  if (!canView) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1 className="page-title">{t('booking.calendar.title')}</h1>
          </div>
        </div>
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">{t('booking.noAccess')}</div>
            {t('booking.noAccessHint')}
          </div>
        </div>
      </div>
    )
  }

  const roomLegend = (
    <div className="bk-rooms">
      {filteredRooms.map((room) => {
        const hidden = hiddenRooms.includes(room.roomId)
        return (
          <button
            key={room.roomId}
            type="button"
            className={`bk-room-chip${hidden ? ' bk-room-chip--off' : ''}`}
            aria-pressed={!hidden}
            onClick={() => toggleRoom(room.roomId)}
            title={t('booking.calendar.roomToggle', { room: room.name })}
          >
            <span
              className="bk-room-dot"
              style={{ background: roomColor.get(room.roomId) }}
            />
            {room.name}
          </button>
        )
      })}
    </div>
  )

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('booking.calendar.title')}</h1>
          <p className="page-subtitle">{t('booking.calendar.subtitle')}</p>
        </div>
      </div>

      <PageHelp>{t('booking.calendar.help')}</PageHelp>

      <div className="bk-toolbar">
        <div className="form-field">
          <label className="form-label" htmlFor="bk-cal-range">
            {t('booking.calendar.range')}
          </label>
          <DateRangeField
            id="bk-cal-range"
            from={pendingRange ? pendingRange[0] : rangeFrom}
            to={pendingRange ? pendingRange[1] : rangeTo}
            clearable
            w={240}
            onChange={(nextFrom, nextTo) => {
              if (nextFrom && !nextTo) {
                setPendingRange([nextFrom, null])
                return
              }
              setPendingRange(null)
              setDayOverride(null)
              // Clearing means "back to this week" — the endpoint needs two dates, so an empty
              // range is not a state this page can hold.
              if (!nextFrom) setRange(defaultFrom, defaultTo)
              else setRange(nextFrom, nextTo ?? nextFrom)
            }}
          />
        </div>

        <div className="form-field">
          <span className="form-label">{t('booking.calendar.period')}</span>
          <div className="bk-stepper">
            <ActionIcon
              variant="default"
              aria-label={t('booking.calendar.prev')}
              onClick={() => shiftRange(-1)}
            >
              <IconChevronLeft size={16} className="bk-chevron-back" />
            </ActionIcon>
            <Button
              variant="default"
              onClick={() => {
                setRange(defaultFrom, defaultTo)
                setDayOverride(null)
              }}
            >
              {t('booking.calendar.today')}
            </Button>
            <ActionIcon
              variant="default"
              aria-label={t('booking.calendar.next')}
              onClick={() => shiftRange(1)}
            >
              <IconChevronRight size={16} className="bk-chevron-forward" />
            </ActionIcon>
          </div>
        </div>

        <div className="form-field">
          <span className="form-label">{t('booking.calendar.jumpTo')}</span>
          <div className="bk-quick">
            {quickRanges.map((quick) => (
              <button
                key={quick.key}
                type="button"
                className={`bk-quick-chip${
                  rangeFrom === quick.from && rangeTo === quick.to
                    ? ' bk-quick-chip--on'
                    : ''
                }`}
                onClick={() => {
                  setPendingRange(null)
                  setDayOverride(null)
                  setRange(quick.from, quick.to)
                }}
              >
                {quick.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-room-filter">
            {t('booking.fields.room')}
          </label>
          <Select
            id="bk-room-filter"
            w={180}
            data={[
              { value: '', label: t('booking.calendar.allRooms') },
              ...activeRooms.map((room) => ({
                value: String(room.roomId),
                label: room.name,
              })),
            ]}
            value={roomFilter == null ? '' : String(roomFilter)}
            onChange={(value) => setRoomFilter(value ? Number(value) : null)}
            allowDeselect={false}
          />
        </div>

        <div className="form-field">
          <span className="form-label">{t('booking.fields.status')}</span>
          <Switch
            checked={showCancelled}
            onChange={(event) => setShowCancelled(event.currentTarget.checked)}
            label={t('booking.calendar.showCancelled')}
          />
        </div>

        {canManage && (
          <div className="bk-toolbar-spacer" style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="default"
              leftSection={<IconLock size={16} />}
              onClick={() => {
                setPrefill({
                  roomId: roomFilter ?? visibleRooms[0]?.roomId ?? null,
                  date: focusDay,
                  start: null,
                  end: null,
                })
                setBlockOpen(true)
              }}
            >
              {t('booking.calendar.blockRoom')}
            </Button>
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => {
                setPrefill({
                  roomId: roomFilter ?? visibleRooms[0]?.roomId ?? null,
                  date: focusDay,
                  start: null,
                  end: null,
                })
                setNewOpen(true)
              }}
            >
              {t('booking.calendar.newBooking')}
            </Button>
          </div>
        )}
      </div>

      {/* ── what the colours mean, and which rooms are on ── */}
      <div className="bk-legend-bar">
        <div className="bk-legend">
          <span className="bk-legend-item">
            <span className="bk-legend-swatch bk-legend-swatch--closed" />
            {t('booking.calendar.closedHours')}
          </span>
          <span className="bk-legend-item">
            <span className="bk-legend-swatch bk-ev--block" />
            {t('booking.calendar.blocked')}
          </span>
          {(['Pending', 'Confirmed', 'Completed', 'NoShow'] as const).map((status) => (
            <span className="bk-legend-item" key={status}>
              <span className={`bk-legend-swatch ${STATUS_CLASS[status]}`} />
              {statusLabel(status)}
            </span>
          ))}
          {showCancelled && (
            <span className="bk-legend-item">
              <span className={`bk-legend-swatch ${STATUS_CLASS.Cancelled}`} />
              {statusLabel('Cancelled')}
            </span>
          )}
        </div>

        {/* The room legend collapses into a popover on a small screen, where a row of chips would
            take the height the grid needs. */}
        {isSmall ? (
          <Popover position="bottom-end" withArrow shadow="md">
            <Popover.Target>
              <Button variant="default" size="xs">
                {t('booking.calendar.rooms')}
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              <div className="hint" style={{ marginTop: 0 }}>
                {t('booking.calendar.roomsHint')}
              </div>
              {roomLegend}
            </Popover.Dropdown>
          </Popover>
        ) : (
          roomLegend
        )}
      </div>

      {/* The small screen loses the day columns, so it needs a way to walk the range. */}
      {isSmall && !tooLong && (
        <div className="bk-day-stepper">
          <ActionIcon
            variant="default"
            aria-label={t('booking.calendar.prev')}
            onClick={() => stepDay(-1)}
          >
            <IconChevronLeft size={16} className="bk-chevron-back" />
          </ActionIcon>
          <strong>
            {weekdayName(focusDay)} · {dayLabel(focusDay)}
          </strong>
          <ActionIcon
            variant="default"
            aria-label={t('booking.calendar.next')}
            onClick={() => stepDay(1)}
          >
            <IconChevronRight size={16} className="bk-chevron-forward" />
          </ActionIcon>
        </div>
      )}

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {tooLong ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">
              {t('booking.calendar.tooLong', { days: spanDays })}
            </div>
            {t('booking.calendar.tooLongHint', { max: MAX_GRID_DAYS })}
            <div style={{ marginTop: 10 }}>
              <Link to="/bookings/list">{t('booking.calendar.openList')}</Link>
            </div>
          </div>
        </div>
      ) : firstLoad ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : filteredRooms.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">{t('booking.calendar.noRooms')}</div>
            {t('booking.calendar.noRoomsHint')}
          </div>
        </div>
      ) : visibleRooms.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">{t('booking.calendar.allHidden')}</div>
            {t('booking.calendar.allHiddenHint')}
          </div>
        </div>
      ) : (
        <div className="bk-cal-wrap">
          {/* Dimmed, never replaced: an unmounted grid loses the scroll position, and after
              confirming a booking the operator wants to be looking at the same hour. */}
          <LoadingOverlay visible={loading} zIndex={5} overlayProps={{ blur: 0.6 }} />

          <div
            className={`bk-cal${drag ? ' bk-cal--dragging' : ''}`}
            ref={scrollRef}
            style={{ height: gridHeight }}
          >
            <div className="bk-cal-head" style={{ gridTemplateColumns: gridTemplate(columns.length) }}>
              <div className="bk-cal-head-cell bk-cal-corner" />
              {columns.map((column) => (
                <div
                  key={column.key}
                  className={`bk-cal-head-cell${
                    column.day === today() && !roomColumns ? ' bk-cal-head-cell--today' : ''
                  }`}
                  style={
                    column.accent
                      ? { boxShadow: `inset 0 -3px 0 ${column.accent}` }
                      : undefined
                  }
                >
                  {column.title}
                  <span className="bk-cal-head-sub">{column.sub}</span>
                </div>
              ))}
            </div>

            <div className="bk-cal-body" style={{ gridTemplateColumns: gridTemplate(columns.length) }}>
              {/* the clock gutter — sticky on the leading edge, which is the right in Arabic */}
              <div className="bk-cal-gutter" style={{ height: bodyHeight }}>
                {hourMarks.map((minutes) => (
                  <span
                    key={minutes}
                    className="bk-cal-hour-label"
                    style={{ top: toTop(minutes) }}
                  >
                    {fromMinutes(minutes)}
                  </span>
                ))}
              </div>

              {columns.map((column) => {
                const events = eventsByColumn.get(column.key) ?? []
                const isToday = column.day === today()

                /* One click target per SLOT inside the opening window, behind the events in the
                   stacking order so a click on a booking always opens the booking. */
                const slots: number[] = []
                if (!column.closedAllDay && canManage) {
                  const first = Math.max(column.openMin, viewWindow.start)
                  const last = Math.min(column.closeMin, viewWindow.end)
                  for (let m = first; m + slotMinutes <= last; m += slotMinutes) slots.push(m)
                }

                const dragSpan =
                  drag && drag.columnKey === column.key
                    ? {
                        from: Math.min(drag.anchor, drag.current),
                        to: Math.max(drag.anchor, drag.current) + slotMinutes,
                      }
                    : null

                return (
                  <div
                    key={column.key}
                    className="bk-cal-col"
                    style={{ height: bodyHeight }}
                  >
                    {slotMarks.map((minutes) => (
                      <div
                        key={`slot-${minutes}`}
                        className="bk-cal-rule bk-cal-rule--slot"
                        style={{ top: toTop(minutes) }}
                      />
                    ))}
                    {hourMarks.map((minutes) => (
                      <div
                        key={minutes}
                        className="bk-cal-rule"
                        style={{ top: toTop(minutes) }}
                      />
                    ))}

                    {/* Closed time, hatched: the whole column, or the strips before opening and
                        after closing. In a day column those are the union of the visible rooms'
                        hours — a room open late keeps the evening bookable. */}
                    {column.closedAllDay ? (
                      <div className="bk-cal-closed" style={{ top: 0, height: bodyHeight }} />
                    ) : (
                      <>
                        {column.openMin > viewWindow.start && (
                          <div
                            className="bk-cal-closed"
                            style={{ top: 0, height: toTop(column.openMin) }}
                          />
                        )}
                        {column.closeMin < viewWindow.end && (
                          <div
                            className="bk-cal-closed"
                            style={{
                              top: toTop(column.closeMin),
                              height: bodyHeight - toTop(column.closeMin),
                            }}
                          />
                        )}
                      </>
                    )}

                    {slots.map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        className="bk-cal-slot"
                        style={{ top: toTop(minutes), height: (slotMinutes / 60) * PIXELS_PER_HOUR }}
                        title={t('booking.calendar.slotHint', {
                          room:
                            column.rooms.length === 1
                              ? column.rooms[0].name
                              : t('booking.calendar.allRooms'),
                          time: fromMinutes(minutes),
                        })}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return
                          event.preventDefault()
                          setDrag({ columnKey: column.key, anchor: minutes, current: minutes })
                        }}
                        onPointerEnter={() => {
                          setDrag((current) =>
                            current && current.columnKey === column.key
                              ? { ...current, current: minutes }
                              : current,
                          )
                        }}
                        onClick={(event) => {
                          // Pointer input is committed by the window's pointerup, so the only
                          // clicks that belong here are the keyboard's — which report detail 0.
                          if (event.detail !== 0) return
                          openNewAt(
                            column,
                            minutes,
                            Math.max(
                              minutes + slotMinutes,
                              Math.min(
                                minutes + minHoursFor(column.defaultRoomId) * 60,
                                column.closeMin,
                              ),
                            ),
                          )
                        }}
                      />
                    ))}

                    {dragSpan && (
                      <div
                        className="bk-cal-drag"
                        style={{
                          top: toTop(dragSpan.from),
                          height: toTop(dragSpan.to) - toTop(dragSpan.from),
                        }}
                      >
                        {fromMinutes(dragSpan.from)}–{fromMinutes(dragSpan.to)}
                      </div>
                    )}

                    {events.map((event) => {
                      const geometry = eventStyle(event, toTop)
                      const stripe = roomColor.get(event.roomId)

                      if (event.kind === 'block') {
                        return (
                          <button
                            key={event.key}
                            type="button"
                            className="bk-ev bk-ev--block"
                            style={geometry}
                            onClick={() => openBlock(event.block)}
                            title={
                              event.block.reason
                                ? t('booking.calendar.blockedWith', {
                                    reason: event.block.reason,
                                  })
                                : t('booking.calendar.blocked')
                            }
                          >
                            <span className="bk-ev-stripe" style={{ background: stripe }} />
                            <span className="bk-ev-badge">
                              {event.block.reason
                                ? t('booking.calendar.blockedWith', {
                                    reason: event.block.reason,
                                  })
                                : t('booking.calendar.blocked')}
                            </span>
                            <span className="bk-ev-name">
                              {!roomColumns && `${event.block.roomName} · `}
                              {hhmm(event.block.startTime)}–{hhmm(event.block.endTime)}
                            </span>
                          </button>
                        )
                      }

                      const row = event.booking
                      const room = activeRooms.find((r) => r.roomId === row.roomId)

                      return (
                        <button
                          key={event.key}
                          type="button"
                          className={`bk-ev ${STATUS_CLASS[row.status]}${
                            isStruck(row.status) ? ' bk-ev--struck' : ''
                          }`}
                          style={geometry}
                          onClick={() => openBooking(row)}
                          title={`${row.guestName} · ${row.roomName} · ${statusLabel(row.status)}`}
                        >
                          <span className="bk-ev-stripe" style={{ background: stripe }} />
                          <span className="bk-ev-time">
                            {hhmm(row.startTime)}–{hhmm(row.endTime)}
                            {!roomColumns && (
                              <span className="bk-ev-room">{room?.code ?? row.roomCode}</span>
                            )}
                          </span>
                          <span className="bk-ev-name">{row.guestName}</span>
                          {/* The refund position, on the card itself: Due reads red, Refunded
                              green, so a cancelled block that still owes money is findable. */}
                          {hasRefund(row) && (
                            <span
                              className={`bk-ev-refund bk-ev-refund--${refundStatusOf(row).toLowerCase()}`}
                            >
                              {refundLabel(refundStatusOf(row))}
                            </span>
                          )}
                        </button>
                      )
                    })}

                    {isToday &&
                      minuteTick >= viewWindow.start &&
                      minuteTick <= viewWindow.end && (
                        <div
                          className="bk-cal-now"
                          style={{ top: toTop(minuteTick) }}
                          aria-hidden="true"
                        />
                      )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <BookingDrawer
        booking={selectedBooking}
        block={selectedBlock}
        opened={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onChanged={load}
        canManage={canManage}
      />

      <NewBookingModal
        opened={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={load}
        catalog={catalog}
        initialRoomId={prefill.roomId}
        initialDate={prefill.date}
        initialStart={prefill.start}
        initialEnd={prefill.end}
      />

      <BlockRoomModal
        opened={blockOpen}
        onClose={() => setBlockOpen(false)}
        onCreated={load}
        catalog={catalog}
        initialRoomId={prefill.roomId}
        initialDate={prefill.date}
        initialStart={prefill.start}
        initialEnd={prefill.end}
      />
    </div>
  )
}

/* ── the shapes the grid is drawn from ───────────────────────────────────────────────────────── */

/** One column of the grid — a whole day across rooms, or one room's day. */
interface CalColumn {
  key: string
  day: string
  /** Whose events land in this column. One room in the resource view, all visible rooms in a day. */
  rooms: Room[]
  title: string
  sub: string
  /** The room's colour, underlining a room column's heading. Absent on a day column. */
  accent: string | undefined
  /** Which room a click on empty time proposes. In a day column, the first room still switched on. */
  defaultRoomId: number | null
  openMin: number
  closeMin: number
  closedAllDay: boolean
}

type CalEvent =
  | {
      kind: 'block'
      key: string
      roomId: number
      start: number
      end: number
      block: BookingBlock
    }
  | {
      kind: 'booking'
      key: string
      roomId: number
      start: number
      end: number
      booking: BookingRow
    }

type PlacedEvent = CalEvent & { lane: number; lanes: number }

interface DragState {
  columnKey: string
  /** The slot the drag began on, in minutes. May be AFTER `current` — dragging upwards is ordinary. */
  anchor: number
  current: number
}

/**
 * `minmax(0, 1fr)`, not `minmax(150px, 1fr)`, and that ONE change is what stops the sideways scroll.
 *
 * A minimum width makes the grid wider than its box as soon as there are enough columns, and the
 * container scrolls. With no floor the columns divide whatever there is, so a fortnight is thinner
 * than a week and both fit. The 31-day cap is what keeps "thinner" from becoming "unreadable".
 */
function gridTemplate(columnCount: number): string {
  return `56px repeat(${Math.max(columnCount, 1)}, minmax(0, 1fr))`
}

/**
 * Where an event sits, how tall it is, and which of its column's lanes it occupies.
 *
 * A MINIMUM HEIGHT OF 18px, because a 15-minute booking on a 56px hour is 14px tall and cannot hold
 * a line of text — it would be a coloured sliver with the guest's name clipped out of it. Better
 * slightly wrong geometry than an event nobody can read or reliably click.
 *
 * THE LANES ARE PERCENTAGES OF THE COLUMN and are set as logical insets, so four rooms busy at 10:00
 * sit side by side in reading order — left to right in English, right to left in Arabic.
 */
function eventStyle(
  event: PlacedEvent,
  toTop: (minutes: number) => number,
): { top: number; height: number; insetInlineStart: string; width: string } {
  const top = toTop(event.start)
  const height = toTop(event.end) - top
  const share = 100 / event.lanes

  return {
    top,
    height: Math.max(height, 18),
    insetInlineStart: `calc(${share * event.lane}% + 3px)`,
    width: `calc(${share}% - 6px)`,
  }
}
