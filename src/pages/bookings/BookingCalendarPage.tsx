import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionIcon, Button, Loader, SegmentedControl, Select } from '@mantine/core'
import {
  IconChevronLeft,
  IconChevronRight,
  IconLock,
  IconPlus,
} from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { getErrorMessage } from '../../api/errorMessage'
import { PageHelp } from '../../components/PageHelp'
import { bookingsService, roomsService } from '../../services/bookingService'
import type {
  BookingBlock,
  BookingRow,
  Room,
  RoomCatalog,
  RoomHours,
} from '../../types/booking'
import {
  addDays,
  dayLabel,
  dayOfWeek,
  fromMinutes,
  hhmm,
  isStruck,
  minutesOf,
  PERMISSIONS,
  PIXELS_PER_HOUR,
  startOfWeek,
  STATUS_CLASS,
  statusLabel,
  today,
  visibleWindow,
  weekDays,
  weekdayName,
} from './bookingShared'
import { BookingDrawer } from './BookingDrawer'
import { NewBookingModal } from './NewBookingModal'
import { BlockRoomModal } from './BlockRoomModal'
import './bookings.css'

/**
 * The room calendar — the page this whole area exists for.
 *
 * WHY IT IS ABSOLUTE POSITIONING AND NOT A CSS GRID. A booking is a span of MINUTES. 10:30–12:15
 * has to begin and end where it actually does, and a grid quantised to the hour would round it into
 * something that is not true. So each (day, room) is a `position: relative` column of known height
 * and every event is placed from its own minutes; the hour rules behind it are decoration.
 *
 * ONE COLUMN PER ACTIVE ROOM, PER DAY IN VIEW. The day view is one day's worth of rooms; the week
 * view is the same columns repeated across seven days, grouped under a day heading. That is why the
 * room filter matters more than it looks — it is what turns a 28-column week into a 7-column one.
 *
 * BLOCKS ARE DRAWN FROM THE SAME FETCH AND ARE NOT BOOKINGS. They are dark and hatched, they say
 * "Blocked", and they carry no status colour, because a block has no guest and no money and
 * colouring it like a status would invite the wrong action on it.
 *
 * THERE IS DELIBERATELY NO STATUS FILTER HERE, though the endpoint offers one. A calendar exists to
 * show what the room is doing, and hiding cancelled or completed bookings would leave time looking
 * free that somebody may still be standing in. The list page filters by status; this one shows the
 * day as it is.
 */
