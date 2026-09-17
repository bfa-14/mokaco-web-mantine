/**
 * Payroll — mirrors the backend Model/Payroll DTOs exactly.
 *
 * THREE THINGS THESE TYPES ARE BUILT TO KEEP TRUE, because they are what payroll gets wrong when it
 * goes wrong:
 *
 *  1. A LOCKED RUN IS IMMUTABLE. `lockedAt` (and `status === 'Approved'`) is not a styling hint — it
 *     is the signal that NOTHING on the screen may offer editing, regenerating or deleting. The
 *     server refuses anyway; the UI's job is to stop asking.
 *
 *  2. EVERY FIGURE IS TRACEABLE. A payslip line carries `sourceType` + `sourceId`, and — for the
 *     ones that came from a request — `requestInstanceId`, so the document can link back to what
 *     produced it.
 *
 *  3. CURRENCIES NEVER MERGE. Every money figure is a *Usd / *Lbp PAIR. There is exactly one field
 *     in this file where the two ever meet, `netPrimary`, and it is a COMPARABLE at the run's frozen
 *     rate — never a payable amount. Render it with "≈" and the rate beside it, or not at all.
 */

// ─────────────────────────────────── runs ──────────────────────────────────

/** Draft → Review → Approved, or Cancelled. Approved is terminal and locked. */
export type PayrollRunStatus = 'Draft' | 'Review' | 'Approved' | 'Cancelled'

/**
 * Primary is the monthly salary run. Supplemental is OFF-CYCLE: it pays approved, unconsumed
 * adjustments for a period whose primary is already locked, and computes no statutory
 * contributions — so a supplemental payslip carries no NSSF or tax line and no employer cost.
 *
 * The two share every endpoint from creation onwards; only the generator differs, and the server
 * picks it from the run's own type. Nothing in the client should ever send a type to /generate.
 */
export type PayrollRunType = 'Primary' | 'Supplemental'

/** One run in the list — GET /api/payroll/runs. */
export interface PayrollRunListItem {
  payrollRunId: number
  /** Format 2026-08. */
  periodYearMonth: string
  status: PayrollRunStatus
  runType: PayrollRunType
  primaryCurrency: string
  createdAt: string
  createdBy: string | null
  generatedAt: string | null
  approvedAt: string | null
  approvedBy: string | null
  /** Non-null is THE lock. */
  lockedAt: string | null
  payslipCount: number
  /** The "≈" comparable, at this run's frozen rates. Null while the run has no payslips. */
  totalNetPrimary: number | null
}

/** The whole run page — GET /api/payroll/runs/{id}, four result sets in one call. */
export interface PayrollRunDetail {
  /** Null never reaches the client: a missing run is a 404. */
  header: PayrollRunHeader
  rates: PayrollRunRate[]
  /**
   * Always present for a run that exists — the totals query is an aggregate with no GROUP BY, so an
   * ungenerated run still returns one row, reading payslipCount 0 with null sums.
   */
  totals: PayrollRunTotals | null
  events: PayrollRunEvent[]
}

export interface PayrollRunHeader {
  payrollRunId: number
  periodYearMonth: string
  periodStart: string
  periodEnd: string
  status: PayrollRunStatus
  runType: PayrollRunType
  primaryCurrency: string
  notes: string | null
  createdAt: string
  createdBy: string | null
  generatedAt: string | null
  approvedAt: string | null
  approvedBy: string | null
  lockedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
}

/**
 * One exchange rate FROZEN into the run when it was created.
 *
 * Frozen is the point: every payslip in this run converts at these numbers for as long as the run
 * exists, so a rate change next week cannot silently restate what people were paid. Print them —
 * a comparable figure without its rate is a number nobody can check.
 */
export interface PayrollRunRate {
  fromCurrency: string
  toCurrency: string
  rate: number
  /** Official / Market — whichever PayrollRateType named at creation. */
  rateType: string
  /** The date of the rate row that was snapshotted, not the date of the snapshot. */
  sourceEffectiveDate: string
}

