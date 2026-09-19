/**
 * Workflow API models. Mirrors the backend DTOs in MokaCo.HRMS.Model/Workflow.
 *
 * The one idea that explains most of this file: a chain is DATA, versioned and never edited, and an
 * approver is a KIND, not a name. Requests lock the version they were submitted under; skipped steps
 * carry the reason they were skipped; who typed a request and whose request it is are two facts.
 * Dates/times are strings, as everywhere.
 */

/* ── Permission codes (module 'Workflow') ── */
export const WF = {
  configure: 'WORKFLOW_CONFIGURE',
  versionMove: 'WORKFLOW_VERSION_MOVE',
  raiseSelf: 'REQUEST_RAISE_SELF',
  raiseOthers: 'REQUEST_RAISE_OTHERS',
  viewAll: 'REQUEST_VIEW_ALL',
  signatureManage: 'SIGNATURE_MANAGE',
} as const

/* ── Request types & chain definitions ── */

export interface RequestType {
  requestTypeId: number
  code: string
  name: string
  /**
   * The Arabic name, when somebody has supplied one. NULLABLE AND OFTEN ABSENT — see
   * src/i18n/referenceName.ts; read it through referenceName() rather than directly, so an
   * untranslated row falls back to the English name instead of rendering blank.
   */
  nameAr?: string | null
  description: string | null
  descriptionAr?: string | null
  isActive: boolean
}

/**
 * A type the signed-in user may ACTUALLY RAISE (GET /api/workflow/request-types/raisable): active,
 * and with a published chain. Types without one are absent — offering them would produce a form that
 * fails at submit, after the person had filled it in.
 *
 * This is what the new-request screen lists. The full catalogue lives behind request-types, which
 * needs WORKFLOW_CONFIGURE; an ordinary employee raising a request may read only this.
 */
export interface RaisableRequestType {
  requestTypeId: number
  code: string
  name: string
  /**
   * The Arabic name, when somebody has supplied one. NULLABLE AND OFTEN ABSENT — see
   * src/i18n/referenceName.ts; read it through referenceName() rather than directly, so an
   * untranslated row falls back to the English name instead of rendering blank.
   */
  nameAr?: string | null
  /** The short label for a card or a menu — falls back to name server-side. */
  menuLabel: string
  /** Arabic menu label; falls back server-side to nameAr, and to nothing if neither exists. */
  menuLabelAr?: string | null
  description: string | null
  descriptionAr?: string | null
  icon: string | null
  sortOrder: number
}

export interface WorkflowDefinition {
  workflowDefinitionId: number
  requestTypeId: number
  requestTypeCode: string
  requestTypeName: string
  version: number
  /** Draft / Active / Retired. Only a Draft may be edited. */
  status: string
  notes: string | null
  publishedAt: string | null
  createdAt: string
  /**
   * Which population this chain serves: null = everyone, otherwise THAT TIER AND EVERYONE MORE
   * SENIOR — everyone with a SMALLER number, because tier 1 is the head of the organisation.
   */
  minRequesterTier: number | null
  stepCount: number
}

/* THE TIER→WORD MAP THAT USED TO LIVE HERE IS GONE.
   It hard-coded two names ("Management+", "Executive") for tiers 2 and 3, and its options list
   offered exactly those two. Both are wrong now: the tier names are an editable dictionary, and a
   BIGGER number is a LOWER role rather than a higher one, so "and above" named the wrong direction.
   Labels and options now come from useApprovalTiers() — see populationLabel there. */

/** The value the "Applies to" Select uses for "everyone"; the API takes null, which a Select cannot bind to. */
export const MIN_TIER_EVERYONE = 0

export interface WorkflowStep {
  workflowStepId: number
  stepNo: number
  name: string
  /** BranchManager / Role / SpecificUser. */
  approverType: string
  approverRoleId: number | null
  approverRoleName: string | null
  approverUserId: number | null
  approverUsername: string | null
  isMandatory: boolean
  /** A deputy role whose members may also sign this step, alongside the named approver. */
  fallbackRoleId: number | null
  fallbackRoleName: string | null
  /** For a LineManager step: how many levels up the reporting line it climbs (1 = direct manager). */
  escalationLevels: number | null
  /** This approver may grant less than requested (e.g. 120 of 180 minutes). */
  canAdjust: boolean
  /** A comment is required with EVERY decision here, not only on a change or a rejection. */
  requiresComment: boolean
  /** Every decision here must be password-signed, whoever signs — on top of any role signature policy. */
  requiresSignature: boolean
}

/** One step of the active chain, shown before submitting. */
export interface ActiveDefinitionStep {
  workflowDefinitionId: number
  version: number
  publishedAt: string | null
  stepNo: number
  name: string
  approverType: string
  approverRoleId: number | null
  approverRoleName?: string | null
  isMandatory: boolean
  /** For a LineManager step: how many levels up the reporting line (1 = direct manager). */
  escalationLevels?: number | null
  /** For a LineManager step read with an employeeId: the actual person it resolves to for that requester. */
  resolvedApproverName?: string | null
}

export interface DefinitionCreated {
  workflowDefinitionId: number
  version: number
}

/**
 * A chain a DRAFT can be started from (GET /api/workflow/copy-sources) — any version, of any type,
 * that actually has steps. Retired and draft versions are offered too: the useful precedent is
 * often the one that was just superseded.
 */
export interface DefinitionCopySource {
  workflowDefinitionId: number
  requestTypeCode: string
  requestTypeName: string
  version: number
  status: string
  minRequesterTier: number | null
  /**
   * minRequesterTier in words, composed by the SERVER. Its own field because the SOURCE's audience
   * is what lets the builder say, after a copy, that the audience did NOT come along: applies-to
   * belongs to the draft, never to the steps.
   */
  appliesTo: string | null
  /** Ready to show — "Overtime · v1 (active) · Everyone". Composed in SQL so one wording serves every caller. */
  label: string
  stepCount: number
  /** "1. Branch manager → 2. Owner" — the whole chain in a line, for help text under the picker. */
  stepsPreview: string | null
}

/**
 * Copy one chain's steps into a draft. A SNAPSHOT, NOT A LINK — nothing records where the steps
 * came from, so later edits to either chain leave the other alone.
 */
export interface DefinitionCopyFromRequest {
  sourceDefinitionId: number
  /**
   * False first, always. The API REFUSES a draft that already has steps and names how many; that
   * refusal is what becomes the explicit "Replace existing steps" confirm, so nobody discards work
   * they had forgotten was there.
   */
  replaceExisting: boolean
}

/** What a copy did. stepsReplaced is 0 unless the draft's own steps were discarded first. */
export interface DefinitionCopyResult {
  workflowDefinitionId: number
  stepsCopied: number
  stepsReplaced: number
}

export interface DefinitionAddStepRequest {
  stepNo: number
  name: string
  /** BranchManager / Role / SpecificUser / LineManager. */
  approverType: string
  approverRoleId: number | null
  approverUserId: number | null
  isMandatory: boolean
  /** For a LineManager step: how many levels up the reporting line (1 = direct manager). Null otherwise. */
  escalationLevels: number | null
  /** Optional deputy role (maps to the proc's @FallbackRoleId) whose members may also sign this step. */
  deputyRoleId: number | null
  /** This approver may grant less than requested. Default false. */
  canAdjust: boolean
  /** A comment is required with every decision here. Default false. */
  requiresComment: boolean
  /** Every decision here must be password-signed, whoever signs. Default false. */
  requiresSignature: boolean
}

/** A role that may be chosen as an approver/deputy in a chain (GET /api/roles/approvers). */
export interface ApproverRole {
  roleId: number
  name: string
  isSystem: boolean
  usableAsApprover: boolean
  /** How many ACTIVE users hold this role. 0 means a deputy set to it could never sign. */
  activeMemberCount: number
}

/* ── Decision control (data-driven approve/reject/hold/delegate) ── */

/**
 * One decision offered at the current step (GET /api/requests/{id}/decisions), already filtered by
 * the step config, CanAdjust and whether the caller may act. An EMPTY list is the answer "not yours
 * to decide" — render the step read-only, not as an error. Only `engineAction` picks the endpoint;
 * everything else is presentation and requirement flags the dialog reads to build itself.
 */
