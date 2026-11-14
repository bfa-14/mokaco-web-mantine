import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Loader, Textarea } from '@mantine/core'
import { DateTimePicker } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconCalendar, IconCheck, IconX } from '@tabler/icons-react'
import { Modal } from '../../components/dialogs'
import { dateTimeToPicker, secondsDateTimeFromPicker } from '../../components/date/pickerValue'
import { ApiError } from '../../api/client'
import { getErrorMessage } from '../../api/errorMessage'
import { dayReportsService } from '../../services/attendanceService'
import type { DayReport } from '../../types/attendance'
import { useLive } from '../../live/useLive'
import { useLiveEnabled } from '../../live/useLiveSettings'
import { formatDayLabel, formatMinutes, formatTime, statusText } from './attendanceFormat'

/** The server's own sentence, also for a 403 (the generic "no permission" hides who may report what). */
function refusal(err: unknown): string {
  return err instanceof ApiError && err.message ? err.message : getErrorMessage(err)
}

/**
 * "SOMETHING IS WRONG WITH THIS DAY": the real times and a message, sent to HR. Nothing changes until HR accepts
 * (it then becomes an approved correction). `employeeId` null = the signed-in person's own day.
 */
export function ReportDayDialog({
  employeeId,
  employeeName,
  workDate,
  currentIn,
  currentOut,
  onClose,
  onSent,
}: {
  employeeId: number | null
  employeeName: string
  workDate: string
  currentIn: string | null
  currentOut: string | null
  onClose: () => void
  onSent: () => void
}) {
  const { t } = useTranslation()
  const day = workDate.slice(0, 10)
  const [timeIn, setTimeIn] = useState<string | null>(currentIn)
  const [timeOut, setTimeOut] = useState<string | null>(currentOut)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    if (!message.trim()) {
      setError(t('attendance.dayReport.messageRequired'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await dayReportsService.create({
        employeeId,
        workDate: day,
        // Only what was changed is a claim; an untouched time is what the day already says.
        claimedIn: timeIn !== currentIn ? timeIn : null,
        claimedOut: timeOut !== currentOut ? timeOut : null,
        message: message.trim(),
      })
      notifications.show({
        message: t(employeeId == null ? 'attendance.dayReport.sent' : 'attendance.dayReport.sentForOther'),
        color: 'green',
        autoClose: 4000,
      })
      onSent()
      onClose()
    } catch (err) {
      setError(refusal(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      opened
      onClose={() => !saving && onClose()}
      title={t('attendance.dayReport.title', { name: employeeName, date: formatDayLabel(day) })}
      size={480}
      centered
      closeOnClickOutside={!saving}
    >
      <p className="hint" style={{ marginTop: 0 }}>
        {currentIn || currentOut
          ? t('attendance.dayReport.now', { in: formatTime(currentIn), out: formatTime(currentOut) })
          : t('attendance.dayReport.nowNone')}
      </p>
      <div className="form-grid">
        <div className="form-field">
          <label className="form-label" htmlFor="report-in">
            {t('attendance.dayReport.realIn')}
          </label>
          <DateTimePicker
            id="report-in"
            valueFormat="DD/MM/YYYY HH:mm"
            leftSection={<IconCalendar size={14} />}
            clearable
            value={dateTimeToPicker(timeIn)}
            defaultDate={day}
            disabled={saving}
            onChange={(v) => setTimeIn(secondsDateTimeFromPicker(v))}
          />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="report-out">
            {t('attendance.dayReport.realOut')}
          </label>
          <DateTimePicker
            id="report-out"
            valueFormat="DD/MM/YYYY HH:mm"
            leftSection={<IconCalendar size={14} />}
            clearable
            value={dateTimeToPicker(timeOut)}
            defaultDate={day}
            disabled={saving}
            onChange={(v) => setTimeOut(secondsDateTimeFromPicker(v))}
          />
        </div>
      </div>
      <div className="form-field">
        <label className="form-label" htmlFor="report-message">
          {t('attendance.dayReport.message')}
        </label>
        <Textarea
          id="report-message"
          minRows={3}
          maxLength={400}
          placeholder={t('attendance.dayReport.messagePlaceholder')}
          value={message}
          disabled={saving}
          onChange={(e) => {
            setMessage(e.currentTarget.value)
            setError(null)
          }}
        />
      </div>
      <p className="hint">{t('attendance.dayReport.hint')}</p>
      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        <Button variant="default" onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void send()} loading={saving}>
          {t('attendance.dayReport.send')}
        </Button>
      </div>
    </Modal>
  )
}

/** A report's state in a few words, for the reporter. */
export function reportStateText(report: DayReport, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (report.status) {
    case 'Open':
      return t('attendance.dayReport.state.open')
    case 'Accepted':
      return t('attendance.dayReport.state.accepted', { by: report.decidedBy ?? '' })
    case 'Rejected':
      return report.decisionNote
        ? t('attendance.dayReport.state.rejectedNote', { by: report.decidedBy ?? '', note: report.decisionNote })
        : t('attendance.dayReport.state.rejected', { by: report.decidedBy ?? '' })
    case 'Withdrawn':
      return t('attendance.dayReport.state.withdrawn')
  }
}

/**
 * HR'S QUEUE (Anomalies > Reported days): each report beside what the day says now. Accept writes the reported
 * times as an approved correction (one click); Reject asks for the note the reporter will read.
 */
export function DayReportsQueue({ onCount }: { onCount?: (open: number) => void }) {
  const { t } = useTranslation()
  const [reports, setReports] = useState<DayReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showDecided, setShowDecided] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [rejecting, setRejecting] = useState<DayReport | null>(null)
  const [note, setNote] = useState('')
  const [rejectError, setRejectError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await dayReportsService.queue()
      setReports(list)
      setError(null)
      onCount?.(list.filter((r) => r.status === 'Open').length)
    } catch (err) {
      setError(refusal(err))
    }
  }, [onCount])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])
  useLive(['attendance'], () => void load(), useLiveEnabled('attendance'))

  async function accept(report: DayReport) {
    setBusy(report.reportId)
    try {
      await dayReportsService.decide(report.reportId, true)
      notifications.show({
        message: t('attendance.dayReport.accepted', { name: report.employeeName, date: formatDayLabel(report.workDate) }),
        color: 'green',
        autoClose: 4000,
      })
      await load()
    } catch (err) {
      notifications.show({ message: refusal(err), color: 'red', autoClose: 8000 })
    } finally {
      setBusy(null)
    }
  }

  async function reject() {
    if (!rejecting) return
    if (!note.trim()) {
      setRejectError(t('attendance.dayReport.rejectNoteRequired'))
      return
    }
    setBusy(rejecting.reportId)
    try {
      await dayReportsService.decide(rejecting.reportId, false, note.trim())
      notifications.show({ message: t('attendance.dayReport.rejected', { name: rejecting.employeeName }), color: 'green', autoClose: 4000 })
      setRejecting(null)
      await load()
    } catch (err) {
      setRejectError(refusal(err))
    } finally {
      setBusy(null)
    }
  }

  if (error)
    return (
      <div className="alert alert--error" role="alert">
        {error}
      </div>
    )
  if (!reports)
    return (
      <div className="page-loading">
        <Loader size={32} />
      </div>
    )

  const open = reports.filter((r) => r.status === 'Open')
  const shown = showDecided ? reports : open
  return (
    <div className="card">
      <div className="tab-toolbar">
        <div className="empty-hint-main">
          {open.length === 0 ? t('attendance.dayReport.queueNone') : t('attendance.dayReport.queueTitle', { count: open.length })}
        </div>
        <Checkbox
          label={t('attendance.dayReport.showDecided')}
          checked={showDecided}
          onChange={(e) => setShowDecided(e.currentTarget.checked)}
        />
      </div>
      <p className="hint">{t('attendance.dayReport.queueHint')}</p>
      <div className="unrostered-list">
        {shown.map((r) => (
          <div key={r.reportId} className={r.status === 'Open' ? 'unrostered-day' : 'unrostered-day unrostered-day--closed'}>
            <div className="unrostered-who">
              <span className="unrostered-name">{r.employeeName}</span>
              <span className="hint">{r.branchName}</span>
            </div>
            <div className="unrostered-facts">
              <span className="unrostered-date">{formatDayLabel(r.workDate)}</span>
              <span className="hint">
                {t('attendance.dayReport.dayNow', {
                  status: r.currentStatus ? statusText(r.currentStatus) : t('attendance.dayReport.noRecord'),
                  in: formatTime(r.currentFirstIn),
                  out: formatTime(r.currentLastOut),
                  worked: formatMinutes(r.currentWorkedMinutes ?? 0),
                })}
              </span>
              <span>
                <b>
                  {t('attendance.dayReport.claimed', {
                    in: r.claimedIn ? formatTime(r.claimedIn) : t('attendance.dayReport.unchanged'),
                    out: r.claimedOut ? formatTime(r.claimedOut) : t('attendance.dayReport.unchanged'),
                  })}
                </b>
              </span>
              <span className="hint unrostered-note">
                “{r.message}” — {r.reportedBy}
              </span>
              {r.status !== 'Open' && <span className="hint">{reportStateText(r, t)}</span>}
            </div>
            <div className="unrostered-actions">
              {r.status === 'Open' && r.canDecide && (
                <>
                  <Button
                    size="compact-sm"
                    leftSection={<IconCheck size={14} />}
                    loading={busy === r.reportId}
                    disabled={!r.attendanceId || (!r.claimedIn && !r.claimedOut)}
                    title={
                      !r.attendanceId
                        ? t('attendance.dayReport.acceptNoRecord')
                        : !r.claimedIn && !r.claimedOut
                          ? t('attendance.dayReport.acceptNoTimes')
                          : t('attendance.dayReport.acceptTitle')
                    }
                    onClick={() => void accept(r)}
                  >
                    {t('attendance.dayReport.accept')}
                  </Button>
                  <Button
                    size="compact-sm"
                    variant="default"
                    leftSection={<IconX size={14} />}
                    disabled={busy === r.reportId}
                    onClick={() => {
                      setRejecting(r)
                      setNote('')
                      setRejectError(null)
                    }}
                  >
                    {t('attendance.dayReport.reject')}
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {rejecting && (
        <Modal
          opened
          onClose={() => busy === null && setRejecting(null)}
          title={t('attendance.dayReport.rejectTitle', { name: rejecting.employeeName, date: formatDayLabel(rejecting.workDate) })}
          size={460}
          centered
        >
          <div className="form-field">
            <label className="form-label" htmlFor="reject-note">
              {t('attendance.dayReport.rejectNote')}
            </label>
            <Textarea
              id="reject-note"
              minRows={3}
              maxLength={400}
              value={note}
              onChange={(e) => {
                setNote(e.currentTarget.value)
                setRejectError(null)
              }}
            />
          </div>
          {rejectError && (
            <div className="alert alert--error" role="alert">
              {rejectError}
            </div>
          )}
          <div className="form-actions">
            <Button variant="default" onClick={() => setRejecting(null)} disabled={busy !== null}>
              {t('common.cancel')}
            </Button>
            <Button color="red" onClick={() => void reject()} loading={busy !== null}>
              {t('attendance.dayReport.reject')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
