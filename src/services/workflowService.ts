import { apiRequest } from '../api/client'
import { API_BASE_URL } from '../config'
import { tokenStorage } from '../auth/tokenStorage'
import type {
  ActiveDefinitionStep,
  ApproverRole,
  ApproveResult,
  AvailabilityConflict,
  AvailabilityCreated,
  AvailabilityCreateRequest,
  AvailabilityDecideRequest,
  AvailabilityDecisionResult,
  AvailabilityPayload,
  DecisionOption,
  DecisionTypeConfig,
  DraftDecision,
  SignatureRequirement,
  StaleDraft,
  Attachment,
  BranchManagerSet,
  BranchWithManager,
  DefinitionAddStepRequest,
  DefinitionCopyResult,
  DefinitionCopySource,
  DefinitionCreated,
  ExitPermissionCreateRequest,
  ExitPermissionCreated,
  ExitPermissionDecisionResult,
  ExitPermissionDetail,
  ForUserRequest,
  InboxItem,
  LeaveBalanceSummary,
  LeaveRequestCreated,
  LeaveRequestCreateRequest,
  LeaveRequestDecideResult,
  LeaveRequestPayload,
  LongHold,
  MoveVersionResult,
  MyEmployee,
  MyExitPermission,
  PostLeaveResult,
  MyLeaveRequest,
  MyRequest,
  MySignature,
  MySignatureSaved,
  MyOvertime,
  OldVersionRequest,
  OnboardingCreated,
  OnboardingCreateRequest,
  OnboardingDecisionResult,
  OnboardingPayload,
  OnboardingSetTaskRequest,
  OnboardingTask,
  OvertimeApplyResult,
  OvertimeCreated,
  OvertimeCreateRequest,
  OvertimeDecideRequest,
  OvertimeDecisionResult,
  OvertimePayload,
  RaisableRequestType,
  ReopenResult,
  RequestCounts,
  RosterApprovalCreated,
  RosterApprovalCreateRequest,
  SeparationContext,
  SeparationCreated,
  SeparationCreateRequest,
  SeparationDecisionResult,
  SeparationPayload,
  SeparationSettlement,
  SeparationSettlementRequest,
  ShiftSwapCreated,
  ShiftSwapCreateRequest,
  ShiftSwapPayload,
  PayrollAdjustmentCreateRequest,
  PayrollAdjustmentPayload,
  SalaryAdvanceCreateRequest,
  SalaryAdvanceCreated,
  SalaryAdvancePayload,
  TipDecideRequest,
  TipDecisionResult,
  TipDistributionCreated,
  TipDistributionCreateRequest,
  TipDistributionPayload,
  TypedDecideRequest,
  TypedDecisionResult,
  RequestDetail,
  RequestNote,
  RequestStep,
  RequestType,
  WorkflowDefinition,
  WorkflowStep,
} from '../types/workflow'

/**
 * A `?v=` cache-buster built from a version stamp (a signature's updatedAt).
 *
 * Belt to the server's braces. The live image endpoints now send no-cache, which is the real fix;
 * this makes the URL itself change when the content does, so a replaced image cannot be served from
 * anything holding the old address — a stale disk cache, a service worker, an intermediary that
 * ignores the header. Reduced to epoch milliseconds because it is shorter and URL-clean; the raw
 * stamp is used if it will not parse, since any changing token does the job.
 *
 * Returns '' for a missing version, so callers can append it unconditionally.
 */
function cacheBust(version: string | null | undefined): string {
  if (!version) return ''
  const ms = Date.parse(version)
  return `?v=${Number.isNaN(ms) ? encodeURIComponent(version) : ms}`
}

