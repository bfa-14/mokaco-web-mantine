/**
 * WHO MAY TAKE A DECISION BACK, AS THE PAGE OFFERS IT — the request page's reversal doors, mirrored
 * from the procedures (docs/101_qa3_workflow.sql in the API) so a button is offered exactly where the
 * server would honour it. The server stays the lock: every refusal still arrives as its own sentence.
 *
 *   - "Retract my decision" on a CLOSED request (approved or rejected): the last signer, the same
 *     BEIRUT calendar day — POST /api/workflow/requests/{id}/retract (QA3 WF-3, WF-5, WF-13).
 *   - The same button on an OPEN request is "change my decision": the step's own withdrawal, offered
 *     where the server says the caller may still withdraw (step.canWithdraw).
 *   - Reopen by the General Manager + the Owner: approved or rejected requests with a decision that
 *     still stands, two different people (QA3 WF-14).
 *   - HR's single-signature reopen: cancelled requests only (QA3 WF-14).
 *   - Cancel: the requester, the employee concerned, or HR / Admin — what the API allows.
 *
 * No imports but types, and nothing that reads the browser: `npm test` runs this with Node alone.
 */
import type { RequestReversal, RequestStep, SignatureLogEntry } from '../../types/workflow'

/** The company's day. "Same day" for a retract is the Beirut calendar day, in SQL and here. */
export const BUSINESS_TIME_ZONE = 'Asia/Beirut'

const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The Beirut calendar date of an instant, as YYYY-MM-DD. */
export function beirutDay(at: Date): string {
  return DAY_FORMAT.format(at)
}

/**
 * An API timestamp as an instant. They arrive WITHOUT a zone and are UTC — hence the 'Z' — but one
 * that already carries a zone is taken as it is.
 */
export function parseUtc(value: string | null | undefined): Date | null {
  if (!value) return null
  const hasZone = /(?:[zZ]|[+-]\d\d:?\d\d)$/.test(value)
  const at = new Date(hasZone ? value : `${value}Z`)
  return Number.isNaN(at.getTime()) ? null : at
}

/** Whether a UTC timestamp falls on today's BEIRUT date — the procedure's own comparison. */
export function isSameBeirutDay(value: string | null | undefined, now: Date = new Date()): boolean {
  const at = parseUtc(value)
  return at != null && beirutDay(at) === beirutDay(now)
}

/**
 * The decision a retract would actually take back — the newest signature that still STANDS.
 *
 * Mirrors the procedure's pick: not retracted, a real decision (a 'Submitted' row carries no step),
 * newest by ActedAt then SignatureId — the tie-break matters on the day two decisions share a second.
 */
export function lastStandingDecision(history: SignatureLogEntry[]): SignatureLogEntry | null {
  const standing = history.filter(
    (e) =>
      e.retractedAt == null &&
      e.stepNo != null &&
      (e.action === 'Approved' || e.action === 'Rejected'),
  )
  if (standing.length === 0) return null

  return standing.reduce((newest, entry) => {
    const a = Date.parse(entry.actedAt)
    const b = Date.parse(newest.actedAt)
    if (a !== b) return a > b ? entry : newest
    return entry.signatureId > newest.signatureId ? entry : newest
  })
}

const CLOSED_WITH_A_DECISION = new Set(['Approved', 'Rejected'])
const OPEN = new Set(['Pending', 'OnHold'])

/**
 * What "Retract my decision" does on this request for this user, or null when it is not theirs to do.
 *
 *   'retract'  — a closed request whose deciding signature is the caller's, from today in Beirut;
 *   'withdraw' — an open request whose last standing decision is the caller's and the server still
 *                lets them withdraw it (nobody after them has acted);
 *   null       — everything else: a cancelled request has no decision (HR reopens it), somebody
 *                else's decision is not yours, yesterday's needs the General Manager and the Owner.
 */
