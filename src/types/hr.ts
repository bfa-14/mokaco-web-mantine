/** hr.BRANCH — GET /api/branches. */
export interface Branch {
  branchId: number
  name: string
  isActive: boolean
}

/** hr.DEPARTMENT — GET /api/departments. */
export interface Department {
  departmentId: number
  name: string
  isActive: boolean
}

/** hr.[POSITION] — GET /api/positions. */
export interface Position {
  positionId: number
  title: string
  isActive: boolean
}

/** hr.COMPONENT_TYPE — GET /api/component-types. */
export interface ComponentType {
  componentTypeId: number
  name: string
  /**
   * The Arabic name, when somebody has supplied one. NULLABLE AND OFTEN ABSENT — see
   * src/i18n/referenceName.ts; read it through referenceName() rather than directly, so an
   * untranslated row falls back to the English name instead of rendering blank.
   */
  nameAr?: string | null
  category: string // Earning / Deduction
  sign: number // +1 / -1
}

/** hr.LEAVE_TYPE — GET /api/leave-types. */
export interface LeaveType {
  leaveTypeId: number
  name: string
  /**
   * The Arabic name, when somebody has supplied one. NULLABLE AND OFTEN ABSENT — see
   * src/i18n/referenceName.ts; read it through referenceName() rather than directly, so an
   * untranslated row falls back to the English name instead of rendering blank.
   */
  nameAr?: string | null
  isPaid: boolean
  carryOver: boolean

  /* ── policy. Every one of these is ENFORCED in the leave-request procedures; they are read here
     only so the form can say what a type needs BEFORE someone submits and is refused. Nothing in
     the client may treat them as the rule itself. ── */

  /** Approval is REFUSED until the request carries an attachment (usp_LeaveRequest_Decide). */
  requiresCertificate: boolean
  /** Months of service before this type may be USED. The balance accrues from hire regardless. */
  minServiceMonthsToUse: number
  /** Preferred notice. Advisory — short notice warns on the create response, never blocks. */
  noticePreferredDays: number
  /** A whole entitlement (maternity), not a per-request cap. Null when the type has none. */
  fixedEntitlementDays: number | null
  /** Granted at the approver's discretion rather than by entitlement. */
  isDiscretionary: boolean
}

/**
 * One (leave type, relation) entitlement — GET /api/leave-types/relation-entitlements.
 *
 * A type with NO rows here needs no relation, which is exactly the test usp_LeaveRequest_Create
 * makes. So the form asks THIS whether to show the relation dropdown, never a type name: Bereavement
 * is simply the only type with rows today, and a second one later needs a row, not a release.
 */
export interface LeaveRelationEntitlement {
  leaveTypeId: number
  leaveTypeName: string
  relation: string
  /** The most days this relation entitles. The procedure refuses a longer request. */
  days: number
}

/**
 * Annual-leave entitlement by tenure. "From minServiceYears of service, the entitlement is
 * annualDays a year": 0 → 15, 5 → 21.
 *
 * A TIER IS A FLOOR, not a band — the highest tier at or below the employee's tenure applies — so
 * tiers need no upper bound and inserting one in the middle cannot leave a gap.
 */
export interface LeaveAccrualTier {
  leaveTypeId: number
  minServiceYears: number
  annualDays: number
}

/** Sick pay by tenure: days at full pay and days at half, from minServiceYears. Same floor rule. */
export interface LeavePayTier {
  leaveTypeId: number
  minServiceYears: number
  fullPayDays: number
  halfPayDays: number
}

/**
 * The whole leave policy in one read (GET /api/leave-policy). One call rather than four because the
 * screen is meaningless in pieces: which grids a type shows depends on whether it HAS tiers or
 * relations, so a partial answer would render a page that then rearranges itself.
 */
export interface LeavePolicy {
  types: LeaveType[]
  accrualTiers: LeaveAccrualTier[]
  payTiers: LeavePayTier[]
  relations: LeaveRelationEntitlement[]
}

