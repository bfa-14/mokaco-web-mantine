import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Select, Textarea, TextInput } from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { notifications } from '@mantine/notifications'
import { getErrorMessage } from '../../api/errorMessage'
import { bookingsService } from '../../services/bookingService'
import type { RoomCatalog } from '../../types/booking'
import { hhmm, today, withSeconds } from './bookingShared'
import { addClock, formSpan } from './bookingTimes'

/**
 * Hold a room back: maintenance, a private event, a deep clean.
 *
 * A BLOCK IS NOT A BOOKING. It has no guest, no money and no status — it exists only to make the
 * room unbookable, which is why this dialog asks for so much less than the booking one.
 *
 * THE SERVER REFUSES TO BLOCK OVER LIVE BOOKINGS, and that refusal is the useful behaviour rather
 * than an obstacle: a block is not a way to evict guests. Its message ("Real bookings exist in that
 * period — cancel or move them first.") is shown verbatim, because it names the thing to do next.
 *
 * The reason is INTERNAL. It appears on the calendar and in the drawer for staff, and never reaches
 * the public availability feed — an anonymous visitor learns a slot is unavailable, not why.
 *
 * A BLOCK CAN RUN PAST MIDNIGHT (QA3 BKG-2): an end at or before the start is the next morning, up to
 * 06:00 — 23:00 → 01:00 blocks the last two hours of a room open until 01:00, as one block, on its
 * date. The server applies the same rule (booking.usp_Block_Add).
 */
export function BlockRoomModal({
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
  onCreated: () => void
  catalog: RoomCatalog
  initialRoomId?: number | null
  initialDate?: string | null
  initialStart?: string | null
  /** The end of a span dragged on the calendar. Absent for a plain click, which proposes an hour. */
  initialEnd?: string | null
}) {
  const { t } = useTranslation()

  const [roomId, setRoomId] = useState<number | null>(null)
  const [blockDate, setBlockDate] = useState(today())
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!opened) return

    setRoomId(initialRoomId ?? catalog.rooms.find((r) => r.isActive)?.roomId ?? null)
    setBlockDate(initialDate ?? today())
    setStartTime(initialStart ?? '09:00')
    setEndTime(initialEnd ?? (initialStart ? addClock(initialStart, 60) : '10:00'))
    setReason('')
    setError(null)
  }, [opened, initialRoomId, initialDate, initialStart, initialEnd, catalog.rooms])

  /** 23:00 → 01:00 is 1380–1500; null for no span (the same time twice, or an end after 06:00). */
  const span = formSpan(startTime, endTime)

  const missing = roomId == null || !blockDate || !span

  async function submit() {
    if (roomId == null || missing) return

    setSaving(true)
    setError(null)
    try {
      await bookingsService.createBlock({
        roomId,
        blockDate,
        startTime: withSeconds(startTime),
        endTime: withSeconds(endTime),
        reason: reason.trim() || null,
      })

      notifications.show({ message: t('booking.block.created'), color: 'green' })
      onCreated()
      onClose()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('booking.block.title')}
      size={440}
      centered
    >
      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <div className="form-grid">
        <div className="form-field full">
          <label className="form-label" htmlFor="bk-block-room">
            {t('booking.fields.room')}
          </label>
          <Select
            id="bk-block-room"
            data={catalog.rooms
              .filter((r) => r.isActive)
              .map((r) => ({ value: String(r.roomId), label: r.name }))}
            value={roomId == null ? null : String(roomId)}
            onChange={(value) => setRoomId(value ? Number(value) : null)}
            allowDeselect={false}
          />
        </div>

        <div className="form-field full">
          <label className="form-label" htmlFor="bk-block-date">
            {t('booking.fields.date')}
          </label>
          <TextInput
            id="bk-block-date"
            type="date"
            value={blockDate}
            onChange={(e) => setBlockDate(e.currentTarget.value)}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-block-start">
            {t('booking.fields.start')}
          </label>
          <TextInput
            id="bk-block-start"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.currentTarget.value)}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-block-end">
            {t('booking.fields.end')}
          </label>
          <TextInput
            id="bk-block-end"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.currentTarget.value)}
          />
        </div>

        {!span && (
          <div className="form-field full">
            <div className="hint">{t('booking.new.endAfterStart')}</div>
          </div>
        )}
        {span && span.end > 1440 && (
          <div className="form-field full">
            <div className="hint">
              {t('booking.new.nextMorning', { end: hhmm(endTime), hours: (span.end - span.start) / 60 })}
            </div>
          </div>
        )}

        <div className="form-field full">
          <label className="form-label" htmlFor="bk-block-reason">
            {t('booking.block.reason')} {t('common.optional')}
          </label>
          <Textarea
            id="bk-block-reason"
            minRows={2}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            maxLength={200}
          />
          <div className="hint">{t('booking.block.reasonHint')}</div>
        </div>
      </div>

      <div className="form-actions">
        <Button variant="default" onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={submit} loading={saving} disabled={missing}>
          {t('booking.block.submit')}
        </Button>
      </div>
    </Modal>
  )
}
