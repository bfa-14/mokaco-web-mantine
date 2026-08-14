/**
 * The home page — GET /api/dashboard, the ten result sets of core.usp_Dashboard_Get.
 *
 * Mirrors the backend `Dashboard` DTO exactly. It is an OPERATIONAL page: everything here is
 * something to act on today. Nothing describes the SHAPE of the company — headcount by department,
 * who joined last quarter — because that is reference material, and it lives on the HR and Reports
 * screens where somebody has deliberately gone looking for it.
 *
 * WHAT A USER MAY SEE IS DECIDED IN SQL. The procedure works out from the caller's roles whether they
 * are managerial and returns NOTHING in the managerial sets otherwise, so an ordinary employee's
 * response never carries company-wide figures at all. `companySnapshot === null` is therefore the
 * authoritative "not managerial" signal, and the page reads it as such rather than re-deciding from
 * roles or permissions in the browser — two opinions on who may see payroll totals is one too many.
 */
export interface Dashboard {
  waitingOnMe: WaitingOnMeItem[]
  myRequests: MyOpenRequest[]
  recentActivity: DashboardActivity[]
  leaveBalances: DashboardLeaveBalance[]
  coverageGaps: CoverageGap[]
  /** Null for a non-managerial caller — and that null is what hides every managerial card. */
  companySnapshot: CompanySnapshot | null
  staffingToday: BranchStaffing[]
  onLeaveToday: OnLeaveTodayItem[]
  workflowByType: OpenRequestsByType[]
  monthMoney: MonthMoneyLine[]
}

/**
 * One request waiting on the caller's decision.
 *
 * `totalCount` repeats on every row and is the TRUE total — the procedure returns only the five
 * oldest, so the list length is not the count. Zero rows means zero waiting, so
 * `rows[0]?.totalCount ?? 0` is always the right read.
 */
export interface WaitingOnMeItem {
  totalCount: number
  requestInstanceId: number
  title: string | null
  requestTypeCode: string
  requestTypeName: string
  submittedAt: string
  /** Whole days since submission. Past 3 the row turns amber. */
  ageDays: number
}

/** One of the caller's own open requests. `totalCount` is the true total; see {@link WaitingOnMeItem}. */
export interface MyOpenRequest {
  totalCount: number
  requestInstanceId: number
  title: string | null
  requestTypeName: string
  status: string
  currentStepNo: number | null
  submittedAt: string
}

/** A decision somebody took on one of the caller's own requests. */
export interface DashboardActivity {
  requestInstanceId: number
  title: string | null
  /** Approved / Rejected / Skipped / VersionMoved. */
  action: string
  /** Null for a step the engine skipped — nobody acted, so nobody is named. */
  actedBy: string | null
  actedAt: string
}

/** The caller's standing in one leave type: what a full year grants, and what is left. */
export interface DashboardLeaveBalance {
  leaveTypeId: number
  leaveTypeName: string
  isPaid: boolean
  annualEntitlementDays: number | null
  currentBalance: number
}

/** A request type nobody can raise, because no chain has ever been published for it. */
export interface CoverageGap {
  requestTypeId: number
  code: string
  name: string
}

/** The company-wide counters. Present only for a managerial caller. */
export interface CompanySnapshot {
  activeEmployees: number
  openRequests: number
  approvedLast30Days: number
  activeChains: number
  /**
   * Whether the destructive system-reset switch is armed. Null when the setting has never been
   * written — "nobody configured this" is not the same claim as "it is off", so the red strip
   * appears only on a definite true.
   */
  resetArmed: boolean | null
}

/**
 * One branch's cover today. `rosteredToday` counts the ROSTER — who is scheduled — not who has
 * clocked in. The label on screen says "Rostered" for exactly that reason: read as attendance, a
 * normal 9am would look like half the branch failing to turn up.
 */
export interface BranchStaffing {
  branchId: number
  branchName: string
  rosteredToday: number
  onLeaveToday: number
}

/** One person on approved leave today, with the request that granted it. */
export interface OnLeaveTodayItem {
  fullName: string
  branchName: string
  leaveTypeName: string
  fromDate: string
  toDate: string
  requestInstanceId: number
}

/** Open requests of one type, and how long the oldest has been waiting. */
export interface OpenRequestsByType {
  code: string
  name: string
  openCount: number
  oldestAgeDays: number | null
}

/**
 * One line of this month's money, per currency.
 *
 * MONEY AND TIME ARE NOT THE SAME COLUMN, deliberately. Expenses and tips carry an `amount` in a
 * named `currencyCode`; overtime carries `minutes` and no currency, because pricing an hour is
 * payroll's job and any figure this page invented for it would be wrong.
 *
 * The overtime line is an aggregate with no GROUP BY, so SQL emits it even for a month with nothing
 * in it — as an all-null row. Rows with neither an amount nor minutes mean "nothing this month" and
 * are dropped before rendering.
 */
export interface MonthMoneyLine {
  item: string
  currencyCode: string | null
  amount: number | null
  minutes: number | null
}
