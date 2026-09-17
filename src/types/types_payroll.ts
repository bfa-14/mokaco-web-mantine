/* src/types/payroll.ts — mirrors the payroll procedures' result sets exactly. */

export interface PayrollRunListItem {
  payrollRunId: number
  periodYearMonth: string
  status: 'Draft' | 'Review' | 'Approved' | 'Cancelled'
  primaryCurrency: string
  createdAt: string
  createdBy: string | null
  generatedAt: string | null
  approvedAt: string | null
  approvedBy: string | null
  lockedAt: string | null
  payslipCount: number
  totalNetPrimary: number | null
}

export interface PayrollRunHeader extends Omit<PayrollRunListItem, 'payslipCount' | 'totalNetPrimary'> {
  periodStart: string
  periodEnd: string
  notes: string | null
  cancelledAt: string | null
  cancelReason: string | null
}

export interface PayrollRunRate {
  fromCurrency: string
  toCurrency: string
  rate: number
  rateType: string
  sourceEffectiveDate: string
}

export interface PayrollRunTotals {
  grossUsd: number; grossLbp: number
  deductionsUsd: number; deductionsLbp: number
  netUsd: number; netLbp: number
  employerCostUsd: number; employerCostLbp: number
  netPrimary: number
  payslipCount: number
  payslipsWithWarnings: number
}

export interface PayrollRunEvent {
  action: string
  actedBy: string | null
  actedAt: string
  detail: string | null
}

export interface PayrollRunDetail {
  header: PayrollRunHeader | null
  rates: PayrollRunRate[]
  totals: PayrollRunTotals | null
  events: PayrollRunEvent[]
}

export interface PayslipRow {
  payslipId: number
  employeeId: number
  employeeName: string
  positionTitle: string
  branchName: string
  paidDayFraction: number | null
  unpaidLeaveDays: number | null
  paidLeaveDays: number | null
  overtimeMinutes: number | null
  grossUsd: number; grossLbp: number
  deductionsUsd: number; deductionsLbp: number
  netUsd: number; netLbp: number
  netPrimary: number
  paymentMethod: string | null
  paidAt: string | null
  notes: string | null
}

export interface PayslipHeader extends PayslipRow {
  payrollRunId: number
  nssfNumber: string | null
  hireDate: string
  employerCostUsd: number
  employerCostLbp: number
  paymentReference: string | null
  periodYearMonth: string
  runStatus: string
  lockedAt: string | null
}

export interface PayslipLine {
  payslipLineId: number
  componentName: string
  category: 'Earning' | 'Deduction' | 'EmployerCost'
  sign: number
  amount: number
  currencyCode: string
  sourceType: string
  sourceId: number | null
  quantity: number | null
  unitAmount: number | null
  note: string | null
  sortOrder: number
}

export interface PayslipDetail {
  payslip: PayslipHeader | null
  lines: PayslipLine[]
}

export interface AttendanceReadiness {
  periodYearMonth: string
  periodStart: string
  periodEnd: string
  unprocessedPunches: number
  unresolvedPinPunches: number
  openAnomalies: number
  pendingCorrections: number
  rosteredDaysWithNoRecord: number
  undecidedExitVariances: number
  /** Late / early / missing-punch anomalies HR has not excused, deducted or corrected. */
  undecidedAnomalies: number
  isReady: boolean
}

export interface SalaryAdvance {
  salaryAdvanceId: number
  employeeId: number
  employeeName: string
  amount: number
  currencyCode: string
  advanceDate: string
  monthlyDeduction: number
  remainingAmount: number
  firstDeductionPeriod: string
  reason: string | null
  isSettled: boolean
  createdBy: string | null
  createdAt: string
}

export interface PayrollAdjustment {
  payrollAdjustmentId: number
  employeeId: number
  employeeName: string
  componentName: string
  sign: number
  amount: number
  currencyCode: string
  targetPeriod: string
  correctsRunId: number | null
  correctsPeriod: string | null
  reason: string
  appliedToPayslipId: number | null
  createdBy: string | null
  createdAt: string
}

export interface PayrollComponentType {
  componentTypeId: number
  name: string
  category: string
  sign: number
  isStanding: boolean
}
