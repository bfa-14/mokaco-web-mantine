import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Loader, Textarea } from '@mantine/core'
import { DateTimePicker } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconCalendar } from '@tabler/icons-react'
import { Modal } from '../../components/dialogs'
import { dateTimeToPicker, secondsDateTimeFromPicker } from '../../components/date/pickerValue'
import { getErrorMessage } from '../../api/errorMessage'
import { attendanceService } from '../../services/attendanceService'
import type { AttendanceAnomaly, AttendanceRecord } from '../../types/attendance'
import { describeAnomaly, formatDate, formatMinutes, formatTime } from './attendanceFormat'
import { findMissingAnomaly, missingSide, prefillTime } from './missingPunch'

/**
 * "ENTER THE MISSING TIME", from the day itself: one field, opened on the shift's time for the missing
 * side, saved at once as a Correct ruling on the day's missing-punch anomaly. When the day has no such
 * anomaly to rule on (already corrected, or the gap is not a plain missing In / Out), it says so and
 * offers the correction form instead.
 */
export function MissingPunchDialog({
  record,
  onClose,
  onSaved,
  onUseCorrection,
}: {
  record: AttendanceRecord
  onClose: () => void
  onSaved: () => Promise<void> | void
  /** The full correction form, for the day this dialog cannot fix. */
  onUseCorrection: () => void
}) {
  const { t } = useTranslation()
  const side = missingSide(record) ?? 'out'
  const day = record.workDate.slice(0, 10)
  const [anomaly, setAnomaly] = useState<AttendanceAnomaly | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [time, setTime] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    attendanceService
      .getAnomalies(day, day, false, record.branchId)
      .then((list) => {
        if (cancelled) return
        const found = findMissingAnomaly(list, record.attendanceId)
        setAnomaly(found)
        setTime(found ? prefillTime(found, side) : null)
      })
      .catch((err) => !cancelled && setLoadError(getErrorMessage(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [day, record.attendanceId, record.branchId, side])

  async function save() {
    if (!anomaly) return
    if (!time) {
      setError(t('attendance.anomalies.dialog.correctedTimeRequired'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await attendanceService.decideAnomaly(anomaly.anomalyId, {
        decision: 'Correct',
        correctedTime: time,
        note: note.trim() || null,
      })
      notifications.show({
        message: t('attendance.anomalies.saved.Corrected', {
          name: record.fullName,
          date: formatDate(record.workDate),
          worked: formatMinutes(result.workedMinutes),
        }),
        color: 'green',
        autoClose: 4000,
      })
      onClose()
      await onSaved()
    } catch (err) {
      // The procedure's own sentence ("must fall on the work date") belongs beside the field.
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      opened
      onClose={() => !saving && onClose()}
      title={t(side === 'in' ? 'attendance.missingPunch.titleIn' : 'attendance.missingPunch.titleOut', {
        name: record.fullName,
        date: formatDate(record.workDate),
      })}
      size={460}
      centered
      closeOnClickOutside={!saving}
    >
      <p className="hint" style={{ marginTop: 0 }}>
        {describeAnomaly(record)}
      </p>
      {loading ? (
        <div className="page-loading">
          <Loader size={28} />
        </div>
      ) : loadError ? (
        <div className="alert alert--error" role="alert">
          {loadError}
        </div>
      ) : !anomaly ? (
        <>
          <p className="hint">{t('attendance.missingPunch.noAnomaly')}</p>
          <div className="form-actions">
            <Button variant="default" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button onClick={onUseCorrection}>{t('attendance.missingPunch.useCorrection')}</Button>
          </div>
        </>
      ) : (
        <>
          {(anomaly.shiftStart || anomaly.shiftEnd) && (
            <p className="hint">
              {t('attendance.missingPunch.shift', {
                start: formatTime(anomaly.shiftStart),
                end: formatTime(anomaly.shiftEnd),
              })}
            </p>
          )}
          <div className="form-field">
            <label className="form-label" htmlFor="missing-punch-time">
              {t(side === 'in' ? 'attendance.anomalies.dialog.correctedIn' : 'attendance.anomalies.dialog.correctedOut')}
            </label>
            <DateTimePicker
              id="missing-punch-time"
              valueFormat="DD/MM/YYYY HH:mm"
              leftSection={<IconCalendar size={14} />}
              value={dateTimeToPicker(time)}
              disabled={saving}
              onChange={(v) => {
                setTime(secondsDateTimeFromPicker(v))
                setError(null)
              }}
            />
            <span className="hint">{t('attendance.missingPunch.timeHint')}</span>
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="missing-punch-note">
              {t('attendance.anomalies.dialog.note')}
            </label>
            <Textarea
              id="missing-punch-note"
              minRows={2}
              placeholder={t('attendance.missingPunch.notePlaceholder')}
              value={note}
              disabled={saving}
              onChange={(e) => setNote(e.currentTarget.value)}
            />
          </div>
          {error && (
            <div className="alert alert--error" role="alert">
              {error}
            </div>
          )}
          <div className="form-actions">
            <Button variant="default" onClick={onClose} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void save()} loading={saving}>
              {t('attendance.missingPunch.save')}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