export interface DecisionOption {
  /** The stable key stored on the step as its Decision — carried in the submit body verbatim. */
  code: string
  label: string
  description: string | null
  /** Approve | Reject | Hold | Delegate — the ONE thing the code branches on. */
  engineAction: string
  /** Positive | Negative | Neutral — colours the icon + label only, never the whole row. */
  tone: string
  requiresComment: boolean
  requiresAttachment: boolean
  requiresTargetUser: boolean
  /** For a Hold decision: pause AND ask the requester (e.g. "Ask the employee"). */
  waitingOnRequester: boolean
  /** May adjust the typed figure — already AND-ed with the step's CanAdjust by the procedure. */
  allowsValueChange: boolean
  /** At most one is primary — the filled button; the rest live behind the caret. */
  isPrimary: boolean
  icon: string | null
  sortOrder: number
}

/**
 * The caller's OWN signature image, metadata only (GET /api/me/signature) — the bytes never travel
 * here. `hasSignature` false, or a null response, both mean "no image on file", which is a normal
 * state: a decision is signed with a PASSWORD, and the image is only a convention shown alongside.
 * Nothing may treat its absence as an error or refuse to sign.
 */
export interface MySignature {
  userId: number
  username: string
  hasSignature: boolean
  contentType: string | null
  fileName: string | null
  byteSize: number | null
  updatedAt: string | null
  updatedByUsername: string | null
}

/** What comes back after uploading one — metadata, never the bytes just sent. */
export interface MySignatureSaved {
  userId: number
  contentType: string
  fileName: string | null
  byteSize: number
  updatedAt: string
  updatedBy: number | null
}

/** GET /api/requests/{id}/signature-requirement — known before the dialog opens. */
export interface SignatureRequirement {
  signatureRequired: boolean
  requiredByRole: string | null
  requiredByStep: boolean
  graceMinutes: number
  /** Verbatim sentence to show above the password field — never invent one. */
  explanation: string | null
  /** Whether the caller has a signature image on file — the popup shows it, or a quiet "no image" line. */
  hasSignatureImage: boolean
}

/**
 * A decision saved without signing (GET /api/requests/{id}/draft). A draft is deliberately allowed
 * to be half-formed — none of the decision's requirement rules apply until it is actually signed. An
 * empty response means "no draft of MINE" (a colleague's draft on a shared Role step is invisible),
 * never an error.
 */
export interface DraftDecision {
  stepNo: number
  stepName: string
  draftDecisionCode: string
  /** Null when the decision type it referenced has since been deactivated. */
  draftDecisionLabel: string | null
  draftComment: string | null
  draftValue: number | null
  draftTargetUserId: number | null
  draftTargetUsername: string | null
  draftWaitingOnRequester: boolean
  draftSavedAt: string
  daysSinceSaved: number
}

/** A configurable decision type (GET /api/workflow/decision-types, usp_DecisionType_GetAll). */
export interface DecisionTypeConfig {
  decisionTypeId: number
  code: string
  label: string
  description: string | null
  engineAction: string
  tone: string
  requiresComment: boolean
  requiresAttachment: boolean
  requiresTargetUser: boolean
  allowsValueChange: boolean
  waitingOnRequester: boolean
  isPrimary: boolean
  /** 0 = the engine derives it (e.g. an auto-skip); it must never appear in the menu. */
  isSelectable: boolean
  /** System types cannot have their Code or EngineAction edited. */
  isSystem: boolean
  isActive: boolean
  icon: string | null
  sortOrder: number
}

/* ── Requests ── */

export interface RequestHeader {
  requestInstanceId: number
  requestTypeId: number
  requestTypeCode: string
  requestTypeName: string
  employeeId: number
  employeeName: string
  branchName: string
  raisedByUserId: number
  raisedByUsername: string
  /** True when the submitter is not the employee. */
  raisedOnBehalf: boolean
  status: string
  currentStepNo: number | null
  title: string | null
  submittedAt: string
  closedAt: string | null
  closedReason: string | null
  workflowVersion: number
}

export interface RequestStep {
  requestStepInstanceId: number
  stepNo: number
  name: string
  approverType: string
  resolvedUserId: number | null
  resolvedUsername: string | null
  approverRoleId: number | null
  approverRoleName: string | null
  /** A deputy role that may ALSO sign this step, if configured. */
  fallbackRoleId: number | null
  fallbackRoleName: string | null
  /** Pending / OnHold / Approved / Rejected / Skipped. */
  status: string
  /** The recorded decision, when it says more than the status. */
  decision: string | null
  actedByUserId: number | null
  actedByUsername: string | null
  actedAt: string | null
  comment: string | null
  /** Why this step was skipped — rendered where a signature would go, so a skip never reads as a blank gap. */
  skipReason: string | null
  /** Frozen from the chain: false = a rejection here is advisory and the chain continues. */
  rejectionEndsRequest: boolean
  /** While on hold: what it waits for, when it began, whether the requester must answer, and who set it. */
  holdReason: string | null
  holdSetAt: string | null
  waitingOnRequester: boolean
  holdSetByUsername: string | null
  canAdjust: boolean
  requiresComment: boolean
  /** True when a later authority overruled this rejection — render "did not recommend", not solid red. */
  wasOverruled: boolean
  /** True when the signed-in caller may still withdraw THIS decision (their own, request open, nobody after acted). */
  canWithdraw: boolean
  /** True when withdrawing THIS decision must be password-signed (it was signed, or the step/role demands it). */
  withdrawNeedsSignature: boolean
  /** True when the decision on this step was made with a password — render a lock + "signed". */
  signedWithPassword: boolean
  /**
   * True when this step's signer has a FROZEN signature image on file for this decision — the cue to
   * render an <img>. False (with signedWithPassword still true) means they signed but have no image:
   * show the lock and "signed", never a broken image. The bytes are NOT here — they come one at a
   * time from GET /api/signatures/{signedSignatureId}/image.
   */
  hasSignatureImage: boolean
  /** The signature-log row id carrying that frozen image — the id the image endpoint takes. Null when there is none. */
  signedSignatureId: number | null
  /** True only for the person who delegated this step, and only while the delegate has not decided. */
  canReclaim: boolean
  /** When this step was delegated: to whom (the actual "was delegated" signal — never infer from ApproverType), and from whom. */
  delegatedToUserId: number | null
  delegatedToUsername: string | null
  delegatedFromUsername: string | null
  /**
   * DEPUTY DELEGATION — a different act from the person-to-person delegation above. That one names
   * a user; this one opens the step to `fallbackRoleId`, so whoever holds that role may sign.
   * Non-null `delegatedToDeputyAt` IS the signal — a configured `fallbackRoleName` on its own only
   * means a deputy EXISTS, not that the step was handed over.
   */
  delegatedToDeputyAt: string | null
  deputyDelegatedByUserId: number | null
  deputyDelegatedByUsername: string | null
  /**
   * True when the step's MAIN approver cannot act — absent, vacant, or the requester themselves.
   *
   * THE DEPUTY MAY ALREADY SIGN WHEN THIS IS TRUE, with nothing delegated: absence is the system
   * noticing the approver has stepped away, delegation is them saying so. The server computes this
   * with the same rule fn_CanUserActOnStep uses to allow the deputy, so it never disagrees with
   * what the decisions endpoint offers.
   */
  mainApproverAbsent: boolean
  /** How many proof attachments hang off this step (bytes are never in the list). */
  proofCount: number
}

/**
 * What the delegate/reclaim calls return — the step's deputy state after the act.
 *
 * Both members come back null after a reclaim, which is what lets a caller re-render from the
 * response alone. The pages here refetch anyway: delegating also changes who the decisions
 * endpoint will answer for, and that is not in this shape.
 */
export interface DeputyDelegationResult {
  stepNo: number
  delegatedToDeputyAt: string | null
  deputyDelegatedByUserId: number | null
}

/**
 * What POST /api/requests/{id}/send-email hands back — the outbox row and where it is addressed.
 *
 * THE ADDRESS IS WHY THIS IS NOT A 204. Whoever presses the button is almost never the employee,
 * and "Queued" alone does not say whether it is going to the address they meant. Naming it back puts
 * that in front of them while the mail is still a row and correcting it costs one edit.
 */