/**
 * Create or update a leave type. EVERY POLICY FIELD IS OPTIONAL, and omitting one on an update
 * KEEPS ITS STORED VALUE — that is what stops the older leave-types screen (which knows only the
 * first four fields) from clearing the certificate rule, the service gate and the notice period
 * whenever someone renames a type there.
 */
/**
 * One leave type's line in what POST /api/leave/year-open did.
 *
 * THE YEARLY OPENING IS THE ONLY GRANTING PATH — there is no monthly accrual. The figures are
 * independent: an employee can be granted this year AND have last year's remainder carried in, or
 * granted it and have last year's expire, by the type's own carry-over rule.
 */
export interface LeaveYearOpenSummary {
  leaveTypeName: string
  /** Employees this run opened. Already-opened ones are skipped, so a second run reports 0. */
  employeesOpened: number
  daysGranted: number
  /**
   * How many of those got a PART year — hired partway through it. Above zero, headcount × annual
   * entitlement will not equal daysGranted, which is the only thing that explains the difference.
   */
  proratedEmployees: number
  /** Last year's unused days brought forward — types WITH carry over. */
  daysCarriedOver: number
  /** Last year's unused days written off — types WITHOUT carry over. */
  daysExpired: number
}

export interface LeaveTypeUpsertRequest {
  name: string
  isPaid: boolean
  carryOver: boolean
  requiresCertificate?: boolean | null
  minServiceMonthsToUse?: number | null
  noticePreferredDays?: number | null
  fixedEntitlementDays?: number | null
  /** Clears fixedEntitlementDays back to null — which omitting the field alone cannot express. */
  clearFixedEntitlement?: boolean
  isDiscretionary?: boolean | null
}

/** Grid row from GET /api/employees (resolved lookup names). */
export interface EmployeeListItem {
  employeeId: number
  fullName: string
  nationalId: string | null
  nssfNumber: string | null
  hireDate: string
  terminationDate: string | null
  /** A tier NUMBER — 1 is the head, bigger is more junior. Its word comes from the tier dictionary. */
  approvalTier: number
  branch: string
  department: string
  position: string
}

/**
 * One row of GET /api/employees/login-status — an employee and how they sign in.
 *
 * `hasLogin` drives the three visible states: no login, linked+active, linked+disabled
 * (hasLogin true but userIsActive false). `warning` is non-null ONLY for the case that quietly
 * breaks approvals: a branch manager who cannot approve because they have no login or a disabled
 * one. It carries the exact text to show — never invent one.
 */
export interface EmployeeLoginStatus {
  employeeId: number
  fullName: string
  branchId: number
  branchName: string
  positionName: string | null
  userId: number | null
  username: string | null
  /** Null when there is no linked account (nothing to be active). */
  userIsActive: boolean | null
  hasLogin: boolean
  isBranchManager: boolean
  warning: string | null
}

/** Result of PUT /api/employees/{id}/user. `warning` is set when the linked account is disabled. */
export interface EmployeeLinkResult {
  employeeId: number
  fullName: string
  userId: number
  username: string
  userIsActive: boolean
  warning: string | null
}

/**
 * Result of DELETE /api/employees/{id}/user. Reports the cost of the unlink so the UI can confirm
 * it — `requestsLeftWaiting` is how many pending requests can no longer be signed by this person.
 */
export interface EmployeeUnlinkResult {
  employeeId: number
  wasBranchManager: boolean
  requestsLeftWaiting: number
  warning: string | null
}

/** A salary-component line inside the employee profile. */
export interface SalaryComponentLine {
  salaryComponentId: number
  componentName: string
  amount: number
  currencyCode: string
  effectiveFrom: string
  effectiveTo: string | null
}

