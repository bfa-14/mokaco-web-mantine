/**
 * Printable report models. Each report returns TWO parts — a header block and the detail rows —
 * mirroring the two result sets its stored procedure produces. The client renders both: the header
 * is what turns a table into a dated, titled document.
 *
 * Dates are strings, as everywhere. Reporting is read-only.
 */

/** { header, rows } — the shape every report endpoint returns. */
export interface ReportResult<THeader, TRow> {
  header: THeader
  rows: TRow[]
}

/* ── 1. Monthly Attendance Summary ── */

export interface MonthlyAttendanceHeader {
  reportTitle: string
  period: string
  periodStart: string
  periodEnd: string
  branchName: string
  generatedUtc: string
}

export interface MonthlyAttendanceRow {
  employeeId: number
  fullName: string
  branchName: string
  departmentName: string
  /** Fractional — someone who left two hours early counts 0.75, not 1. */
  daysWorked: number
  fullDaysWorked: number
  presentDays: number
  absentDays: number
  leaveDays: number
  restDays: number
  lateMinutes: number
  /** Detected, not payable. */
  overtimeMinutes: number
  workedHours: number
  exitLeaveDays: number
  approvedLeaveDays: number
  /** Absences not covered by approved leave — the deduction. */
  unpaidAbsenceDays: number
}

/* ── 2. Daily Attendance Sheet ── */

export interface DailyAttendanceHeader {
  reportTitle: string
  workDate: string
  branchName: string
  generatedUtc: string
}

export interface DailyAttendanceRow {
  employeeId: number
  fullName: string
  branchName: string
  shiftName: string | null
  firstInUtc: string | null
  lastOutUtc: string | null
  lateMinutes: number
  workedHours: number
  overtimeMinutes: number
  exitActualMinutes: number
  dayFraction: number
  status: string
  /** The punches did not add up — this row's hours are not yet trustworthy. */
  hasAnomaly: boolean
  source: string
}

/* ── 3. Leave Balance Report ── */

export interface LeaveBalanceHeader {
  reportTitle: string
  asOfPeriod: string
  branchName: string
  generatedUtc: string
}

export interface LeaveBalanceRow {
  employeeId: number
  fullName: string
  branchName: string
  leaveType: string
  isPaid: boolean
  accrued: number
  carriedOver: number
  used: number
  /** Accrued + carried over − used. The column people open this report to read. */
  remaining: number
}
