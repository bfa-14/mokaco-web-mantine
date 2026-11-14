import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionIcon, Button, Loader } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconChevronLeft, IconChevronRight, IconRefresh } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { dayReportsService, myAttendanceService } from '../../services/attendanceService'
import type { DayReport, MyAttendance, MyAttendanceDay, MyDayDecision } from '../../types/attendance'
import { ReportDayDialog, reportStateText } from './DayReports'
import { useLanguage } from '../../i18n/useLanguage'
import { currentLocale } from '../../i18n'
import { formatDayLabel, formatMinutes, formatTime } from './attendanceFormat'
import { StatusBadge } from './attendanceShared'
import './attendance.css'

/** 'yyyy-MM' moved by whole months. */
function shiftMonth(month: string, by: number): string {
  const d = new Date(`${month}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + by)
  return d.toISOString().slice(0, 7)
}

/**
 * MY ATTENDANCE — every employee's own days: today's punches, the next seven days' shifts, and a month day by
 * day with what HR decided on each (never HR's notes). Open to every signed-in person linked to an employee.
 */
export default function MyAttendancePage() {
  const { t } = useTranslation()
  const { isRtl } = useLanguage()
  const [month, setMonth] = useState<string | null>(null)
  const [data, setData] = useState<MyAttendance | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /** My reports about days of the month shown ("something is wrong with this day"), newest first. */
  const [reports, setReports] = useState<DayReport[]>([])
  const [reporting, setReporting] = useState<MyAttendanceDay | null>(null)

  const load = useCallback(async (asked: string | null) => {
    setLoading(true)
    try {
      const mine = await myAttendanceService.get(asked ?? undefined)
      setData(mine)
      setError(null)
      if (mine) {
        const first = `${mine.month}-01`
        const last = mine.days[mine.days.length - 1]?.workDate.slice(0, 10) ?? first
        // A database without script 110 simply has no reports to show.
        dayReportsService.mine(first, last).then(setReports).catch(() => setReports([]))
      }
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(month)
  }, [load, month])

  const Back = isRtl ? IconChevronRight : IconChevronLeft
  const Forward = isRtl ? IconChevronLeft : IconChevronRight
  const shown = data?.month ?? month

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('attendance.my.title')}</h1>
          <p className="page-subtitle">{t('attendance.my.subtitle')}</p>
        </div>
        <div className="page-head-actions">
          <ActionIcon variant="default" size="lg" title={t('common.refresh')} aria-label={t('common.refresh')} onClick={() => void load(month)}>
            <IconRefresh size={16} />
          </ActionIcon>
        </div>
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {loading && data === undefined ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : data === null ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">{t('attendance.my.noEmployeeTitle')}</div>
            {t('attendance.my.noEmployeeText')}
          </div>
        </div>
      ) : data ? (
        <>
          <TodayCard data={data} />

          <section className="card">
            <div className="card-title">{t('attendance.my.nextTitle')}</div>
            <div className="my-next">
              {data.nextDays.map((day) => (
                <div key={day.workDate} className="my-next-day">
                  <span className="my-next-date">{formatDayLabel(day.workDate)}</span>
                  <span className="hint" style={{ margin: 0 }}>{planText(day, t)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="my-month-head">
              <ActionIcon variant="default" size="lg" aria-label={t('attendance.my.prevMonth')} onClick={() => shown && setMonth(shiftMonth(shown, -1))}>
                <Back size={18} />
              </ActionIcon>
              <div className="card-title" style={{ margin: 0 }}>
                {t('attendance.my.monthTitle', { month: monthLabel(data.month) })}
              </div>
              <ActionIcon variant="default" size="lg" aria-label={t('attendance.my.nextMonth')} onClick={() => shown && setMonth(shiftMonth(shown, 1))}>
                <Forward size={18} />
              </ActionIcon>
            </div>

            <div className="today-counters">
              <Tile value={String(data.totals.daysWorked)} label={t('attendance.my.totals.days')} />
              <Tile value={formatMinutes(data.totals.workedMinutes)} label={t('attendance.my.totals.worked')} />
              <Tile value={String(data.totals.lateDays)} label={t('attendance.my.totals.late', { minutes: formatMinutes(data.totals.lateMinutes) })} />
              <Tile value={String(data.totals.absentDays)} label={t('attendance.my.totals.absent')} />
              <Tile value={String(data.totals.waitingForHr)} label={t('attendance.my.totals.waiting')} />
            </div>

            <div className="my-days">
              {data.days.map((day) => (
                <DayRow
                  key={day.workDate}
                  day={day}
                  today={data.today.slice(0, 10)}
                  report={reports.find((r) => r.workDate.slice(0, 10) === day.workDate.slice(0, 10)) ?? null}
                  onReport={() => setReporting(day)}
                  onChanged={() => void load(month)}
                />
              ))}
            </div>
            <p className="hint" style={{ marginBottom: 0 }}>{t('attendance.my.footnote')}</p>
          </section>
        </>
      ) : null}

      {reporting && data && (
        <ReportDayDialog
          employeeId={null}
          employeeName={data.fullName}
          workDate={reporting.workDate}
          currentIn={reporting.firstIn}
          currentOut={reporting.lastOut}
          onClose={() => setReporting(null)}
          onSent={() => void load(month)}
        />
      )}
    </div>
  )
}

type T = (key: string, options?: Record<string, unknown>) => string

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Intl.DateTimeFormat(currentLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)))
}

/** What the roster planned for a day, in words. */
function planText(day: MyAttendanceDay, t: T): string {
  if (day.leaveDays >= 1) return t('attendance.my.plan.leave')
  if (!day.rostered) return t('attendance.my.plan.none')
  if (day.isRestDay) return t('attendance.my.plan.rest')
  const shift = t('attendance.my.plan.shift', {
    name: day.shiftName ?? '',
    start: (day.startTime ?? '').slice(0, 5),
    end: (day.endTime ?? '').slice(0, 5),
  })
  return day.leaveDays > 0 ? `${shift} · ${t('attendance.my.plan.halfLeave')}` : shift
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="today-counter today-counter--muted">
      <span className="today-counter-value" style={{ color: 'var(--ink)' }}>{value}</span>
      <span className="today-counter-label">{label}</span>
    </div>
  )
}

function TodayCard({ data }: { data: MyAttendance }) {
  const { t } = useTranslation()
  const today = data.today.slice(0, 10)
  const day = data.days.find((d) => d.workDate.slice(0, 10) === today)
  return (
    <section className="card">
      <div className="card-title">{t('attendance.my.todayTitle', { date: formatDayLabel(today) })}</div>
      {day && <p className="hint" style={{ marginTop: 0 }}>{planText(day, t)}</p>}
      {data.todayPunches.length === 0 ? (
        <p className="hint" style={{ marginBottom: 0 }}>{t('attendance.my.noPunchToday')}</p>
      ) : (
        <div className="my-punches">
          {data.todayPunches.map((p, i) => (
            <span key={i} className={p.punchType === 1 ? 'badge badge--muted' : 'badge badge--on'}>
              {t(p.punchType === 0 ? 'attendance.my.punchIn' : p.punchType === 1 ? 'attendance.my.punchOut' : 'attendance.my.punchKey', {
                time: formatTime(p.punchTime),
              })}
            </span>
          ))}
        </div>
      )}
      <p className="hint" style={{ marginBottom: 0 }}>{t('attendance.my.punchHint')}</p>
    </section>
  )
}

function decisionText(d: MyDayDecision, t: T): string {
  const what = t(`attendance.my.type.${d.type}`, { minutes: formatMinutes(d.minutes), defaultValue: d.type })
  const ruling = d.decision ? t(`attendance.my.decision.${d.decision}`) : t('attendance.my.decision.waiting')
  return `${what} — ${ruling}`
}

function DayRow({
  day,
  today,
  report,
  onReport,
  onChanged,
}: {
  day: MyAttendanceDay
  today: string
  report: DayReport | null
  onReport: () => void
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const myUserId = useAuth().user?.userId
  const [withdrawing, setWithdrawing] = useState(false)
  async function withdraw() {
    if (!report) return
    setWithdrawing(true)
    try {
      await dayReportsService.withdraw(report.reportId)
      onChanged()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 6000 })
    } finally {
      setWithdrawing(false)
    }
  }
  const date = day.workDate.slice(0, 10)
  const future = date > today
  const isToday = date === today
  return (
    <div className={`my-day${future ? ' my-day--future' : ''}`}>
      <div className="my-day-date">
        <span className="my-day-label">{formatDayLabel(day.workDate)}</span>
        <span className="hint" style={{ margin: 0 }}>{planText(day, t)}</span>
      </div>
      <div className="my-day-actual">
        {day.status && <StatusBadge status={day.status} />}
        {(day.firstIn || day.lastOut) && (
          <span>
            {t('attendance.my.times', {
              in: formatTime(day.firstIn),
              out: day.lastOut ? formatTime(day.lastOut) : isToday ? t('attendance.daily.onShift') : formatTime(null),
              worked: formatMinutes(day.workedMinutes),
            })}
          </span>
        )}
        {!day.status && !future && day.rostered && !day.isRestDay && day.leaveDays < 1 && !day.offRosterState && (
          <span className="hint" style={{ margin: 0 }}>{t('attendance.my.noRecord')}</span>
        )}
        {day.isManual && <span className="badge badge--muted">{t('attendance.my.manual')}</span>}
        {day.status === 'Present' && !isToday && day.shortfallMinutes > 0 && (day.dayFraction ?? 1) < 1 && (
          <span className="badge badge--late">{t('attendance.my.short', { minutes: formatMinutes(day.shortfallMinutes) })}</span>
        )}
        {day.decisions
          .filter((d) => !(isToday && d.type === 'MissingPunch' && !d.decision))
          .map((d, i) => (
            <span key={i} className={d.decision ? 'badge badge--muted' : 'badge badge--late'}>
              {decisionText(d, t)}
            </span>
          ))}
        {report && (
          <span className={report.status === 'Open' ? 'badge badge--late' : 'badge badge--muted'} title={report.message}>
            {reportStateText(report, t)}
          </span>
        )}
        {report?.status === 'Open' && report.reportedByUserId !== myUserId ? null : report?.status === 'Open' ? (
          <Button variant="subtle" size="compact-xs" loading={withdrawing} onClick={() => void withdraw()}>
            {t('attendance.dayReport.withdraw')}
          </Button>
        ) : (
          !future && (
            <Button variant="subtle" size="compact-xs" onClick={onReport}>
              {t('attendance.dayReport.open')}
            </Button>
          )
        )}
        {day.offRosterState && (
          <span className={day.offRosterState === 'Open' ? 'badge badge--late' : 'badge badge--muted'}>
            {t(day.offRosterState === 'Open' ? 'attendance.my.offRosterOpen' : 'attendance.my.offRosterDismissed')}
          </span>
        )}
      </div>
    </div>
  )
}
