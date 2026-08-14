import { useEffect, useRef, useState } from 'react'
import { Button } from '@mantine/core'
import { attachmentsService, requestsService } from '../../services/workflowService'
import type { Attachment, RequestHeader, RequestStep } from '../../types/workflow'
import {
  approverText,
  dateTime,
  decisionLabel,
  fileSize,
  statusChipClass,
  statusLabel,
  stepState,
} from './workflowFormat'
import type { StepState } from './workflowFormat'
import { groupOfType } from './newRequestShared'
import { t } from '../../i18n/t'
import { arrowFlow, arrowReturn } from '../../i18n/physical'

/** A status word as a coloured chip. The same status looks the same on every page. */
export function StatusChip({ status }: { status: string }) {
  return <span className={statusChipClass(status)}>{statusLabel(status)}</span>
}

/**
 * The current step, as a chip.
 *
 * Shared by the hub's cards and its grid so a step reads identically in both. It renders the step
 * NUMBER as well as the name — "2. Owner" says how far along a request is, where "Owner" alone
 * does not. A request with no current step is finished; it gets a muted dash, because an empty
 * cell reads as missing data rather than as "nothing left to do".
 */
export function StepChip({
  stepNo,
  stepName,
}: {
  stepNo: number | null
  stepName: string | null
}) {
  if (stepNo == null) return <span className="wf-muted">—</span>
  return (
    <span className="wf-chip wf-chip-step">
      {stepNo}. {stepName ?? t('workflow.chain.step')}
    </span>
  )
}

/**
 * The colour dot for a request type's GROUP — Money, Schedule, People, Time.
 *
 * The grouping is {@link groupOfType}, the same map the new-request picker groups by, so a type
 * belongs to the same family wherever it is drawn.
 *
 * ON THE COLOURS, WHICH ARE NOT A FIVE-COLOUR CODE. The brand palette is one accent (desert) over
 * neutrals, and inventing four more hues to make a legible code would break the palette rule this
 * was asked to keep. So Money takes the accent, Schedule its darker shade, and the rest step down
 * through the neutrals. The effect is a family HINT, not something to decode — which is why the
 * type name is always beside it and never replaced by it.
 */
export function TypeDot({ code }: { code: string }) {
  const group = groupOfType(code).toLowerCase()
  const known = ['money', 'schedule', 'people', 'time'].includes(group) ? group : 'other'
  return <span className={`wf-type-dot wf-type-dot--${known}`} aria-hidden="true" />
}


/**
 * A chain drawn as a horizontal flow: ①Branch manager → ②HR → ③Owner. Used before submitting, on
 * the chains page, and in the builder preview — the same visual language in all three, so a chain
 * reads the same wherever it appears. Accepts any step-like shape.
 */
export function ChainFlow({
  steps,
  skipStepNo,
}: {
  steps: {
    stepNo: number
    name: string
    approverType: string
    approverRoleName?: string | null
    escalationLevels?: number | null
    resolvedApproverName?: string | null
  }[]
  /** A step number to show as "will be skipped" — e.g. the requester's own branch-manager step. */
  skipStepNo?: number | null
}) {
  if (steps.length === 0) {
    return <span className="hint">{t('workflow.chain.noSteps')}</span>
  }
  return (
    <div className="wf-flow">
      {steps.map((s, i) => (
        <span key={s.stepNo} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {i > 0 && <span className="wf-flow-arrow">{arrowFlow()}</span>}
          <span
            className={
              skipStepNo === s.stepNo ? 'wf-flow-node wf-flow-node--skip' : 'wf-flow-node'
            }
            title={approverText(s)}
          >
            <span className="wf-flow-num">{s.stepNo}</span>
            {s.name}
            {/* A LineManager step resolved to a real person (a per-employee preview) names them
                inline — that is the whole point of resolving the preview to the requester. */}
            {s.resolvedApproverName && (
              <span className="wf-flow-resolved">{s.resolvedApproverName}</span>
            )}
          </span>
        </span>
      ))}
    </div>
  )
}

/** The marker glyph for a step state. */
function markerGlyph(state: StepState, stepNo: number): string {
  if (state === 'done') return '✓'
  if (state === 'rejected') return '✕'
  if (state === 'advisory') return '✕'
  if (state === 'onhold') return '⏸'
  if (state === 'skipped') return '⊘'
  return String(stepNo)
}