/** Chain configuration — the setup side. Reads/writes need WORKFLOW_CONFIGURE (active-chain read is any-user). */
export const chainsService = {
  getRequestTypes: () =>
    apiRequest<RequestType[]>('/api/workflow/request-types'),

  /**
   * What the signed-in user may actually raise — active types WITH a published chain, one row per
   * type. This is what the new-request screen lists: unlike getRequestTypes (WORKFLOW_CONFIGURE),
   * any authenticated user may read it, which is the point — an ordinary employee raising a request
   * is not an administrator.
   */
  getRaisableRequestTypes: () =>
    apiRequest<RaisableRequestType[]>('/api/workflow/request-types/raisable'),
  upsertRequestType: (body: {
    code: string
    name: string
    description?: string | null
    isActive: boolean
  }) =>
    apiRequest<{ requestTypeId: number }>('/api/workflow/request-types', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Chains a draft can be started from — every version, of every type, that has steps. */
  getCopySources: () => apiRequest<DefinitionCopySource[]>('/api/workflow/copy-sources'),

  /**
   * Copy one chain's steps into a DRAFT. A snapshot, not a link.
   *
   * Call with replaceExisting FALSE first: a draft that already has steps is refused with a message
   * naming how many, which the builder shows before offering to retry with true.
   */
  copyStepsFrom: (targetDefinitionId: number, sourceDefinitionId: number, replaceExisting = false) =>
    apiRequest<DefinitionCopyResult>(
      `/api/workflow/definitions/${targetDefinitionId}/copy-from`,
      { method: 'POST', body: JSON.stringify({ sourceDefinitionId, replaceExisting }) },
    ),

  getDefinitions: (requestTypeId?: number) =>
    apiRequest<WorkflowDefinition[]>(
      '/api/workflow/definitions' +
        (requestTypeId ? `?requestTypeId=${requestTypeId}` : ''),
    ),
  createDraft: (requestTypeId: number, notes?: string | null) =>
    apiRequest<DefinitionCreated>('/api/workflow/definitions', {
      method: 'POST',
      body: JSON.stringify({ requestTypeId, notes }),
    }),
  addStep: (definitionId: number, step: DefinitionAddStepRequest) =>
    apiRequest<void>(`/api/workflow/definitions/${definitionId}/steps`, {
      method: 'POST',
      body: JSON.stringify(step),
    }),
  publish: (definitionId: number) =>
    apiRequest<WorkflowDefinition>(
      `/api/workflow/definitions/${definitionId}/publish`,
      { method: 'POST' },
    ),
  getSteps: (definitionId: number) =>
    apiRequest<WorkflowStep[]>(`/api/workflow/definitions/${definitionId}/steps`),

  /** Deletes a DRAFT (and its steps). The API refuses a published/retired version — that message is shown verbatim. */
  deleteDraft: (definitionId: number) =>
    apiRequest<void>(`/api/workflow/definitions/${definitionId}`, { method: 'DELETE' }),

  /**
   * Sets which population a DRAFT chain serves — 2 (management+), 3 (executive only), or null for the
   * default everyone chain. Draft-only: the API refuses a published version with a message shown
   * verbatim. Returns the draft's new standing.
   */
  setMinTier: (definitionId: number, minRequesterTier: number | null) =>
    apiRequest<{ workflowDefinitionId: number; version: number; minRequesterTier: number | null }>(
      `/api/workflow/definitions/${definitionId}/min-tier`,
      { method: 'PUT', body: JSON.stringify({ minRequesterTier }) },
    ),

  /**
   * The published chain for a type — shown to a requester before submitting. When an employeeId is
   * given, the chain returned is the one THAT PERSON'S TIER will actually run (management/executive
   * may get a shorter chain), so the preview matches the real thing. Any signed-in user may read it.
   */
  getActive: (requestTypeCode: string, employeeId?: number | null) =>
    apiRequest<ActiveDefinitionStep[]>(
      `/api/workflow/active/${encodeURIComponent(requestTypeCode)}` +
        (employeeId != null ? `?employeeId=${employeeId}` : ''),
    ),

  getOnOldVersions: (requestTypeId?: number) =>
    apiRequest<OldVersionRequest[]>(
      '/api/workflow/requests/old-versions' +
        (requestTypeId ? `?requestTypeId=${requestTypeId}` : ''),
    ),

  /** Roles usable as an approver/deputy in a chain, each with its active-member count. Feeds the deputy picker. */
  getApprovers: () => apiRequest<ApproverRole[]>('/api/roles/approvers'),

  /** All configurable decision types (usp_DecisionType_GetAll) — the Decision Types setup screen. */
  getDecisionTypes: () =>
    apiRequest<DecisionTypeConfig[]>('/api/workflow/decision-types'),

  /** The comma-separated decision codes offered at one step; empty restores the default (all types). */
  setStepDecisions: (workflowStepId: number, decisionCodes: string[]) =>
    apiRequest<void>(`/api/workflow/definitions/steps/${workflowStepId}/decisions`, {
      method: 'PUT',
      body: JSON.stringify({ decisionCodes: decisionCodes.join(',') }),
    }),

  /** Requests stuck on hold longer than a threshold — HR's stalled-holds queue. */
  getLongHolds: (olderThanDays = 7) =>
    apiRequest<LongHold[]>(`/api/workflow/long-holds?olderThanDays=${olderThanDays}`),

  /** Drafts sitting unsigned longer than a threshold — someone who forgot they started. */
  getStaleDrafts: (olderThanDays = 3) =>
    apiRequest<StaleDraft[]>(`/api/workflow/stale-drafts?olderThanDays=${olderThanDays}`),
}

/**
 * Requests — the operations side. No permission needed to approve/reject; the database decides who
 * may sign, and a refusal comes back as a 403 with its message intact (getErrorMessage surfaces it).
 */
export const requestsService = {
  getById: (id: number) => apiRequest<RequestDetail>(`/api/requests/${id}`),

  /**
   * Save a decision WITHOUT signing it — half-formed is allowed, so the server validates nothing.
   * A colleague already holding a draft on a shared step comes back as a 4xx naming them.
   */
  saveDraft: (
    id: number,
    body: {
      decisionCode: string
      comment?: string | null
      value?: number | null
      targetUserId?: number | null
      waitingOnRequester: boolean
    },
  ) =>
    apiRequest<void>(`/api/requests/${id}/draft`, {
      method: 'POST',
      body: JSON.stringify({
        decisionCode: body.decisionCode,
        comment: body.comment ?? null,
        value: body.value ?? null,
        targetUserId: body.targetUserId ?? null,
        waitingOnRequester: body.waitingOnRequester,
      }),
    }),

  /** The caller's OWN saved draft here, or null — a colleague's draft on a shared step is invisible (204). */
  getDraft: (id: number) =>
    apiRequest<DraftDecision | null>(`/api/requests/${id}/draft`).then((v) => v ?? null),

  /** Throw away the caller's draft. Also called automatically by the API after any real decision. */
  discardDraft: (id: number) =>
    apiRequest<void>(`/api/requests/${id}/draft`, { method: 'DELETE' }),

  /**
   * The chain read FOR the signed-in caller — the server passes the token's UserId as @ForUserId,
   * so each step's `canWithdraw` says whether THIS user may still take that decision back. The steps
   * on getById are NOT caller-scoped; use this whenever the withdraw button must appear.
   */
  getSteps: (id: number) => apiRequest<RequestStep[]>(`/api/requests/${id}/steps`),

  /**
   * The enriched step list — usp_Request_GetSteps with the caller's UserId, so `canWithdraw` is
   * populated (getById's inline steps cannot carry it). The detail page renders the chain from this.
   */
  steps: (id: number) => apiRequest<RequestStep[]>(`/api/requests/${id}/steps`),
  mine: (status?: string) =>
    apiRequest<MyRequest[]>(
      '/api/requests/mine' + (status ? `?status=${encodeURIComponent(status)}` : ''),
    ),
  inbox: () => apiRequest<InboxItem[]>('/api/requests/inbox'),

  /**
   * Everything I am connected to, in any capacity — the single call that feeds the whole hub.
   *
   * The procedure applies `from`/`to` to CLOSED requests only: a pending request is a to-do and its
   * age is a reason to show it, never to hide it. `status='Pending'` is the "Open" filter; a closed
   * status makes the procedure include closed rows on its own; `includeClosed` covers the "All" case.
   */
  forMe: (opts?: {
    status?: string
    includeClosed?: boolean
    requestTypeId?: number
    from?: string
    to?: string
  }) => {
    const p = new URLSearchParams()
    if (opts?.status) p.set('status', opts.status)
    if (opts?.includeClosed) p.set('includeClosed', 'true')
    if (opts?.requestTypeId) p.set('requestTypeId', String(opts.requestTypeId))
    if (opts?.from) p.set('from', opts.from)
    if (opts?.to) p.set('to', opts.to)
    const qs = p.toString()
    return apiRequest<ForUserRequest[]>('/api/requests/for-me' + (qs ? `?${qs}` : ''))
  },

  /** The hub's tab-badge counts. */
  counts: () => apiRequest<RequestCounts>('/api/requests/counts'),

  /**
   * The decisions the caller may make at the current step (usp_Step_GetAvailableDecisions), already
   * filtered server-side. An EMPTY array means "not yours to decide" — the caller renders read-only.
   */
  getDecisions: (id: number) => apiRequest<DecisionOption[]>(`/api/requests/${id}/decisions`),

  /** Whether this step's decision must be password-signed, and the verbatim explanation to show. */
  getSignatureRequirement: (id: number) =>
    apiRequest<SignatureRequirement>(`/api/requests/${id}/signature-requirement`),

  /**
   * Approve. `code` keeps the decision label the user actually chose; `password` is sent only when a
   * signature was required (verified server-side, never logged); `value` adjusts the typed figure and
   * is routed to the typed endpoint by the caller, not here.
   */
  approve: (
    id: number,
    body?: { comment?: string | null; changeSummary?: string | null; code?: string; password?: string },
  ) =>
    apiRequest<ApproveResult>(`/api/requests/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({
        comment: body?.comment ?? null,
        changeSummary: body?.changeSummary ?? null,
        code: body?.code ?? null,
        password: body?.password ?? null,
      }),
    }),

  /** Park a live request on hold. The reason is required; waitingOnRequester marks it as the employee's to answer. */
  hold: (
    id: number,
    reason: string,
    waitingOnRequester: boolean,
    extra?: { code?: string; password?: string },
  ) =>
    apiRequest<void>(`/api/requests/${id}/hold`, {
      method: 'POST',
      body: JSON.stringify({
        reason,
        waitingOnRequester,
        code: extra?.code ?? null,
        password: extra?.password ?? null,
      }),
    }),

  /**
   * LIFTS A HOLD — the step goes back to Pending with the same approver.
   *
   * The API allows the approver who set the hold OR the person who raised the request, because a
   * hold marked "waiting on the requester" is answered BY the requester: answering it IS the resume,
   * and making them then chase the approver to press a button would park the request for nothing.
   * No password — resuming decides nothing.
   */
  resume: (id: number, note?: string | null) =>
    apiRequest<ApproveResult>(`/api/requests/${id}/resume`, {
      method: 'POST',
      body: JSON.stringify({ note: note ?? null }),
    }),

  /** Hand this step to a named person; it stays open. The decision Code is recorded with it. */
  delegate: (id: number, toUserId: number, reason: string, code?: string) =>
    apiRequest<void>(`/api/requests/${id}/delegate`, {
      method: 'POST',
      body: JSON.stringify({ toUserId, reason, code: code ?? null }),
    }),

  /** The request's conversation, oldest first. */
  getNotes: (id: number) => apiRequest<RequestNote[]>(`/api/requests/${id}/notes`),

  /** Add a note. stepNo ties it to a step; isHoldResponse marks an answer to a hold. */
  addNote: (
    id: number,
    body: { noteText: string; stepNo?: number | null; isHoldResponse?: boolean },
  ) =>
    apiRequest<{ noteId: number }>(`/api/requests/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({
        noteText: body.noteText,
        stepNo: body.stepNo ?? null,
        isHoldResponse: body.isHoldResponse ?? false,
      }),
    }),

  /**
   * Take back your OWN decision on a step, while the request is open and nobody after you has acted.
   * Routes to the request-type's typed withdraw procedure server-side (it restores the figure first).
   */
  withdraw: (id: number, stepNo: number, reason: string, password?: string) =>
    apiRequest<void>(`/api/requests/${id}/steps/${stepNo}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({ reason, password: password ?? null }),
    }),

  /**
   * Take a DELEGATED step back — for the person who delegated it, while the delegate has not decided.
   * Not a withdrawal (nothing was signed); no password. Returns the step to the delegator's inbox.
   */
  reclaim: (id: number, reason?: string) =>
    apiRequest<void>(`/api/requests/${id}/reclaim`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason ?? null }),
    }),

  /** HR only. Reopen a REJECTED or CANCELLED request to the step that closed it. Approved cannot be reopened. */
  reopen: (id: number, reason: string) =>
    apiRequest<void>(`/api/requests/${id}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  /*
   * ── THE TWO REVERSALS ──
   *
   * Distinct from `withdraw` above, which is a still-open request's own approver changing their
   * mind before anyone else acted. These undo a decision that has ALREADY TAKEN EFFECT, and they
   * are the only way back once it has.
   *
   * NEITHER TAKES A PERMISSION and neither is pre-checked here. Who may retract (the last signer,
   * same UTC day) and who may reopen (the GM and the Owner, together) is decided by the database,
   * exactly as approve and reject are. Every refusal names the rule that was broken AND the path
   * that would work — the next-day retract names the GM + Owner route, a consumed adjustment names
   * the counter-adjustment — so they are shown verbatim and never replaced.
   */

  /**
   * Take back the LAST decision on this request, as the person who made it, on the same UTC day.
   *
   * Deliberately does NOT check whether the request's effects have been consumed: that answer lives
   * in the database (a locked payslip, a started recovery, an applied attendance day), and its
   * refusal tells the user what to do instead — which no disabled button could.
   */
  retract: (id: number, reason: string) =>
    apiRequest<ApproveResult>(`/api/workflow/requests/${id}/retract`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  /**
   * One half of a GM + Owner reopen, in either order.
   *
   * READ `state` OFF THE RESPONSE — the call has two outcomes. 'AwaitingSecond' means this was the
   * FIRST signature and nothing has moved: the request is still closed, waiting on the other role.
   * 'Reopened' means it completed and the request is back at its last step. Reporting the first as
   * a success is how somebody walks away believing a request was reopened when it was not.
   *
   * The reason is required on the first signature only; the second inherits it.
   */
  reopenWithSecondSignature: (id: number, reason: string) =>
    apiRequest<ReopenResult>(`/api/workflow/requests/${id}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  reject: (id: number, reason: string, extra?: { code?: string; password?: string }) =>
    apiRequest<void>(`/api/requests/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason, code: extra?.code ?? null, password: extra?.password ?? null }),
    }),
  cancel: (id: number, reason: string) =>
    apiRequest<void>(`/api/requests/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  /** HR only. Rewrites who must sign a live request, so the reason is mandatory. */
  moveVersion: (id: number, reason: string, targetWorkflowDefinitionId?: number) =>
    apiRequest<MoveVersionResult>(`/api/requests/${id}/move-version`, {
      method: 'POST',
      body: JSON.stringify({ targetWorkflowDefinitionId: targetWorkflowDefinitionId ?? null, reason }),
    }),

  /**
   * The FROZEN signature image for a signed step, as an authenticated object URL — the endpoint is
   * bearer-gated, and a plain <img src> cannot send the token. Returns null when the step has no
   * image (404). The caller must revoke the URL, or it leaks.
   */
  async signatureImageObjectUrl(requestId: number, stepNo: number): Promise<string | null> {
    const token = tokenStorage.getAccessToken()
    const res = await fetch(
      `${API_BASE_URL}/api/requests/${requestId}/steps/${stepNo}/signature/image`,
      { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
    )
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Could not load the signature image (${res.status}).`)
    return URL.createObjectURL(await res.blob())
  },

  /**
   * A FROZEN signature image BY ITS SIGNATURE-LOG ID — the id a step carries as signedSignatureId.
   * Bearer-gated, so fetched WITH the token and handed back as an object URL a plain <img> can show.
   * Null on 404 (no image). The caller must revoke the URL, or it leaks.
   */
  async frozenSignatureImageObjectUrl(signatureId: number): Promise<string | null> {
    const token = tokenStorage.getAccessToken()
    const res = await fetch(`${API_BASE_URL}/api/signatures/${signatureId}/image`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Could not load the signature image (${res.status}).`)
    return URL.createObjectURL(await res.blob())
  },
}

/**
 * Attachments — the requester's supporting document (stepNo null) or proof an approver relied on for
 * a decision (stepNo set). The list is metadata only; each file loads from its own bearer-gated URL.
 */
export const attachmentsService = {
  forRequest: (requestId: number) =>
    apiRequest<Attachment[]>(`/api/requests/${requestId}/attachments`),

  /** multipart/form-data. Omit stepNo for a request document; set it for proof of a step's decision. */
  upload: (
    requestId: number,
    file: File,
    opts?: { stepNo?: number | null; caption?: string | null },
  ) => {
    const form = new FormData()
    form.append('file', file)
    if (opts?.stepNo != null) form.append('stepNo', String(opts.stepNo))
    if (opts?.caption) form.append('caption', opts.caption)
    return apiRequest<{ attachmentId: number }>(
      `/api/requests/${requestId}/attachments`,
      { method: 'POST', body: form },
    )
  },

  /** The file as an authenticated object URL — the endpoint is bearer-gated. The caller must revoke it. */
  async fileObjectUrl(attachmentId: number): Promise<string> {
    const token = tokenStorage.getAccessToken()
    const res = await fetch(`${API_BASE_URL}/api/attachments/${attachmentId}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!res.ok) throw new Error(`Could not load the file (${res.status}).`)
    return URL.createObjectURL(await res.blob())
  },

  /** Open the file in a new tab — fetched WITH the token first, since a plain link cannot authenticate. */
  async open(attachmentId: number): Promise<void> {
    const url = await attachmentsService.fileObjectUrl(attachmentId)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  },

  remove: (attachmentId: number) =>
    apiRequest<void>(`/api/attachments/${attachmentId}`, { method: 'DELETE' }),
}

