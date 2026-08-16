import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Select } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { getErrorMessage } from '../../api/errorMessage'
import { reportsService } from '../../services/reportsService'
import { branchesService } from '../../services/hrService'
import type { Branch } from '../../types/hr'
import type {
  MonthlyAttendanceHeader,
  MonthlyAttendanceRow,
} from '../../types/reports'
import { ReportShell, ReportDocHead } from './ReportShell'
import { lastMonths, REPORT_VIEW, reportMinutes } from './reportShared'

/** The columns whose values are worth summing at the foot of the sheet. */
function totalsOf(rows: MonthlyAttendanceRow[]) {
  return rows.reduce(
    (acc, r) => ({
      daysWorked: acc.daysWorked + r.daysWorked,
      presentDays: acc.presentDays + r.presentDays,
      absentDays: acc.absentDays + r.absentDays,
      lateMinutes: acc.lateMinutes + r.lateMinutes,
      overtimeMinutes: acc.overtimeMinutes + r.overtimeMinutes,
      workedHours: acc.workedHours + r.workedHours,
      unpaidAbsenceDays: acc.unpaidAbsenceDays + r.unpaidAbsenceDays,
    }),
    {
      daysWorked: 0,
      presentDays: 0,
      absentDays: 0,
      lateMinutes: 0,
      overtimeMinutes: 0,
      workedHours: 0,
      unpaidAbsenceDays: 0,
    },
  )
}

/**
 * The sheet HR reviews before running payroll: one row per employee for the month.
 *
 * Landscape, because fifteen pay-relevant columns cannot be read in portrait — and every one of
 * them is here on purpose: leaving a column off would hide a deduction or a credit from the person
 * signing off the run.
 */
export default function MonthlyAttendanceReportPage() {
  const { hasPermission } = useAuth()
  const canView = hasPermission(REPORT_VIEW)

  const [searchParams] = useSearchParams()
  const months = lastMonths(12)

  const [period, setPeriod] = useState(searchParams.get('period') ?? months[0])
  const [branchId, setBranchId] = useState<number | null>(
    searchParams.get('branchId') ? Number(searchParams.get('branchId')) : null,
  )

  const [branches, setBranches] = useState<Branch[]>([])
  const [header, setHeader] = useState<MonthlyAttendanceHeader | null>(null)
  const [rows, setRows] = useState<MonthlyAttendanceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    branchesService
      .getAll()
      .then((list) => {
        if (!cancelled) setBranches(list)
      })
      .catch(() => {
        // The branch filter is optional — its absence just means "all branches", which is the
        // default anyway, so a failure to load it must not block the report.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const result = await reportsService.monthlyAttendance(
        period,
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
  }, [period, branchId])

  if (!canView) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1 className="page-title">Monthly Attendance Summary</h1>
          </div>
        </div>
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">
              You do not have access to attendance reports.
            </div>
            Reports need the &lsquo;view attendance&rsquo; permission. Ask whoever
            administers the system.
          </div>
        </div>
      </div>
    )
  }

  const totals = totalsOf(rows)

  return (
    <div>
      <div className="page-head report-no-print">
        <div>
          <h1 className="page-title">Monthly Attendance Summary</h1>
          <p className="page-subtitle">
            The sheet to review before running payroll.
          </p>
        </div>
      </div>

      <ReportShell
        help="One row per employee for the month, with every figure payroll turns into a pay line. Review it before running a payroll period; the number to watch is unpaid absence days. Overtime here is detected, not automatically paid."
        landscape
        canPrint={header !== null}
        loading={loading}
        error={error}
        isEmpty={rows.length === 0}
        onPrint={() => window.print()}
        filters={
          <>
            <div className="report-filter">
              <span className="report-filter-label">Period</span>
              <Select
                data={months}
                value={period}
                allowDeselect={false}
                onChange={(v) => setPeriod(v ?? period)}
                w={140}
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
                { label: 'Period', value: header.period },
                { label: 'Branch', value: header.branchName },
              ]}
            />
            <table className="report-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Branch</th>
                  <th>Department</th>
                  <th className="num">Days worked</th>
                  <th className="num">Full days</th>
                  <th className="num">Present</th>
                  <th className="num">Absent</th>
                  <th className="num">Leave</th>
                  <th className="num">Rest</th>
                  <th className="num">Late</th>
                  <th className="num">Overtime</th>
                  <th className="num">Worked hrs</th>
                  <th className="num">Exit-leave days</th>
                  <th className="num">Appr. leave days</th>
                  <th className="num">Unpaid absence</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employeeId}>
                    <td>{r.fullName}</td>
                    <td>{r.branchName}</td>
                    <td>{r.departmentName}</td>
                    <td className="num">{r.daysWorked.toFixed(2)}</td>
                    <td className="num">{r.fullDaysWorked}</td>
                    <td className="num">{r.presentDays}</td>
                    <td className="num">{r.absentDays}</td>
                    <td className="num">{r.leaveDays}</td>
                    <td className="num">{r.restDays}</td>
                    <td className="num">{reportMinutes(r.lateMinutes)}</td>
                    <td className="num">{reportMinutes(r.overtimeMinutes)}</td>
                    <td className="num">{r.workedHours.toFixed(2)}</td>
                    <td className="num">{r.exitLeaveDays.toFixed(2)}</td>
                    <td className="num">{r.approvedLeaveDays.toFixed(2)}</td>
                    <td
                      className={
                        r.unpaidAbsenceDays > 0
                          ? 'num report-negative report-strong-cell'
                          : 'num'
                      }
                    >
                      {r.unpaidAbsenceDays.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Totals — {rows.length} employees</td>
                  <td className="num">{totals.daysWorked.toFixed(2)}</td>
                  <td className="num" />
                  <td className="num">{totals.presentDays}</td>
                  <td className="num">{totals.absentDays}</td>
                  <td className="num" />
                  <td className="num" />
                  <td className="num">{reportMinutes(totals.lateMinutes)}</td>
                  <td className="num">{reportMinutes(totals.overtimeMinutes)}</td>
                  <td className="num">{totals.workedHours.toFixed(2)}</td>
                  <td className="num" />
                  <td className="num" />
                  <td className="num">{totals.unpaidAbsenceDays.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
      </ReportShell>
    </div>
  )
}
