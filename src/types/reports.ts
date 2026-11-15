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
  /** null on a RestDay / Leave / Holiday row — nothing to divide by. */
  dayFraction: number | null
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
  /** QA3 (LEV-14): corrections, the year-end close and expired carry-over, signed. */
  adjusted?: number
  /** Accrued + carried over − used + adjusted. The column people open this report to read. */
  remaining: number
}

/* ── 4. Worked Time Report (script 113) ── */

export interface WorkedTimeHeader {
  from: string
  to: string
  /** The last day counted: the end of the period, or yesterday when it reaches today. Null: nothing has passed yet. */
  countedTo: string | null
  branchId: number | null
  branchName: string | null
  standardDayMinutes: number
  standardDaysPerMonth: number
  generatedUtc: string
}

export interface WorkedTimeRow {
  employeeId: number
  fullName: string
  branchName: string
  departmentName: string
  daysWorked: number
  workedMinutes: number
  averageMinutes: number
  /** Beyond the shift, or the standard day without one — detected, not paid. */
  overtimeMinutes: number
  missingPunchDays: number
  leaveDays: number
  holidayDays: number
  expectedMinutes: number
  /** Worked / expected × 100; null when nothing was expected. */
  progressPercent: number | null
  /** Punched, not on an approved roster, waiting for a decision. Not in the figures above. */
  notOnRosterDays: number
  notOnRosterMinutes: number
}

export interface WorkedTimeDay {
  employeeId: number
  workDate: string
  branchName: string
  /** Present / RestDay / Holiday / Leave / Absent, or NotOnRoster. */
  kind: string
  /** Wall clock (Beirut). */
  firstIn: string | null
  lastOut: string | null
  workedMinutes: number
  overtimeMinutes: number
  missingPunch: boolean
  isManual: boolean
  /** A holiday's name, or 'HalfDay' for half a day of leave. */
  note: string | null
  /** The holiday's Arabic name, when it has one. */
  noteAr: string | null
}

export interface WorkedTimeReport {
  header: WorkedTimeHeader
  rows: WorkedTimeRow[]
  totals: WorkedTimeRow
  days: WorkedTimeDay[]
}