/** Exit permissions — the first concrete request type. */
export const exitPermissionsService = {
  create: (body: ExitPermissionCreateRequest) =>
    apiRequest<ExitPermissionCreated>('/api/exit-permissions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  mine: () => apiRequest<MyExitPermission[]>('/api/exit-permissions/mine'),

  /**
   * PERIOD CLOSE. Posts the approved exit-permission minutes that were marked "convert to leave" as
   * leave-ledger usage for the month.
   *
   * MANUAL AND NOT SCHEDULED — the nightly job applies permissions to attendance, but it does not do
   * this. Until somebody runs it, converted exit minutes are never actually deducted from anyone's
   * balance. Idempotent: a permission already posted is left alone, so a second run reports 0.
   */
  postLeave: (periodYearMonth: string, leaveTypeId: number) =>
    apiRequest<PostLeaveResult>('/api/exit-permissions/post-leave', {
      method: 'POST',
      body: JSON.stringify({ periodYearMonth, leaveTypeId }),
    }),
  byRequest: (requestId: number) =>
    apiRequest<ExitPermissionDetail>(`/api/exit-permissions/by-request/${requestId}`),

  /**
   * The TYPED approve-with-adjustment path (usp_ExitPermission_Decide) — used when a decision allows
   * a value change, because the typed procedure owns the figure and its rules (it refuses more than
   * currently stands). `password` is sent only when the step required a signature.
   */
  decide: (
    requestId: number,
    body: { approvedMinutes?: number | null; comment?: string | null; code?: string; password?: string },
  ) =>
    apiRequest<ExitPermissionDecisionResult>(`/api/exit-permissions/by-request/${requestId}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        // NULL means "as it stands", which is the procedure's own default and the common case.
        // Sending the standing figure back explicitly means the same thing; sending MORE is refused.
        approvedMinutes: body.approvedMinutes ?? null,
        comment: body.comment ?? null,
        code: body.code ?? null,
        password: body.password ?? null,
      }),
    }),
}

/**
 * Leave requests — the second concrete request type.
 *
 * Reading and acting on the request ITSELF (chain, notes, reject, hold, cancel) stays on
 * requestsService: the engine knows nothing about leave. Only the typed payload and the typed
 * approval are here.
 */
export const leaveRequestsService = {
  /**
   * Raise one. A refusal for OVERLAPPING DATES comes back as a 400 whose message names the clashing
   * dates and their status — show it verbatim; that sentence is the whole value of the refusal.
   */
  create: (body: LeaveRequestCreateRequest) =>
    apiRequest<LeaveRequestCreated>('/api/leave-requests', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * THE TYPED APPROVAL. Approving leave goes through here, not the generic /approve, because the
   * granted day count belongs to the typed procedure — it bounds the figure at what was requested
   * and posts the ledger movement exactly once, when the request closes Approved.
   *
   * `approvedDays` omitted (or null) means "as requested". `password` is sent only when the step
   * required a signature.
   *
   * `makeDiscretionary` grants the leave WITHOUT deducting it. Sent explicitly as false rather than
   * omitted, so the request always states which of the two it is. Every approver may ask for it,
   * but only the decision that closes the request touches the ledger — so the answer that takes
   * effect is the last one, and `discretionaryGranted` on the result says what actually happened.
   */
  decide: (
    requestId: number,
    body: {
      approvedDays?: number | null
      comment?: string | null
      code?: string
      password?: string
      makeDiscretionary?: boolean
    },
  ) =>
    apiRequest<LeaveRequestDecideResult>(`/api/leave-requests/${requestId}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        approvedDays: body.approvedDays ?? null,
        comment: body.comment ?? null,
        code: body.code ?? null,
        password: body.password ?? null,
        makeDiscretionary: body.makeDiscretionary ?? false,
      }),
    }),

  /** The leave payload behind a request, with the employee's current balance for that type. */
  payload: (requestId: number) =>
    apiRequest<LeaveRequestPayload>(`/api/leave-requests/${requestId}/payload`),

  /* The two employee-scoped reads. They live under /api/employees because that is whose data it is,
     but they are leave concerns, so the client keeps them here with the rest of leave. */

  /** One employee's leave history, newest first. The date bounds OVERLAP rather than contain. */
  forEmployee: (employeeId: number, from?: string, to?: string) => {
    const p = new URLSearchParams()
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    const qs = p.toString()
    return apiRequest<MyLeaveRequest[]>(
      `/api/employees/${employeeId}/leave-requests` + (qs ? `?${qs}` : ''),
    )
  },

  /** An employee's balance for ONE leave type — the all-time ledger sum. Zero is a real answer, not an error. */
  balance: (employeeId: number, leaveTypeId: number) =>
    apiRequest<LeaveBalanceSummary>(
      `/api/employees/${employeeId}/leave-balance?leaveTypeId=${leaveTypeId}`,
    ),
}

