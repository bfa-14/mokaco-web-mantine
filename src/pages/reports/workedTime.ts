/**
 * WORKED TIME — the pure parts of the report page: the period shortcuts, the progress tone and the CSV.
 * No imports beyond types: `npm test` reads this file directly.
 */
import type { WorkedTimeDay, WorkedTimeReport, WorkedTimeRow } from '../../types/reports'

/** The month of a 'yyyy-MM-dd' day, first to last day. `offset` -1 is the month before. */
export function monthOf(day: string, offset = 0): { from: string; to: string } {
  const [y, m] = day.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + offset, 1))
  const last = new Date(Date.UTC(y, m + offset, 0))
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) }
}

/** How the progress reads: on track (95% and up), a little behind (80% and up), behind, or nothing expected. */
export function progressTone(percent: number | null): 'ok' | 'warn' | 'low' | 'none' {
  if (percent == null) return 'none'
  if (percent >= 95) return 'ok'
  if (percent >= 80) return 'warn'
  return 'low'
}

/** The days of one employee, in date order (the report sends them grouped already; this keeps the page honest). */
export function daysOf(report: WorkedTimeReport, employeeId: number): WorkedTimeDay[] {
  return report.days.filter((d) => d.employeeId === employeeId).sort((a, b) => a.workDate.localeCompare(b.workDate))
}

/** Minutes as decimal hours with two places, the way a spreadsheet adds them up. */
export function hoursOf(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100
}

/**
 * The CSV: one line per employee and a totals line, hours as decimal numbers so the sheet can add them up.
 * `label` gives the column titles in the reader's language.
 */
export function workedTimeCsvRows(
  report: WorkedTimeReport,
  label: (key: string) => string,
): { header: string[]; rows: (string | number | null)[][] } {
  const header = [
    label('employee'),
    label('branch'),
    label('department'),
    label('daysWorked'),
    label('workedHours'),
    label('averageHours'),
    label('expectedHours'),
    label('progress'),
    label('overtimeHours'),
    label('missingPunch'),
    label('leaveDays'),
    label('holidays'),
    label('notOnRosterDays'),
    label('notOnRosterHours'),
  ]
  const line = (r: WorkedTimeRow, name: string) => [
    name,
    r.branchName,
    r.departmentName,
    r.daysWorked,
    hoursOf(r.workedMinutes),
    hoursOf(r.averageMinutes),
    hoursOf(r.expectedMinutes),
    r.progressPercent,
    hoursOf(r.overtimeMinutes),
    r.missingPunchDays,
    r.leaveDays,
    r.holidayDays,
    r.notOnRosterDays,
    hoursOf(r.notOnRosterMinutes),
  ]
  return {
    header,
    rows: [...report.rows.map((r) => line(r, r.fullName)), line({ ...report.totals, branchName: '', departmentName: '' }, label('totals'))],
  }
}