/** Full employee profile — GET /api/employees/{id}. */
export interface EmployeeProfile {
  employeeId: number
  userId: number | null
  branchId: number
  departmentId: number
  positionId: number
  fullName: string
  nationalId: string | null
  nssfNumber: string | null
  hireDate: string
  terminationDate: string | null
  /**
   * How the person is reached. Both optional and stored NULL rather than empty.
   *
   * EMAIL IS ALSO AN ADDRESS THE SYSTEM WRITES TO — the closing-request notification goes here,
   * and somebody with none simply gets no mail rather than a queued one that cannot be delivered.
   * Phone is stored and displayed only; nothing sends to it yet.
   */
  email: string | null
  phoneNumber: string | null
  /**
   * 'en' or 'ar' — WHICH LANGUAGE THIS PERSON IS WRITTEN TO IN, not the one they browse in.
   *
   * A property of the EMPLOYEE, not of the session: the closing notification is composed by a
   * background worker at a moment when nobody is signed in, so there is no UI language to borrow.
   * It is copied onto the outbox row when the message is queued and frozen there.
   */
  preferredLanguage: string
  /** A tier NUMBER (1 = head) — set via its own PUT, not the update body. Named by the dictionary. */
  approvalTier: number
  /** Who this person reports to — set via its own PUT. Null for the top of a reporting line. */
  reportsToEmployeeId: number | null
  isDeleted: boolean
  createdAt: string
  createdBy: number | null
  modifiedAt: string | null
  modifiedBy: number | null
  /** The manager's name (resolved from reportsToEmployeeId), so the form shows it before the list loads. */
  reportsToName: string | null
  branchName: string
  departmentName: string
  positionTitle: string
  salaryComponents: SalaryComponentLine[]
}

/** POST /api/employees. */
export interface EmployeeCreateRequest {
  userId: number | null
  branchId: number
  departmentId: number
  positionId: number
  fullName: string
  nationalId: string | null
  nssfNumber: string | null
  hireDate: string
  /** Optional. Send null, never "" — the procedure NULLIFs a blank anyway, but null is the honest wire value. */
  email: string | null
  phoneNumber: string | null
  /** 'en' or 'ar'. The procedure defaults it to 'en' and folds anything unrecognised down to it. */
  preferredLanguage: string
}

/** PUT /api/employees/{id}. */
export interface EmployeeUpdateRequest {
  branchId: number
  departmentId: number
  positionId: number
  fullName: string
  nationalId: string | null
  nssfNumber: string | null
  hireDate: string
  terminationDate: string | null
  /** Optional. Sending null CLEARS what was there — emptying the box is a real edit. */
  email: string | null
  phoneNumber: string | null
  /** 'en' or 'ar'. Never null: the column is NOT NULL and every employee has one. */
  preferredLanguage: string
}

/**
 * Anything an employee picker might be bound to. Deliberately loose: the pickers are fed by several
 * shapes — the employee list (position/branch), the self-service employee (positionName/branchName),
 * and the "Reports to" list, which prepends a synthetic entry carrying only a name.
 */
export interface EmployeeLabelSource {
  fullName: string
  position?: string | null
  positionName?: string | null
  branch?: string | null
  branchName?: string | null
}

/**
 * ONE WORDING for an employee, in every dropdown: "Fadi Ghanem — Cashier · Hamra".
 *
 * A MODULE-LEVEL CONST, not an inline arrow at each call site. DevExtreme compares props by
 * reference, so a fresh function every render is a changed displayExpr, which rebuilds the item
 * templates — the same identity trap that produced the Maximum-update-depth crash on the tip form.
 * Declared once, it is the same function forever.
 *
 * DEGRADES, NEVER THROWS. It prints as much as the shape it is handed actually carries: name +
 * position + branch, name + branch, or just the name. It is also called with null while a SelectBox
 * has no selection, which is why the guard comes first.
 */
export const employeeLabel = (e: EmployeeLabelSource | null | undefined): string => {
  if (!e?.fullName) return ''
  const position = e.position ?? e.positionName ?? null
  const branch = e.branch ?? e.branchName ?? null
  const detail = [position, branch].filter((v): v is string => Boolean(v)).join(' · ')
  return detail ? `${e.fullName} — ${detail}` : e.fullName
}

