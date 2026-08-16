import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Select } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { getErrorMessage } from '../../api/errorMessage'
import { reportsService } from '../../services/reportsService'
import { branchesService, employeesService } from '../../services/hrService'
import type { Branch, EmployeeListItem } from '../../types/hr'
import type { LeaveBalanceHeader, LeaveBalanceRow } from '../../types/reports'
import { ReportShell, ReportDocHead } from './ReportShell'
import { REPORT_VIEW, lastMonths } from './reportShared'

/**
 * Accrued / carried over / used / remaining, per employee per leave type, as of a period.
 *
 * Remaining is the whole reason the report exists — it is set apart in bold, and shown red when it
 * has gone negative (somebody has taken more than they had), because that is the one value here a
 * reader must not skim past.
 */
export default function LeaveBalanceReportPage() {
  const { hasPermission } = useAuth()
  const canView = hasPermission(REPORT_VIEW)

  const [searchParams] = useSearchParams()
  const months = lastMonths(12)

  const [asOf, setAsOf] = useState(searchParams.get('asOf') ?? months[0])
  const [employeeId, setEmployeeId] = useState<number | null>(
    searchParams.get('employeeId')
      ? Number(searchParams.get('employeeId'))
      : null,
  )
  const [branchId, setBranchId] = useState<number | null>(
    searchParams.get('branchId') ? Number(searchParams.get('branchId')) : null,
  )

  const [branches, setBranches] = useState<Branch[]>([])
  const [employees, setEmployees] = useState<EmployeeListItem[]>([])
  const [header, setHeader] = useState<LeaveBalanceHeader | null>(null)
  const [rows, setRows] = useState<LeaveBalanceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const result = await reportsService.leaveBalance(
        asOf,
        employeeId ?? undefined,
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
  }, [asOf, employeeId, branchId])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      branchesService.getAll().catch(() => [] as Branch[]),
      employeesService.getAll().catch(() => [] as EmployeeListItem[]),
    ]).then(([b, e]) => {
      if (!cancelled) {
        setBranches(b)
        setEmployees(e)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Opened from a Leave page's "Print balances" shortcut with an employee already chosen — run it
  // straight away, once.
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current) return
    if (searchParams.get('employeeId') || searchParams.get('asOf')) {
      autoRan.current = true
      // A deliberate mount-time fetch for a deep-linked report: the user asked for this exact
      // report from another page, so running it is the expected behaviour, not a surprise render.
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
            <h1 className="page-title">Leave Balance Report</h1>
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

  // Only the first row of each employee shows their name and branch — computed up front rather than
  // by mutating a variable during render. The procedure orders by branch then employee, so a row is
  // an employee's first when the name differs from the row before it.
  const firstForEmployee = rows.map(
    (r, i) => i === 0 || rows[i - 1].fullName !== r.fullName,
  )

  return (
    <div>
      <div className="page-head report-no-print">
        <div>
          <h1 className="page-title">Leave Balance Report</h1>
          <p className="page-subtitle">
            Accrued, used and remaining leave per employee.
          </p>
        </div>
      </div>

      <ReportShell
        help="One row per employee per leave type, as of the end of the chosen period. Remaining is accrued plus carried over, minus used — the column to read. A negative remaining means somebody has taken more than they had."
        canPrint={header !== null}
        loading={loading}
        error={error}
        isEmpty={rows.length === 0}
        onPrint={() => window.print()}
        filters={
          <>
            <div className="report-filter">
              <span className="report-filter-label">As of</span>
              <Select
                data={months}
                value={asOf}
                allowDeselect={false}
                onChange={(v) => setAsOf(v ?? asOf)}
                w={140}
              />
            </div>
            <div className="report-filter">
              <span className="report-filter-label">Employee</span>
              <Select
                data={employees.map((e) => ({
                  value: String(e.employeeId),
                  label: e.fullName,
                }))}
                value={employeeId != null ? String(employeeId) : null}
                placeholder="All employees"
                searchable
                clearable
                w={220}
                onChange={(v) => setEmployeeId(v != null ? Number(v) : null)}
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
                { label: 'As of', value: header.asOfPeriod },
                { label: 'Branch', value: header.branchName },
              ]}
            />
            <table className="report-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Branch</th>
                  <th>Leave type</th>
                  <th className="num">Accrued</th>
                  <th className="num">Carried over</th>
                  <th className="num">Used</th>
                  <th className="num">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, index) => (
                    <tr key={`${r.employeeId}-${r.leaveType}`}>
                      <td>{firstForEmployee[index] ? r.fullName : ''}</td>
                      <td>{firstForEmployee[index] ? r.branchName : ''}</td>
                      <td>
                        {r.leaveType}
                        {!r.isPaid && (
                          <span
                            className="report-anomaly"
                            title="Time taken in this type is unpaid."
                          >
                            {' '}
                            (unpaid)
                          </span>
                        )}
                      </td>
                      <td className="num">{r.accrued.toFixed(2)}</td>
                      <td className="num">{r.carriedOver.toFixed(2)}</td>
                      <td className="num">{r.used.toFixed(2)}</td>
                      <td
                        className={
                          r.remaining < 0
                            ? 'num report-strong-cell report-negative'
                            : 'num report-strong-cell'
                        }
                      >
                        {r.remaining.toFixed(2)}
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </ReportShell>
    </div>
  )
}