/**
 * Tip distributions — a shift's tips split between the people who worked it.
 *
 * The split belongs to the procedure: per-person is round(total/n, 2) and the LAST participant
 * absorbs the remainder, so the lines sum to exactly the total. The form previews the same
 * arithmetic; it never sends the figures.
 */
export const tipDistributionsService = {
  create: (body: TipDistributionCreateRequest) =>
    apiRequest<TipDistributionCreated>('/api/tip-distributions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * THE TYPED APPROVAL. Closing this request Approved stamps FinalizedAt, which is what hands the
   * lines to payroll — approving through the generic endpoint would approve a request that never
   * finalized.
   *
   * `linesJson` RESTATES THE SPLIT and is a full replacement set: send it only when the approver has
   * actually redistributed, and omit it (null) to approve as calculated. Every rule about it is the
   * procedure's — the shares summing exactly to each pooled currency, the currencies not changing,
   * the participants belonging to the branch, the step allowing an adjustment at all — and each
   * refusal names the figure that is wrong, so show those messages verbatim.
   *
   * On `linesRestated` the lines have changed: refetch the payload, or the panel keeps showing the
   * split that was replaced.
   */
  decide: (requestId: number, body: TipDecideRequest) =>
    apiRequest<TipDecisionResult>(`/api/tip-distributions/${requestId}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        linesJson: body.linesJson ?? null,
        comment: body.comment ?? null,
        password: body.password ?? null,
      }),
    }),

  /** Header and per-person lines together. */
  payload: (requestId: number) =>
    apiRequest<TipDistributionPayload>(`/api/tip-distributions/${requestId}/payload`),
}

/** Shift swaps — two people in the same role exchange a rostered day. */
export const shiftSwapsService = {
  create: (body: ShiftSwapCreateRequest) =>
    apiRequest<ShiftSwapCreated>('/api/shift-swaps', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * THE TYPED APPROVAL. At final approval the procedure REWRITES THE ROSTER — each takes the
   * other's slot, their own becomes a rest day — and stamps AppliedAt. Anything reading the roster
   * must refetch afterwards.
   */
  decide: (requestId: number, body: TypedDecideRequest) =>
    apiRequest<TypedDecisionResult>(`/api/shift-swaps/${requestId}/decide`, {
      method: 'POST',
      body: JSON.stringify({ comment: body.comment ?? null, password: body.password ?? null }),
    }),

  payload: (requestId: number) =>
    apiRequest<ShiftSwapPayload>(`/api/shift-swaps/${requestId}/payload`),
}

/**
 * Roster approvals — a branch's whole month of roster, put up for signature in one request.
 *
 * CREATE ONLY, and deliberately so: this type has NO typed decision. Approving it changes no
 * figure and rewrites no row — it records that the month was signed off — so it goes through the
 * GENERIC approve endpoint like any request whose approval is just an approval. Adding a `decide`
 * here would be inventing a second path to the same effect and a typed 409 to go with it.
 *
 * The refusals worth reading are on create and all say the same kind of thing: this branch-month
 * is already approved, or already sitting pending on somebody's desk. They arrive as a 400 with
 * the server's own sentence, which is shown verbatim wherever the create is called from.
 */
export const rosterApprovalsService = {
  create: (body: RosterApprovalCreateRequest) =>
    apiRequest<RosterApprovalCreated>('/api/workflow/roster-approvals', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

/** Overtime — hours beyond the scheduled shift, approved in advance and paid at a multiplier. */
export const overtimeService = {
  /** The PAST-DATE refusal comes back as a 400 with the procedure's own sentence — show it verbatim. */
  create: (body: OvertimeCreateRequest) =>
    apiRequest<OvertimeCreated>('/api/overtime', { method: 'POST', body: JSON.stringify(body) }),

  /**
   * THE TYPED APPROVAL. The minutes are REQUIRED on every approval — the figure signed for is the cap
   * payroll pays to — and the typed procedure owns every rule about it: above zero, no more than was
   * requested, and no more than an earlier approver already allowed. That last one is TIGHTEN-ONLY,
   * and its refusal names the standing figure; show it verbatim.
   *
   * `approvedMinutes` is still sent as null when absent rather than defaulted here, so an empty field
   * earns the procedure's own "State the approved minutes" instead of a silently invented number.
   */
  decide: (requestId: number, body: OvertimeDecideRequest) =>
    apiRequest<OvertimeDecisionResult>(`/api/overtime/${requestId}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        approvedMinutes: body.approvedMinutes ?? null,
        comment: body.comment ?? null,
        password: body.password ?? null,
      }),
    }),

  payload: (requestId: number) => apiRequest<OvertimePayload>(`/api/overtime/${requestId}/payload`),

  /** One employee's overtime history. */
  forEmployee: (employeeId: number, from?: string, to?: string) => {
    const p = new URLSearchParams()
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    const qs = p.toString()
    return apiRequest<MyOvertime[]>(
      `/api/employees/${employeeId}/overtime` + (qs ? `?${qs}` : ''),
    )
  },

  /** Sweep approved overtime into its attendance day. Also runs nightly. Idempotent. */
  applyToAttendance: (workDate?: string) =>
    apiRequest<OvertimeApplyResult>('/api/overtime/apply-to-attendance', {
      method: 'POST',
      body: JSON.stringify({ workDate: workDate ?? null }),
    }),
}