export interface QueuedEmailResult {
  emailId: number
  toAddress: string
}

/**
 * Where this request's messages got to — GET /api/requests/{id}/email-status, ONE PER CHANNEL.
 *
 * A LIST, because an Email row and a WhatsApp row for the same request are two messages with two
 * outcomes: the address can bounce while the WhatsApp arrives, and neither retries the other.
 *
 * AN EMPTY LIST IS THE COMMON ANSWER and it is not an error: nothing has ever been queued for this
 * request, so there is nothing to say. The endpoint answers 204 and the screen shows no line at all,
 * rather than a status meaning "none".
 */
export interface RequestEmailStatus {
  /** 'Email' or 'WhatsApp' — which message this line is about. */
  channel: string
  /** Pending, Sent or Failed — core.EMAIL_OUTBOX.Status verbatim. */
  status: string
  /**
   * Sends attempted so far, against a ceiling of 3 that the procedure enforces. Shown while a row is
   * still Pending: "attempt 2/3" is the difference between a message that is retrying after a
   * failure and one that has simply not been picked up yet.
   */
  attemptCount: number
  /** The mail server's or the API's own reason. Null unless the status is Failed. */
  error: string | null
  /** When it actually left. Null until it does. */
  sentUtc: string | null
}

export interface SignatureLogEntry {
  signatureId: number
  stepNo: number | null
  /** Submitted / Approved / Rejected / Skipped / Cancelled / VersionMoved. */
  action: string
  actedByUserId: number | null
  actedByUsername: string | null
  actedAt: string
  comment: string | null
  hasSignatureImage: boolean
  /**
   * When this signature was STRUCK by a retract or a reopen. Null on one that still stands.
   *
   * A struck signature is NEVER removed from the log — it renders struck through, with the reason
   * beside it. Deleting it would make the record say the decision was never taken, which is the one
   * thing an append-only trail exists to prevent. Anything looking for "the decision that currently
   * stands" must therefore filter on this being null, not assume the newest row wins.
   */
  retractedAt?: string | null
  /** Why it was struck — the retractor's own words, or "Reopened by GM + Owner". */
  retractedReason?: string | null
}

/**
 * A reversal — undoing a decision, recorded as its OWN event rather than as another signature.
 *
 * TWO KINDS. A RETRACT is the last signer taking back their own decision on the same UTC day; it
 * completes at once, so `firstSignRole` is 'Self' and `completedAt` is already set. A REOPEN needs
 * the General Manager AND the Owner in either order: whoever signs first creates the row with
 * `completedAt` null, and the OTHER role completes it.
 *
 * So `completedAt === null` on a Reopen is the half-signed state — that, and nothing else, is what
 * the request page reads to say it is waiting on the other of the two.
 */
export interface RequestReversal {
  reversalId: number
  /** 'Retract' or 'Reopen'. */
  kind: string
  reason: string
  firstSignUserId: number
  firstSignUsername: string | null
  /** 'Self' for a retract; 'Owner' or 'GeneralManager' for a reopen. */
  firstSignRole: string
  secondSignUserId: number | null
  secondSignUsername: string | null
  secondSignRole: string | null
  /** Null while a reopen waits on the other of GM/Owner. */
  completedAt: string | null
  createdAt: string
}

export interface RequestDetail {
  header: RequestHeader
  steps: RequestStep[]
  history: SignatureLogEntry[]
  /**
   * Retracts and reopens on this request. Optional because a client may be talking to an API that
   * predates the fourth result set — treat an absent list as "none", never as an error.
   */
  reversals?: RequestReversal[]
}

/**
 * What a reopen attempt did. ONE OF TWO THINGS, and both must be handled.
 *
 * The first of GM/Owner to sign gets `state: 'AwaitingSecond'` with `firstSignRole` naming who —
 * and NOTHING HAS MOVED: the request is still closed. The second gets `state: 'Reopened'` with the
 * request's new standing. Reporting the first as though it were the second is the mistake this
 * shape exists to prevent.
 */
export interface ReopenResult {
  state: 'AwaitingSecond' | 'Reopened' | string
  /** Which of GM/Owner has signed so far. Set only on 'AwaitingSecond'. */
  firstSignRole?: string | null
  /** The request's new standing. Set only on 'Reopened'. */
  requestInstanceId?: number | null
  status?: string | null
  currentStepNo?: number | null
}

export interface MyRequest {
  requestInstanceId: number
  requestTypeCode: string
  requestTypeName: string
  title: string | null
  status: string
  currentStepNo: number | null
  currentStepName: string | null
  submittedAt: string
  closedAt: string | null
  closedReason: string | null
}

/**
 * One request the user is connected to in ANY capacity (GET /api/requests/for-me), with flags
 * saying HOW. The hub loads this once and filters client-side into its tabs — a request can carry
 * several flags at once.
 */
export interface ForUserRequest {
  requestInstanceId: number
  requestTypeCode: string
  requestTypeName: string
  /** The type's Arabic name, when the read supplies one — see src/i18n/referenceName.ts. */
  requestTypeNameAr?: string | null
  employeeId: number
  employeeName: string
  branchName: string
  title: string | null
  /** Pending / OnHold / Approved / Rejected / Cancelled. Pending AND OnHold are both OPEN. */
  status: string
  currentStepNo: number | null
  currentStepName: string | null
  /** The current step's own status — 'OnHold' when the request is paused. */
  currentStepStatus: string | null
  /** When the request is on hold: what it waits for, when it began, and whether the requester must answer. */
  holdReason: string | null
  holdSetAt: string | null
  waitingOnRequester: boolean
  submittedAt: string
  closedAt: string | null
  closedReason: string | null
  workflowVersion: number
  daysOpen: number
  /** Sitting on my signature this moment. */
  waitingOnMe: boolean
  /** Someone put a hold on MY OWN request asking me to answer — work of mine even though I am not an approver. */
  needsMyAnswer: boolean
  /** Raised FOR me — I am the employee. */
  isMine: boolean
  /** I typed it — mine, or on someone else's behalf. */
  raisedByMe: boolean
  /** I signed a step at some point. */
  iActedOnIt: boolean
  /** What I did on the step I most recently acted on ('Approved'/'Rejected'), or null. */
  myStepStatus: string | null
  /** The recorded decision on that step, when distinct from its status. Null if I never acted. */
  myDecision: string | null
  myActedAt: string | null
  /** The note left with my decision — e.g. a rejection reason. Null if none. */
  myComment: string | null
  /** How many notes are on this request — drives the speech-bubble count on the card. */
  noteCount: number
  /**
   * DEPUTY DELEGATION ON THE CURRENT STEP — all four answered for the signed-in caller, so the
   * hub card can offer the act without a second call per row.
   *
   * `fallbackRoleName` null means the current step has no deputy configured, which is most steps.
   * `delegatedToDeputyAt` non-null IS the "handed over" signal — a configured role on its own only
   * means a deputy exists.
   */
  fallbackRoleName: string | null
  delegatedToDeputyAt: string | null
  /**
   * True when I may hand the current step to its deputy: I am its MAIN approver, request and step
   * are open, a deputy exists, and it is not delegated yet.
   *
   * NOT `waitingOnMe`. That one is true for the DEPUTY too — it asks who may SIGN — and a deputy
   * must never be offered a button to delegate the step to themselves.
   */
  canDelegate: boolean
  /** True when I may take the current step back from the deputy — mine, and still delegated. */
  canReclaim: boolean
  /** True when I have an unsigned draft decision waiting on this request's current step — badge it,
   *  and sort it to the top of "To handle". Optional: absent until the backend serves it. */
  hasMyDraft?: boolean
  /** The decision my draft chose (label), for the badge. */
  myDraftDecision?: string | null
  /** When I saved that draft. */
  myDraftSavedAt?: string | null
}

/** The hub's tab-badge counts (GET /api/requests/counts). */
export interface RequestCounts {
  waitingOnMe: number
  /** Requests I parked on hold that are still mine to finish. */
  onHoldWithMe: number
  /** Requests where someone put a hold on MY OWN request waiting for me to answer — the employee's actionable number. */
  needsMyAnswer: number
  myOpenRequests: number
  myTotalRequests: number
}

