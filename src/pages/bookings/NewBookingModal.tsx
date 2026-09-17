import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import type { RoomCatalog } from '../../types/booking'
import {
  dayOfWeek,
  hhmm,
  minutesOf,
  money,
  today,
  weekdayName,
  withSeconds,
} from './bookingShared'

/**
 * Take a booking by hand — the manual half of the same procedure the website posts to.
 *
 * THE TOTAL IS PREVIEWED, NOT CALCULATED. What is shown here is a copy of the server's arithmetic,
 * run for the operator's benefit so they can quote a price before committing; the number that is
 * STORED is the one the procedure works out and returns. They agree today because the formula is
 * simple (rate × hours, plus add-ons, deposit is a percentage) — but where they ever disagree, the
 * server wins, and the confirmation notification quotes what came back rather than what was shown.
 *
 * OPENING HOURS ARE OFFERED, NOT ENFORCED. The day's open/close are pushed into the time inputs as
 * min/max and named in a hint, because a form that lets you type 03:00 and then refuses is worse
 * than one that steers. The actual refusal is still the server's — the room could be closed, the
 * slot taken a second ago, or the length outside the room's min/max — and it arrives as a sentence
 * this dialog shows verbatim.
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
    setEndTime(initialEnd ?? (initialStart ? shiftHour(initialStart) : '10:00'))
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

  /** Duration in hours. Negative or zero is a real state here — the form guards on it below. */
  const hours = (minutesOf(endTime) - minutesOf(startTime)) / 60

  /** The preview. See the class remark: an echo of the server's sum, not the source of it. */
  const preview = useMemo(() => {
    if (!room || hours <= 0) return null

    const addonTotal = roomAddons
      .filter((addon) => addonIds.includes(addon.addonId))
      .reduce(
        (sum, addon) =>
          sum +
          (addon.priceType === 'PerHour'
            ? round2(addon.price * hours)
            : addon.price),
        0,
      )

    const total = round2(room.pricePerHour * hours) + addonTotal
    return {
      total,
      deposit: round2((total * room.depositPercent) / 100),
      currency: room.currencyCode,
    }
  }, [room, hours, roomAddons, addonIds])

  const missing =
    !room ||
    !bookDate ||
    hours <= 0 ||
    persons < 1 ||
    guestName.trim() === '' ||
    guestPhone.trim() === ''

  async function submit() {
    if (!room || missing) return

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
              min={dayHours && !dayHours.isClosed ? hhmm(dayHours.openTime) : undefined}
              max={dayHours && !dayHours.isClosed ? hhmm(dayHours.closeTime) : undefined}
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
              min={dayHours && !dayHours.isClosed ? hhmm(dayHours.openTime) : undefined}
              max={dayHours && !dayHours.isClosed ? hhmm(dayHours.closeTime) : undefined}
              onChange={(e) => setEndTime(e.currentTarget.value)}
            />
          </div>

          <div className="form-field full">
            {/* `dayHours` is re-tested rather than leaning on `closedDay`: a boolean derived from a
                nullable does not narrow it, so the compiler still needs to see the check here. */}
            {dayHours && !dayHours.isClosed ? (
              <div className="hint">
                {t('booking.new.hoursHint', {
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
            {hours <= 0 && (
              <div className="hint">{t('booking.new.endAfterStart')}</div>
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

          {preview && (
            <div className="form-field full">
              <div className="bk-money-row bk-money-row--total">
                <span>{t('booking.fields.total')}</span>
                <span>{money(preview.total, preview.currency)}</span>
              </div>
              <div className="bk-money-row">
                <span>{t('booking.fields.deposit')}</span>
                <span>{money(preview.deposit, preview.currency)}</span>
              </div>
              <div className="hint">{t('booking.new.previewHint')}</div>
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

/** 'HH:mm' one hour later, clamped to 23:59 so a 23:30 slot still produces a valid end. */
function shiftHour(value: string): string {
  const total = Math.min(23 * 60 + 59, minutesOf(value) + 60)
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return `${`${hours}`.padStart(2, '0')}:${`${minutes}`.padStart(2, '0')}`
}

/** Money rounding, matching the procedure's ROUND(x, 2) so the preview does not drift by a cent. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}