/** The signed-in user's own context, and branch-manager administration. */
export const meService = {
  /**
   * The employee behind the token. Returns null for an account with no employee record (a pure
   * admin login) — a 204, which the client turns into null. That means "no self-service", not an
   * error.
   */
  employee: () =>
    apiRequest<MyEmployee | null>('/api/me/employee').then((v) => v ?? null),

  /**
   * Whether the caller has a signature image on file — metadata only, never the bytes. Null when
   * they have none, which is a NORMAL state: signing works without an image, so nothing may treat
   * this as an error or a blocker.
   */
  signature: () =>
    apiRequest<MySignature | null>('/api/me/signature').then((v) => v ?? null),

  /**
   * The caller's own signature image as an authenticated object URL — the endpoint is bearer-gated,
   * and a plain <img src> cannot send the token. Null when there is none (404). The caller must
   * revoke the URL, or it leaks.
   *
   * PASS THE VERSION (the signature's updatedAt) whenever it is known. Because the bytes arrive
   * through fetch() rather than an <img src>, the staleness that bit here was the HTTP cache
   * answering the fetch — a fresh object URL wrapping the OLD bytes looks exactly like a working
   * upload that did nothing. The endpoint's no-cache header is the fix; this makes the address
   * change too, so nothing holding the previous URL can answer for the new image.
   */
  async signatureImageObjectUrl(version?: string | null): Promise<string | null> {
    const token = tokenStorage.getAccessToken()
    const res = await fetch(`${API_BASE_URL}/api/me/signature/image${cacheBust(version)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Could not load your signature image (${res.status}).`)
    return URL.createObjectURL(await res.blob())
  },

  /** Upload or replace the caller's own signature. multipart; the server validates type and size. */
  uploadSignature: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiRequest<MySignatureSaved>('/api/me/signature', { method: 'POST', body: form })
  },

  removeSignature: () => apiRequest<void>('/api/me/signature', { method: 'DELETE' }),

  /**
   * Changes the caller's own password. There is NO user id to send: the account is read from the
   * token on the server, so this request cannot be pointed at anybody else.
   *
   * The session survives it. A successful change returns 204 and nothing is re-issued or cleared —
   * the access token states who the caller is, not what their password is, so it stays true. Do not
   * add a logout here; the server does not expect one.
   *
   * A wrong current password comes back as a 400 whose message is written for the user to read.
   * Show it verbatim rather than substituting a friendlier one — the server's wording is the only
   * one that knows which of the two passwords was the problem.
   */
  changePassword: (currentPassword: string, newPassword: string) =>
    apiRequest<void>('/api/me/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
}

