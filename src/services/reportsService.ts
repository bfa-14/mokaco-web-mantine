import { apiRequest } from '../api/client'
import type {
  DailyAttendanceHeader,
  DailyAttendanceRow,
  LeaveBalanceHeader,
  LeaveBalanceRow,
  MonthlyAttendanceHeader,
  MonthlyAttendanceRow,
  ReportResult,
  WorkedTimeReport,
} from '../types/reports'

/** The printable reports. All read-only, all gated on REPORT_VIEW. Each returns { header, rows } (Worked time adds totals and days). */
export const reportsService = {
  monthlyAttendance: (period: string, branchId?: number) =>
    apiRequest<ReportResult<MonthlyAttendanceHeader, MonthlyAttendanceRow>>(
      `/api/reports/monthly-attendance?period=${encodeURIComponent(period)}` +
        (branchId ? `&branchId=${branchId}` : ''),
    ),

  dailyAttendance: (workDate: string, branchId?: number) =>
    apiRequest<ReportResult<DailyAttendanceHeader, DailyAttendanceRow>>(
      `/api/reports/daily-attendance?workDate=${encodeURIComponent(workDate)}` +
        (branchId ? `&branchId=${branchId}` : ''),
    ),

  leaveBalance: (asOf: string, employeeId?: number, branchId?: number) =>
    apiRequest<ReportResult<LeaveBalanceHeader, LeaveBalanceRow>>(
      `/api/reports/leave-balance?asOf=${encodeURIComponent(asOf)}` +
        (employeeId ? `&employeeId=${employeeId}` : '') +
        (branchId ? `&branchId=${branchId}` : ''),
    ),

  /** Worked time (script 113): days and hours worked and progress, for a period of at most 93 days. */
  workedTime: (from: string, to: string, branchId?: number, employeeId?: number) =>
    apiRequest<WorkedTimeReport>(
      `/api/reports/worked-time?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` +
        (branchId ? `&branchId=${branchId}` : '') +
        (employeeId ? `&employeeId=${employeeId}` : ''),
    ),
}
