import { apiRequest, ApiError } from '../api/client'
import { API_BASE_URL } from '../config'
import { tokenStorage } from '../auth/tokenStorage'
import type {
  ApprovalTier,
  ApprovalTierCreateRequest,
  ApprovalTierNameRequest,
  Branch,
  ComponentType,
  Department,
  Document,
  DocumentCreateRequest,
  EmployeeCreateRequest,
  EmployeeLinkResult,
  EmployeeListItem,
  EmployeeLoginStatus,
  EmployeeProfile,
  EmployeeReportsTo,
  EmployeeUnlinkResult,
  EmployeeUpdateRequest,
  LeaveBalance,
  LeaveDay,
  LeaveLedgerEntry,
  LeaveLedgerPostRequest,
  LeavePolicy,
  LeaveYearOpenSummary,
  LeaveRelationEntitlement,
  LeaveType,
  LeaveTypeUpsertRequest,
  OrgTreeNode,
  Position,
  ReportingLineEntry,
  SalaryComponent,
  SalaryComponentCreateRequest,
  SalaryComponentUpdateRequest,
  EmployeeSalaryComponent,
  SalaryComponentSetRequest,
} from '../types/hr'

/** All HR endpoints: read requires EMP_VIEW, write requires EMP_EDIT. */

export const branchesService = {
  getAll: () => apiRequest<Branch[]>('/api/branches'),
  create: (name: string) =>
    apiRequest<{ branchId: number }>('/api/branches', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  update: (branchId: number, name: string, isActive: boolean) =>
    apiRequest<void>(`/api/branches/${branchId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, isActive }),
    }),
}

export const departmentsService = {
  getAll: () => apiRequest<Department[]>('/api/departments'),
  create: (name: string) =>
    apiRequest<{ departmentId: number }>('/api/departments', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  update: (departmentId: number, name: string, isActive: boolean) =>
    apiRequest<void>(`/api/departments/${departmentId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, isActive }),
    }),
}