/**
 * What an employee picker searches. Typing "cashier" filters by role, not only by name — which is
 * how someone looks for a person whose name they cannot spell.
 *
 * Module-level for the same reason as employeeLabel: an inline array literal is a new identity on
 * every render. A row missing `position` simply does not match that term; nothing errors.
 */
export const EMPLOYEE_SEARCH_EXPR: string[] = ['fullName', 'position']

/**
 * The approval-tier options for the employee form. Tier 1 (Staff) is the default; management and
 * executive requests may follow shorter approval chains.
 */
/**
 * One row of hr.APPROVAL_TIER — the seniority dictionary.
 *
 * THE NAMES ARE DATA NOW, not a constant in this file. They were a hard-coded three-item map here
 * (Staff / Management / Executive) until the tiers became a table somebody can edit; a company that
 * calls tier 2 "Supervisors" had no way to say so, and a fourth tier could not exist at all.
 *
 * Read through {@link ../hr/useApprovalTiers}, never fetched per component — every employee row and
 * every org-chart node prints one of these.
 */
export interface ApprovalTier {
  tierNo: number
  name: string
  /** The Arabic name. null falls back to {@link name} rather than to the number. */
  nameAr: string | null

  /* THE BASIC-SALARY BAND FOR THIS TIER. Policy: a DB trigger refuses a BASIC component outside
     it. Surfaced so the salary form can SAY the rule before the save is refused by it. */

  /** The floor. null = no lower bound. */
  minBasicSalary?: number | null
  /** The ceiling. null = no upper bound. */
  maxBasicSalary?: number | null
  /** Which currency the two figures are in. null when the tier has no band at all. */
  salaryCurrency?: string | null
}

/** POST /api/hr/approval-tiers. */
export interface ApprovalTierCreateRequest {
  tierNo: number
  name: string
  nameAr: string | null
}

/** PUT /api/hr/approval-tiers/{tierNo} — the number is identity and travels in the route. */
export interface ApprovalTierNameRequest {
  name: string
  nameAr: string | null
}

/**
 * PUT /api/hr/approval-tiers/{tierNo}/salary-range.
 *
 * Separate from the rename because it needs a different trust: renaming is EMP_EDIT, setting what
 * a rank may be paid is PAYROLL_RUN.
 *
 * EITHER BOUND MAY BE null, and null means "no bound" — not "leave alone". Both null clears the
 * band, which is how a tier goes back to unconstrained.
 */
export interface ApprovalTierSalaryRangeRequest {
  minBasicSalary: number | null
  maxBasicSalary: number | null
  salaryCurrency: string
}

/** What PUT /api/employees/{id}/reports-to returns — the new manager and any login warning. */
export interface EmployeeReportsTo {
  employeeId: number
  fullName: string
  reportsToEmployeeId: number | null
  reportsToName: string | null
  /** Set when the chosen manager has no login, so line-manager approvals above this person would skip. */
  warning: string | null
}

/** One rung of a person's chain of command (GET /api/employees/{id}/reporting-line), bottom-up: lvl 0 = self. */
export interface ReportingLineEntry {
  lvl: number
  employeeId: number
  fullName: string
  /** False when this person has no login — a line-manager step resolving to them would skip. */
  hasLogin: boolean
}

/** One node of the org tree (GET /api/employees/org-tree), pre-sorted depth-first. */
export interface OrgTreeNode {
  employeeId: number
  fullName: string
  reportsToEmployeeId: number | null
  branchName: string
  approvalTier: number
  depth: number
}

/** Row from GET /api/salary-components/by-employee/{id}. */
export interface SalaryComponent {
  salaryComponentId: number
  componentTypeId: number
  componentName: string
  amount: number
  currencyCode: string
  effectiveFrom: string
  effectiveTo: string | null
}

/**
 * One salary row on the SALARY ADMINISTRATION page — current or historical.
 *
 * `isCurrent` is the divide: exactly one open row per component, everything else is closed history
 * that must never be edited. A change does not rewrite a row — it closes the standing one the day
 * before and opens a new one — so a month already paid keeps saying what it paid.
 */
