import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, Loader, Select, Table, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCalendarQuestion, IconCheck, IconListDetails, IconRotate } from '@tabler/icons-react'
import { Modal } from '../../components/dialogs'
import { ApiError } from '../../api/client'
import { getErrorMessage } from '../../api/errorMessage'
import { attendanceService, importService, shiftsService } from '../../services/attendanceService'
import type { RawPunch, Shift, UnrosteredDay, UnrosteredDecision } from '../../types/attendance'
import { useLanguage } from '../../i18n/useLanguage'
import { formatDayLabel, formatMinutes, formatTime, periodLabel } from './attendanceFormat'
import { rosterDayLink } from './rosterLink'
import {
  DECISION_NOTE_MAX,
  addBlockedBy,
  decisionNote,
  decisionProblem,
  inWorkOrder,
  punchDates,
  punchesOfDay,
  suggestShift,
} from './unrosteredDay'

/**
 * NOT ON ROSTER — days somebody punched on that the APPROVED roster of the month does not know.
 *
 * No attendance record exists for such a day, so the Days grid cannot show it: nothing is paid and
 * nothing is deducted until a PERSON says what the day was. This panel is where that is seen and
 * decided. The system proposes a shift; it never adds a roster row on a guess.
 *
 * WHO DECIDES is two permissions (today / past days) that the SERVER checks, with the branch, at the
 * moment of the decision. The panel shows the buttons from each row's `canDecide`, which the server
 * computed for the signed-in person, and keeps the server's own sentence when it refuses.
 *
 * A list, not a table: each day is a block that wraps, so on a phone the buttons sit under the day
 * they belong to instead of four screens to the right.
 */

/** The server's own sentence for a refusal. A 403 is normally collapsed to one generic line; here the
    procedure's sentence says WHICH permission is missing, which is the whole point of showing it. */
function refusalText(error: unknown): string {
  if (error instanceof ApiError && error.message) return error.message
  return getErrorMessage(error)
}

