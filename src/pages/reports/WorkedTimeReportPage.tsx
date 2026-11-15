import { Fragment, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Select } from '@mantine/core'
import { IconChevronDown, IconChevronRight, IconDownload, IconSearch } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { getErrorMessage } from '../../api/errorMessage'
import { DateRangeField } from '../../components/DateRangeField'
import { reportsService } from '../../services/reportsService'
import { branchesService } from '../../services/hrService'
import type { Branch } from '../../types/hr'
import type { WorkedTimeDay, WorkedTimeReport, WorkedTimeRow } from '../../types/reports'
import { formatDayLabel, formatTime, statusText } from '../attendance/attendanceFormat'
import { companyToday } from '../attendance/dayProgress'
import { toCsv } from '../attendance/dailyFilters'
import { ReportShell, ReportDocHead, ReportNoAccess } from './ReportShell'
import { REPORT_VIEW, reportMinutes } from './reportShared'
import { daysOf, monthOf, progressTone, workedTimeCsvRows } from './workedTime'

const MAX_DAYS = 93

/**
 * Twelve columns need a landscape sheet. The reports' named @page (reports.css) is not honoured by every browser's
 * print, so this page also sets the sheet itself while it is open; a <style> it renders goes away with it.
 */
const PRINT_PAGE = '@page { size: A4 landscape; }'