/** The run's totals, per currency and never merged. */
export interface PayrollRunTotals {
  grossUsd: number | null
  grossLbp: number | null
  deductionsUsd: number | null
  deductionsLbp: number | null
  netUsd: number | null
  netLbp: number | null
  employerCostUsd: number | null
  employerCostLbp: number | null
  /** The ONLY cross-currency figure in payroll. Show it as "≈", with the frozen rate visible. */
  netPrimary: number | null
  payslipCount: number
  /** Payslips carrying a note. Amber above zero; clicking filters the grid to them. */
  payslipsWithWarnings: number
}

/** One entry in the run's history. */
export interface PayrollRunEvent {
  /** Created / Generated / Review / Approved / Cancelled. */
  action: string
  actedBy: string | null
  actedAt: string
  detail: string | null
}

export interface PayrollRunCreated {
  payrollRunId: number
  periodYearMonth: string
  status: PayrollRunStatus
  primaryCurrency: string
}

export interface PayrollRunStatusResult {
  payrollRunId: number
  status: PayrollRunStatus
  /** Stamped by approve only. */
  lockedAt: string | null
}

export interface PayrollRunGenerateResult {
  payrollRunId: number
  payslipCount: number
  payslipsWithWarnings: number
}

/** One line of the payment sheet — approved runs only; a draft is refused by the server. */
export interface PaymentSheetRow {
  payslipId: number
  employeeName: string
  branchName: string
  netUsd: number
  netLbp: number
  paymentMethod: string | null
  paymentReference: string | null
  paidAt: string | null
}

/**
 * The attendance gate — GET /api/payroll/readiness?period=2026-08.
 *
 * Seven counts and a verdict. `isReady` is true only when every count is zero, and the create
 * procedure runs this same check itself: the panel exists to make the refusal UNDERSTANDABLE before
 * anyone hits it, not to replace it. Never enable Create on a client-side re-derivation.
 */
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

export interface PayrollRunCreateRequest {
  periodYearMonth: string
  notes?: string | null
  /**
   * Omitted means Primary — the server's default, deliberately not restated here so only one layer
   * decides it. Every rule about when a Supplemental is allowed (the primary must be locked, only
   * one open at a time, something must actually be payable) is the procedure's, and its refusals
   * arrive as sentences to show verbatim.
   */
  runType?: PayrollRunType
}

// ───────────────────────────────── payslips ────────────────────────────────

/** One payslip in the run's grid — GET /api/payroll/runs/{id}/payslips. */
export interface PayslipRow {
  payslipId: number
  employeeId: number
  employeeName: string
  positionTitle: string
  branchName: string
  /** Days actually worked, as fractions. Null when nothing was recorded. */
  paidDayFraction: number | null
  unpaidLeaveDays: number | null
  paidLeaveDays: number | null
  overtimeMinutes: number | null
  grossUsd: number
  grossLbp: number
  deductionsUsd: number
  deductionsLbp: number
  netUsd: number
  netLbp: number
  netPrimary: number
  paymentMethod: string | null
  paidAt: string | null
  /**
   * The warning channel. The generator writes "NO BASIC SALARY ON FILE." or "NEGATIVE NET - review
   * deductions." here. Non-empty means the row wants a human — show THIS text, not a paraphrase.
   */
  notes: string | null
}

/** The payslip document — GET /api/payroll/payslips/{id}. */
export interface PayslipDetail {
  payslip: Payslip
  lines: PayslipLine[]
}

/**
 * The payslip. The identity fields are COPIES taken when it was generated, not joins to the employee
 * row: a payslip is a document about a moment, and renaming somebody next year must not restate what
 * their July payslip said. Render these, never a fresh lookup.
 */
