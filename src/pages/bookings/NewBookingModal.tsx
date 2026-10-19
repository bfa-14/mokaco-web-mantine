import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { emailError } from '../../components/contact'
import {
  Button,
  Checkbox,
  NumberInput,
  Select,
  Textarea,
  TextInput,
} from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { notifications } from '@mantine/notifications'
import { getErrorMessage } from '../../api/errorMessage'
import { bookingsService } from '../../services/bookingService'
import { FormErrorBoundary } from '../workflow/FormErrorBoundary'
import type { RoomCatalog, StaffQuote } from '../../types/booking'
import {
  dayOfWeek,
  hhmm,
  money,
  today,
  weekdayName,
  withSeconds,
} from './bookingShared'
import { addClock, closeMinOf, formSpan } from './bookingTimes'
import { latestOnly } from './latestOnly'

/**
 * Take a booking by hand — the manual half of the same procedure the website posts to.
 *
 * THE PRICE SHOWN IS THE SERVER'S QUOTE (WEB-9 / QA3 BKG-10). The form used to work out rate × hours
 * and the room's flat deposit percentage itself, so it showed 60.00 with a 25 % deposit where the
 * booking then stored 54.00 (the three-hour discount) with 50 % (the short-notice tier). It now asks
 * POST /api/bookings/quote — the same procedure the booking is priced by — a moment after the room,
 * date, times or add-ons change, and shows only the answer for what is on the form now (a sequence
 * number drops a late answer). A slot the server would refuse shows its sentence instead.
 *
 * THE NIGHT RUNS PAST MIDNIGHT (QA3 BKG-2): an end at or before the start is the next morning, up to
 * 06:00 — 22:00 → 01:00 is a three-hour booking, as the API reads it — and a start after midnight is
 * the NEXT date's (the calendar fills the date in when such a slot is clicked).
 *
 * OPENING HOURS ARE OFFERED, NOT ENFORCED. The day's open/close are pushed into the time inputs as
 * min/max (only when the room closes the same day: 07:00–01:00 is no range a time input can hold) and
 * named in a hint, because a form that lets you type 03:00 and then refuses is worse than one that
 * steers. The actual refusal is still the server's — the room could be closed, the slot taken a second
 * ago, or the length outside the room's min/max — and it arrives as a sentence this dialog shows
 * verbatim.
 *
 * ADD-ONS ARE A Checkbox.Group, NOT ONE HANDLER PER BOX. Mantine hands the group's onChange the full
 * list of checked values, so there is no event object to read late. The first version read
 * `e.currentTarget.checked` INSIDE a setState updater, by which point React had released the
 * synthetic event and currentTarget was null — one tick on a box took the whole page down. The
 * general rule for every handler in here: read the event synchronously, never inside a deferred
 * callback.
 *
 * THE BODY SITS IN A FormErrorBoundary so a future render error of that kind is shown INSIDE the
 * dialog — message and component stack — instead of unmounting the calendar behind it. The key
 * advances on every open, so a caught crash is cleared by closing and reopening.
 */