export interface InboxItem {
  requestInstanceId: number
  requestTypeCode: string
  requestTypeName: string
  employeeId: number
  employeeName: string
  branchName: string
  title: string | null
  stepNo: number
  stepName: string
  approverType: string
  submittedAt: string
  daysWaiting: number
  /** True when I only reach this step as its DEPUTY, not the named approver — badge it "Covering". */
  asDeputy: boolean
  fallbackRoleName: string | null
}

/** One note on a request — the conversation, oldest first (GET /api/requests/{id}/notes). */
export interface RequestNote {
  noteId: number
  requestInstanceId: number
  stepNo: number | null
  stepName: string | null
  authorUserId: number
  authorUsername: string | null
  authorFullName: string | null
  /** True when the author is the request's employee — align/tint their notes as the other side of the conversation. */
  authorIsRequester: boolean
  noteText: string
  /** True when this note answered a hold — show the ↩ marker so question and answer read as a pair. */
  isHoldResponse: boolean
  createdAt: string
}

/** A draft left unsigned past the threshold (GET /api/workflow/stale-drafts). */
export interface StaleDraft {
  requestInstanceId: number
  requestTypeName: string
  employeeName: string
  branchName: string
  title: string | null
  stepNo: number
  stepName: string
  /** The chosen decision's LABEL, not its code. Null when the draft carries only a note. */
  draftDecision: string | null
  draftSavedAt: string | null
  savedBy: string | null
  /** Days the draft has sat unsigned. */
  daysUnsigned: number
  /** Days since the request was submitted — longer, and the number the requester actually feels. */
  daysWaiting: number
}

/** A request held longer than the threshold (GET /api/workflow/long-holds). */
export interface LongHold {
  requestInstanceId: number
  requestTypeName: string
  employeeName: string
  branchName: string
  title: string | null
  stepNo: number
  stepName: string
  holdReason: string | null
  holdSetAt: string | null
  waitingOnRequester: boolean
  heldBy: string | null
  daysOnHold: number
  /** Ready-to-show sentence distinguishing "waiting on the employee" from "waiting on the approver". */
  detail: string
}

export interface OldVersionRequest {
  requestInstanceId: number
  requestTypeCode: string
  requestTypeName: string
  employeeId: number
  employeeName: string
  branchName: string
  title: string | null
  submittedAt: string
  currentStepNo: number | null
  currentStepName: string | null
  currentVersion: number
  activeVersion: number
  activeWorkflowDefinitionId: number
  daysWaiting: number
}

/**
 * One attachment's METADATA (GET /api/requests/{id}/attachments) — never the bytes. `attachedTo`
 * is 'Request' for the requester's supporting document (stepNo null) or 'Decision' for proof an
 * approver relied on (stepNo set). The file itself loads from its own URL when asked.
 */
export interface Attachment {
  attachmentId: number
  requestInstanceId: number
  stepNo: number | null
  /** 'Request' (requester's document) or 'Decision' (proof for a step's decision). */
  attachedTo: string
  stepName: string | null
  uploadedByUserId: number
  uploadedByUsername: string | null
  fileName: string
  contentType: string
  byteSize: number
  caption: string | null
  uploadedAt: string
}

export interface ApproveResult {
  requestInstanceId: number
  status: string
  currentStepNo: number | null
}

export interface MoveVersionResult {
  requestInstanceId: number
  status: string
  currentStepNo: number | null
  movedFromVersion: number
  movedToVersion: number
  versionMovedAt: string | null
  versionMovedBy: number | null
}

/* ── Exit permissions ── */

/*
 * NOTE ON THE FIGURE: the table's `Minutes` was split into `RequestedMinutes` (what was asked for)
 * and `ApprovedMinutes` (what currently stands). They are equal until an approver grants less, so
 * anything showing the figure must show BOTH when they differ — "granted 120 of 180 requested".
 */
export interface ExitPermissionCreated {
  exitPermissionId: number
  requestInstanceId: number
  employeeId: number
  exitDate: string
  fromTime: string
  toTime: string
  requestedMinutes: number
  approvedMinutes: number
  convertToLeave: boolean
  status: string
  currentStepNo: number | null
  title: string | null
}

export interface MyExitPermission {
  exitPermissionId: number
  requestInstanceId: number
  exitDate: string
  fromTime: string
  toTime: string
  requestedMinutes: number
  approvedMinutes: number
  reason: string
  convertToLeave: boolean
  status: string
  currentStepNo: number | null
  currentStepName: string | null
  appliedToAttendanceAt: string | null
  submittedAt: string
  closedAt: string | null
  closedReason: string | null
}

export interface ExitPermissionDetail {
  exitPermissionId: number
  requestInstanceId: number
  employeeId: number
  fullName: string
  branchName: string
  exitDate: string
  fromTime: string
  toTime: string
  /** What was asked for. */
  requestedMinutes: number
  /** What currently stands — less than requested once an approver has cut it. */
  approvedMinutes: number
  /** requested − approved, and the flag saying it happened. */
  minutesReduced: number
  wasReduced: boolean
  /** The approved figure expressed as leave days at the configured standard day. */
  leaveDaysEquivalent: number
  reason: string
  convertToLeave: boolean
  appliedToAttendanceAt: string | null
  createdAt: string
  /** From the attendance record once the day exists — all null until then. */
  attendanceId: number | null
  exitActualMinutes: number | null
  exitApprovedMinutes: number | null
  exitVarianceMinutes: number | null
  exitLeaveMinutes: number | null
  exitVarianceDisposition: string | null
}

/**
 * What the period-close post produced. ZERO IS A NORMAL ANSWER, not a failure: it means every
 * convert-to-leave permission in that month had already been posted, which is what a second run
 * should say.
 */
export interface PostLeaveResult {
  leaveMovementsPosted: number
}

/**
 * What the TYPED exit-permission decide returns — the engine's approval result plus where the figure
 * ended up. `minutesReduced` and `wasReduced` come from the SERVER: the approver may have left the
 * minutes alone, and "approved as asked" and "cut to 30" are different outcomes to report.
 */
export interface ExitPermissionDecisionResult extends TypedDecisionResult {
  exitPermissionId: number
  requestedMinutes: number
  approvedMinutes: number | null
  minutesReduced: number
  wasReduced: boolean
}

export interface ExitPermissionCreateRequest {
  employeeId: number
  exitDate: string
  fromTime: string
  toTime: string
  reason: string
  convertToLeave: boolean
  /**
   * Optional title override. Left undefined/blank, the STORED PROCEDURE composes the standard title
   * — the format lives there, so the auto-title never disagrees with itself. Only send a value when
   * the user actually typed one.
   */
  title?: string | null
}

/* ── Leave requests ── */

/*
 * THE BALANCE RULE, which explains these shapes: days are DEDUCTED AT APPROVAL, never reserved at
 * submit. What prevents double-booking is the overlap refusal in usp_LeaveRequest_Create, not a
 * reservation. So a balance CAN go negative — but only when an approver knowingly grants it, which
 * is why balanceIsNegative is a warning carried back to the UI and never a refusal.
 */

export interface LeaveRequestCreated {
  requestInstanceId: number
  status: string
  currentStepNo: number | null
  workflowVersion: number
  /** Inclusive calendar days, counted by the procedure — never by the client. */
  daysRequested: number
  /**
   * Raised at shorter notice than the type prefers. ADVISORY: the request WAS accepted and is in
   * flight. Reported so the requester can be told, not so anything can be undone — nothing about the
   * chain changes because of it.
   */
  noticeShorterThanPreferred: boolean
  /** The notice this type prefers, in days — the figure the warning quotes. 0 when it has no preference. */
  noticePreferredDays: number
}