/**
 * Availability changes — a standing rewrite of somebody's default week from a date onwards.
 *
 * Reading and acting on the request itself (chain, notes, reject, hold, cancel) stays on
 * requestsService: the engine knows nothing about weekly patterns. Only the typed payload and the
 * typed approval are here — and the typed approval exists because closing this request Approved is
 * what actually rewrites attendance.EMPLOYEE_SHIFT_PATTERN.
 */
export const availabilityService = {
  /**
   * Raise one. ONLY THE CHANGED DAYS are sent — the procedure touches only what it receives, so an
   * untouched day is left as it is rather than being reasserted.
   *
   * The four refusals all come back as 400s carrying the procedure's own sentence, and each says
   * exactly what to fix: a past effective date, a whole week marked unavailable, an employee who
   * already has one waiting, and an unknown shift. Show them verbatim.
   */
  create: (body: AvailabilityCreateRequest) =>
    apiRequest<AvailabilityCreated>('/api/availability-changes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * THE TYPED APPROVAL. `days` optionally RESTATES the request — a full replacement set, and only at
   * a step whose CanAdjust allows it; the engine refuses it otherwise. Omit it to approve as asked.
   */
  decide: (requestId: number, body: AvailabilityDecideRequest) =>
    apiRequest<AvailabilityDecisionResult>(`/api/availability-changes/${requestId}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        days: body.days ?? null,
        comment: body.comment ?? null,
        password: body.password ?? null,
      }),
    }),

  /** Header and the requested days together. */
  payload: (requestId: number) =>
    apiRequest<AvailabilityPayload>(`/api/availability-changes/${requestId}/payload`),

  /**
   * Rostered days that contradict the change. An EMPTY LIST IS THE GOOD ANSWER; rows here keep their
   * shifts, because approving rewrites the template and not days somebody already published.
   */
  conflicts: (requestId: number) =>
    apiRequest<AvailabilityConflict[]>(`/api/availability-changes/${requestId}/conflicts`),
}

/**
 * New-hire onboarding — the hire decision and the paperwork that must follow it.
 *
 * THERE IS NO EMPLOYEE ID ANYWHERE HERE. The candidate is nobody in the system at submit time; the
 * procedure takes the requester from the token, and the hr.EMPLOYEE record is created by the first
 * approval.
 */
export const onboardingService = {
  create: (body: OnboardingCreateRequest) =>
    apiRequest<OnboardingCreated>('/api/onboardings', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * THE TYPED APPROVAL. The first one creates the employee record; the LAST is refused while any
   * required checklist item is undone, with a message naming every outstanding one — show it
   * verbatim, it is the whole point of the type.
   */
  decide: (requestId: number, body: { comment?: string | null; password?: string | null }) =>
    apiRequest<OnboardingDecisionResult>(`/api/onboardings/${requestId}/decide`, {
      method: 'POST',
      body: JSON.stringify({ comment: body.comment ?? null, password: body.password ?? null }),
    }),

  payload: (requestId: number) =>
    apiRequest<OnboardingPayload>(`/api/onboardings/${requestId}/payload`),

  /**
   * Ticks or unticks one item and returns the WHOLE list, already in order — render it as it
   * arrives; see the note on OnboardingTask.sortOrder. Refused once the request is closed: "This
   * onboarding is closed; its checklist is now history."
   */
  setTask: (requestId: number, code: string, body: OnboardingSetTaskRequest) =>
    apiRequest<OnboardingTask[]>(
      `/api/onboardings/${requestId}/tasks/${encodeURIComponent(code)}`,
      {
        method: 'POST',
        body: JSON.stringify({ isComplete: body.isComplete, note: body.note ?? null }),
      },
    ),
}

/**
 * Separations — resignation, termination, end of contract, retirement.
 *
 * THE FINAL SIGN-OFF IS REFUSED ON AN UNPREPARED SETTLEMENT, and once given it ends the employment
 * and clears the leave ledger. Both effects are irreversible from this application, so anything that
 * leads to `decide` on the last step must say so before it is signed.
 */
export const separationsService = {
  /**
   * The figures the form shows BEFORE anyone commits — service, notice and any shortfall, a
   * provisional indemnity where a basic is on file, and the leave still on the ledger. Reads nothing
   * and changes nothing: the dates are hypotheses being tried out.
   *
   * `monthlyBasic` and `provisionalIndemnity` come back NULL when no basic is on file. That is a real
   * answer the form must state — a zero there would read as "nothing is owed".
   */
  context: (employeeId: number, lastWorkingDate?: string | null, noticeGivenDate?: string | null) => {
    const p = new URLSearchParams({ employeeId: String(employeeId) })
    if (lastWorkingDate) p.set('lastWorkingDate', lastWorkingDate)
    if (noticeGivenDate) p.set('noticeGivenDate', noticeGivenDate)
    return apiRequest<SeparationContext>(`/api/separations/context?${p.toString()}`)
  },

  /**
   * Raise one. "This employee already has a termination date on file." and the in-progress guard both
   * come back verbatim — each names the exact reason this cannot proceed.
   */
  create: (body: SeparationCreateRequest) =>
    apiRequest<SeparationCreated>('/api/separations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * Saves the preparer's figures and returns them with the total the SERVER computed, so the screen
   * never has to agree with it. Refused once the request is closed, and on any negative amount.
   */
  setSettlement: (requestId: number, body: SeparationSettlementRequest) =>
    apiRequest<SeparationSettlement>(`/api/separations/${requestId}/settlement`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  decide: (requestId: number, body: { comment?: string | null; password?: string | null }) =>
    apiRequest<SeparationDecisionResult>(`/api/separations/${requestId}/decide`, {
      method: 'POST',
      body: JSON.stringify({ comment: body.comment ?? null, password: body.password ?? null }),
    }),

  payload: (requestId: number) =>
    apiRequest<SeparationPayload>(`/api/separations/${requestId}/payload`),
}

export const branchManagerService = {
  getAll: () => apiRequest<BranchWithManager[]>('/api/branches/with-manager'),
  setManager: (branchId: number, managerEmployeeId: number | null) =>
    apiRequest<BranchManagerSet>(`/api/branches/${branchId}/manager`, {
      method: 'PUT',
      body: JSON.stringify({ managerEmployeeId }),
    }),
}

export const expensesService = {
  create: (body: ExpenseCreateRequest) =>
    apiRequest<ExpenseCreated>('/api/expenses', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /**
   * THE FIGURE IS REQUIRED — every expense decision carries it, in the expense's OWN currency.
   * Typed as required here so a caller cannot forget it; the procedure refuses a null anyway, with
   * a better sentence than any client check would produce.
   *
   * THERE IS NO SIGNER CAP. The operations manager may grant ANY figure up to what was claimed;
   * what he grants ROUTES the request — at or under the threshold the remaining steps are skipped
   * and it closes Approved, above it the Owner step stands. The result says which happened
   * (`remainingStepsSkipped` / `goesToOwner`), so nothing here has to work it out.
   *
   * REFETCH THE CHAIN AFTER THIS, always. A skipped Owner step changes the chain without any further
   * call, and a page that does not refetch keeps showing a step waiting on somebody who was never
   * asked.
   */
  decide: (
    requestId: number,
    body: { approvedAmount: number; comment?: string | null; password?: string | null },
  ) =>
    apiRequest<ExpenseDecisionResult>(`/api/expenses/${requestId}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        approvedAmount: body.approvedAmount,
        comment: body.comment ?? null,
        password: body.password ?? null,
      }),
    }),
  payload: (requestId: number) =>
    apiRequest<ExpensePayload>(`/api/expenses/${requestId}/payload`),
}