export function NewBookingModal({
  opened,
  onClose,
  onCreated,
  catalog,
  initialRoomId,
  initialDate,
  initialStart,
  initialEnd,
}: {
  opened: boolean
  onClose: () => void
  /** Fired after a successful create so the calendar can refetch. */
  onCreated: () => void
  catalog: RoomCatalog
  /** Prefilled when the dialog was opened by clicking an empty slot. */
  initialRoomId?: number | null
  initialDate?: string | null
  initialStart?: string | null
  /** The end of a span DRAGGED on the calendar. Absent for a plain click, which proposes an hour. */
  initialEnd?: string | null
}) {
  const { t } = useTranslation()

  const [roomId, setRoomId] = useState<number | null>(null)
  const [bookDate, setBookDate] = useState(today())
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [persons, setPersons] = useState<number>(1)
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [note, setNote] = useState('')
  const [addonIds, setAddonIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Bumped on every open: the error boundary's reset key, so a caught crash does not outlive it. */
  const [openSeq, setOpenSeq] = useState(0)

  /* Re-seed every time the dialog OPENS. A dialog that kept the previous guest's name because it
     was never unmounted is the classic version of this bug; the reset is keyed on `opened` rather
     than on the caller remembering to clear anything. */
  useEffect(() => {
    if (!opened) return

    const firstActive = catalog.rooms.find((room) => room.isActive)?.roomId ?? null
    const room = initialRoomId ?? firstActive

    setRoomId(room)
    setBookDate(initialDate ?? today())
    setStartTime(initialStart ?? '09:00')
    setEndTime(initialEnd ?? (initialStart ? addClock(initialStart, 60) : '10:00'))
    setPersons(catalog.rooms.find((r) => r.roomId === room)?.minPersons ?? 1)
    setGuestName('')
    setGuestPhone('')
    setGuestEmail('')
    setNote('')
    setAddonIds([])
    setError(null)
    setOpenSeq((n) => n + 1)
    // Seeding on open is the point; the caller's prefill props are the deps that matter.
  }, [opened, initialRoomId, initialDate, initialStart, initialEnd, catalog.rooms])

  const room = catalog.rooms.find((r) => r.roomId === roomId) ?? null

  /** The chosen room's hours for the chosen weekday — what the time inputs are bounded by. */
  const dayHours = useMemo(() => {
    if (!room) return null
    const dow = dayOfWeek(bookDate)
    return catalog.hours.find((h) => h.roomId === room.roomId && h.dayOfWeek === dow) ?? null
  }, [room, bookDate, catalog.hours])

  const roomAddons = useMemo(
    () => catalog.addons.filter((a) => a.roomId === roomId && a.isActive),
    [catalog.addons, roomId],
  )

  /** The span the times mean — 22:00 → 01:00 is 1320–1500 — or null when they mean none. */
  const span = formSpan(startTime, endTime)

  /** Does the chosen day close after midnight? Then the time inputs carry no min/max. */
  const closesNextMorning =
    !!dayHours && !dayHours.isClosed && closeMinOf(dayHours.closeTime) >= 1440

  /* ── the server's price (see the class remark) ─────────────────────────────────────────────── */

  const addonKey = addonIds
    .slice()
    .sort((a, b) => a - b)
    .join(',')
  /** What is on the form now, as one string — a quote is shown only for the key it was asked for. */
  const quoteKey =
    opened && roomId != null && bookDate && span
      ? `${roomId}|${bookDate}|${startTime}|${endTime}|${addonKey}`
      : null
  const [priced, setPriced] = useState<{
    key: string
    quote: StaffQuote | null
    error: string | null
  } | null>(null)
  const [quoteLatest] = useState(latestOnly)

  useEffect(() => {
    if (quoteKey == null || roomId == null) return
    const isLatest = quoteLatest.begin()
    const timer = window.setTimeout(() => {
      bookingsService
        .quote({
          roomId,
          bookDate,
          startTime: withSeconds(startTime),
          endTime: withSeconds(endTime),
          addonIds: addonKey ? addonKey.split(',').map(Number) : [],
        })
        .then((quote) => {
          if (isLatest()) setPriced({ key: quoteKey, quote, error: null })
        })
        .catch((err) => {
          if (isLatest()) setPriced({ key: quoteKey, quote: null, error: getErrorMessage(err) })
        })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [quoteKey, roomId, bookDate, startTime, endTime, addonKey, quoteLatest])

  /** The answer for what is on the form NOW; anything else is not shown. */
  const current = priced && priced.key === quoteKey ? priced : null

  const missing =
    !room ||
    !bookDate ||
    !span ||
    persons < 1 ||
    guestName.trim() === '' ||
    guestPhone.trim() === ''

  async function submit() {
    if (!room || missing) return
    // The optional address, when given, must be one — same rule as the employee form (contact.ts).
    if (emailError(guestEmail, false)) {
      setError(t('booking.new.emailInvalid'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const created = await bookingsService.createManual({
        roomId: room.roomId,
        bookDate,
        startTime: withSeconds(startTime),
        endTime: withSeconds(endTime),
        persons,
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim(),
        guestEmail: guestEmail.trim() || null,
        note: note.trim() || null,
        addonIds,
      })

      notifications.show({
        message: t('booking.new.created', {
          id: created.bookingId,
          total: money(created.totalAmount, created.currencyCode),
        }),
        color: 'green',
      })
      onCreated()
      onClose()
    } catch (err) {
      // The procedure's own sentence — "That time was just taken", "Mokha takes 2 to 6 persons".
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('booking.new.title')}
      size={560}
      centered
    >
      <FormErrorBoundary resetKey={String(openSeq)}>
        {error && (
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        )}

        <div className="form-grid">
          <div className="form-field full">
            <label className="form-label" htmlFor="bk-new-room">
              {t('booking.fields.room')}
            </label>
            <Select
              id="bk-new-room"
              data={catalog.rooms
                .filter((r) => r.isActive)
                .map((r) => ({ value: String(r.roomId), label: r.name }))}
              value={roomId == null ? null : String(roomId)}
              onChange={(value) => {
                const next = value ? Number(value) : null
                setRoomId(next)
                // The add-on list belongs to the room, so a room change invalidates the selection
                // rather than silently carrying ids the new room will ignore.
                setAddonIds([])
                const nextRoom = catalog.rooms.find((r) => r.roomId === next)
                if (nextRoom) setPersons(nextRoom.minPersons)
              }}
              allowDeselect={false}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="bk-new-date">
              {t('booking.fields.date')}
            </label>
            <TextInput
              id="bk-new-date"
              type="date"
              value={bookDate}
              onChange={(e) => setBookDate(e.currentTarget.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="bk-new-persons">
              {t('booking.fields.persons')}
            </label>
            <NumberInput
              id="bk-new-persons"
              min={1}
              max={room?.seats}
              value={persons}
              onChange={(v) => setPersons(typeof v === 'number' ? v : 1)}
            />
            {room && (
              <div className="hint">
                {t('booking.new.personsHint', {
                  min: room.minPersons,
                  max: room.seats,
                })}
              </div>
            )}
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="bk-new-start">
              {t('booking.fields.start')}
            </label>
            <TextInput
              id="bk-new-start"
              type="time"
              value={startTime}
              min={dayHours && !dayHours.isClosed && !closesNextMorning ? hhmm(dayHours.openTime) : undefined}
              max={dayHours && !dayHours.isClosed && !closesNextMorning ? hhmm(dayHours.closeTime) : undefined}
              onChange={(e) => setStartTime(e.currentTarget.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="bk-new-end">
              {t('booking.fields.end')}
            </label>
            <TextInput
              id="bk-new-end"
              type="time"
              value={endTime}
              min={dayHours && !dayHours.isClosed && !closesNextMorning ? hhmm(dayHours.openTime) : undefined}
              max={dayHours && !dayHours.isClosed && !closesNextMorning ? hhmm(dayHours.closeTime) : undefined}
              onChange={(e) => setEndTime(e.currentTarget.value)}
            />
          </div>

          <div className="form-field full">
            {/* `dayHours` is re-tested rather than leaning on `closedDay`: a boolean derived from a
                nullable does not narrow it, so the compiler still needs to see the check here. */}
            {dayHours && !dayHours.isClosed ? (
              <div className="hint">
                {t(closesNextMorning ? 'booking.new.hoursHintNextMorning' : 'booking.new.hoursHint', {
                  day: weekdayName(bookDate),
                  open: hhmm(dayHours.openTime),
                  close: hhmm(dayHours.closeTime),
                })}
              </div>
            ) : (
              <div className="hint">
                {t('booking.new.closedDay', { day: weekdayName(bookDate) })}
              </div>
            )}
            {!span && (
              <div className="hint">{t('booking.new.endAfterStart')}</div>
            )}
            {span && span.end > 1440 && (
              <div className="hint">
                {t('booking.new.nextMorning', {
                  end: hhmm(endTime),
                  hours: (span.end - span.start) / 60,
                })}
              </div>
            )}
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="bk-new-name">
              {t('booking.fields.guest')}
            </label>
            <TextInput
              id="bk-new-name"
              value={guestName}
              onChange={(e) => setGuestName(e.currentTarget.value)}
              maxLength={120}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="bk-new-phone">
              {t('booking.fields.phone')}
            </label>
            <TextInput
              id="bk-new-phone"
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.currentTarget.value)}
              maxLength={30}
            />
          </div>

          <div className="form-field full">
            <label className="form-label" htmlFor="bk-new-email">
              {t('booking.fields.email')} {t('common.optional')}
            </label>
            <TextInput
              id="bk-new-email"
              type="email"
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.currentTarget.value)}
              maxLength={150}
            />
            <div className="hint">{t('booking.new.emailHint')}</div>
          </div>

          <div className="form-field full">
            <label className="form-label" htmlFor="bk-new-note">
              {t('booking.fields.note')} {t('common.optional')}
            </label>
            <Textarea
              id="bk-new-note"
              minRows={2}
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
              maxLength={500}
            />
          </div>

          {roomAddons.length > 0 && (
            <div className="form-field full">
              <span className="form-label">{t('booking.fields.addons')}</span>
              {/* Checkbox values are strings by contract; the ids are numbers everywhere else
                  (state, preview, payload), so the conversion lives here and only here. */}
              <Checkbox.Group
                value={addonIds.map(String)}
                onChange={(values) => setAddonIds(values.map(Number))}
              >
                {roomAddons.map((addon) => (
                  <Checkbox
                    key={addon.addonId}
                    mt={6}
                    value={String(addon.addonId)}
                    label={
                      addon.priceType === 'PerHour'
                        ? t('booking.new.addonPerHour', {
                            name: addon.name,
                            price: money(addon.price, room?.currencyCode ?? ''),
                          })
                        : t('booking.new.addonFixed', {
                            name: addon.name,
                            price: money(addon.price, room?.currencyCode ?? ''),
                          })
                    }
                  />
                ))}
              </Checkbox.Group>
            </div>
          )}

          {quoteKey != null && (
            <div className="form-field full" aria-live="polite">
              {current?.quote ? (
                <>
                  {current.quote.discountAmount > 0 && (
                    <div className="bk-money-row">
                      <span>
                        {t('booking.new.discount', {
                          percent: current.quote.discountPercent,
                          hours: current.quote.hours,
                        })}
                      </span>
                      <span>−{money(current.quote.discountAmount, current.quote.currencyCode)}</span>
                    </div>
                  )}
                  <div className="bk-money-row bk-money-row--total">
                    <span>{t('booking.fields.total')}</span>
                    <span>{money(current.quote.totalAmount, current.quote.currencyCode)}</span>
                  </div>
                  <div className="bk-money-row">
                    <span>
                      {t('booking.new.depositPercent', { percent: current.quote.depositPercent })}
                    </span>
                    <span>{money(current.quote.depositDue, current.quote.currencyCode)}</span>
                  </div>
                  <div className="hint">{t('booking.new.quoteHint')}</div>
                </>
              ) : current?.error ? (
                <div className="hint">{t('booking.new.quoteRefused', { reason: current.error })}</div>
              ) : (
                <div className="hint">{t('booking.new.quoting')}</div>
              )}
            </div>
          )}
        </div>

        <div className="form-actions">
          <Button variant="default" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={saving} disabled={missing}>
            {t('booking.new.submit')}
          </Button>
        </div>
      </FormErrorBoundary>
    </Modal>
  )
}