export default function BookingCalendarPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canView = hasPermission(PERMISSIONS.view)
  const canManage = hasPermission(PERMISSIONS.manage)

  const [mode, setMode] = useState<'week' | 'day'>('week')
  const [anchor, setAnchor] = useState(today())
  const [roomFilter, setRoomFilter] = useState<number | null>(null)

  const [catalog, setCatalog] = useState<RoomCatalog>({ rooms: [], hours: [], addons: [] })
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [blocks, setBlocks] = useState<BookingBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedBooking, setSelectedBooking] = useState<BookingRow | null>(null)
  const [selectedBlock, setSelectedBlock] = useState<BookingBlock | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const [newOpen, setNewOpen] = useState(false)
  const [blockOpen, setBlockOpen] = useState(false)
  const [prefill, setPrefill] = useState<{
    roomId: number | null
    date: string | null
    start: string | null
  }>({ roomId: null, date: null, start: null })

  /** The days on screen: seven for a week, one for a day. */
  const days = useMemo(
    () => (mode === 'week' ? weekDays(anchor) : [anchor]),
    [mode, anchor],
  )

  const rangeFrom = days[0]
  const rangeTo = days[days.length - 1]

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

  const load = useCallback(async () => {
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
    }
  }, [rangeFrom, rangeTo, roomFilter])

  useEffect(() => {
    if (!canView) return
    void load()
  }, [canView, load])

  /** Active rooms, narrowed by the filter. Retired rooms never get a column — nothing can be booked in one. */
  const columnsRooms: Room[] = useMemo(
    () =>
      catalog.rooms
        .filter((room) => room.isActive)
        .filter((room) => roomFilter == null || room.roomId === roomFilter),
    [catalog.rooms, roomFilter],
  )

  /** Hours for the rooms and weekdays actually on screen — the window is computed from these. */
  const relevantHours: RoomHours[] = useMemo(() => {
    const roomIds = new Set(columnsRooms.map((r) => r.roomId))
    const dows = new Set(days.map(dayOfWeek))
    return catalog.hours.filter((h) => roomIds.has(h.roomId) && dows.has(h.dayOfWeek))
  }, [catalog.hours, columnsRooms, days])

  const viewWindow = useMemo(() => visibleWindow(relevantHours), [relevantHours])
  const totalMinutes = viewWindow.end - viewWindow.start
  const bodyHeight = (totalMinutes / 60) * PIXELS_PER_HOUR

  /** Minutes since midnight → pixels from the top of a column. */
  const toTop = useCallback(
    (minutes: number) => ((minutes - viewWindow.start) / 60) * PIXELS_PER_HOUR,
    [viewWindow.start],
  )

  /** The hour marks drawn across every column. */
  const hourMarks = useMemo(() => {
    const marks: number[] = []
    for (let m = viewWindow.start; m <= viewWindow.end; m += 60) marks.push(m)
    return marks
  }, [viewWindow.start, viewWindow.end])

  /** The flat column list: every (day, room) pair, in reading order. */
  const columns = useMemo(
    () => days.flatMap((day) => columnsRooms.map((room) => ({ day, room }))),
    [days, columnsRooms],
  )

  const gridTemplateColumns = `64px repeat(${Math.max(columns.length, 1)}, minmax(150px, 1fr))`

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

  function openNewAt(roomId: number, day: string, startMinutes: number) {
    setPrefill({ roomId, date: day, start: fromMinutes(startMinutes) })
    setNewOpen(true)
  }

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
        <SegmentedControl
          value={mode}
          onChange={(value) => setMode(value as 'week' | 'day')}
          data={[
            { value: 'week', label: t('booking.calendar.week') },
            { value: 'day', label: t('booking.calendar.day') },
          ]}
        />

        <div className="form-field">
          <span className="form-label">{t('booking.calendar.period')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ActionIcon
              variant="default"
              aria-label={t('booking.calendar.prev')}
              onClick={() =>
                setAnchor((current) => addDays(current, mode === 'week' ? -7 : -1))
              }
            >
              <IconChevronLeft size={16} />
            </ActionIcon>
            <Button variant="default" onClick={() => setAnchor(today())}>
              {t('booking.calendar.today')}
            </Button>
            <ActionIcon
              variant="default"
              aria-label={t('booking.calendar.next')}
              onClick={() =>
                setAnchor((current) => addDays(current, mode === 'week' ? 7 : 1))
              }
            >
              <IconChevronRight size={16} />
            </ActionIcon>
            <strong style={{ marginInlineStart: 6 }}>
              {mode === 'week'
                ? `${dayLabel(startOfWeek(anchor))} – ${dayLabel(addDays(startOfWeek(anchor), 6))}`
                : `${weekdayName(anchor)} ${dayLabel(anchor)}`}
            </strong>
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-room-filter">
            {t('booking.fields.room')}
          </label>
          <Select
            id="bk-room-filter"
            w={200}
            data={[
              { value: '', label: t('booking.calendar.allRooms') },
              ...catalog.rooms
                .filter((room) => room.isActive)
                .map((room) => ({ value: String(room.roomId), label: room.name })),
            ]}
            value={roomFilter == null ? '' : String(roomFilter)}
            onChange={(value) => setRoomFilter(value ? Number(value) : null)}
            allowDeselect={false}
          />
        </div>

        {canManage && (
          <div className="bk-toolbar-spacer" style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="default"
              leftSection={<IconLock size={16} />}
              onClick={() => {
                setPrefill({ roomId: roomFilter, date: anchor, start: null })
                setBlockOpen(true)
              }}
            >
              {t('booking.calendar.blockRoom')}
            </Button>
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => {
                setPrefill({ roomId: roomFilter, date: anchor, start: null })
                setNewOpen(true)
              }}
            >
              {t('booking.calendar.newBooking')}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : columnsRooms.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">{t('booking.calendar.noRooms')}</div>
            {t('booking.calendar.noRoomsHint')}
          </div>
        </div>
      ) : (
        <div className="bk-cal">
          {/* Header. In the week view a day heading spans that day's rooms, so twenty-eight columns
              still read as seven days rather than as one long strip of room names. */}
          {mode === 'week' && (
            <div className="bk-cal-head" style={{ gridTemplateColumns }}>
              <div className="bk-cal-head-cell" />
              {days.map((day) => (
                <div
                  key={day}
                  className="bk-cal-head-cell"
                  style={{ gridColumn: `span ${columnsRooms.length}` }}
                >
                  {weekdayName(day)}
                  <span className="bk-cal-head-sub">{dayLabel(day)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="bk-cal-head" style={{ gridTemplateColumns }}>
            <div className="bk-cal-head-cell" />
            {columns.map(({ day, room }) => (
              <div key={`${day}-${room.roomId}`} className="bk-cal-head-cell">
                {room.name}
                <span className="bk-cal-head-sub">
                  {t('booking.calendar.seats', { count: room.seats })}
                </span>
              </div>
            ))}
          </div>

          <div className="bk-cal-body" style={{ gridTemplateColumns }}>
            {/* the clock gutter */}
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

            {columns.map(({ day, room }) => {
              const dow = dayOfWeek(day)
              const hours = catalog.hours.find(
                (h) => h.roomId === room.roomId && h.dayOfWeek === dow,
              )
              const closedAllDay = !hours || hours.isClosed
              const openMin = hours && !hours.isClosed ? minutesOf(hours.openTime) : 0
              const closeMin = hours && !hours.isClosed ? minutesOf(hours.closeTime) : 0

              const dayBookings = bookings.filter(
                (b) => b.roomId === room.roomId && b.bookDate.slice(0, 10) === day,
              )
              const dayBlocks = blocks.filter(
                (b) => b.roomId === room.roomId && b.blockDate.slice(0, 10) === day,
              )

              /* One click target per whole hour inside the opening window. Behind the events in the
                 stacking order, so a click on a booking always opens the booking. */
              const slots: number[] = []
              if (!closedAllDay && canManage) {
                for (
                  let m = Math.max(openMin, viewWindow.start);
                  m + 60 <= Math.min(closeMin, viewWindow.end);
                  m += 60
                ) {
                  slots.push(m)
                }
              }

              return (
                <div
                  key={`${day}-${room.roomId}`}
                  className="bk-cal-col"
                  style={{ height: bodyHeight }}
                >
                  {hourMarks.map((minutes) => (
                    <div
                      key={minutes}
                      className="bk-cal-rule"
                      style={{ top: toTop(minutes) }}
                    />
                  ))}

                  {/* Closed time, hatched. Either the whole column, or the strips before opening
                      and after closing. */}
                  {closedAllDay ? (
                    <div className="bk-cal-closed" style={{ top: 0, height: bodyHeight }} />
                  ) : (
                    <>
                      {openMin > viewWindow.start && (
                        <div
                          className="bk-cal-closed"
                          style={{ top: 0, height: toTop(openMin) }}
                        />
                      )}
                      {closeMin < viewWindow.end && (
                        <div
                          className="bk-cal-closed"
                          style={{
                            top: toTop(closeMin),
                            height: bodyHeight - toTop(closeMin),
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
                      style={{ top: toTop(minutes), height: PIXELS_PER_HOUR }}
                      title={t('booking.calendar.slotHint', {
                        room: room.name,
                        time: fromMinutes(minutes),
                      })}
                      onClick={() => openNewAt(room.roomId, day, minutes)}
                    />
                  ))}

                  {dayBlocks.map((blockRow) => (
                    <button
                      key={`block-${blockRow.blockId}`}
                      type="button"
                      className="bk-ev bk-ev--block"
                      style={eventStyle(blockRow.startTime, blockRow.endTime, toTop)}
                      onClick={() => openBlock(blockRow)}
                      title={blockRow.reason ?? t('booking.calendar.blocked')}
                    >
                      <span className="bk-ev-badge">{t('booking.calendar.blocked')}</span>
                      <span className="bk-ev-name">
                        {hhmm(blockRow.startTime)}–{hhmm(blockRow.endTime)}
                      </span>
                    </button>
                  ))}

                  {dayBookings.map((row) => (
                    <button
                      key={`bk-${row.bookingId}`}
                      type="button"
                      className={`bk-ev ${STATUS_CLASS[row.status]}${
                        isStruck(row.status) ? ' bk-ev--struck' : ''
                      }`}
                      style={eventStyle(row.startTime, row.endTime, toTop)}
                      onClick={() => openBooking(row)}
                      title={`${row.guestName} · ${statusLabel(row.status)}`}
                    >
                      <span className="bk-ev-time">
                        {hhmm(row.startTime)}–{hhmm(row.endTime)}
                      </span>
                      <span className="bk-ev-name">{row.guestName}</span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="bk-legend">
        {(['Pending', 'Confirmed', 'Completed', 'Cancelled'] as const).map((status) => (
          <span className="bk-legend-item" key={status}>
            <span className={`bk-legend-swatch ${STATUS_CLASS[status]}`} />
            {statusLabel(status)}
          </span>
        ))}
        <span className="bk-legend-item">
          <span className="bk-legend-swatch bk-ev--block" />
          {t('booking.calendar.blocked')}
        </span>
      </div>

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
      />

      <BlockRoomModal
        opened={blockOpen}
        onClose={() => setBlockOpen(false)}
        onCreated={load}
        catalog={catalog}
        initialRoomId={prefill.roomId}
        initialDate={prefill.date}
        initialStart={prefill.start}
      />
    </div>
  )
}

/**
 * Where an event sits and how tall it is.
 *
 * A MINIMUM HEIGHT OF 18px, because a 15-minute booking on a 56px hour is 14px tall and cannot hold
 * a line of text — it would be a coloured sliver with the guest's name clipped out of it. Better
 * slightly wrong geometry than an event nobody can read or reliably click.
 */
function eventStyle(
  start: string,
  end: string,
  toTop: (minutes: number) => number,
): { top: number; height: number } {
  const top = toTop(minutesOf(start))
  const height = toTop(minutesOf(end)) - top
  return { top, height: Math.max(height, 18) }
}