/**
 * Payroll adjustments — corrections with a chain behind them.
 *
 * THIS IS THE ONLY DOOR. The direct POST /api/payroll/adjustments is gone and its procedure refuses,
 * so a correction now exists only as a request: HR states the claim, the Owner signs it, and the
 * FINAL approval writes the ledger row the next Generate consumes.
 *
 * `decide` CARRIES THE FIGURE THE APPROVER SIGNS. `approvedAmount` is required, and it — not the
 * amount originally claimed — is what reaches the payslip. The server refuses more than was
 * requested, and refuses more than an earlier approver already allowed, so a chain can only tighten
 * a figure on its way up. Granting more means rejecting and raising again.
 *
 * READ `approvedAmount` OFF THE RESPONSE rather than assuming the body took effect: it is the new
 * standing figure and it is what the next approver will be shown.
 *
 * The refusal to watch for is the one nobody can plan around: the target period can LOCK while the
 * request is in flight, and the final approval then refuses with "The 2026-09 run locked while this
 * request waited. Reject it and raise it again for the next open period." It arrives before any
 * signature is written, so the request is still intact — show it verbatim and let them reject.
 */
export const payrollAdjustmentsService = {
  create: (body: PayrollAdjustmentCreateRequest) =>
    apiRequest<{ requestInstanceId: number; status: string; currentStepNo: number | null }>(
      '/api/payroll-adjustment-requests',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  decide: (
    requestId: number,
    body: {
      /** Required, above zero. The figure being signed for. */
      approvedAmount: number
      comment?: string | null
      password?: string | null
    },
  ) =>
    apiRequest<
      TypedDecisionResult & { approvedAmount: number; createdAdjustmentId: number | null }
    >(`/api/payroll-adjustment-requests/${requestId}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        approvedAmount: body.approvedAmount,
        comment: body.comment ?? null,
        password: body.password ?? null,
      }),
    }),
  payload: (requestId: number) =>
    apiRequest<PayrollAdjustmentPayload>(
      `/api/payroll-adjustment-requests/${requestId}/payload`,
    ),
}

/**
 * Salary advances — money lent against future pay, with a chain behind it.
 *
 * THIS IS THE ONLY DOOR: POST /api/payroll/advances is gone and its procedure refuses. The final
 * approval writes the ledger row payroll then recovers against, month by month.
 *
 * `decide` CARRIES TWO FIGURES: how much is lent, and how fast it comes back. `approvedAmount` is
 * required; `approvedMonthlyDeduction` is optional, and OMITTING IT MEANS "keep the standing
 * schedule", not "deduct nothing" — the server carries it over and clamps it to the approved
 * amount. So read BOTH figures off the response: when the monthly was left out, or stated larger
 * than the amount can support, what comes back is what will actually be deducted.
 *
 * The refusal seen most is the one-at-a-time rule: "This employee already has an advance being
 * recovered or awaiting a decision. One at a time." Show it verbatim; it explains itself.
 */
export const salaryAdvancesService = {
  create: (body: SalaryAdvanceCreateRequest) =>
    apiRequest<SalaryAdvanceCreated>('/api/salary-advance-requests', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  decide: (
    requestId: number,
    body: {
      /** Required, above zero. */
      approvedAmount: number
      /** Optional. Null keeps the standing schedule, clamped by the server to the approved amount. */
      approvedMonthlyDeduction?: number | null
      comment?: string | null
      password?: string | null
    },
  ) =>
    apiRequest<
      TypedDecisionResult & {
        approvedAmount: number
        approvedMonthlyDeduction: number
        createdAdvanceId: number | null
      }
    >(`/api/salary-advance-requests/${requestId}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        approvedAmount: body.approvedAmount,
        approvedMonthlyDeduction: body.approvedMonthlyDeduction ?? null,
        comment: body.comment ?? null,
        password: body.password ?? null,
      }),
    }),
  payload: (requestId: number) =>
    apiRequest<SalaryAdvancePayload>(`/api/salary-advance-requests/${requestId}/payload`),
}