export interface LeaveRequestDecideResult {
  requestInstanceId: number
  status: string
  currentStepNo: number | null
  closedReason: string | null
  decision: string | null
  signedAsDeputy: boolean
  signedWithPassword: boolean
  /** What this approver granted — at most what was requested. */
  daysApproved: number
  /** The balance AFTER any ledger posting this decision caused. Unchanged until the request closes Approved. */
  balanceAfter: number
  /** Approved into the negative — show it, never block on it. The approver already decided. */
  balanceIsNegative: boolean
  /**
   * The leave was granted DISCRETIONARILY: approved, but no usage posted, so the balance is
   * untouched. Reports what the procedure DID, not what was asked — only the decision that closes
   * the request reaches the ledger, so an earlier approver who ticked the box still gets false here.
   */
  discretionaryGranted: boolean
}

export interface LeaveRequestPayload {
  leaveRequestId: number
  employeeId: number
  employeeName: string
  leaveTypeId: number
  leaveTypeName: string
  isPaid: boolean
  fromDate: string
  toDate: string
  daysRequested: number
  /** Null until an approver has decided. May be less than requested. */
  daysApproved: number | null
  reason: string | null
  /** When the usage was posted to the ledger. Null until the request closed Approved. */
  appliedToLedgerAt: string | null
  /** Who the leave was for, on a relation-capped type (bereavement). Null on every other type. */
  relationToEmployee: string | null
  /** This type cannot be approved without an attachment — usp_LeaveRequest_Decide refuses. */
  requiresCertificate: boolean
  /**
   * Attachments on the request — the COUNT THE APPROVAL GATE COUNTS, so the page can say a
   * certificate is still missing rather than letting an approver discover it as they sign.
   */
  attachmentCount: number
  /** The employee's CURRENT balance for this leave type — the all-time ledger sum. */
  currentBalance: number
  /**
   * Granted without deducting it. A property of THIS REQUEST, decided by the approver who closed
   * it — not of the leave type.
   *
   * It is why appliedToLedgerAt can stay null on an approved request without anything being wrong:
   * there was no ledger movement to stamp.
   */
  isDiscretionary: boolean
  /** Days between the request being raised and the leave starting. */
  noticeGivenDays: number
  /** The notice this type prefers, in days. 0 when it has no preference. */
  noticePreferredDays: number
  /**
   * Raised at shorter notice than the type prefers. ADVISORY — the same figure the requester was
   * warned with at submit, carried here so the APPROVER sees it too. Nothing is blocked by it and
   * usp_LeaveRequest_Decide does not consult it; it is context for a signature, not a gate.
   *
   * False when the type has no preference, so a type that never set one cannot look breached.
   */
  noticeShorterThanPreferred: boolean
}

export interface MyLeaveRequest {
  leaveRequestId: number
  requestInstanceId: number
  status: string
  leaveTypeName: string
  fromDate: string
  toDate: string
  daysRequested: number
  daysApproved: number | null
  reason: string | null
  submittedAt: string
}

/** An employee's balance for one leave type (GET /api/employees/{id}/leave-balance?leaveTypeId=). */
export interface LeaveBalanceSummary {
  leaveTypeName: string
  isPaid: boolean
  /**
   * THE YEARLY FIGURE for THIS employee today — the highest accrual tier their service qualifies
   * for (hr.fn_GetAnnualEntitlement). It replaced a per-month rate, which could not express
   * "15 days, then 21 after five years". Zero means the type does not accrue: a real answer.
   *
   * Use this wherever a yearly entitlement is shown. It is NOT the balance — that is currentBalance.
   */
  annualEntitlementDays: number
  currentBalance: number
  totalUsed: number
}

/**
 * Raise a leave request. The day count is deliberately ABSENT: the procedure counts inclusive
 * calendar days itself, so the client cannot disagree with the stored figure.
 */
/**
 * GET /api/leave-requests/working-days — what a range would COST before it is requested (D2): the employee's rostered
 * working days in it, with the rest days and public holidays that cost nothing counted beside them.
 */
export interface LeaveWorkingDays {
  calendarDays: number
  /** What the request will use: working days, 0.5 for a half day, calendar days for a fixed-entitlement type. */
  workingDays: number
  restDays: number
  holidays: number
  /** True for a type with a fixed entitlement (maternity): a span of the calendar, every day counts. */
  countsCalendarDays: boolean
  balance: number
}

export interface LeaveRequestCreateRequest {
  employeeId: number
  leaveTypeId: number
  /** D3: 'AM' | 'PM' makes a ONE-day request half a day (0.5 of the balance). Omitted = whole days. */
  halfDay?: 'AM' | 'PM' | null
  /** yyyy-MM-dd. */
  fromDate: string
  /** yyyy-MM-dd. */
  toDate: string
  reason?: string | null
  /** Left undefined/blank, the STORED PROCEDURE composes the standard title. */
  title?: string | null
  /**
   * Who the leave is for, on a relation-capped type (bereavement). Required by the procedure for any
   * type with relation entitlements, and it CAPS THE DAYS — a parent allows more than an aunt.
   * Omitted on every other type, where the procedure ignores it.
   */
  relationToEmployee?: string | null
}

/* ── Tip distribution ── */

/*
 * THE SPLIT IS THE PROCEDURE'S. per-person = round(total / n, 2), and the LAST participant absorbs
 * whatever rounding left over, so the lines always sum to exactly the total. The form previews the
 * same arithmetic; these figures come back so it can be shown the preview was right.
 */

/**
 * One currency's share of the pooled tips. Serialized to the procedure's @AmountsJson, whose
 * OPENJSON reads $.currencyCode / $.amount — the camelCase here is load-bearing, not cosmetic.
 */
export interface TipAmount {
  currencyCode: string
  amount: number
}

/**
 * What raising a tip distribution produced.
 *
 * NO PER-PERSON FIGURES: the split is per CURRENCY now, so one pair of numbers could not describe
 * it. The form computes and shows the preview; the procedure stores the lines.
 */
export interface TipDistributionCreated {
  requestInstanceId: number
  status: string
  currentStepNo: number | null
  /**
   * ADVISORY, a comma-separated name list: participants with no attendance record that day. It does
   * NOT mean they did not work — the day may simply be unprocessed — so it is something for the
   * approver to confirm, never a refusal.
   */
  noAttendanceWarning: string | null
}

export interface TipDistributionHeader {
  tipDistributionId: number
  branchId: number
  branchName: string
  shiftDate: string
  /** Set when the request closed Approved — payroll consumes the finalized lines. */
  finalizedAt: string | null
}

export interface TipDistributionLine {
  employeeId: number
  fullName: string
  currencyCode: string
  amount: number
}

export interface TipDistributionPayload {
  header: TipDistributionHeader | null
  /** The pool, one row per currency. */
  amounts: TipAmount[]
  lines: TipDistributionLine[]
}

/** One line of a restated split. Matches the procedure's OPENJSON keys exactly — do not rename. */
export interface TipLineInput {
  employeeId: number
  currencyCode: string
  amount: number
}

/**
 * A decision on a tip distribution, optionally RESTATING the whole split.
 *
 * `linesJson` is a FULL REPLACEMENT SET, never a patch: anybody left out is dropped from the
 * distribution rather than kept as they were. Null means "approve as calculated".
 *
 * The name says Json because that is the stored procedure's parameter; it travels as an array and is
 * serialized server-side, so no caller ever hand-builds JSON.
 */
export interface TipDecideRequest {
  linesJson?: TipLineInput[] | null
  comment?: string | null
  password?: string | null
}

/** A tip decision's result — the engine's, plus whether the split was rewritten. */
export interface TipDecisionResult extends TypedDecisionResult {
  /** The lines changed, so any payload already on screen is stale and must be refetched. */
  linesRestated: boolean
}


/* ── Shift swap ── */

export interface ShiftSwapCreated {
  requestInstanceId: number
  status: string
  currentStepNo: number | null
  /** Hours from now to the EARLIER of the two shifts — the one that constrains the roster. */
  hoursUntilFirstShift: number
  /** Under 48 hours. Advisory — the swap was accepted; the roster is simply being changed late. */
  noticeShorterThanRecommended: boolean
}

export interface ShiftSwapPayload {
  shiftSwapId: number
  requesterEmployeeId: number
  requesterName: string
  /** The day the REQUESTER gives up. */
  requesterDate: string
  counterpartEmployeeId: number
  counterpartName: string
  /** The day the COUNTERPART gives up. */
  counterpartDate: string
  /**
   * WHO SAID THE COUNTERPART AGREED — whoever ticked the box, not the counterpart's own
   * confirmation. The system never saw them consent; it saw someone assert it, and the record says so.
   */
  consentAssertedBy: string
  /** Set once the roster was actually rewritten, at final approval. Null until then. */
  appliedAt: string | null
}