export interface Payslip {
  payslipId: number
  payrollRunId: number
  employeeId: number
  employeeName: string
  positionTitle: string
  branchName: string
  nssfNumber: string | null
  hireDate: string
  paidDayFraction: number | null
  unpaidLeaveDays: number | null
  paidLeaveDays: number | null
  overtimeMinutes: number | null
  grossUsd: number
  grossLbp: number
  deductionsUsd: number
  deductionsLbp: number
  netUsd: number
  netLbp: number
  employerCostUsd: number
  employerCostLbp: number
  netPrimary: number
  paymentMethod: string | null
  paymentReference: string | null
  paidAt: string | null
  notes: string | null
  // --- the run this payslip belongs to ---
  periodYearMonth: string
  /** Payment is offered only on Approved; on Draft/Review the payment block is hidden entirely. */
  runStatus: PayrollRunStatus
  lockedAt: string | null
}

/** Where a payslip line came from. Attendance and Statutory have no single source row. */
export type PayslipLineSource =
  | 'Salary'
  | 'Leave'
  | 'Attendance'
  | 'Overtime'
  | 'Tip'
  | 'Expense'
  | 'Advance'
  | 'Adjustment'
  | 'Separation'
  | 'Statutory'

/**
 * One line, and its provenance.
 *
 * `sourceId` is the id in THAT source's own table — a salaryComponentId for Salary, an
 * overtimeRequestId for Overtime — which is why `requestInstanceId` exists separately: the request
 * pages are keyed by request instance, and the server resolves the two for the lines that have a
 * request behind them. Salary, Attendance, Advance, Adjustment and Statutory lines resolve to null
 * because no request produced them; their links go elsewhere.
 */
export interface PayslipLine {
  payslipLineId: number
  componentName: string
  /** Earning / Deduction / EmployerCost — the grouping the document is read in. */
  category: string
  /** +1 or -1. The amount is always positive; the sign says which way it moves. */
  sign: number
  amount: number
  currencyCode: string
  sourceType: PayslipLineSource
  sourceId: number | null
  /** Minutes for overtime, days for leave — whatever the unit rate is charged per. */
  quantity: number | null
  unitAmount: number | null
  note: string | null
  sortOrder: number
  /** The request behind this line, when there is one. Null otherwise. */
  requestInstanceId: number | null
}

export interface PayslipPaymentRequest {
  /** Bank or Cash. Anything else earns the server's own refusal. */
  paymentMethod: 'Bank' | 'Cash'
  paymentReference?: string | null
}

export interface PayslipPaymentResult {
  payslipId: number
  paymentMethod: string | null
  paymentReference: string | null
  paidAt: string | null
}

// ───────────────────────────────── advances ────────────────────────────────

/**
 * A salary advance.
 *
 * `remainingAmount` is the figure that matters, and APPROVING a run is what reduces it — not
 * generating one. A draft regenerated five times still owes the same amount, which is why the grid
 * shows the remaining balance in bold rather than anything derived from a pending run.
 */
export interface SalaryAdvance {
  salaryAdvanceId: number
  employeeId: number
  employeeName: string
  amount: number
  currencyCode: string
  advanceDate: string
  monthlyDeduction: number
  remainingAmount: number
  /** Format 2026-09 — no deduction is taken from a period before this one. */
  firstDeductionPeriod: string
  reason: string | null
  /** Set when the balance reaches zero. Settled rows are read-only. */
  isSettled: boolean
  createdBy: string | null
  createdAt: string
}

export interface SalaryAdvanceCreated {
  salaryAdvanceId: number
  remainingAmount: number
}

export interface SalaryAdvanceMonthlyResult {
  salaryAdvanceId: number
  monthlyDeduction: number
  remainingAmount: number
}

export interface SalaryAdvanceCreateRequest {
  employeeId: number
  amount: number
  currencyCode: string
  /** ISO date. */
  advanceDate: string
  monthlyDeduction: number
  /** Format 2026-09. */
  firstDeductionPeriod: string
  reason?: string | null
}

// ─────────────────────────────── adjustments ───────────────────────────────

/**
 * A correction aimed at a FUTURE period — the only way a locked run is ever put right.
 *
 * `appliedToPayslipId` non-null means a payslip consumed it, so it is now history: the delete is
 * refused, and the row shows as consumed rather than offering an action that cannot work.
 */
