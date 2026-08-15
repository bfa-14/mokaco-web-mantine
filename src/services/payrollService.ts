/* src/services/payrollService.ts — every payroll endpoint, one object per area. */
import { apiRequest } from '../api/client'
import type {
  AttendanceReadiness, EmployeePayslip, MyPayslip, NssfRate, NssfRateUpsertRequest,
  PayrollAdjustment, PayrollComponentType,
  PayrollRunCreateRequest, PayrollRunDetail, PayrollRunListItem, PayslipDetail, PayslipLineLookup,
  PayslipRow, SalaryAdvance, StatutoryReportRow, TaxBracket, TaxBracketUpsertRequest,
} from '../types/payroll'

/** Payroll runs — the month lifecycle. All endpoints require PAYROLL_MANAGE. */
export const payrollRunsService = {
  getList: () => apiRequest<PayrollRunListItem[]>('/api/payroll/runs'),
  get: (id: number) => apiRequest<PayrollRunDetail>(`/api/payroll/runs/${id}`),
  getPayslips: (id: number) => apiRequest<PayslipRow[]>(`/api/payroll/runs/${id}/payslips`),
  readiness: (period: string) =>
    apiRequest<AttendanceReadiness>(`/api/payroll/readiness?period=${encodeURIComponent(period)}`),
  /** `runType` omitted means Primary — the server's default, not restated here. */
  create: (body: PayrollRunCreateRequest) =>
    apiRequest<{ payrollRunId: number }>('/api/payroll/runs', {
      method: 'POST', body: JSON.stringify(body),
    }),
  generate: (id: number) =>
    apiRequest<{ payslipCount: number; payslipsWithWarnings: number }>(
      `/api/payroll/runs/${id}/generate`, { method: 'POST' }),
  sendToReview: (id: number) =>
    apiRequest<{ status: string }>(`/api/payroll/runs/${id}/send-to-review`, { method: 'POST' }),
  approve: (id: number) =>
    apiRequest<{ status: string; lockedAt: string }>(`/api/payroll/runs/${id}/approve`, { method: 'POST' }),
  cancel: (id: number, reason: string) =>
    apiRequest<{ status: string }>(`/api/payroll/runs/${id}/cancel`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }),
  paymentSheet: (id: number) =>
    apiRequest<PayslipRow[]>(`/api/payroll/runs/${id}/payment-sheet`),

  /** The NSSF/tax sheet for a run. Figures are in the run's primary currency — say so when shown. */
  statutoryReport: (id: number) =>
    apiRequest<StatutoryReportRow[]>(`/api/payroll/runs/${id}/statutory-report`),
}

export const payslipsService = {
  /**
   * One payslip. Readable by a PAYROLL_RUN holder, OR by the employee it is about once the run is
   * approved — so this is safe to call from "My payslips" without a permission check first. A 403
   * is the honest answer for somebody else's slip and should be shown, not swallowed.
   */
  get: (id: number) => apiRequest<PayslipDetail>(`/api/payroll/payslips/${id}`),

  /** The caller's own payslips. Authentication only — everybody is paid, so everybody may look. */
  mine: () => apiRequest<MyPayslip[]>('/api/me/payslips'),

  /** One employee's payslips across every run, drafts included — the HR tab. Managerial. */
  forEmployee: (employeeId: number) =>
    apiRequest<EmployeePayslip[]>(`/api/payroll/employees/${employeeId}/payslips`),

  /**
   * "Was this request paid?" Resolves to null on a 404, which is the ordinary "not yet" answer —
   * callers render their badge only when this is non-null.
   */
  lineLookup: (sourceType: string, sourceId: number) =>
    apiRequest<PayslipLineLookup>(
      `/api/payroll/lines/lookup?sourceType=${encodeURIComponent(sourceType)}&sourceId=${sourceId}`,
    ).catch(() => null),
  setPayment: (id: number, body: { paymentMethod: 'Bank' | 'Cash'; paymentReference?: string | null }) =>
    apiRequest<{ paidAt: string }>(`/api/payroll/payslips/${id}/payment`, {
      method: 'POST', body: JSON.stringify(body),
    }),
}