export interface ShiftSwapCreateRequest {
  employeeId: number
  counterpartEmployeeId: number
  /** yyyy-MM-dd. */
  requesterDate: string
  /** yyyy-MM-dd. */
  counterpartDate: string
  counterpartHasAgreed: boolean
  title?: string | null
}

/** A decision on a typed request with no adjustable figure — a comment, and a password where policy demands one. */
export interface TypedDecideRequest {
  comment?: string | null
  password?: string
}

/** What the typed decide endpoints return — the engine's approval result, unchanged. */
export interface TypedDecisionResult {
  requestInstanceId: number
  status: string
  currentStepNo: number | null
  closedReason: string | null
  decision: string | null
  signedAsDeputy: boolean
  signedWithPassword: boolean
}


/* ── Overtime ── */

/*
 * THE THREE FIGURES ONLY EXIST ONCE THE DAY IS PROCESSED. Before that, worked/detected/payable are
 * null and attendanceProcessed is false — the request is approved for hours nobody has yet observed
 * being worked. Panels must say "awaiting the worked day", never render zeros, which would read as
 * "worked nothing".
 */

export interface OvertimeCreated {
  requestInstanceId: number
  status: string
  currentStepNo: number | null
  /** The shift rostered that day, or null when there was none. */
  shiftName: string | null
  startTime: string | null
  endTime: string | null
  /** A rest day, or no roster entry at all — the whole worked time counts as overtime. Not a refusal. */
  isRestDayOrUnrostered: boolean
}

export interface OvertimePayload {
  overtimeRequestId: number
  employeeId: number
  employeeName: string
  workDate: string
  requestedMinutes: number
  /** Null until an approver has decided. May be less than requested. */
  approvedMinutes: number | null
  /** The pay multiplier — 1.50 for the standard overtime rate. */
  rateMultiplier: number
  reason: string | null
  /** When the sweep linked this to the attendance day. Null until then. */
  appliedToAttendanceAt: string | null
  shiftName: string | null
  startTime: string | null
  endTime: string | null
  /* all null until attendanceProcessed */
  workedMinutes: number | null
  standardMinutes: number | null
  /** What attendance says was extra, independent of what was approved. */
  detectedOvertimeMinutes: number | null
  /** The LESSER of detected and approved: neither approving nor working alone earns it. */
  payableOvertimeMinutes: number | null
  /** False until the worked day exists. Everything above it is null while this is false. */
  attendanceProcessed: boolean
}

export interface MyOvertime {
  overtimeRequestId: number
  requestInstanceId: number
  status: string
  workDate: string
  requestedMinutes: number
  approvedMinutes: number | null
  rateMultiplier: number
  reason: string | null
  submittedAt: string
}

/** How many approved overtime requests a sweep linked to their attendance day. */
export interface OvertimeApplyResult {
  stamped: number
}

export interface OvertimeCreateRequest {
  employeeId: number
  /** yyyy-MM-dd. The procedure refuses a past date, verbatim. */
  workDate: string
  requestedMinutes: number
  reason?: string | null
  title?: string | null
}

/**
 * Approve overtime. THE FIGURE IS STATED ON EVERY APPROVAL — there is no "as it stands" default any
 * more, because the minutes signed for are the cap payroll pays to and nobody should sign one they
 * did not look at.
 *
 * Still typed as optional so an omitted field reaches the procedure as null and earns its precise
 * "State the approved minutes" refusal; the popup requires it before it will submit.
 */
export interface OvertimeDecideRequest {
  approvedMinutes?: number | null
  comment?: string | null
  password?: string
}

/**
 * What an overtime decision returned: the engine's result, the cap that now stands, and how it got
 * there.
 *
 * THE FIGURE ONLY EVER TIGHTENS. A later approver may cut the cap but never raise it — the procedure
 * refuses that, naming the standing figure — so `approvedMinutes` is the binding cap from this
 * decision onwards, and `requestedMinutes` is what was originally asked for, kept so a reduced
 * approval reads as a reduction rather than as the whole story.
 */
export interface OvertimeDecisionResult extends TypedDecisionResult {
  /** The cap now standing, in minutes. */
  approvedMinutes: number
  /** What was originally asked for. */
  requestedMinutes: number
  /** This decision cut the figure below what stood before it — the chain records the change. */
  figureTightened: boolean
  /** The request closed Approved here, so the cap is settled and already swept into attendance. */
  isFinal: boolean
}

/* ── Availability change ──
   A standing rewrite of somebody's DEFAULT WEEK from a date onwards, not a one-off absence. At final
   approval it MERGEs into attendance.EMPLOYEE_SHIFT_PATTERN. */

/**
 * One day of the change. The keys match the procedures' OPENJSON exactly ($.dayOfWeek /
 * $.isAvailable / $.shiftId) — do not rename them.
 *
 * `shiftId` means something only when available; the procedure discards it otherwise, so an
 * unavailable day never keeps a shift behind the scenes.
 */
export interface AvailabilityDay {
  /** ISO: 1 = Monday .. 7 = Sunday. */
  dayOfWeek: number
  isAvailable: boolean
  shiftId?: number | null
}

/**
 * Raise a standing availability change.
 *
 * ONLY THE CHANGED DAYS TRAVEL. The procedure touches only the days it is sent, so a day absent from
 * this list is one nobody asked to change and is left exactly as it was — including a day somebody
 * else changed meanwhile. Sending all seven would silently reassert the whole week.
 */
export interface AvailabilityCreateRequest {
  employeeId: number
  /** yyyy-MM-dd. Today or later; the procedure refuses a past date verbatim. */
  effectiveFrom: string
  days: AvailabilityDay[]
  reason?: string | null
  title?: string | null
}

export interface AvailabilityCreated {
  requestInstanceId: number
  status: string
  currentStepNo: number | null
  /**
   * ADVISORY. Roster days already published past the effective date that put this person on a day
   * they are asking to drop. Approving does NOT rewrite them — the pattern is a template, and dated
   * rows somebody already published are theirs to change — so this is a to-do list, not a refusal.
   */
  futureConflicts: number
}

/** A decision, optionally RESTATING the days. `days` is a full replacement set; null approves as asked. */
export interface AvailabilityDecideRequest {
  days?: AvailabilityDay[] | null
  comment?: string | null
  password?: string | null
}

export interface AvailabilityDecisionResult extends TypedDecisionResult {
  /** Recomputed against whatever the days now say. See AvailabilityCreated.futureConflicts. */
  futureConflicts: number
}

export interface AvailabilityHeader {
  availabilityChangeId: number
  employeeId: number
  employeeName: string
  effectiveFrom: string
  reason: string | null
  /** When the weekly pattern was actually rewritten. Null until the request closes Approved. */
  appliedAt: string | null
}

export interface AvailabilityPayloadDay extends AvailabilityDay {
  dayName: string
  shiftName: string | null
}

export interface AvailabilityPayload {
  header: AvailabilityHeader | null
  days: AvailabilityPayloadDay[]
}

/**
 * A rostered day that contradicts the change. These KEEP THEIR SHIFTS — the manual fix list.
 */
export interface AvailabilityConflict {
  shiftAssignmentId: number
  workDate: string
  dayName: string
  shiftName: string | null
  employeeName: string
}

/* ── New hire onboarding ──
   The hire decision and the paperwork that must follow it. THERE IS NO EMPLOYEE: the candidate is
   nobody in the system at submit time, and the hr.EMPLOYEE record is created by the first approval. */

export interface OnboardingCreateRequest {
  candidateName: string
  branchId: number
  departmentId: number
  positionId: number
  /** yyyy-MM-dd. Becomes HireDate on the employee record the approval creates. */
  startDate: string
  /* Optional at submit on purpose — a candidate rarely has an NSSF number before they are hired.
     The checklist on the request page is where these get chased and ticked off. */
  nationalId?: string | null
  nssfNumber?: string | null
  taxNumber?: string | null
  bankAccount?: string | null
  notes?: string | null
  title?: string | null
}