function downloadText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 'yyyy-MM-dd' -> ISO weekday 1..7, the keys of common.weekday. */
function isoWeekday(day: string): number {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

/**
 * WORKED TIME — per employee and for any period: days and hours worked, the progress against the standard month,
 * time beyond the standard day, missing punches, leave and holidays, and the punched days still waiting for a roster
 * decision (apart, never in the totals). Works with or without a roster: worked time is the attendance days the
 * system builds from the punches every hour, the same as Daily attendance and payroll. A row opens to the employee's
 * days. Print (landscape) and CSV.
 */
export default function WorkedTimeReportPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canView = hasPermission(REPORT_VIEW)

  const today = companyToday()
  const [from, setFrom] = useState(() => monthOf(today).from)
  const [to, setTo] = useState(() => monthOf(today).to)
  const [branchId, setBranchId] = useState<number | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [report, setReport] = useState<WorkedTimeReport | null>(null)
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    branchesService
      .getAll()
      // Every branch, a closed one too: a past period of a branch closed since is still worth reading.
      .then((list) => !cancelled && setBranches([...list].sort((a, b) => Number(b.isActive) - Number(a.isActive))))
      .catch(() => {
        // Optional filter: without it the report covers every branch the caller may see.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      setReport(await reportsService.workedTime(from, to, branchId ?? undefined))
      setOpen(new Set())
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [from, to, branchId])

  if (!canView) return <ReportNoAccess title={t('attendance.reports.worked.title')} />

  const tooLong = (Date.parse(to) - Date.parse(from)) / 86400000 + 1 > MAX_DAYS
  const allOpen = report !== null && report.rows.length > 0 && open.size === report.rows.length
  const toggle = (employeeId: number) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(employeeId)) next.delete(employeeId)
      else next.add(employeeId)
      return next
    })

  const exportCsv = () => {
    if (!report) return
    const { header, rows } = workedTimeCsvRows(report, (key) => t(`attendance.reports.worked.csv.${key}`))
    downloadText(
      `worked-time_${report.header.from.slice(0, 10)}_${report.header.to.slice(0, 10)}.csv`,
      toCsv(header, rows),
    )
  }

  const setMonth = (offset: number) => {
    const m = monthOf(today, offset)
    setFrom(m.from)
    setTo(m.to)
  }

  return (
    <div>
      <style>{PRINT_PAGE}</style>
      <div className="page-head report-no-print">
        <div>
          <h1 className="page-title">{t('attendance.reports.worked.title')}</h1>
          <p className="page-subtitle">{t('attendance.reports.worked.subtitle')}</p>
        </div>
      </div>

      <ReportShell
        help={t('attendance.reports.worked.help')}
        landscape
        canPrint={report !== null}
        loading={loading}
        error={error}
        isEmpty={report !== null && report.rows.length === 0}
        onPrint={() => window.print()}
        filters={
          <>
            <div className="report-filter">
              <span className="report-filter-label">{t('common.period')}</span>
              <DateRangeField
                from={from}
                to={to}
                defaultFrom={monthOf(today).from}
                defaultTo={monthOf(today).to}
                w={240}
                onChange={(f, tt) => {
                  if (f && tt) {
                    setFrom(f)
                    setTo(tt)
                  }
                }}
              />
            </div>
            <div className="report-filter wt-month-buttons">
              <span className="report-filter-label">&nbsp;</span>
              <div>
                <Button variant="subtle" size="xs" onClick={() => setMonth(0)}>
                  {t('attendance.reports.worked.thisMonth')}
                </Button>
                <Button variant="subtle" size="xs" onClick={() => setMonth(-1)}>
                  {t('attendance.reports.worked.lastMonth')}
                </Button>
              </div>
            </div>
            <div className="report-filter">
              <span className="report-filter-label">{t('common.branch')}</span>
              <Select
                data={branches.map((b) => ({
                  value: String(b.branchId),
                  label: b.isActive ? b.name : t('attendance.reports.worked.closedBranch', { name: b.name }),
                }))}
                value={branchId != null ? String(branchId) : null}
                placeholder={t('common.report.allBranches')}
                clearable
                w={200}
                onChange={(v) => setBranchId(v != null ? Number(v) : null)}
              />
            </div>
            <Button
              variant="default"
              leftSection={<IconSearch size={16} />}
              disabled={tooLong || loading}
              onClick={() => void generate()}
            >
              {t('common.report.generate')}
            </Button>
            <Button
              variant="default"
              leftSection={<IconDownload size={16} />}
              disabled={!report || report.rows.length === 0}
              onClick={exportCsv}
            >
              {t('attendance.reports.worked.exportCsv')}
            </Button>
            {tooLong && (
              <span className="wt-too-long">{t('attendance.reports.worked.tooLong', { max: MAX_DAYS })}</span>
            )}
          </>
        }
      >
        {report && (
          <>
            <ReportDocHead
              title={t('attendance.reports.worked.title')}
              generatedUtc={report.header.generatedUtc}
              meta={[
                {
                  label: t('common.period'),
                  value: `${formatDayLabel(report.header.from)} – ${formatDayLabel(report.header.to)}`,
                },
                {
                  label: t('attendance.reports.worked.countedTo'),
                  value: report.header.countedTo
                    ? formatDayLabel(report.header.countedTo)
                    : t('attendance.reports.worked.notStarted'),
                },
                {
                  label: t('common.branch'),
                  value: report.header.branchName ?? t('common.report.allBranches'),
                },
                {
                  label: t('attendance.reports.worked.standard'),
                  value: t('attendance.reports.worked.standardValue', {
                    days: report.header.standardDaysPerMonth,
                    hours: reportMinutes(report.header.standardDayMinutes),
                  }),
                },
              ]}
            />
            <div className="report-no-print wt-expand-all">
              <Button
                variant="subtle"
                size="xs"
                onClick={() => setOpen(allOpen ? new Set() : new Set(report.rows.map((r) => r.employeeId)))}
              >
                {allOpen ? t('attendance.reports.worked.hideAllDays') : t('attendance.reports.worked.showAllDays')}
              </Button>
            </div>
            <div className="wt-scroll">
              <table className="report-table wt-table">
                <thead>
                  <tr>
                    <th>{t('common.report.employee')}</th>
                    <th>{t('common.branch')}</th>
                    <th className="num">{t('attendance.reports.worked.col.daysWorked')}</th>
                    <th className="num">{t('attendance.reports.worked.col.worked')}</th>
                    <th className="num">{t('attendance.reports.worked.col.average')}</th>
                    <th className="num">{t('attendance.reports.worked.col.expected')}</th>
                    <th>{t('attendance.reports.worked.col.progress')}</th>
                    <th className="num">{t('attendance.reports.worked.col.overtime')}</th>
                    <th className="num">{t('attendance.reports.worked.col.missingPunch')}</th>
                    <th className="num">{t('attendance.reports.worked.col.leave')}</th>
                    <th className="num">{t('attendance.reports.worked.col.holidays')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => {
                    const isOpen = open.has(r.employeeId)
                    return (
                      <Fragment key={r.employeeId}>
                        <tr className="wt-row" onClick={() => toggle(r.employeeId)} aria-expanded={isOpen}>
                          <td>
                            <span className="wt-name">
                              <span className="report-no-print wt-chevron">
                                {isOpen ? (
                                  <IconChevronDown size={14} />
                                ) : (
                                  <IconChevronRight size={14} className="wt-flip-rtl" />
                                )}
                              </span>
                              {r.fullName}
                            </span>
                          </td>
                          <td>{r.branchName}</td>
                          <Figures row={r} />
                        </tr>
                        {isOpen && (
                          <tr className="wt-days-row">
                            <td colSpan={11}>
                              <DayList days={daysOf(report, r.employeeId)} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>
                      {t('attendance.reports.worked.totals', {
                        count: report.rows.length,
                      })}
                    </td>
                    <Figures row={report.totals} />
                  </tr>
                </tfoot>
              </table>
            </div>
            {report.totals.notOnRosterDays > 0 && (
              <p className="wt-rules wt-to-decide">
                {t('attendance.reports.worked.notOnRosterNote', {
                  count: report.totals.notOnRosterDays,
                  time: reportMinutes(report.totals.notOnRosterMinutes),
                })}
              </p>
            )}
            <p className="wt-rules">{t('attendance.reports.worked.rules')}</p>
          </>
        )}
      </ReportShell>
    </div>
  )
}

function Figures({ row }: { row: WorkedTimeRow }) {
  const { t } = useTranslation()
  const tone = progressTone(row.progressPercent)
  return (
    <>
      <td className="num">{row.daysWorked}</td>
      <td className="num report-strong-cell">{reportMinutes(row.workedMinutes)}</td>
      <td className="num">{row.daysWorked ? reportMinutes(row.averageMinutes) : t('common.dash')}</td>
      <td className="num">{reportMinutes(row.expectedMinutes)}</td>
      <td>
        {row.progressPercent == null ? (
          t('common.dash')
        ) : (
          <span className={`wt-progress wt-progress--${tone}`}>
            <span className="wt-bar">
              <span style={{ width: `${Math.min(100, row.progressPercent)}%` }} />
            </span>
            <span className="wt-pct">{row.progressPercent.toFixed(1)}%</span>
          </span>
        )}
      </td>
      <td className="num">{reportMinutes(row.overtimeMinutes)}</td>
      <td className={row.missingPunchDays > 0 ? 'num report-negative' : 'num'}>{row.missingPunchDays}</td>
      <td className="num">{row.leaveDays}</td>
      <td className="num">{row.holidayDays}</td>
    </>
  )
}

function kindText(day: WorkedTimeDay, t: (key: string, options?: Record<string, unknown>) => string, arabic: boolean): string {
  const holiday = arabic ? (day.noteAr ?? day.note) : day.note
  if (day.kind === 'NotOnRoster')
    return holiday ? `${statusText('Holiday')} · ${holiday}` : t('attendance.reports.worked.kind.notOnRoster')
  if (day.kind === 'Leave' && day.note === 'HalfDay') return t('attendance.reports.worked.kind.halfLeave')
  if (day.kind === 'Holiday' && holiday) return `${statusText('Holiday')} · ${holiday}`
  return statusText(day.kind)
}

function DayList({ days }: { days: WorkedTimeDay[] }) {
  const { t, i18n } = useTranslation()
  const arabic = i18n.language.startsWith('ar')
  if (days.length === 0) return <div className="wt-no-days">{t('attendance.reports.worked.noDays')}</div>
  return (
    <table className="wt-days">
      <thead>
        <tr>
          <th>{t('attendance.reports.worked.day.date')}</th>
          <th>{t('attendance.reports.worked.day.what')}</th>
          <th>{t('attendance.reports.worked.day.firstIn')}</th>
          <th>{t('attendance.reports.worked.day.lastOut')}</th>
          <th className="num">{t('attendance.reports.worked.col.worked')}</th>
          <th className="num">{t('attendance.reports.worked.col.overtime')}</th>
          <th>{t('attendance.reports.worked.day.notes')}</th>
        </tr>
      </thead>
      <tbody>
        {days.map((d) => (
          <tr key={`${d.workDate}-${d.kind}`} className={d.kind === 'NotOnRoster' ? 'wt-day--decide' : undefined}>
            <td>
              {t(`common.weekday.${isoWeekday(d.workDate)}`)} {formatDayLabel(d.workDate)}
            </td>
            <td>{kindText(d, t, arabic)}</td>
            <td>{d.firstIn ? formatTime(d.firstIn) : t('common.dash')}</td>
            <td>{d.lastOut ? formatTime(d.lastOut) : t('common.dash')}</td>
            <td className="num">{d.workedMinutes ? reportMinutes(d.workedMinutes) : t('common.dash')}</td>
            <td className="num">{d.overtimeMinutes ? reportMinutes(d.overtimeMinutes) : t('common.dash')}</td>
            <td>
              {[
                d.missingPunch ? t('attendance.reports.worked.day.missingPunch') : null,
                d.isManual ? t('attendance.reports.worked.day.manual') : null,
                d.kind === 'NotOnRoster' ? t('attendance.reports.worked.day.toDecide') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