export function retractKind(args: {
  status: string
  lastDecision: SignatureLogEntry | null
  userId: number | null | undefined
  steps: Pick<RequestStep, 'stepNo' | 'canWithdraw'>[]
  now?: Date
}): 'retract' | 'withdraw' | null {
  const { status, lastDecision, userId, steps } = args
  if (lastDecision == null || lastDecision.stepNo == null) return null
  if (userId == null || lastDecision.actedByUserId !== userId) return null

  if (CLOSED_WITH_A_DECISION.has(status))
    return isSameBeirutDay(lastDecision.actedAt, args.now ?? new Date()) ? 'retract' : null

  if (OPEN.has(status))
    return steps.find((s) => s.stepNo === lastDecision.stepNo)?.canWithdraw === true ? 'withdraw' : null

  return null
}

/** The role a user signs a reopen in — the procedure's own pick: Owner first, else the General Manager. */
export function reopenRoleOf(roles: readonly string[]): 'Owner' | 'GeneralManager' | null {
  const has = (name: string) => roles.some((r) => r.toLowerCase() === name.toLowerCase())
  if (has('Owner')) return 'Owner'
  if (has('General Manager') || has('GeneralManager')) return 'GeneralManager'
  return null
}

/** The reopen that is half-signed and waiting on the other of GM/Owner, if there is one. */
export function pendingReopen(reversals: RequestReversal[] | undefined): RequestReversal | null {
  return reversals?.find((r) => r.kind === 'Reopen' && r.completedAt == null) ?? null
}

/**
 * The GM + Owner reopen as this user may take part in it:
 *   'sign'        — start it (the first signature);
 *   'countersign' — complete one the OTHER role started, as a different person;
 *   'waiting'     — this user (or their role) already signed: the other must countersign;
 *   null          — not theirs, or nothing to reopen. A request with no standing decision (approved
 *                   automatically) is refused by the server at the first half, so it is not offered.
 */
export function gmReopenAction(args: {
  status: string
  roles: readonly string[]
  userId: number | null | undefined
  history: SignatureLogEntry[]
  reversals: RequestReversal[] | undefined
}): 'sign' | 'countersign' | 'waiting' | null {
  const role = reopenRoleOf(args.roles)
  if (role == null || !CLOSED_WITH_A_DECISION.has(args.status)) return null

  const pending = pendingReopen(args.reversals)
  if (pending) {
    const sameRole =
      pending.firstSignRole.replace(/\s+/g, '').toLowerCase() === role.toLowerCase()
    return pending.firstSignUserId === args.userId || sameRole ? 'waiting' : 'countersign'
  }

  return lastStandingDecision(args.history) != null ? 'sign' : null
}

/** HR's single-signature reopen: a CANCELLED request only, for a holder of WORKFLOW_VERSION_MOVE. */
export function canHrReopen(status: string, mayMoveVersions: boolean): boolean {
  return status === 'Cancelled' && mayMoveVersions
}

/** The roles that may cancel SOMEBODY ELSE'S request — what the API allows (HR, Admin). */
export const CANCEL_ROLES: readonly string[] = ['HR', 'Admin']

export function holdsCancelRole(roles: readonly string[]): boolean {
  return roles.some((r) => CANCEL_ROLES.some((c) => c.toLowerCase() === r.toLowerCase()))
}

/** The sentence a lost race arrives with (409): the screen is stale and must be read again. */
export function isDecidedAMomentAgo(status: number | undefined, message: string | undefined): boolean {
  return status === 409 && (message ?? '').startsWith('This step was decided a moment ago')
}

/** A version move refused until it is confirmed, because it would approve the request at once (409). */
export function moveNeedsConfirmation(status: number | undefined, message: string | undefined): boolean {
  return status === 409 && /confirm the move/i.test(message ?? '')
}

/**
 * The workflow API's own sentence out of an error body ({ error: "…" }), when it sent one.
 *
 * A reversal refused as the wrong person (403) names the way that WOULD work — "reopening needs the GM
 * and the Owner together", "the other of the two must countersign" — so those dialogs show it rather
 * than the app's one-line "no permission".
 */
export function serverSentence(data: unknown): string | null {
  if (data != null && typeof data === 'object' && 'error' in data) {
    const error = (data as { error?: unknown }).error
    if (typeof error === 'string' && error.trim() !== '') return error
  }
  return null
}