/**
 * What an expense decision returned: the engine's result, the granted figure, and WHERE THE REQUEST
 * WENT because of it.
 *
 * The two routing flags come from the procedure and are never re-derived from approvedUsd against
 * thresholdUsd: routing also depends on WHERE in the chain the decision was taken (the Owner is
 * never skipped by his own decision — he is the last word), which only the procedure knows.
 */
export interface ExpenseDecisionResult {
  requestInstanceId: number
  status: string
  currentStepNo: number | null
  closedReason: string | null
  decision: string | null
  signedAsDeputy: boolean
  signedWithPassword: boolean
  /** The granted figure, in the expense's own currency. */
  approvedAmount: number
  /** The same figure in USD at the expense's frozen rate — what the routing tested. */
  approvedUsd: number
  /** The USD figure it was tested against, so a near-threshold outcome stays explicable. */
  thresholdUsd: number
  /**
   * The grant landed at or under the threshold and later steps existed, so they were skipped and the
   * request closed Approved. Those steps now show grey with their reason — refetch the chain.
   */
  remainingStepsSkipped: boolean
  /** The grant was above the threshold and the request is now open on the Owner. */
  goesToOwner: boolean
}

export interface ExpensePayload {
  expenseReimbursementId: number
  employeeId: number
  employeeName: string
  expenseDate: string
  category: string
  amount: number
  currencyCode: string
  amountUsd: number
  /** The rate the USD figure was frozen at when the request was raised. Null for a USD expense. */
  rateUsed: number | null
  /** The USD figure a GRANT is tested against — what the decision dialog previews the routing from. */
  thresholdUsd: number
  approvedAmount: number | null
  description: string | null
  reimbursedInPayrollAt: string | null
  receiptCount: number
  /**
   * Whether the REQUESTED amount is above the threshold. A statement about the claim, not the
   * routing: what the approver grants is what settles whether the Owner is asked.
   */
  ownerSignatureRequired: boolean
}

export interface ExpenseCreateRequest {
  employeeId: number
  /** yyyy-MM-dd; today or earlier. */
  expenseDate: string
  category: string
  amount: number
  currencyCode: string
  description?: string | null
  title?: string | null
}

export interface ExpenseCreated {
  requestInstanceId: number
  status: string
  currentStepNo: number | null
  amountUsd: number
  rateUsed: number | null
  thresholdUsd: number
  /**
   * LIKELY, not settled. The REQUESTED amount is above the threshold, so on present evidence the
   * Owner will be asked — but what actually decides is the figure the operations manager GRANTS.
   * Never phrase this to a requester as a settled fact.
   */
  ownerLikelyNeeded: boolean
}