export interface OnboardingCreated {
  requestInstanceId: number
  status: string
  currentStepNo: number | null
  onboardingId: number
  /**
   * The checklist COPIED FROM THE TEMPLATE as it stood at submit — a snapshot, not a link. Editing
   * the template later does not reach back into requests already in flight.
   */
  taskCount: number
}

/**
 * One checklist item.
 *
 * NOTE ON `sortOrder`: the payload endpoint returns it, the set-task endpoint does NOT — that
 * procedure orders its rows by it but does not select it, so on a set-task response it is 0 on every
 * row. Both lists arrive ALREADY IN ORDER, so render them in array order and never sort by this
 * field, or the checklist would scramble the moment somebody ticks something.
 */
export interface OnboardingTask {
  code: string
  name: string
  /** The last approval is REFUSED while any required item is undone. */
  isRequired: boolean
  sortOrder: number
  /** Null while undone. Ticking stamps it; unticking clears it back to null. */
  completedAt: string | null
  completedBy: string | null
  note: string | null
}

export interface OnboardingHeader {
  onboardingId: number
  candidateName: string
  startDate: string
  branchId: number
  branchName: string
  departmentId: number
  departmentName: string
  positionId: number
  positionTitle: string
  nationalId: string | null
  nssfNumber: string | null
  taxNumber: string | null
  bankAccount: string | null
  notes: string | null
  /** The employee this hire created. Null until the hire decision is approved. */
  createdEmployeeId: number | null
  employeeCreatedAt: string | null
  taskCount: number
  tasksDone: number
  /** While above zero the LAST approval is refused, with a message naming every one of them. */
  outstandingRequired: number
}

export interface OnboardingPayload {
  header: OnboardingHeader | null
  tasks: OnboardingTask[]
}

/** Tick or untick one item. Refused once the request is closed. */
export interface OnboardingSetTaskRequest {
  isComplete: boolean
  note?: string | null
}

/**
 * What an onboarding decision returned.
 *
 * Two things happen here that happen nowhere else: the first approval CREATES THE EMPLOYEE RECORD
 * (`createdEmployeeId` is how a caller learns the person now exists), and the last approval is
 * refused outright while any required item is undone.
 */
export interface OnboardingDecisionResult extends TypedDecisionResult {
  createdEmployeeId: number | null
  outstandingRequired: number
}

/* ── Separation ──
   Resignation, termination, end of contract, retirement. The Ops manager prepares the settlement and
   the Owner's final sign-off is REFUSED while it is unprepared. */

/**
 * What the form shows BEFORE anyone commits to a figure.
 *
 * EVERY NUMBER HERE IS PROVISIONAL. The notice tiers carry "VERIFY WITH COUNSEL" in their own note,
 * and `provisionalIndemnity` is arithmetic — months × basic × years — not a legal opinion. Present
 * them as a starting point somebody checks, never as the settlement.
 */
export interface SeparationContextHeader {
  employeeId: number
  fullName: string
  hireDate: string
  lastWorkingDate: string
  /** Years to the last working day, two decimals. */
  serviceYears: number
  requiredNoticeDays: number
  noticeGivenDays: number
  /** Required minus given, floored at zero. Above zero is the warning the form leads with. */
  noticeShortfallDays: number
  /**
   * The basic pay in force on the last working day, IF one is on file. NULL is a REAL ANSWER and the
   * form must say so — without it there is no provisional indemnity, and showing a zero would read
   * as "nothing is owed".
   */
  monthlyBasic: number | null
  basicCurrency: string | null
  indemnityMonthsPerYear: number
  /** basic × months-per-year × years. Null when no basic is on file. */
  provisionalIndemnity: number | null
  /** The tier's own caveat, shown verbatim — every one says to verify with counsel. */
  noticeTierNote: string | null
}

/** One leave type with a non-zero balance. Types never accrued are absent, not zero rows. */
export interface SeparationLeaveBalance {
  leaveTypeId: number
  leaveTypeName: string
  isPaid: boolean
  balanceDays: number
}

/**
 * NON-NULLABLE header, deliberately: the endpoint answers 404 when the employee does not exist
 * rather than 200 with an empty header, so any response the client actually receives has one. Typing
 * it nullable would force a guard at every use for a state that cannot arrive.
 */
export interface SeparationContext {
  header: SeparationContextHeader
  leaveBalances: SeparationLeaveBalance[]
}

export interface SeparationCreateRequest {
  employeeId: number
  /** Resignation / Termination / EndOfContract / Retirement. Anything else is refused by name. */
  separationType: string
  /** yyyy-MM-dd. */
  noticeGivenDate: string
  /** yyyy-MM-dd. Becomes TerminationDate at final approval. */
  lastWorkingDate: string
  reason?: string | null
  title?: string | null
}

/** The service and notice arithmetic, FROZEN on the request at submit so a re-tiering cannot move it. */
export interface SeparationCreated {
  requestInstanceId: number
  status: string
  currentStepNo: number | null
  serviceYears: number
  requiredNoticeDays: number
  noticeGivenDays: number
  /** Above zero: notice was short. Advisory — it does not refuse the request. */
  noticeShortfallDays: number
}

/**
 * The preparer's figures. NONE may be negative — money withheld goes in `deductions`, which is
 * subtracted, and the procedure says exactly that when it refuses.
 */
export interface SeparationSettlementRequest {
  currencyCode: string
  unusedLeaveDays: number
  unusedLeaveAmount: number
  indemnityAmount: number
  noticePayAmount: number
  otherDues: number
  deductions: number
  settlementNote?: string | null
}

/** The settlement as stored, with the total the PROCEDURE computes — the client never has to agree. */
export interface SeparationSettlement {
  currencyCode: string | null
  unusedLeaveDays: number | null
  unusedLeaveAmount: number | null
  indemnityAmount: number | null
  noticePayAmount: number | null
  otherDues: number | null
  deductions: number | null
  /** leave + indemnity + notice pay + other − deductions. */
  settlementTotal: number
  preparedAt: string | null
}

/**
 * What a separation decision returned.
 *
 * AT FINAL APPROVAL TWO IRREVERSIBLE THINGS HAPPEN, neither undoable from the app: the employee's
 * TerminationDate is set, and every remaining leave balance is paid out and zeroed from the ledger.
 * `appliedAt` is how a caller learns it has happened — and the dialog that leads to it must say so
 * before it is signed.
 */
export interface SeparationDecisionResult extends TypedDecisionResult {
  settlementTotal: number
  appliedAt: string | null
}

export interface SeparationPayload {
  separationId: number
  employeeId: number
  employeeName: string
  positionTitle: string
  branchName: string
  hireDate: string
  separationType: string
  noticeGivenDate: string
  lastWorkingDate: string
  serviceYears: number
  requiredNoticeDays: number
  noticeGivenDays: number
  noticeShortfallDays: number
  reason: string | null
  /* The settlement. All null until somebody prepares it. */
  currencyCode: string | null
  unusedLeaveDays: number | null
  unusedLeaveAmount: number | null
  indemnityAmount: number | null
  noticePayAmount: number | null
  otherDues: number | null
  deductions: number | null
  settlementTotal: number
  settlementNote: string | null
  preparedAt: string | null
  preparedBy: string | null
  /** When the termination was written to the employee record. */
  appliedAt: string | null
  /** When the leave balance was paid out and zeroed. */
  leaveClearedAt: string | null
  /** False blocks the FINAL sign-off — the procedure refuses with its own sentence. */
  settlementPrepared: boolean
}

/* ── Supporting ── */

export interface MyEmployee {
  employeeId: number
  userId: number | null
  fullName: string
  branchId: number
  branchName: string
  departmentId: number
  departmentName: string
  positionId: number
  positionName: string
  hireDate: string
  terminationDate: string | null
  /** Whether this person manages their own branch — used to explain why step 1 skips on their own requests. */
  isBranchManager: boolean
}

export interface BranchWithManager {
  branchId: number
  name: string
  isActive: boolean
  managerEmployeeId: number | null
  managerName: string | null
  managerUserId: number | null
  /** A manager is assigned but has no login, so they cannot approve anything yet. */
  managerHasNoLogin: boolean
}