export interface EmployeeSalaryComponent {
  salaryComponentId: number
  componentTypeId: number
  componentName: string
  /** Earning / Deduction / EmployerCost. */
  category: string
  /** +1 or -1. The amount is always positive; the sign says which way it moves. */
  sign: number
  amount: number
  currencyCode: string
  effectiveFrom: string
  /** Null while standing. Set means closed — read-only from then on. */
  effectiveTo: string | null
  isCurrent: boolean
}

/**
 * PUT /api/employees/{id}/salary-components.
 *
 * The refusal to expect is the locked-through one, and it names the earliest date that would work —
 * show it verbatim, it teaches the whole model in one sentence.
 */
export interface SalaryComponentSetRequest {
  componentTypeId: number
  /** Above zero. To remove a component, END it instead. */
  amount: number
  currencyCode: string
  /** ISO date. */
  effectiveFrom: string
}

/** POST /api/salary-components/{id}/end — close a standing row. */
export interface SalaryComponentEndRequest {
  /** ISO date. Must be after the last locked month. */
  effectiveTo: string
}

export interface SalaryComponentCreateRequest {
  employeeId: number
  componentTypeId: number
  amount: number
  currencyCode: string
  effectiveFrom: string
  effectiveTo: string | null
}

export interface SalaryComponentUpdateRequest {
  amount: number
  currencyCode: string
  effectiveFrom: string
  effectiveTo: string | null
}

/** Row from GET /api/documents/by-employee/{id}. */
export interface Document {
  documentId: number
  employeeId: number
  fileName: string
  storagePath: string
  contentType: string
  sizeBytes: number
  uploadedUtc: string
}

export interface DocumentCreateRequest {
  employeeId: number
  fileName: string
  storagePath: string
  contentType: string
  sizeBytes: number
}

/** Row from GET /api/leave-ledger/by-employee/{id}. */
export interface LeaveLedgerEntry {
  leaveLedgerId: number
  employeeId: number
  leaveTypeId: number
  periodYearMonth: string
  movementType: string
  leaveRequestId: number | null
  days: number
  effectiveDate: string
  note: string | null
  createdAt: string
}

/**
 * Row from GET /api/leave-ledger/balance/{id}.
 *
 * THE COLUMNS ADD UP: remaining = accrued + carriedOver − used + adjusted. Every part is shown on
 * the profile's balance grid, because a remaining figure nobody can reconstruct is one nobody can
 * check — and the adjustments are exactly the movements somebody may later have to explain.
 */
export interface LeaveBalance {
  employeeId: number
  leaveTypeId: number
  periodYearMonth: string
  accrued: number
  carriedOver: number
  used: number
  /**
   * The Adjustment movements — everything that moved this balance by hand rather than by rule: an
   * HR correction, a discretionary grant waived at approval, the year-close settlement.
   *
   * SIGNED, and both signs are ordinary: positive gave days back, negative took them away.
   */
  adjusted: number
  remaining: number
}

export interface LeaveLedgerPostRequest {
  employeeId: number
  leaveTypeId: number
  movementType: string
  days: number
  effectiveDate: string
  leaveRequestId: number | null
  note: string | null
}

/**
 * One employee-day on approved leave — GET /api/leave/days?from=&to=
 *
 * A deliberately small shape, because it is a SEAM. Leave is currently derived from
 * hr.LEAVE_LEDGER ('Usage' movements matched on EffectiveDate); workflow.LEAVE_REQUEST, with a
 * real FromDate..ToDate to expand, belongs to the workflow stage and does not exist yet. When it
 * arrives only the server side of this contract changes.
 */
export interface LeaveDay {
  employeeId: number
  /** The day itself. Arrives as a full timestamp, so compare it truncated to 'yyyy-MM-dd'. */
  date: string
  /** 1.00 for a whole day, 0.50 for a half. Positive: the ledger's negative sign is normalised away server-side. */
  daysOnLeave: number
}