/** 'yyyy-MM-dd…' → ISO weekday 1 (Monday) … 7 (Sunday), the keys of common.weekday. */
function isoWeekday(date: string): number {
  const day = new Date(`${date.slice(0, 10)}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

function shiftLabel(shift: Shift): string {
  return `${shift.name} (${shift.startTime.slice(0, 5)}–${shift.endTime.slice(0, 5)})`
}

export function NotOnRosterPanel({
  days,
  error,
  onChanged,
  emptyMonth,
}: {
  /** null while the first read is still out. */
  days: UnrosteredDay[] | null
  error: string | null
  /** A decision was saved: the caller re-reads its lists (this one and whatever shows attendance days). */
  onChanged: () => void | Promise<void>
  /** Set on a page whose whole subject is this list: an empty month then says so. Unset = say nothing. */
  emptyMonth?: string
}) {
  const { t } = useTranslation()
  const { isRtl } = useLanguage()
  const [showDismissed, setShowDismissed] = useState(false)

  const ordered = useMemo(() => inWorkOrder(days ?? []), [days])
  const open = ordered.filter((day) => day.state === 'Open')
  const dismissed = ordered.filter((day) => day.state === 'Dismissed')
  const visible = showDismissed ? ordered : open

  /* ── the decision ── */

  const [target, setTarget] = useState<UnrosteredDay | null>(null)
  const [decision, setDecision] = useState<UnrosteredDecision | null>(null)
  const [shiftId, setShiftId] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  /* The shifts are read once, the first time a decision dialog opens: most visits decide nothing. */
  const [shifts, setShifts] = useState<Shift[] | null>(null)
  const [shiftsError, setShiftsError] = useState<string | null>(null)
  useEffect(() => {
    if (!target || shifts !== null) return
    let cancelled = false
    shiftsService
      .getAll()
      .then((list) => {
        if (!cancelled) setShifts(list)
      })
      .catch((err) => {
        if (!cancelled) setShiftsError(getErrorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [target, shifts])

  const activeShifts = useMemo(() => (shifts ?? []).filter((shift) => shift.isActive), [shifts])
  /** Proposed from the first punch. Only a proposal: it is pre-selected, and the person confirms it. */
  const proposed = useMemo(
    () => (target ? suggestShift(target.firstPunch, activeShifts) : null),
    [target, activeShifts],
  )
  const chosenShift = shiftId ?? proposed

  function openDecision(day: UnrosteredDay) {
    setTarget(day)
    // Adding is the common answer; when it is not possible the only choice left is pre-selected.
    setDecision(addBlockedBy(day) ? 'Dismiss' : 'Shift')
    setShiftId(null)
    setNote('')
    setDialogError(null)
  }

  async function submitDecision() {
    if (!target || !decision) return
    const sentShift = decision === 'Shift' ? chosenShift : null
    const problem = decisionProblem(decision, sentShift, note)
    if (problem) {
      setDialogError(t(problem === 'note' ? 'attendance.unrostered.noteRequired' : 'attendance.unrostered.shiftRequired'))
      return
    }
    setSaving(true)
    setDialogError(null)
    try {
      await attendanceService.decideUnrosteredDay({
        employeeId: target.employeeId,
        workDate: target.workDate.slice(0, 10),
        decision,
        shiftId: sentShift,
        note: decisionNote(note),
      })
      notifications.show({
        message: t(decision === 'Dismiss' ? 'attendance.unrostered.doneDismissed' : 'attendance.unrostered.doneAdded', {
          name: target.employeeName,
          date: formatDayLabel(target.workDate),
        }),
        color: 'green',
        autoClose: 4000,
      })
      setTarget(null)
      await onChanged()
    } catch (err) {
      setDialogError(refusalText(err))
    } finally {
      setSaving(false)
    }
  }

  const [reopening, setReopening] = useState<string | null>(null)

  async function reopen(day: UnrosteredDay) {
    const key = `${day.employeeId}:${day.workDate}`
    setReopening(key)
    try {
      await attendanceService.reopenUnrosteredDay(day.employeeId, day.workDate.slice(0, 10))
      notifications.show({
        message: t('attendance.unrostered.doneReopened', { name: day.employeeName, date: formatDayLabel(day.workDate) }),
        color: 'green',
        autoClose: 3000,
      })
      await onChanged()
    } catch (err) {
      notifications.show({ message: refusalText(err), color: 'red', autoClose: 6000 })
    } finally {
      setReopening(null)
    }
  }

  /* ── the punches behind a day ── */

  const [punchDay, setPunchDay] = useState<UnrosteredDay | null>(null)
  const [punches, setPunches] = useState<RawPunch[] | null>(null)
  const [punchError, setPunchError] = useState<string | null>(null)

  function openPunches(day: UnrosteredDay) {
    setPunchDay(day)
    setPunches(null)
    setPunchError(null)
    // The day's punches sit on one calendar date, or on two for an overnight day; the raw-punch read
    // takes one date at a time, and is the same read the Punches view makes.
    Promise.all(punchDates(day).map((date) => importService.getPunches(date)))
      .then((lists) => setPunches(punchesOfDay(lists.flat(), day)))
      .catch((err) => setPunchError(getErrorMessage(err)))
  }

  /* ── render ── */

  if (error)
    return (
      <div className="alert alert--error" role="alert">
        {t('attendance.unrostered.loadFailed', { error })}
      </div>
    )
  if (days == null)
    return emptyMonth ? (
      <div className="page-loading">
        <Loader size={40} />
      </div>
    ) : null
  if (days.length === 0)
    return emptyMonth ? (
      <div className="card">
        <div className="empty-hint">
          <div className="empty-hint-main">
            {t('attendance.unrostered.emptyTitle', { month: periodLabel(emptyMonth) })}
          </div>
          {t('attendance.unrostered.emptyText')}
        </div>
      </div>
    ) : null

  const blocked = target ? addBlockedBy(target) : null
  const holidayOf = (day: UnrosteredDay) =>
    (isRtl ? day.holidayNameAr : null) ?? day.holidayName

  return (
    <div className="card unrostered">
      <div className="tab-toolbar">
        <div>
          <div className="empty-hint-main">
            <IconCalendarQuestion size={16} className="anomaly-icon" aria-hidden="true" />{' '}
            {open.length > 0
              ? t('attendance.unrostered.bandTitle', { count: open.length })
              : t('attendance.unrostered.bandTitleNone')}
          </div>
          <p className="hint" style={{ marginTop: 4 }}>
            {t('attendance.unrostered.bandHint')}
          </p>
        </div>
        {dismissed.length > 0 && (
          <div className="page-head-actions">
            <Button variant="subtle" size="compact-sm" onClick={() => setShowDismissed((shown) => !shown)}>
              {showDismissed
                ? t('attendance.unrostered.hideDismissed')
                : t('attendance.unrostered.showDismissed', { count: dismissed.length })}
            </Button>
          </div>
        )}
      </div>

      <div className="unrostered-list">
        {visible.map((day) => {
          const key = `${day.employeeId}:${day.workDate}`
          const holiday = holidayOf(day)
          return (
            <div className={day.state === 'Open' ? 'unrostered-day' : 'unrostered-day unrostered-day--closed'} key={key}>
              <div className="unrostered-who">
                <span className="unrostered-name">{day.employeeName}</span>
                <span className="hint">{day.branchName}</span>
              </div>

              <div className="unrostered-facts">
                <span className="unrostered-date">
                  {t(`common.weekday.${isoWeekday(day.workDate)}`)} {formatDayLabel(day.workDate)}
                </span>
                <span>
                  {day.punchCount > 1
                    ? `${formatTime(day.firstPunch)} – ${formatTime(day.lastPunch)}`
                    : formatTime(day.firstPunch)}
                </span>
                <span className="hint">
                  {day.punchCount > 1
                    ? t('attendance.unrostered.punchFacts', {
                        count: day.punchCount,
                        between: formatMinutes(day.workedMinutes),
                      })
                    : t('attendance.unrostered.onePunch')}
                </span>
              </div>

              <div className="unrostered-flags">
                {day.state === 'Open' ? (
                  <span className="badge badge--late">{t('attendance.unrostered.badgeOpen')}</span>
                ) : (
                  <span className="badge badge--muted">{t('attendance.unrostered.badgeDismissed')}</span>
                )}
                {day.isToday && <span className="badge badge--on">{t('attendance.daily.today')}</span>}
                {holiday && (
                  <span className="badge badge--muted">{t('attendance.unrostered.badgeHoliday', { name: holiday })}</span>
                )}
                {day.isPaid && <span className="badge badge--muted">{t('attendance.unrostered.badgePaid')}</span>}
                {day.outsideEmployment && (
                  <span className="badge badge--off">{t('attendance.unrostered.badgeOutside')}</span>
                )}
                {day.openRosterRequestId != null && (
                  <span className="badge badge--muted">
                    {t('attendance.unrostered.badgeRosterWaiting', { id: day.openRosterRequestId })}
                  </span>
                )}
                {/* The reason of a dismissal is part of the row: it is what makes it checkable later. */}
                {day.dismissNote && (
                  <span className="hint unrostered-note">
                    {t(day.punchesChanged ? 'attendance.unrostered.wasDismissed' : 'attendance.unrostered.dismissedBy', {
                      by: day.dismissedBy ?? t('common.dash'),
                      note: day.dismissNote,
                    })}
                  </span>
                )}
              </div>

              <div className="unrostered-actions">
                <Button
                  variant="subtle"
                  size="compact-sm"
                  leftSection={<IconListDetails size={14} />}
                  onClick={() => openPunches(day)}
                >
                  {t('attendance.unrostered.seePunches')}
                </Button>
                <Button component={Link} variant="subtle" size="compact-sm" to={rosterDayLink(day)}>
                  {t('attendance.unrostered.openRoster')}
                </Button>
                {day.canDecide && day.state === 'Open' && (
                  <Button size="compact-sm" leftSection={<IconCheck size={14} />} onClick={() => openDecision(day)}>
                    {t('attendance.unrostered.decide')}
                  </Button>
                )}
                {day.canDecide && day.state === 'Dismissed' && (
                  <Button
                    variant="default"
                    size="compact-sm"
                    leftSection={<IconRotate size={14} />}
                    loading={reopening === key}
                    onClick={() => void reopen(day)}
                  >
                    {t('attendance.unrostered.reopen')}
                  </Button>
                )}
                {/* Said, not left blank: a row with no button reads as a page that is broken. */}
                {!day.canDecide && (
                  <span className="hint unrostered-wait">
                    {t(day.isPaid ? 'attendance.unrostered.paidHint' : 'attendance.unrostered.waitingHint')}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* THE DECISION. One dialog, three answers, each stating what it does before it is chosen. */}
      {target && decision && (
        <Modal
          opened
          onClose={() => !saving && setTarget(null)}
          title={t('attendance.unrostered.decideTitle', {
            name: target.employeeName,
            date: formatDayLabel(target.workDate),
          })}
          size={560}
          centered
          closeOnClickOutside={!saving}
        >
          <div>
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="empty-hint-main">
                {target.punchCount > 1
                  ? t('attendance.unrostered.factsMany', {
                      first: formatTime(target.firstPunch),
                      last: formatTime(target.lastPunch),
                      count: target.punchCount,
                      between: formatMinutes(target.workedMinutes),
                    })
                  : t('attendance.unrostered.factsOne', { first: formatTime(target.firstPunch) })}
              </div>
              <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
                {t('attendance.unrostered.factsHint', { branch: target.branchName })}
                {holidayOf(target) && <> {t('attendance.unrostered.holidayHint', { name: holidayOf(target) })}</>}
              </p>
            </div>

            {blocked && (
              <div className="alert alert--warning" role="status">
                {blocked === 'outsideEmployment'
                  ? t('attendance.unrostered.blockedOutside')
                  : t('attendance.unrostered.blockedRosterWaiting', { id: target.openRosterRequestId })}
              </div>
            )}

            <div className="disposition-actions">
              {(['Shift', 'RestDay', 'Dismiss'] as const).map((option) => {
                const disabled = saving || (blocked !== null && option !== 'Dismiss')
                return (
                  <button
                    key={option}
                    type="button"
                    className={
                      decision === option ? 'disposition-choice disposition-choice--on' : 'disposition-choice'
                    }
                    aria-pressed={decision === option}
                    disabled={disabled}
                    onClick={() => {
                      setDecision(option)
                      setDialogError(null)
                    }}
                  >
                    <span>
                      <span className="disposition-choice-title">{t(`attendance.unrostered.choice.${option}`)}</span>
                      <span className="disposition-choice-consequence">
                        {option === 'RestDay'
                          ? t('attendance.unrostered.consequence.RestDay', {
                              approved: formatMinutes(target.approvedOvertimeMinutes),
                            })
                          : t(`attendance.unrostered.consequence.${option}`)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>

            {decision === 'Shift' && (
              <div className="form-field" style={{ marginTop: 14 }}>
                <label className="form-label" htmlFor="unrostered-shift">
                  {t('attendance.unrostered.shift')}
                </label>
                {shiftsError ? (
                  <div className="alert alert--error" role="alert">
                    {shiftsError}
                  </div>
                ) : (
                  <Select
                    id="unrostered-shift"
                    data={activeShifts.map((shift) => ({ value: String(shift.shiftId), label: shiftLabel(shift) }))}
                    value={chosenShift != null ? String(chosenShift) : null}
                    placeholder={t(shifts === null ? 'attendance.unrostered.shiftsLoading' : 'attendance.unrostered.shiftPlaceholder')}
                    disabled={saving || shifts === null}
                    searchable
                    onChange={(value) => {
                      setShiftId(value != null ? Number(value) : null)
                      setDialogError(null)
                    }}
                  />
                )}
                {proposed != null && chosenShift === proposed && (
                  <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
                    {t('attendance.unrostered.shiftProposed', { time: formatTime(target.firstPunch) })}
                  </p>
                )}
              </div>
            )}

            <div className="form-field" style={{ marginTop: 14 }}>
              <label className="form-label" htmlFor="unrostered-note">
                {t(decision === 'Dismiss' ? 'attendance.unrostered.noteRequiredLabel' : 'attendance.unrostered.noteOptionalLabel')}
              </label>
              <Textarea
                id="unrostered-note"
                value={note}
                maxLength={DECISION_NOTE_MAX}
                autosize
                minRows={2}
                disabled={saving}
                placeholder={decision === 'Dismiss' ? t('attendance.unrostered.notePlaceholder') : undefined}
                onChange={(e) => {
                  const value = e.currentTarget.value
                  setNote(value)
                  setDialogError(null)
                }}
              />
            </div>

            {dialogError && (
              <div className="alert alert--error" role="alert">
                {dialogError}
              </div>
            )}

            <div className="form-actions">
              <Button variant="default" onClick={() => setTarget(null)} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button
                color={decision === 'Dismiss' ? 'gray' : undefined}
                onClick={() => void submitDecision()}
                loading={saving}
              >
                {t(decision === 'Dismiss' ? 'attendance.unrostered.saveDismiss' : 'attendance.unrostered.saveAdd')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* THE PUNCHES BEHIND THE DAY, exactly as the machine sent them. Read-only. */}
      {punchDay && (
        <Modal
          opened
          onClose={() => setPunchDay(null)}
          title={t('attendance.unrostered.punchesTitle', {
            name: punchDay.employeeName,
            date: formatDayLabel(punchDay.workDate),
          })}
          size={520}
          centered
        >
          {punchError ? (
            <div className="alert alert--error" role="alert">
              {punchError}
            </div>
          ) : punches === null ? (
            <div className="page-loading">
              <Loader size={32} />
            </div>
          ) : punches.length === 0 ? (
            <p className="hint">{t('attendance.unrostered.punchesNone')}</p>
          ) : (
            <div className="table-scroll">
              <Table striped fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('attendance.unrostered.punchTime')}</Table.Th>
                    <Table.Th>{t('attendance.unrostered.punchKey')}</Table.Th>
                    <Table.Th>{t('attendance.unrostered.punchMachine')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {punches.map((punch) => (
                    <Table.Tr key={punch.rawLogId}>
                      <Table.Td>
                        {formatDayLabel(punch.punchTimeUtc)} {formatTime(punch.punchTimeUtc)}
                      </Table.Td>
                      <Table.Td>
                        {punch.punchType === 0
                          ? t('attendance.pairs.in')
                          : punch.punchType === 1
                            ? t('attendance.pairs.out')
                            : String(punch.punchType)}
                      </Table.Td>
                      <Table.Td>{punch.deviceName || punch.serialNumber}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          )}
          <p className="hint" style={{ marginBottom: 0 }}>
            {t('attendance.unrostered.punchesHint')}
          </p>
        </Modal>
      )}
    </div>
  )
}

/**
 * The same panel for a page that has no list of its own to read alongside (Anomalies > Not on roster):
 * it reads its days for the range and re-reads them after a decision or when `reloadKey` moves.
 */
export function NotOnRosterSection({
  from,
  to,
  branchId,
  reloadKey,
}: {
  from: string
  to: string
  branchId: number | null
  reloadKey: number
}) {
  const [days, setDays] = useState<UnrosteredDay[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [own, setOwn] = useState(0)

  useEffect(() => {
    let cancelled = false
    attendanceService
      .getUnrosteredDays(from, to, { branchId })
      .then((list) => {
        if (cancelled) return
        setDays(list)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [from, to, branchId, reloadKey, own])

  return (
    <NotOnRosterPanel
      days={days}
      error={error}
      emptyMonth={from.slice(0, 7)}
      onChanged={() => setOwn((n) => n + 1)}
    />
  )
}