export interface BranchManagerSet {
  branchId: number
  name: string
  managerEmployeeId: number | null
  managerName: string | null
  managerUserId: number | null
  managerHasNoLogin: boolean
  warning: string | null
}

/**
 * Raise a tip distribution. No employeeId: the procedure takes the requester from the token and
 * refuses a login with no employee record. Participants are validated against the branch there too.
 */
export interface TipDistributionCreateRequest {
  branchId: number
  /** yyyy-MM-dd. */
  shiftDate: string
  /** One entry per currency. The procedure refuses an empty list, a non-positive or duplicate one. */
  amounts: TipAmount[]
  participantIds: number[]
  title?: string | null
}

/* ── Expense reimbursement ──
   THE EXPENSE TYPES LIVE IN services/workflowService.ts, beside the calls that return them.
   Copies used to sit here as well, imported by nothing, and they had already drifted: they still
   described a signer cap and a create-time Owner skip that the procedures no longer have. Two
   definitions of one API shape means "regenerate the client" updates whichever one you happen to
   open, so the second is deleted rather than kept in step. */

   /* ── Availability change ── */

export interface AvailabilityDay {
  /** ISO: 1 = Monday … 7 = Sunday. */
  dayOfWeek: number
  isAvailable: boolean
  shiftId?: number | null
}

export interface AvailabilityCreateRequest {
  employeeId: number
  /** yyyy-MM-dd; today or later. */
  effectiveFrom: string
  /** Only the days that CHANGE — unmentioned days keep their current state. */
  days: AvailabilityDay[]
  reason?: string | null
  title?: string | null
}

export interface AvailabilityCreated {
  requestInstanceId: number
  status: string
  currentStepNo: number | null
  /** Roster days already published that contradict the request. */
  futureConflicts: number
}

export interface AvailabilityPayloadDay extends AvailabilityDay {
  dayName: string
  shiftName: string | null
}

export interface AvailabilityPayload {
  header: {
    availabilityChangeId: number
    employeeId: number
    employeeName: string
    effectiveFrom: string
    reason: string | null
    appliedAt: string | null
  } | null
  days: AvailabilityPayloadDay[]
}

export interface EmployeePatternDay {
  dayOfWeek: number
  isAvailable: boolean
  shiftId: number | null
  shiftName: string | null
  startTime: string | null
  endTime: string | null
  noPatternRow: boolean
}

/* ── Salary advance ── */

/**
 * Money lent against future pay, asked for as a REQUEST.
 *
 * Unlike a payroll adjustment (HR's instrument, always about somebody else), this is normally
 * raised BY the person who needs it — the shell's employee picker is the subject, and HR may raise
 * on behalf.
 */
export interface SalaryAdvanceCreateRequest {
  employeeId: number
  amount: number
  currencyCode: string
  /** Above zero and no more than the advance — the form checks shape, the server owns the rule. */
  monthlyDeduction: number
  /** Format 2026-09. Must be a month whose primary payroll is not yet locked. */
  firstDeductionPeriod: string
  reason?: string | null
  title?: string | null
}

export interface SalaryAdvanceCreated {
  requestInstanceId: number
  status: string
  currentStepNo: number | null
  /** ceil(amount / monthly) — from the server, so the preview and the record agree. */
  months: number
}

/**
 * The ask, and then the LIVE recovery state.
 *
 * `remainingAmount` and `isSettled` are joined from the ledger row, not stored on the request — so
 * a request approved months ago shows what is still owed TODAY rather than what was borrowed then.
 * Both are null until the final approval creates that row.
 */
export interface SalaryAdvancePayload {
  salaryAdvanceRequestId: number
  employeeId: number
  employeeName: string
  /** What was ASKED FOR. Never changes — the ask is part of the record. */
  amount: number
  /**
   * What the last approver signed for, or null while nobody has.
   *
   * THE STANDING FIGURE IS `approvedAmount ?? amount`, and that — not the original ask — is what
   * the next approver is deciding about. Prefill from the standing figure, never from `amount`,
   * or a second approver is shown a number that has already been superseded.
   */
  approvedAmount: number | null
  currencyCode: string
  /** What was asked to come off each month. */
  monthlyDeduction: number
  /**
   * The signed monthly, or null while nobody has signed. Standing monthly is
   * `approvedMonthlyDeduction ?? monthlyDeduction`, and the server keeps it inside the approved
   * amount — tightening the loan clamps the schedule with it.
   */
  approvedMonthlyDeduction: number | null
  firstDeductionPeriod: string
  /** Computed by the server FROM THE STANDING FIGURES, so it already reflects any tightening. */
  months: number
  reason: string | null
  createdAdvanceId: number | null
  advanceCreatedAt: string | null
  remainingAmount: number | null
  isSettled: boolean | null
}

/* ── Payroll adjustment ── */

/**
 * A correction raised as a REQUEST — HR states the claim, the Owner signs it.
 *
 * There is no direct path any more: payroll.usp_Adjustment_Create refuses and points here, so this
 * is the only way money reaches a payslip outside the normal salary run.
 */
export interface PayrollAdjustmentCreateRequest {
  employeeId: number
  componentTypeId: number
  /** Above zero. The component's SIGN decides direction, not this figure. */
  amount: number
  currencyCode: string
  /** Format 2026-09. A period whose run is already locked is refused. */
  targetPeriod: string
  /** Optional, and must name an APPROVED run — a correction references history. */
  correctsRunId?: number | null
  /** Required — the server refuses an unexplained adjustment, and says why. */
  reason: string
  title?: string | null
}

/**
 * The payload — the claim, and how far it has travelled.
 *
 * The last three fields are the LIFECYCLE and only move forwards:
 * waiting → `createdAdjustmentId` set by the FINAL approval → `appliedToPayslipId` set when the
 * target period's run is locked. Each null is a state, not missing data — read them in that order.
 */
export interface PayrollAdjustmentPayload {
  payrollAdjustmentRequestId: number
  employeeId: number
  employeeName: string
  componentTypeId: number
  componentName: string
  /** Earning / Deduction / EmployerCost. */
  category: string
  /** +1 or -1. Render the amount with this sign; the stored amount is always positive. */
  sign: number
  /** What was CLAIMED. Never changes — the claim as raised is part of the record. */
  amount: number
  /**
   * What the last approver signed for, or null while nobody has.
   *
   * THE STANDING FIGURE IS `approvedAmount ?? amount`. Each signature may tighten it and never
   * raise it, so once a chain is underway `amount` is history and this is the live number.
   */
  approvedAmount: number | null
  currencyCode: string
  /** The open period whose payslip will carry the line. */
  targetPeriod: string
  correctsRunId: number | null
  correctsPeriod: string | null
  reason: string
  /** The ledger row this request created. Null until the final approval writes it. */
  createdAdjustmentId: number | null
  adjustmentCreatedAt: string | null
  /** The payslip that consumed it. Null until the target period is locked. */
  appliedToPayslipId: number | null
}

/**
 * ROSTER APPROVAL — one branch's WHOLE MONTH of roster, signed off as a single request.
 *
 * The subject is a BRANCH AND A MONTH, not a person: there is no employeeId anywhere in the
 * payload, and the raiser comes off the token like every other branch-scoped type. Which is also
 * why the form hides the shell's Employee field (`hidesEmployee`).
 *
 * ONE REQUEST PER BRANCH-MONTH is the server's rule, not the form's — a month already approved, or
 * already sitting pending on somebody's desk, is refused with a sentence saying which. Those
 * refusals are the whole value of the 400 and are shown verbatim.
 */
export interface RosterApprovalCreateRequest {
  branchId: number
  /**
   * The month, as its FIRST DAY: 'yyyy-MM-01'.
   *
   * A whole date rather than a 'yyyy-MM' period string because that is what the endpoint stores —
   * the day is always 01 and the form never lets it be anything else.
   */
  monthDate: string
  title?: string | null
}

/** What raising one produced. Same three fields every typed create returns. */
export interface RosterApprovalCreated {
  requestInstanceId: number
  status: string
  currentStepNo: number | null
}