export const positionsService = {
  getAll: () => apiRequest<Position[]>('/api/positions'),
  create: (title: string) =>
    apiRequest<{ positionId: number }>('/api/positions', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  update: (positionId: number, title: string, isActive: boolean) =>
    apiRequest<void>(`/api/positions/${positionId}`, {
      method: 'PUT',
      body: JSON.stringify({ title, isActive }),
    }),
}

export const componentTypesService = {
  getAll: () => apiRequest<ComponentType[]>('/api/component-types'),
  create: (name: string, category: string, sign: number) =>
    apiRequest<{ componentTypeId: number }>('/api/component-types', {
      method: 'POST',
      body: JSON.stringify({ name, category, sign }),
    }),
  update: (
    componentTypeId: number,
    name: string,
    category: string,
    sign: number,
  ) =>
    apiRequest<void>(`/api/component-types/${componentTypeId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, category, sign }),
    }),
}

export const leaveTypesService = {
  getAll: () => apiRequest<LeaveType[]>('/api/leave-types'),

  /**
   * Which types ask for a relation, which relations they cover, and each one's day cap. The leave
   * form reads this to decide whether the relation dropdown appears at all — the same question
   * usp_LeaveRequest_Create answers by looking for rows, so the two cannot drift apart.
   */
  getRelationEntitlements: () =>
    apiRequest<LeaveRelationEntitlement[]>('/api/leave-types/relation-entitlements'),
  /**
   * Create a leave type. Returns the row AS STORED, so a caller binds from the save rather than
   * re-reading. A duplicate name comes back as a 400 with the procedure's own wording.
   */
  create: (payload: LeaveTypeUpsertRequest) =>
    apiRequest<LeaveType>('/api/leave-types', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Update one. Any policy field omitted keeps its stored value — see LeaveTypeUpsertRequest. */
  update: (leaveTypeId: number, payload: LeaveTypeUpsertRequest) =>
    apiRequest<LeaveType>(`/api/leave-types/${leaveTypeId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
}

/**
 * The leave POLICY — the figures behind entitlement, keyed by tenure, plus the relation caps.
 *
 * Writes are keyed on (type, MinServiceYears) or (type, Relation), so "set" both adds and edits:
 * there is no separate create, and re-setting an existing year simply changes it.
 */
export const leavePolicyService = {
  /** Types, accrual tiers, pay tiers and relations in one call. */
  getAll: () => apiRequest<LeavePolicy>('/api/leave-policy'),

  /**
   * OPENS THE LEAVE YEAR — grants every active employee the entitlement the tier grids describe,
   * and settles last year's remainder (carried over, or expired, by the type's own rule).
   *
   * SAFE TO CALL TWICE: the procedure skips employees already opened for that year, so a repeat
   * returns a summary with zero employees rather than granting anybody a second entitlement.
   * A refusal arrives as a 400 whose text is the procedure's own sentence — show it verbatim.
   */
  openYear: (year: number) =>
    apiRequest<LeaveYearOpenSummary[]>(`/api/leave/year-open?year=${year}`, { method: 'POST' }),

  setAccrualTier: (leaveTypeId: number, minServiceYears: number, annualDays: number) =>
    apiRequest<void>(`/api/leave-types/${leaveTypeId}/accrual-tier`, {
      method: 'PUT',
      body: JSON.stringify({ minServiceYears, annualDays }),
    }),
  deleteAccrualTier: (leaveTypeId: number, minServiceYears: number) =>
    apiRequest<void>(`/api/leave-types/${leaveTypeId}/accrual-tier/${minServiceYears}`, {
      method: 'DELETE',
    }),

  setPayTier: (
    leaveTypeId: number,
    minServiceYears: number,
    fullPayDays: number,
    halfPayDays: number,
  ) =>
    apiRequest<void>(`/api/leave-types/${leaveTypeId}/pay-tier`, {
      method: 'PUT',
      body: JSON.stringify({ minServiceYears, fullPayDays, halfPayDays }),
    }),
  deletePayTier: (leaveTypeId: number, minServiceYears: number) =>
    apiRequest<void>(`/api/leave-types/${leaveTypeId}/pay-tier/${minServiceYears}`, {
      method: 'DELETE',
    }),

  /**
   * Adding a relation is what makes usp_LeaveRequest_Create ACCEPT that relation; deleting it makes
   * the same procedure refuse it again. The policy screen is therefore the only place that decision
   * is made — the request form merely reads the result.
   */
  setRelation: (leaveTypeId: number, relation: string, days: number) =>
    apiRequest<void>(`/api/leave-types/${leaveTypeId}/relation`, {
      method: 'PUT',
      body: JSON.stringify({ relation, days }),
    }),
  deleteRelation: (leaveTypeId: number, relation: string) =>
    apiRequest<void>(
      `/api/leave-types/${leaveTypeId}/relation/${encodeURIComponent(relation)}`,
      { method: 'DELETE' },
    ),
}

export const employeesService = {
  getAll: () => apiRequest<EmployeeListItem[]>('/api/employees'),
  getProfile: (id: number) =>
    apiRequest<EmployeeProfile>(`/api/employees/${id}`),
  create: (request: EmployeeCreateRequest) =>
    apiRequest<{ employeeId: number }>('/api/employees', {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  update: (id: number, request: EmployeeUpdateRequest) =>
    apiRequest<void>(`/api/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify(request),
    }),
  remove: (id: number) =>
    apiRequest<void>(`/api/employees/${id}`, { method: 'DELETE' }),

  /**
   * Employee↔login state for the accounts screen. onlyMissing=true returns just the employees who
   * still need an account. Requires USER_MANAGE.
   */
  getLoginStatus: (onlyMissing = false) =>
    apiRequest<EmployeeLoginStatus[]>(
      '/api/employees/login-status' + (onlyMissing ? '?onlyMissing=true' : ''),
    ),

  /**
   * Links an existing account to this employee (or corrects which one). The proc refuses with a
   * 400 naming the other employee if the account is already taken — that message flows straight
   * through to getErrorMessage. A non-null `warning` in the result means "linked, but disabled".
   */
  linkUser: (employeeId: number, userId: number) =>
    apiRequest<EmployeeLinkResult>(`/api/employees/${employeeId}/user`, {
      method: 'PUT',
      body: JSON.stringify({ userId }),
    }),

  /** Breaks the link. The result reports the cost (branch-manager? requests left waiting?). */
  unlinkUser: (employeeId: number) =>
    apiRequest<EmployeeUnlinkResult>(`/api/employees/${employeeId}/user`, {
      method: 'DELETE',
    }),

  /**
   * Sets the employee's approval tier (1 staff / 2 management / 3 executive) — which published chain
   * their requests follow. Its own endpoint, not part of the update body, because it is a workflow
   * decision with its own validation. Returns the employee's new tier standing.
   */
  setApprovalTier: (employeeId: number, approvalTier: number) =>
    apiRequest<{ employeeId: number; fullName: string; approvalTier: number }>(
      `/api/employees/${employeeId}/approval-tier`,
      { method: 'PUT', body: JSON.stringify({ approvalTier }) },
    ),

  /**
   * Sets who the employee reports to (null = top of a line). Refuses a self-reference or a loop with
   * a clear message that flows straight through to getErrorMessage; a `warning` in the result means
   * "saved, but the chosen manager has no login".
   */
  setReportsTo: (employeeId: number, reportsToEmployeeId: number | null) =>
    apiRequest<EmployeeReportsTo>(`/api/employees/${employeeId}/reports-to`, {
      method: 'PUT',
      body: JSON.stringify({ reportsToEmployeeId }),
    }),

  /** The employee's chain of command, bottom-up (lvl 0 = themselves). Shown under the "Reports to" field. */
  getReportingLine: (employeeId: number) =>
    apiRequest<ReportingLineEntry[]>(`/api/employees/${employeeId}/reporting-line`),

  /** The whole org tree, pre-sorted depth-first — for the org-chart page. */
  getOrgTree: () => apiRequest<OrgTreeNode[]>('/api/employees/org-tree'),

  /** The deepest reporting line among current employees — the chain builder warns past it. Returns the number. */
  getOrgMaxDepth: () =>
    apiRequest<{ maxDepth: number }>('/api/org/max-depth').then((r) => r.maxDepth),
}

/**
 * The approval-tier dictionary — which named rank each tier number stands for.
 *
 * The READ needs no permission (a tier name is a label, printed on screens most of the company
 * sees); every WRITE is EMP_EDIT, and the API refuses a delete while anybody still holds the tier,
 * naming who. That refusal is the whole value of the guard, so callers must surface its message
 * rather than a generic failure.
 */
export const approvalTiersService = {
  getAll: () => apiRequest<ApprovalTier[]>('/api/hr/approval-tiers'),

  create: (request: ApprovalTierCreateRequest) =>
    apiRequest<ApprovalTier>('/api/hr/approval-tiers', {
      method: 'POST',
      body: JSON.stringify(request),
    }),

  /** Renames a tier. The number never moves — it is what employees and chains point at. */
  setName: (tierNo: number, request: ApprovalTierNameRequest) =>
    apiRequest<ApprovalTier>(`/api/hr/approval-tiers/${tierNo}`, {
      method: 'PUT',
      body: JSON.stringify(request),
    }),

  remove: (tierNo: number) =>
    apiRequest<void>(`/api/hr/approval-tiers/${tierNo}`, { method: 'DELETE' }),
}

export const salaryComponentsService = {
  getByEmployee: (employeeId: number) =>
    apiRequest<SalaryComponent[]>(
      `/api/salary-components/by-employee/${employeeId}`,
    ),
  create: (request: SalaryComponentCreateRequest) =>
    apiRequest<{ salaryComponentId: number }>('/api/salary-components', {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  update: (id: number, request: SalaryComponentUpdateRequest) =>
    apiRequest<void>(`/api/salary-components/${id}`, {
      method: 'PUT',
      body: JSON.stringify(request),
    }),
  remove: (id: number) =>
    apiRequest<void>(`/api/salary-components/${id}`, { method: 'DELETE' }),
}

/**
 * SALARY ADMINISTRATION — the history-preserving path, and the one the Salaries page uses.
 *
 * Distinct from {@link salaryComponentsService} above, which edits a row in place. These three
 * never rewrite history: `set` closes the standing row the day before and opens a new one, and
 * `end` closes a row on a date rather than erasing it.
 *
 * Both writes RETURN the employee's rows as they now stand, so a page can render the result of its
 * own change without a second fetch — and without a window where the screen and the truth differ.
 *
 * Every refusal is the procedure's own sentence. The one people meet is
 * "Payroll is locked through that date. The change can start on 2026-09-01 at the earliest…",
 * which contains its own fix; show it unchanged.
 */
export const salaryAdminService = {
  getForEmployee: (employeeId: number) =>
    apiRequest<EmployeeSalaryComponent[]>(`/api/employees/${employeeId}/salary-components`),

  set: (employeeId: number, body: SalaryComponentSetRequest) =>
    apiRequest<EmployeeSalaryComponent[]>(`/api/employees/${employeeId}/salary-components`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  end: (salaryComponentId: number, effectiveTo: string) =>
    apiRequest<EmployeeSalaryComponent[]>(`/api/salary-components/${salaryComponentId}/end`, {
      method: 'POST',
      body: JSON.stringify({ effectiveTo }),
    }),
}

export const documentsService = {
  getByEmployee: (employeeId: number) =>
    apiRequest<Document[]>(`/api/documents/by-employee/${employeeId}`),

  /** Uploads a real file; the server derives content type + size and stores it. */
  upload: (employeeId: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiRequest<{ documentId: number }>(
      `/api/documents/upload?employeeId=${employeeId}`,
      { method: 'POST', body: form },
    )
  },

  /** Downloads the stored file and triggers a browser save with its real name. */
  download: async (doc: Document) => {
    const token = tokenStorage.getAccessToken()
    const res = await fetch(
      `${API_BASE_URL}/api/documents/${doc.documentId}/download`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    )
    if (!res.ok) {
      throw new ApiError(res.status, 'Could not download the file.')
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = doc.fileName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  },

  /** Persist externally-hosted document metadata (no file transfer). */
  create: (request: DocumentCreateRequest) =>
    apiRequest<{ documentId: number }>('/api/documents', {
      method: 'POST',
      body: JSON.stringify(request),
    }),

  remove: (id: number) =>
    apiRequest<void>(`/api/documents/${id}`, { method: 'DELETE' }),
}

export const leaveLedgerService = {
  getByEmployee: (employeeId: number, period?: string) =>
    apiRequest<LeaveLedgerEntry[]>(
      `/api/leave-ledger/by-employee/${employeeId}` +
        (period ? `?period=${encodeURIComponent(period)}` : ''),
    ),
  /**
   * Everybody's approved leave days in a range, one row per employee-day.
   *
   * The roster uses this to avoid scheduling a shift on somebody's leave day. Kept as its own
   * endpoint rather than a loop over getByEmployee, which would be a round trip per person per
   * month just to draw a calendar.
   */
  getLeaveDays: (from: string, to: string) =>
    apiRequest<LeaveDay[]>(
      `/api/leave/days?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  getBalance: (employeeId: number, period?: string) =>
    apiRequest<LeaveBalance[]>(
      `/api/leave-ledger/balance/${employeeId}` +
        (period ? `?period=${encodeURIComponent(period)}` : ''),
    ),
  post: (request: LeaveLedgerPostRequest) =>
    apiRequest<{ leaveLedgerId: number }>('/api/leave-ledger', {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  remove: (id: number) =>
    apiRequest<void>(`/api/leave-ledger/${id}`, { method: 'DELETE' }),
}