export const advancesService = {
  getList: (opts?: { employeeId?: number; openOnly?: boolean }) => {
    const p = new URLSearchParams()
    if (opts?.employeeId) p.set('employeeId', String(opts.employeeId))
    p.set('openOnly', opts?.openOnly === false ? 'false' : 'true')
    return apiRequest<SalaryAdvance[]>(`/api/payroll/advances?${p}`)
  },
  /*
   * THERE IS NO create HERE, and that is deliberate. An advance comes into existence ONLY through
   * an approved SALARY_ADVANCE request — the payroll row is written by the final approval, and
   * payroll.usp_Advance_Create refuses outright and points at the request type. The direct-create
   * this file used to expose posted to /api/payroll/advances, a route the API has never had: the
   * button wrote to a wall. Raise a request instead.
   */
  updateMonthly: (id: number, monthlyDeduction: number) =>
    apiRequest<{ monthlyDeduction: number }>(`/api/payroll/advances/${id}/monthly`, {
      method: 'PUT', body: JSON.stringify({ monthlyDeduction }),
    }),
}

export const adjustmentsService = {
  getForPeriod: (period: string) =>
    apiRequest<PayrollAdjustment[]>(`/api/payroll/adjustments?period=${encodeURIComponent(period)}`),
  // NO create. An adjustment is raised as a request — payrollAdjustmentsService.create in
  // workflowService.ts — and both the route and its procedure are gone/refusing.
  /**
   * Still a live endpoint, and nothing in the app calls it: the procedure now refuses a consumed
   * row AND a request-authorised one, which between them is every row the app can produce. Kept
   * because the pre-request rows are still deletable, and removing the last caller does not remove
   * the reason the endpoint exists.
   */
  remove: (id: number) =>
    apiRequest<{ deleted: number }>(`/api/payroll/adjustments/${id}`, { method: 'DELETE' }),
  componentTypes: () =>
    apiRequest<PayrollComponentType[]>('/api/payroll/component-types'),
}

/**
 * INCOME TAX TIERS — hr.TAX_BRACKET, through hr.usp_TaxBracket_*. PAYROLL_RUN throughout.
 *
 * `rate` crosses the wire as a FRACTION (0..1), which is what the procedure validates. The screen
 * shows percent; the conversion belongs at the edge, not here.
 */
export const taxBracketsService = {
  getAll: () => apiRequest<TaxBracket[]>('/api/payroll/tax-brackets'),
  create: (body: TaxBracketUpsertRequest) =>
    apiRequest<TaxBracket>('/api/payroll/tax-brackets', {
      method: 'POST', body: JSON.stringify(body),
    }),
  update: (id: number, body: TaxBracketUpsertRequest) =>
    apiRequest<TaxBracket>(`/api/payroll/tax-brackets/${id}`, {
      method: 'PUT', body: JSON.stringify(body),
    }),
  remove: (id: number) =>
    apiRequest<void>(`/api/payroll/tax-brackets/${id}`, { method: 'DELETE' }),
}

/**
 * NSSF SCHEMES — hr.NSSF_RATE, through hr.usp_NssfRate_*. PAYROLL_RUN throughout.
 *
 * NO remove, and that is the point: a scheme's rates are law at a date, and payslips already
 * computed from a row are explained by it. A rate that changes gets a NEW row with a later
 * effectiveFrom — which is what the page's "New version" action creates — so re-running an old
 * month still computes what it computed at the time. The procedures offer no delete either.
 */
export const nssfRatesService = {
  getAll: () => apiRequest<NssfRate[]>('/api/payroll/nssf-rates'),
  create: (body: NssfRateUpsertRequest) =>
    apiRequest<NssfRate>('/api/payroll/nssf-rates', {
      method: 'POST', body: JSON.stringify(body),
    }),
  update: (id: number, body: NssfRateUpsertRequest) =>
    apiRequest<NssfRate>(`/api/payroll/nssf-rates/${id}`, {
      method: 'PUT', body: JSON.stringify(body),
    }),
}
