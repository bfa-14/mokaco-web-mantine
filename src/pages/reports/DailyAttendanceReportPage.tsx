import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Select } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { IconCalendar, IconSearch } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { getErrorMessage } from '../../api/errorMessage'
import { reportsService } from '../../services/reportsService'
import { branchesService } from '../../services/hrService'
import type { Branch } from '../../types/hr'
import type {
  DailyAttendanceHeader,
  DailyAttendanceRow,
} from '../../types/reports'
import { ReportShell, ReportDocHead } from './ReportShell'
import { REPORT_VIEW, today, reportDate, reportMinutes } from './reportShared'

/** '2026-06-10T08:05:00' → '08:05'. Blank punches read as a dash, not an empty cell. */
function clock(value: string | null): string {
  if (!value) return '—'
  const time = value.split('T')[1]
  return time ? time.slice(0, 5) : '—'
}

/** The footer tally: how the day actually went, in four numbers a manager reads first. */
function tallyOf(rows: DailyAttendanceRow[]) {
  return {
    present: rows.filter((r) => r.status === 'Present').length,
    late: rows.filter((r) => r.lateMinutes > 0).length,
    absent: rows.filter((r) => r.status === 'Absent').length,
    leave: rows.filter((r) => r.status === 'Leave').length,
  }
}

/**
 * A branch manager's morning sheet: on a given day, who was in, late, absent or off.
 *
 * Portrait, and grouped by branch — the rows arrive branch-ordered from the procedure, so a band
 * is inserted whenever the branch changes rather than re-sorting on the client.
 */
export default function DailyAttendanceReportPage() {
  const { hasPermission } = useAuth()
  const canView = hasPermission(REPORT_VIEW)

  const [searchParams] = useSearchParams()

  const [workDate, setWorkDate] = useState(searchParams.get('workDate') ?? today())
  const [branchId, setBranchId] = useState<number | null>(
    searchParams.get('branchId') ? Number(searchParams.get('branchId')) : null,
  )

  const [branches, setBranches] = useState<Branch[]>([])
  const [header, setHeader] = useState<DailyAttendanceHeader | null>(null)
  const [rows, setRows] = useState<DailyAttendanceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const result = await reportsService.dailyAttendance(
        workDate,
        branchId ?? undefined,
      )
      setHeader(result.header)
      setRows(result.rows)
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
      setHeader(null)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [workDate, branchId])

  useEffect(() => {
    let cancelled = false
    branchesService
      .getAll()
      .then((list) => {
        if (!cancelled) setBranches(list)
      })
      .catch(() => {
        // Optional filter; ignore.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Arriving from the Daily page's "Print daily sheet" shortcut, the date and branch are already in
  // the URL — so run the report at once rather than making the user press Generate for a report they
  // explicitly asked for. Guarded so it fires only for a deep link, and only once.
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current) return
    if (searchParams.get('workDate')) {
      autoRan.current = true
      // A deliberate mount-time fetch for a deep-linked report: the user pressed "Print daily
      // sheet" on the Daily page, so running it at once is what they asked for.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void generate()
    }
    // Runs once on mount by design — the ref guards re-entry; deps intentionally empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!canView) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1 className="page-title">Daily Attendance Sheet</h1>
          </div>
        </div>
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">
              You do not have access to attendance reports.
            </div>
            Reports need the &lsquo;view attendance&rsquo; permission.
          </div>
        </div>
      </div>
    )
  }

  const tally = tallyOf(rows)

  // Which rows begin a new branch band. Computed up front, not by mutating a variable inside the
  // render loop: the procedure already orders by branch, so a row starts a band when its branch
  // differs from the row before it.
  const startsBranch = rows.map(
    (r, i) => i === 0 || rows[i - 1].branchName !== r.branchName,
  )

  return (
    <div>
      <div className="page-head report-no-print">
        <div>
          <h1 className="page-title">Daily Attendance Sheet</h1>
          <p className="page-subtitle">Who was in, late, absent or off on a day.</p>
        </div>
      </div>

      <ReportShell
        help="One row per employee for a single day, grouped by branch. Use it as the morning sheet: who clocked in, who was late, who never showed. A warning icon marks a day whose punches did not add up — its hours are not yet trustworthy."
        canPrint={header !== null}
        loading={loading}
        error={error}
        isEmpty={rows.length === 0}
        onPrint={() => window.print()}
        filters={
          <>
            <div className="report-filter">
              <span className="report-filter-label">Date</span>
              {/* A daily sheet is always FOR a day, so clearing keeps the day already chosen —
                  the same `|| workDate` guard the native input carried. */}
              <DatePickerInput
                valueFormat="DD/MM/YYYY"
                leftSection={<IconCalendar size={14} />}
                value={workDate}
                w={150}
                onChange={(v) => setWorkDate(v || workDate)}
              />
            </div>
            <div className="report-filter">
              <span className="report-filter-label">Branch</span>
              <Select
                data={branches.map((b) => ({ value: String(b.branchId), label: b.name }))}
                value={branchId != null ? String(branchId) : null}
                placeholder="All branches"
                clearable
                w={200}
                onChange={(v) => setBranchId(v != null ? Number(v) : null)}
              />
            </div>
            <Button
              variant="default"
              leftSection={<IconSearch size={16} />}
              onClick={() => void generate()}
            >
              Generate
            </Button>
          </>
        }
      >
        {header && (
          <>
            <ReportDocHead
              title={header.reportTitle}
              generatedUtc={header.generatedUtc}
              meta={[
                { label: 'Date', value: reportDate(header.workDate) },
                { label: 'Branch', value: header.branchName },
              ]}
            />
            <table className="report-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Shift</th>
                  <th className="num">First in</th>
                  <th className="num">Last out</th>
                  <th className="num">Late</th>
                  <th className="num">Worked hrs</th>
                  <th className="num">Overtime</th>
                  <th className="num">Exit</th>
                  <th className="num">Day fraction</th>
                  <th>Status</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, index) => (
                    <Fragment key={r.employeeId}>
                      {startsBranch[index] && (
                        <tr className="report-group-row">
                          <td colSpan={11}>{r.branchName}</td>
                        </tr>
                      )}
                      <tr>
                        <td>
                          {r.hasAnomaly && (
                            <span
                              className="report-anomaly"
                              title="The punches on this day did not add up — the hours are not yet trustworthy."
                            >
                              ⚠{' '}
                            </span>
                          )}
                          {r.fullName}
                        </td>
                        <td>{r.shiftName ?? '—'}</td>
                        <td className="num">{clock(r.firstInUtc)}</td>
                        <td className="num">{clock(r.lastOutUtc)}</td>
                        <td className="num">{reportMinutes(r.lateMinutes)}</td>
                        <td className="num">{r.workedHours.toFixed(2)}</td>
                        <td className="num">{reportMinutes(r.overtimeMinutes)}</td>
                        <td className="num">{reportMinutes(r.exitActualMinutes)}</td>
                        <td className="num">{r.dayFraction.toFixed(2)}</td>
                        <td>{r.status === 'RestDay' ? 'Rest day' : r.status}</td>
                        <td>{r.source}</td>
                      </tr>
                    </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={11}>
                    {rows.length} employees &nbsp;·&nbsp; Present {tally.present}
                    &nbsp;·&nbsp; Late {tally.late} &nbsp;·&nbsp; Absent{' '}
                    {tally.absent} &nbsp;·&nbsp; On leave {tally.leave}
                  </td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
      </ReportShell>
    </div>
  )
}