export interface PayrollAdjustment {
  payrollAdjustmentId: number
  employeeId: number
  employeeName: string
  componentName: string
  /** +1 or -1 from the component type. THE SIGN DECIDES DIRECTION; amount is always positive. */
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
  /**
   * The request that AUTHORISED this row. Null only for rows written before adjustments became a
   * request type — every row created from now on has one, and the grid links through it.
   */
  requestInstanceId: number | null
}

// The single-employee create shape that used to live here is gone with its endpoint. ONE adjustment
// is raised as a REQUEST now — see PayrollAdjustmentCreateRequest in types/workflow.ts.

/**
 * One adjustment for EVERY active employee — POST /api/payroll/adjustments/bulk, PAYROLL_APPROVE.
 *
 * The company-wide bonus, and the one direct create left. It is not a hole in the request chain:
 * the chain protects an INDIVIDUAL's pay from being changed unsigned, and applied here it would mean
 * one request per head for a decision taken once — so the trust is spent on the act instead, on the
 * same permission that locks a run.
 *
 * Rows this writes have no `requestInstanceId`, and the grid shows them as direct entries. That is
 * accurate: there are no signatures to link to.
 */
export interface PayrollAdjustmentBulkRequest {
  componentTypeId: number
  /** Always POSITIVE — the component type's sign decides direction. */
  amount: number
  currencyCode: string
  /** Format 2026-09. */
  targetPeriod: string
  /** Required by the procedure: it lands on every payslip line, and it is part of the re-run key. */
  reason: string
  /** Omitted or null means EVERY branch — the default, and the common case. */
  branchId?: number | null
}

/**
 * How many rows were actually written.
 *
 * NOT the headcount: the procedure skips anyone who already carries this component, period and
 * reason, so a second submit reports 0 rather than paying everybody twice. Show this number, never
 * the number of employees on screen.
 */
export interface PayrollAdjustmentBulkResult {
  employeesGiven: number
}

/**
 * A pay component the adjustment form may choose from.
 *
 * `isStanding` separates what a person is ASSIGNED (basic salary, allowances) from what a run
 * COMPUTES (overtime, NSSF, tax). Salary-component editing filters to isStanding; adjustments do
 * not, because a correction may legitimately target a computed component.
 */
/**
 * One employee's statutory position in a run — the sheet for the NSSF and the tax office.
 *
 * Every figure is in the run's PRIMARY currency, converted at the run's frozen rate. This is the
 * ONE deliberate exception to "currencies never merge", and it is safe for the same reason the
 * comparable net is: a contribution base is a single legal number, and the rate that produced it
 * is printed on the run beside it. Do not present these next to USD/LBP pairs without saying so.
 */
export interface StatutoryReportRow {
  payslipId: number
  employeeId: number
  employeeName: string
  nssfNumber: string | null
  branchName: string
  /** Wage lines only (salary, overtime, leave, attendance). Null when the payslip has none. */
  wageBasePrimary: number | null
  nssfEmployeeShare: number
  nssfEmployerShare: number
  incomeTax: number
}

/**
 * One of the signed-in user's OWN payslips — GET /api/me/payslips.
 *
 * APPROVED runs only, enforced server-side: nobody reads a draft of their own pay, because a draft
 * still changes and a number once seen is remembered as a promise.
 */
export interface MyPayslip {
  payslipId: number
  periodYearMonth: string
  runType: PayrollRunType
  netUsd: number
  netLbp: number
  netPrimary: number
  paymentMethod: string | null
  paidAt: string | null
}

/**
 * One payslip in an employee's history — the HR tab. Unlike {@link MyPayslip} this includes
 * unapproved runs and says which through `runStatus`, because HR is preparing the month.
 */
export interface EmployeePayslip {
  payslipId: number
  periodYearMonth: string
  runType: PayrollRunType
  runStatus: PayrollRunStatus
  grossUsd: number
  grossLbp: number
  netUsd: number
  netLbp: number
  netPrimary: number
  paymentMethod: string | null
  paidAt: string | null
}