/**
 * The FROZEN signature image for a signed step, addressed by its signedSignatureId. Rendered beside
 * the signer's name and timestamp by the caller — the image is a convention; the name and time are
 * the record — and only when the step's HasSignatureImage said there is one to fetch.
 *
 * LAZY BY NECESSITY: the bytes are bearer-gated, so a plain <img src> to the endpoint cannot send
 * the token — the URL is fetched WITH the token and swapped in as an object URL. Doing that eagerly
 * for every signed step would pull the whole chain's images up front, so the fetch is DEFERRED until
 * the row nears the viewport (IntersectionObserver), which is the real lazy-load the token model
 * allows; loading="lazy" on the resulting <img> is the belt to that braces. A short chain fetches
 * a couple of images; a long one fetches only what is scrolled to.
 */
function StepSignatureImage({ signatureId }: { signatureId: number }) {
  const [url, setUrl] = useState<string | null>(null)
  const [near, setNear] = useState(false)
  const holderRef = useRef<HTMLDivElement | null>(null)

  // Watch the reserved slot; once it is within 200px of the viewport, allow the fetch and stop watching.
  useEffect(() => {
    if (near) return
    const el = holderRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  // Printing overrides the scroll heuristic: a printed chain must carry EVERY signature, including
  // steps far below the fold that the viewport observer would never have triggered. beforeprint fires
  // before the print layout is composed, so flipping this on pulls any not-yet-fetched image in.
  useEffect(() => {
    if (near) return
    const loadForPrint = () => setNear(true)
    window.addEventListener('beforeprint', loadForPrint)
    return () => window.removeEventListener('beforeprint', loadForPrint)
  }, [near])

  useEffect(() => {
    if (!near) return
    let objectUrl: string | null = null
    let cancelled = false
    requestsService
      .frozenSignatureImageObjectUrl(signatureId)
      .then((u) => {
        if (cancelled) {
          if (u) URL.revokeObjectURL(u)
          return
        }
        objectUrl = u
        setUrl(u)
      })
      .catch(() => {
        /* no image — the name and timestamp still stand as the record */
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [near, signatureId])

  // The slot reserves the image's height so the row does not jump when the bytes arrive, and gives
  // the observer a stable target to watch even before anything is loaded.
  return (
    <div ref={holderRef} className="wf-sig-img-holder">
      {url && <img className="wf-sig-img" src={url} alt={t('requests.step.signatureAlt')} loading="lazy" />}
    </div>
  )
}

/**
 * The proof an approver relied on for THIS step's decision — folded away behind its count, opened only
 * when asked. It never fetches bytes for the summary: it shows "📎 N" from proofCount, and only on
 * expand fetches the metadata, then each file loads from its own bearer-gated URL when clicked.
 */
function StepProof({
  requestId,
  stepNo,
  count,
}: {
  requestId: number
  stepNo: number
  count: number
}) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<Attachment[] | null>(null)

  useEffect(() => {
    if (!open || files) return
    let cancelled = false
    attachmentsService
      .forRequest(requestId)
      .then((all) => {
        if (!cancelled) setFiles(all.filter((a) => a.stepNo === stepNo))
      })
      .catch(() => {
        if (!cancelled) setFiles([])
      })
    return () => {
      cancelled = true
    }
  }, [open, files, requestId, stepNo])

  return (
    <div className="wf-step-proof">
      <button type="button" className="wf-proof-toggle" onClick={() => setOpen((v) => !v)}>
        📎 {t('requests.step.documents', { count })} {open ? '▾' : '▸'}
      </button>
      {open && files && (
        <ul className="wf-doc-list wf-doc-list--proof">
          {files.map((f) => (
            <li key={f.attachmentId} className="wf-doc">
              <div className="wf-doc-body">
                <button
                  type="button"
                  className="wf-doc-name"
                  onClick={() => void attachmentsService.open(f.attachmentId)}
                >
                  {f.fileName}
                </button>
                <div className="wf-doc-meta">{fileSize(f.byteSize)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The vertical stepper on request detail — and the whole record of the request, not a summary of it.
 * Every step carries what happened AT it: its decision, the note written with that decision, who
 * signed, when, whether they signed with a password, and the proof they relied on. There is no
 * separate conversation anywhere on the page, because there is no conversation: one step, one note,
 * written with the decision it explains.
 *
 * Every field here comes from usp_Request_GetSteps read WITH @ForUserId. Without it CanWithdraw and
 * CanReclaim come back 0 for everyone and the actions below silently never appear — so the caller
 * must pass the caller-scoped chain, never the one inlined on getById.
 *
 * A SKIPPED step shows its reason in words where a signature would go, and says so even when the
 * reason is missing: a blank there reads as "unsigned but should have been".
 */
export function RequestStepper({
  requestId,
  header,
  steps,
  onDecide,
  decideLabel,
  onWithdraw,
  onReclaim,
}: {
  requestId: number
  header: RequestHeader
  steps: RequestStep[]
  /**
   * When given, a "Decide" button appears on the CURRENT step's row — beside the step it acts on,
   * never at the foot of the page. The caller passes this only when usp_Step_GetAvailableDecisions
   * came back non-empty; an empty list means "not yours to decide", and then there is no button and
   * no explanation — the chain is simply read-only, which is normal rather than an error.
   */
  onDecide?: (step: RequestStep) => void
  /** "Finish decision" when a draft of the caller's is waiting on that step. Defaults to "Decide". */
  decideLabel?: string
  /** When given, "Change decision" appears on each step where canWithdraw is true — a way back
   *  from a decision already made. Absent where canWithdraw is false: no disabled control to hunt at. */
  onWithdraw?: (step: RequestStep) => void
  /** "↩ Take this step back" on a step this caller DELEGATED and the delegate has not yet decided. */
  onReclaim?: (step: RequestStep) => void
}) {
  const requestOpen = header.status === 'Pending' || header.status === 'OnHold'
  // Defaulted here rather than in the signature: a default parameter is evaluated at CALL time,
  // which is right, but writing it here keeps the translated string out of the parameter list where
  // it reads as a constant.
  const decideText = decideLabel ?? t('requests.step.decide')
  return (
    <div className="wf-stepper">
      {steps.map((step) => {
        const state = stepState(step, header)
        const signed = step.status === 'Approved' || step.status === 'Rejected'
        // A deputy signature: the engine stores the comment prefixed "Signed as deputy." — surface
        // that as a small label, not buried inline, so the history never looks like the named
        // approver signed when a deputy did.
        const deputyPrefix = 'Signed as deputy.'
        const signedAsDeputy = (step.comment ?? '').startsWith(deputyPrefix)
        const shownComment = signedAsDeputy
          ? (step.comment ?? '').slice(deputyPrefix.length).trim()
          : step.comment
        // The actual delegation signal. ApproverType still describes the step's own rule.
        const delegated = step.delegatedToUserId != null
        // The step the request is waiting on right now — the only row that may offer a decision.
        const isCurrent = requestOpen && header.currentStepNo === step.stepNo
        // The recorded decision, but only where it says more than the status already has:
        // "Approved with changes" is worth a line; "Approved" on an Approved step is noise.
        const extraDecision =
          step.decision && step.decision !== step.status ? decisionLabel(step.decision) : null
        return (
          <div className="wf-step" key={step.stepNo}>
            <div className="wf-step-rail">
              <div className={`wf-step-marker wf-step-marker--${state}`}>
                {markerGlyph(state, step.stepNo)}
              </div>
              <div className="wf-step-line" />
            </div>
            <div className="wf-step-body">
              <div className="wf-step-title">{step.name}</div>
              <div className="wf-step-sub">
                {/* DELEGATION is signalled by delegatedToUserId — never inferred from approverType,
                    which still describes the step's underlying rule. */}
                {delegated
                  ? t('requests.step.waitingFor', { name: step.delegatedToUsername })
                  : approverText(step)}{' '}
                ·{' '}
                {/* An overruled advisory rejection is "did not recommend", not solid "Rejected" —
                    the request lived on, so it must not read as dead. */}
                {step.wasOverruled ? (
                  <span className="wf-advisory-label">{t('requests.step.didNotRecommend')}</span>
                ) : state === 'notreached' ? (
                  /* Closed request: this step was never reached, so nobody owes a decision on it. */
                  <span className="wf-notreached">{t('requests.step.notReached')}</span>
                ) : (
                  <StatusChip status={step.status} />
                )}
                {/* The decision, where it says more than the status — "Approved with changes". */}
                {extraDecision && <span className="wf-step-decision">{extraDecision}</span>}
                {/* Signed with a password: a small lock and the word — but ONLY when there is no
                    signature image. Where an image exists it renders below and the PICTURE says
                    signed, so the lock text would be redundant. Signed-without-an-image keeps the
                    lock exactly as before. */}
                {step.signedWithPassword && !step.hasSignatureImage && (
                  <span className="wf-signed-mark">🔒 {t('requests.step.signedWithPassword')}</span>
                )}
                {step.fallbackRoleName && (
                  <span className="wf-step-deputy-note">
                    {' '}
                    · {t('requests.step.deputyNote', { role: step.fallbackRoleName })}
                  </span>
                )}
              </div>

              {/* Both people, or the chain looks like the step silently changed hands. The original
                  approver stays visible: a Role step handed to one person is still an HR step. */}
              {delegated && (
                <div className="wf-delegated">
                  {t('requests.step.handedTo')} <strong>{step.delegatedToUsername}</strong>
                  {step.delegatedFromUsername ? (
                    <> {t('requests.step.handedBy', { name: step.delegatedFromUsername })}</>
                  ) : null}
                  {step.resolvedUsername !== step.delegatedToUsername && (
                    <> · {t('requests.step.originally', { approver: approverText(step) })}</>
                  )}
                </div>
              )}

              {/* Skipped: the reason, in words, where a signature would be. NEVER a blank — a gap
                  here reads as "unsigned but should have been", so a missing reason says so. */}
              {step.status === 'Skipped' && (
                <div className="wf-skip-reason">
                  {step.skipReason ?? t('requests.step.skippedNoReason')}
                </div>
              )}

              {/* On hold: what it is waiting for, in blue, beside the paused marker. */}
              {step.status === 'OnHold' && step.holdReason && (
                <div className="wf-hold-reason">
                  ⏸ {step.holdReason}
                  {step.waitingOnRequester ? ` ${t('requests.step.waitingOnRequester')}` : ''}
                </div>
              )}

              {/* Signed: who, when, the note they wrote with the decision, and the frozen image
                  beside them — never instead of them. The note belongs HERE, against the decision
                  it explains, which is why the page has no separate notes section. */}
              {signed && (
                <div className="wf-sig-block">
                  {/* The frozen image ONLY when the step says one exists. Signed-but-no-image keeps
                      exactly what shows without it — the lock and "signed" on the line above — and
                      never a placeholder box or a broken-image icon. */}
                  {step.hasSignatureImage && step.signedSignatureId != null && (
                    <StepSignatureImage signatureId={step.signedSignatureId} />
                  )}
                  <div className="wf-sig-meta">
                    {signedAsDeputy && (
                      <div className="wf-deputy-badge">{t('requests.step.signedAsDeputy')}</div>
                    )}
                    <strong>{step.actedByUsername ?? t('requests.step.theSystem')}</strong>
                    {step.actedAt ? <> · {dateTime(step.actedAt)}</> : null}
                    {shownComment && <div className="wf-step-note">“{shownComment}”</div>}
                  </div>
                </div>
              )}

              {/* Proof this step's approver relied on — folded behind its count, opened on demand. */}
              {step.proofCount > 0 && (
                <StepProof requestId={requestId} stepNo={step.stepNo} count={step.proofCount} />
              )}

              {/* THE decision, on the row of the step it acts on. Only on the current step, and only
                  when the caller passed a handler — which they do only for a non-empty decisions
                  response. Nothing here, and no explanation, is what "not yours to decide" looks like. */}
              {onDecide && isCurrent && (
                <div className="wf-step-actions wf-no-print">
                  <Button size="xs" onClick={() => onDecide(step)}>{decideText}</Button>
                </div>
              )}

              {/* A way back from MY OWN still-withdrawable decision — quiet, text, right-aligned. Only
                  when canWithdraw; where it is false, nothing renders at all. Never on paper. */}
              {onWithdraw && step.canWithdraw && (
                <div className="wf-step-withdraw wf-no-print">
                  <button
                    type="button"
                    className="wf-withdraw-btn"
                    onClick={() => onWithdraw(step)}
                  >
                    {t('requests.step.changeDecision')}
                  </button>
                </div>
              )}

              {/* Taking back a delegation — only for whoever handed it over, and only while the
                  delegate has not decided. Nothing was signed, so this asks for no password. */}
              {onReclaim && step.canReclaim && (
                <div className="wf-step-withdraw wf-no-print">
                  <button
                    type="button"
                    className="wf-withdraw-btn"
                    onClick={() => onReclaim(step)}
                  >
                    {arrowReturn()} {t('requests.step.takeBack')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
