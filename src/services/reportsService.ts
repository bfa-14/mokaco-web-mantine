import { apiRequest } from '../api/client'
import type {
  DailyAttendanceHeader,
  DailyAttendanceRow,
  LeaveBalanceHeader,
  LeaveBalanceRow,
  MonthlyAttendanceHeader,
  MonthlyAttendanceRow,
  ReportResult,
} from '../types/reports'

/** The printable reports. All read-only, all gated on ATTENDANCE_VIEW. Each returns { header, rows }. */
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
}