/**
 * "Was this request ever paid?" — the answer for one (sourceType, sourceId) pair.
 *
 * The endpoint 404s when nothing has paid it, so the caller renders its badge only on a hit and
 * treats the 404 as ordinary, not as an error worth surfacing.
 */
export interface PayslipLineLookup {
  payslipId: number
  payrollRunId: number
  periodYearMonth: string
  runType: PayrollRunType
  runStatus: PayrollRunStatus
}

export interface PayrollComponentType {
  componentTypeId: number
  name: string
  /** Earning / Deduction / EmployerCost. */
  category: string
  sign: number
  isStanding: boolean
}

/* ────────────────────────────────────────────────────────────────────────────
   TIERS & CEILINGS — the rate tables payroll computes from.

   THE API CONTRACT THESE MIRROR (hr.TAX_BRACKET / hr.NSSF_RATE, through
   hr.usp_TaxBracket_* / hr.usp_NssfRate_*), named per this codebase's usual
   PascalCase-column → camelCase-JSON mapping.

   RATES ARE FRACTIONS, NOT PERCENTAGES. The procedures validate 0..1, so 0.08
   is eight percent. The screens show percent because that is how the law and
   every payroll conversation state it, and convert on the way in and out — the
   wire value is never a percentage.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * One income-tax tier: the slice of annual income between a floor and a ceiling, and the rate
 * that applies to it.
 *
 * `maxAnnual` null is the TOP tier — open-ended, everything above the last floor. Exactly one
 * tier per currency and period should have it, which is what the gap/overlap check downstream
 * is looking for.
 */
export interface TaxBracket {
  taxBracketId: number
  /** Annual income at which this tier starts. */
  minAnnual: number
  /** Annual income at which it stops. null = the top, open-ended tier ("and above"). */
  maxAnnual: number | null
  /** 0..1. Shown as a percentage; stored and sent as a fraction. */
  rate: number
  currencyCode: string
  effectiveFrom: string
  /** null = still in force. */
  effectiveTo: string | null
  note: string | null
}

/**
 * One NSSF scheme version: its two contribution rates and, new here, its OWN salary ceiling.
 *
 * Rates change by decree, so a scheme is VERSIONED rather than overwritten — a new row with a
 * later effectiveFrom, leaving the old one intact so a re-run of an old month still computes what
 * it computed at the time. That is what the "New version" action exists for.
 *
 * `ceilingAmount` null on a ceilinged scheme means "use the global NssfCeilingUsd setting", which
 * is what every scheme did before per-scheme ceilings existed. Leaving it empty is therefore the
 * no-change answer, and the reason existing payroll behaviour is untouched until somebody types a
 * value.
 */
export interface NssfRate {
  nssfRateId: number
  /** The scheme's name, as the NSSF states it. */
  scheme: string
  /** 0..1. The employee's share. */
  employeeRate: number
  /** 0..1. The employer's share. */
  employerRate: number
  /** Whether contributions stop above a salary ceiling at all. */
  isCeilinged: boolean
  /** This scheme's own ceiling. null on a ceilinged scheme = fall back to NssfCeilingUsd. */
  ceilingAmount: number | null
  effectiveFrom: string
  /** null = still in force. */
  effectiveTo: string | null
  note: string | null
}

/** POST/PUT /api/payroll/tax-brackets — the id travels in the route, never the body. */
export interface TaxBracketUpsertRequest {
  minAnnual: number
  maxAnnual: number | null
  rate: number
  currencyCode: string
  effectiveFrom: string
  effectiveTo: string | null
  note: string | null
}

/** POST/PUT /api/payroll/nssf-rates. */
export interface NssfRateUpsertRequest {
  scheme: string
  employeeRate: number
  employerRate: number
  isCeilinged: boolean
  ceilingAmount: number | null
  effectiveFrom: string
  effectiveTo: string | null
  note: string | null
}

/**
 * The global fallback ceiling, in core.SETTING. Applies to any ceilinged scheme that has no
 * ceiling of its own — see NssfRate.ceilingAmount.
 */
export const NSSF_CEILING_USD_KEY = 'NssfCeilingUsd'
