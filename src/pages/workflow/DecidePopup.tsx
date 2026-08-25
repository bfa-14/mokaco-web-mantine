import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Loader, Modal, NumberInput, PasswordInput, Select, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { getErrorMessage } from '../../api/errorMessage'
import { ApiError } from '../../api/client'
import {
  availabilityService,
  exitPermissionsService,
  expensesService,
  leaveRequestsService,
  meService,
  onboardingService,
  overtimeService,
  payrollAdjustmentsService,
  requestsService,
  salaryAdvancesService,
  separationsService,
  shiftSwapsService,
  tipDistributionsService,
} from '../../services/workflowService'
import type { ExpensePayload } from '../../services/workflowService'
import { employeesService } from '../../services/hrService'
import type { EmployeeListItem } from '../../types/hr'
import type {
  DecisionOption,
  ExitPermissionDetail,
  LeaveRequestPayload,
  MySignature,
  OvertimePayload,
  PayrollAdjustmentPayload,
  RequestStep,
  SalaryAdvancePayload,
  SignatureRequirement,
  TipDistributionLine,
  TipDistributionPayload,
} from '../../types/workflow'
import { balanceDaysText } from './newRequestShared'
import { shortDate } from './workflowFormat'

/**
 * THE decision dialog. One component, used from the Requests hub cards AND from the current step in
 * the approval chain on request detail — a decision must ask for exactly the same things wherever it
 * is made. Everything it renders is DATA (usp_Step_GetAvailableDecisions /
 * usp_Step_GetSignatureRequirement); the only branch is `dispatch`, which turns an ENGINE ACTION
 * into an endpoint. (Ported 1:1 from the post-fix original; DevExtreme → Mantine only.)
 */

/** The commit button names the ACT, so "Ask the employee" (a Hold) still commits with "Put on hold". */
const ENGINE_LABEL: Record<string, string> = {
  Approve: 'Approve',
  Reject: 'Reject',
  Hold: 'Put on hold',
  Delegate: 'Delegate',
}

/** The synthetic "take it back and stop there" choice, offered ONLY when changing a decision. */
const WITHDRAW_ONLY = '__withdraw_only__'

type Choice = { code: string; label: string; description: string | null }

/**
 * The caller's own signature image, fetched AUTHENTICATED (bearer-gated endpoint — a plain
 * <img src> cannot send the token). Renders nothing if there is none.
 */
function MySignatureImage({ version }: { version?: string | null }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    meService
      .signatureImageObjectUrl(version)
      .then((u) => {
        if (cancelled) {
          if (u) URL.revokeObjectURL(u)
          return
        }
        objectUrl = u
        setUrl(u)
      })
      .catch(() => {
        /* the password is what signs; a missing image never blocks anything */
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [version])

  if (!url) return null
  return <img className="wf-sig-img" src={url} alt="Your signature" />
}

export function DecidePopup({
  requestId,
  requestTypeCode,
  summary,
  signature,
  mySignature,
  change = null,
  onClose,
  onDecided,
}: {
  requestId: number
  /** WHICH KIND of request this is — decides whether an Approve goes generic or typed. */
  requestTypeCode: string
  /** Who and what is being decided — supplied by the caller. */
  summary: React.ReactNode
  /** Whether this caller must sign THE NEW DECISION (read by the caller with its page). */
  signature: SignatureRequirement | null
  /** Whether the caller has a signature image on file. Null is normal, never blocks. */
  mySignature: MySignature | null
  /** Set when CHANGING a decision already made: the step to withdraw first. */
  change?: RequestStep | null
  onClose: () => void
  /** Refresh whatever the caller shows. */
  onDecided: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [decisions, setDecisions] = useState<DecisionOption[]>([])
  const [decisionCode, setDecisionCode] = useState('')
  /** The note — held separately so switching the dropdown never wipes it. */
  const [note, setNote] = useState('')
  /** THE PASSWORD. Component state only; cleared on success AND on every failure. */
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  /** The API's refusal, shown verbatim INSIDE the dialog. */
  const [error, setError] = useState<string | null>(null)

  /** THE TYPED FIGURE for leave; null means "as requested" (the procedure's own default). */
  const [grantValue, setGrantValue] = useState<number | null>(null)
  const [leave, setLeave] = useState<LeaveRequestPayload | null>(null)

  /**
   * GRANT THE LEAVE WITHOUT DEDUCTING IT — a per-request favour, not a property of the leave type.
   *
   * Off by default, because the ordinary answer is that leave costs leave. It is offered at EVERY
   * step rather than only the last, since no approver can know they are the last one; only the
   * decision that closes the request reaches the ledger, so the final approver's box is the one
   * that takes effect and the result reports what was actually done.
   */
  const [makeDiscretionary, setMakeDiscretionary] = useState(false)

  const isLeave = requestTypeCode === 'LEAVE_REQUEST'
  const isExpense = requestTypeCode === 'EXPENSE_REIMBURSEMENT'
  const isTip = requestTypeCode === 'TIP_DISTRIBUTION'
  const isOvertime = requestTypeCode === 'OVERTIME'
  /** THE FIGURE IS SIGNED AT EVERY STEP — tighten only, never raise. */
  const isPayrollAdjustment = requestTypeCode === 'PAYROLL_ADJUSTMENT'
  /** Two signed figures: how much is lent and how fast it comes back. */
  const isSalaryAdvance = requestTypeCode === 'SALARY_ADVANCE'
  /** The four that carry no figure but still have an effect (typed procedures only). */
  const isShiftSwap = requestTypeCode === 'SHIFT_SWAP'
  const isOnboarding = requestTypeCode === 'ONBOARDING'
  const isSeparation = requestTypeCode === 'SEPARATION'
  const isAvailability = requestTypeCode === 'AVAILABILITY_CHANGE'
  /** Exit permission carries its minutes; only the typed procedure can cut them. */
  const isExitPermission = requestTypeCode === 'EXIT_PERMISSION'

  const [exitPermission, setExitPermission] = useState<ExitPermissionDetail | null>(null)
  /** The minutes to approve. Prefilled with what STANDS, and bounded by it. */
  const [grantExitMinutes, setGrantExitMinutes] = useState<number | null>(null)

  const standingExitMinutes = exitPermission
    ? (exitPermission.approvedMinutes ?? exitPermission.requestedMinutes)
    : null

  const exitAlreadyCut =
    exitPermission != null &&
    standingExitMinutes != null &&
    standingExitMinutes < exitPermission.requestedMinutes

  /** The expense payload — currency, frozen rate and the bound. */
  const [expense, setExpense] = useState<ExpensePayload | null>(null)

  /** The chain, read so the dialog knows WHERE IN IT the caller is standing. */
  const [steps, setSteps] = useState<RequestStep[]>([])

  /** The step being decided (first unresolved), or the step being withdrawn when changing. */
  const currentStepNo = useMemo(() => {
    if (change) return change.stepNo
    const open = steps
      .filter((s) => s.status === 'Pending' || s.status === 'OnHold')
      .sort((a, b) => a.stepNo - b.stepNo)
    return open[0]?.stepNo ?? null
  }, [steps, change])

  /** Whether anything follows this step — the procedure's own `@Step < @LastStep`, mirrored. */
  const hasLaterSteps = useMemo(() => {
    if (currentStepNo == null || steps.length === 0) return false
    return currentStepNo < Math.max(...steps.map((s) => s.stepNo))
  }, [steps, currentStepNo])

  /** Whether THIS step may change the figures (frozen on the step by the chain). */
  const canAdjustHere = useMemo(
    () => steps.find((s) => s.stepNo === currentStepNo)?.canAdjust === true,
    [steps, currentStepNo],
  )

  /* ── tip distribution: restating the split ── */

  const [tip, setTip] = useState<TipDistributionPayload | null>(null)
  const [branchStaff, setBranchStaff] = useState<EmployeeListItem[]>([])

  /** OFF BY DEFAULT — approving the calculated split stays one click. */
  const [redistribute, setRedistribute] = useState(false)

  /** The editable split. A LOCAL COPY seeded from the payload, never the payload itself. */
  const [draftLines, setDraftLines] = useState<TipDistributionLine[]>([])

  /** Add-a-person picker, cleared after each add. */
  const [addEmployeeId, setAddEmployeeId] = useState<number | null>(null)

  /** THE ARITHMETIC, PER CURRENCY, in integer minor units (binary floats lie about 0.00). */
  const currencyTotals = useMemo(() => {
    if (!tip) return []
    const cents = (v: number) => Math.round(v * 100)
    return tip.amounts.map((pool) => {
      const assigned = draftLines
        .filter((l) => l.currencyCode === pool.currencyCode)
        .reduce((sum, l) => sum + cents(l.amount || 0), 0)
      const pooled = cents(pool.amount)
      return {
        currencyCode: pool.currencyCode,
        assigned: assigned / 100,
        pooled: pool.amount,
        difference: (pooled - assigned) / 100,
        exact: assigned === pooled,
      }
    })
  }, [tip, draftLines])

  /** Every pooled currency accounted for to the unit. */
  const splitBalances = currencyTotals.length > 0 && currencyTotals.every((c) => c.exact)

  /** A share of nothing — the procedure refuses it; caught while the row is on screen. */
  const zeroShare = draftLines.some((l) => !l.amount || l.amount <= 0)

  /** Whoever is not yet in the split — the only people "Add participant" may offer. */
  const addableStaff = useMemo(
    () =>
      branchStaff.filter(
        (e) => !e.terminationDate && !draftLines.some((l) => l.employeeId === e.employeeId),
      ),
    [branchStaff, draftLines],
  )

  /* ── overtime: the cap ── */

  const [overtime, setOvertime] = useState<OvertimePayload | null>(null)
  /** The minutes to approve. REQUIRED on every approval. */
  const [grantMinutes, setGrantMinutes] = useState<number | null>(null)

  /** THE FIGURE STANDING BEFORE THIS DECISION — the procedure's own ISNULL(@Prev, @Req). */
  const standingMinutes = overtime ? (overtime.approvedMinutes ?? overtime.requestedMinutes) : null

  const alreadyCapped =
    overtime != null && standingMinutes != null && standingMinutes < overtime.requestedMinutes

  /* ── payroll adjustment / salary advance: the signed figures ── */

  const [adjustment, setAdjustment] = useState<PayrollAdjustmentPayload | null>(null)
  const [advance, setAdvance] = useState<SalaryAdvancePayload | null>(null)

  /** The amount to approve, for whichever of the two money types this is. Required. */
  const [grantSigned, setGrantSigned] = useState<number | null>(null)

  /** The monthly deduction to approve, advance only. Sent explicitly. */
  const [grantMonthly, setGrantMonthly] = useState<number | null>(null)

  /** The standing figure — the ceiling, NOT the requested figure once a chain is underway. */
  const standingAmount = isPayrollAdjustment
    ? (adjustment ? (adjustment.approvedAmount ?? adjustment.amount) : null)
    : isSalaryAdvance
      ? (advance ? (advance.approvedAmount ?? advance.amount) : null)
      : null

  const standingMonthly = advance
    ? (advance.approvedMonthlyDeduction ?? advance.monthlyDeduction)
    : null

  const requestedAmount = isPayrollAdjustment
    ? (adjustment?.amount ?? null)
    : isSalaryAdvance
      ? (advance?.amount ?? null)
      : null

  const alreadyTightened =
    standingAmount != null && requestedAmount != null && standingAmount < requestedAmount

  const signedCurrency = isPayrollAdjustment
    ? (adjustment?.currencyCode ?? '')
    : (advance?.currencyCode ?? '')

  /** Recovery months at the figures currently in the boxes. */
  const advanceMonths = useMemo(() => {
    if (!isSalaryAdvance || grantSigned == null || grantMonthly == null || grantMonthly <= 0) {
      return null
    }
    return Math.ceil(grantSigned / grantMonthly)
  }, [isSalaryAdvance, grantSigned, grantMonthly])

  /** An expense's granted figure — REQUIRED, prefilled with what was requested. */
  const [grantAmount, setGrantAmount] = useState<number | null>(null)

  /** THE FROZEN CONVERSION — the rate STORED ON THE EXPENSE, not today's. */
  const grantUsd = useMemo(() => {
    if (!expense || grantAmount == null) return null
    if (expense.currencyCode === 'USD') return grantAmount
    if (!expense.rateUsed) return null
    return Math.round(grantAmount * expense.rateUsed * 100) / 100
  }, [expense, grantAmount])

  /** What this figure will do — a PREDICTION, silent on the Owner's own step. */
  const routingPreview = useMemo(() => {
    if (!expense || grantUsd == null) return null
    if (!hasLaterSteps) return null
    return grantUsd <= expense.thresholdUsd
      ? { over: false, text: 'Approves the request — the Owner is not needed.' }
      : { over: true, text: 'Goes to the Owner for approval.' }
  }, [expense, grantUsd, hasLaterSteps])

  /** The real decision behind the current choice, or null for withdraw-only. */
  const selected = decisions.find((d) => d.code === decisionCode) ?? null
  const isWithdrawOnly = decisionCode === WITHDRAW_ONLY

  /** Whether to offer the leave figure — AllowsValueChange already AND-ed with CanAdjust. */
  const canAdjustValue =
    isLeave && leave != null && selected?.engineAction === 'Approve' && selected.allowsValueChange

  /** Changing a decision offers withdraw-only FIRST — the smaller, safer act. */
  const choices: Choice[] = change
    ? [
        {
          code: WITHDRAW_ONLY,
          label: 'Withdraw without deciding again',
          description: 'Take my decision back and leave this step open.',
        },
        ...decisions,
      ]
    : decisions

  /**
   * TWO INDEPENDENT SIGNATURE QUESTIONS: the WITHDRAWAL is governed by the step's own
   * WithdrawNeedsSignature; the NEW DECISION by the request's SignatureRequired.
   */
  const withdrawNeedsPassword = change?.withdrawNeedsSignature ?? false
  const newDecisionNeedsPassword = signature?.signatureRequired ?? false
  const needsPassword = change
    ? withdrawNeedsPassword || (!isWithdrawOnly && newDecisionNeedsPassword)
    : newDecisionNeedsPassword

  // What this caller may actually do here. Empty = "not yours to decide" → close; EXCEPT when
  // changing a decision, where withdrawing is still open to them.
  useEffect(() => {
    let cancelled = false
    async function loadDecisions() {
      try {
        const [
          list,
          payload,
          expensePayload,
          chain,
          tipPayload,
          staff,
          otPayload,
          adjPayload,
          advPayload,
          epPayload,
        ] = await Promise.all([
          requestsService.getDecisions(requestId),
          isLeave
            ? leaveRequestsService.payload(requestId).catch(() => null)
            : Promise.resolve(null),
          isExpense
            ? expensesService.payload(requestId).catch(() => null)
            : Promise.resolve(null),
          isExpense || isTip || isOvertime || isExitPermission
            ? requestsService.steps(requestId).catch(() => [])
            : Promise.resolve([]),
          isTip ? tipDistributionsService.payload(requestId).catch(() => null) : Promise.resolve(null),
          isTip ? employeesService.getAll().catch(() => [] as EmployeeListItem[]) : Promise.resolve([]),
          isOvertime ? overtimeService.payload(requestId).catch(() => null) : Promise.resolve(null),
          isPayrollAdjustment
            ? payrollAdjustmentsService.payload(requestId).catch(() => null)
            : Promise.resolve(null),
          isSalaryAdvance
            ? salaryAdvancesService.payload(requestId).catch(() => null)
            : Promise.resolve(null),
          isExitPermission
            ? exitPermissionsService.byRequest(requestId).catch(() => null)
            : Promise.resolve(null),
        ])
        if (cancelled) return
        setLeave(payload)
        setExpense(expensePayload)
        setSteps(chain)
        setTip(tipPayload)
        // Only this branch's people may appear in the split.
        setBranchStaff(
          tipPayload?.header
            ? staff.filter((e) => e.branch === tipPayload.header!.branchName)
            : [],
        )
        if (tipPayload) setDraftLines(tipPayload.lines.map((l) => ({ ...l })))
        setOvertime(otPayload)
        // Prefilled with THE STANDING FIGURE, not the requested one.
        if (otPayload) setGrantMinutes(otPayload.approvedMinutes ?? otPayload.requestedMinutes)
        // Prefilled with what was REQUESTED — the common decision is "yes, all of it".
        if (expensePayload) setGrantAmount(expensePayload.amount)

        // THE STANDING FIGURE, not the original claim.
        setAdjustment(adjPayload)
        if (adjPayload) setGrantSigned(adjPayload.approvedAmount ?? adjPayload.amount)

        setAdvance(advPayload)
        if (advPayload) {
          const amount = advPayload.approvedAmount ?? advPayload.amount
          const monthly = advPayload.approvedMonthlyDeduction ?? advPayload.monthlyDeduction
          setGrantSigned(amount)
          // Clamped on open, not only while typing.
          setGrantMonthly(Math.min(monthly, amount))
        }

        setExitPermission(epPayload)
        if (epPayload) setGrantExitMinutes(epPayload.approvedMinutes ?? epPayload.requestedMinutes)
        if (list.length === 0 && !change) {
          notifications.show({
            message: 'This step is no longer yours to decide — it has moved on.',
            color: 'orange',
            autoClose: 5000,
          })
          onClose()
          await onDecided()
          return
        }
        setDecisions(list)
        if (change) {
          // Start from WHAT THEY DID: their previous decision, preselected, with their note.
          const previous = change.decision && list.some((d) => d.code === change.decision)
            ? change.decision
            : WITHDRAW_ONLY
          setDecisionCode(previous)
          setNote(change.comment ?? '')
        } else {
          // The primary choice is preselected — the ordinary case is open → note → commit.
          setDecisionCode(list.find((d) => d.isPrimary)?.code ?? list[0].code)
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadDecisions()
    return () => {
      cancelled = true
    }
    // Deliberately keyed on the request alone — re-running would throw away what the user typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId])

  /**
   * THE ONLY BRANCH. A decision's ENGINE ACTION picks the endpoint; typed approvals go to the
   * type's own procedure, which owns the figure and its effect. Returns an extra sentence for the
   * success message, or null.
   */
  async function dispatch(d: DecisionOption, text: string, pw?: string): Promise<string | null> {
    switch (d.engineAction) {
      case 'Approve':
        if (isLeave) {
          const result = await leaveRequestsService.decide(requestId, {
            approvedDays: grantValue,
            comment: text || null,
            code: d.code,
            password: pw,
            makeDiscretionary,
          })
          if (result.status !== 'Approved') return null
          const granted = `Granted ${balanceDaysText(result.daysApproved)}.`
          // Said from the RESULT, not from the box: a discretionary grant posts nothing, so
          // reporting "the balance is now X" would imply a deduction that never happened.
          if (result.discretionaryGranted) {
            return `${granted} ${t('workflow.leaveDiscretionary.outcome', {
              type: leave?.leaveTypeName ?? '',
              balance: balanceDaysText(result.balanceAfter),
            })}`
          }
          return result.balanceIsNegative
            ? `${granted} ${leave?.leaveTypeName ?? 'The'} balance is now ${balanceDaysText(result.balanceAfter)} — negative.`
            : `${granted} ${leave?.leaveTypeName ?? 'The'} balance is now ${balanceDaysText(result.balanceAfter)}.`
        }
        if (isExpense) {
          const result = await expensesService.decide(requestId, {
            approvedAmount: grantAmount as number,
            comment: text || null,
            password: pw ?? null,
          })
          const ccy = expense?.currencyCode ?? ''
          const usd = ccy && ccy !== 'USD' ? ` (${result.approvedUsd.toFixed(2)} USD)` : ''
          const granted = `Granted ${result.approvedAmount.toFixed(2)} ${ccy}${usd}.`
          if (result.remainingStepsSkipped)
            return `${granted} Approved — the Owner step was skipped.`
          if (result.goesToOwner) return `${granted} Sent to the Owner.`
          return granted
        }
        if (isTip) {
          const result = await tipDistributionsService.decide(requestId, {
            linesJson: redistribute
              ? draftLines.map((l) => ({
                  employeeId: l.employeeId,
                  currencyCode: l.currencyCode,
                  amount: l.amount,
                }))
              : null,
            comment: text || null,
            password: pw ?? null,
          })
          if (result.linesRestated) {
            const fresh = await tipDistributionsService.payload(requestId).catch(() => null)
            if (fresh) {
              setTip(fresh)
              setDraftLines(fresh.lines.map((l) => ({ ...l })))
            }
            const people = new Set(draftLines.map((l) => l.employeeId)).size
            return `Split restated across ${people} ${people === 1 ? 'person' : 'people'}.`
          }
          return null
        }
        if (isOvertime) {
          const result = await overtimeService.decide(requestId, {
            approvedMinutes: grantMinutes,
            comment: text || null,
            password: pw,
          })
          const cap = `${result.approvedMinutes} min approved`
          const cut = result.figureTightened
            ? ` — cut from ${standingMinutes ?? result.requestedMinutes}`
            : ''
          return result.isFinal
            ? `${cap}${cut}. Payroll pays the actual extra time worked, up to it.`
            : `${cap}${cut}.`
        }
        if (isPayrollAdjustment) {
          const result = await payrollAdjustmentsService.decide(requestId, {
            approvedAmount: grantSigned as number,
            comment: text || null,
            password: pw ?? null,
          })
          const signed = `${result.approvedAmount.toFixed(2)} ${adjustment?.currencyCode ?? ''}`.trim()
          const cut =
            standingAmount != null && result.approvedAmount < standingAmount
              ? ` — cut from ${standingAmount.toFixed(2)}`
              : ''
          return result.createdAdjustmentId != null
            ? `Approved at ${signed}${cut}. The correction is queued — regenerate that period to pick it up.`
            : `Approved at ${signed}${cut}.`
        }
        if (isSalaryAdvance) {
          const result = await salaryAdvancesService.decide(requestId, {
            approvedAmount: grantSigned as number,
            approvedMonthlyDeduction: grantMonthly,
            comment: text || null,
            password: pw ?? null,
          })
          const ccy = advance?.currencyCode ?? ''
          const months = Math.ceil(result.approvedAmount / result.approvedMonthlyDeduction)
          const terms =
            `${result.approvedAmount.toFixed(2)} ${ccy} at ${result.approvedMonthlyDeduction.toFixed(2)}/month ` +
            `over ${months} ${months === 1 ? 'month' : 'months'}`
          return result.createdAdvanceId != null
            ? `Approved: ${terms}. Payroll starts recovering it in ${advance?.firstDeductionPeriod ?? 'the first deduction period'}.`
            : `Approved: ${terms}.`
        }
        if (isShiftSwap) {
          const result = await shiftSwapsService.decide(requestId, {
            comment: text || null,
            password: pw,
          })
          return result.status === 'Approved'
            ? 'Applied to the roster — the two shifts are exchanged.'
            : null
        }
        if (isOnboarding) {
          const result = await onboardingService.decide(requestId, {
            comment: text || null,
            password: pw ?? null,
          })
          const created = result.createdEmployeeId != null ? 'Employee record created.' : null
          const outstanding =
            result.outstandingRequired > 0
              ? `${result.outstandingRequired} required checklist ${result.outstandingRequired === 1 ? 'item is' : 'items are'} still outstanding.`
              : null
          return [created, outstanding].filter(Boolean).join(' ') || null
        }
        if (isSeparation) {
          const result = await separationsService.decide(requestId, {
            comment: text || null,
            password: pw ?? null,
          })
          return result.appliedAt != null
            ? 'Employment ended — the termination date is stamped and the remaining leave settled.'
            : null
        }
        if (isAvailability) {
          const result = await availabilityService.decide(requestId, {
            comment: text || null,
            password: pw ?? null,
          })
          if (result.status !== 'Approved') return null
          return result.futureConflicts > 0
            ? `Weekly pattern rewritten. ${result.futureConflicts} already-rostered ${result.futureConflicts === 1 ? 'day contradicts' : 'days contradict'} it and ${result.futureConflicts === 1 ? 'keeps its shift' : 'keep their shifts'}.`
            : 'Weekly pattern rewritten.'
        }
        if (isExitPermission) {
          const result = await exitPermissionsService.decide(requestId, {
            approvedMinutes: grantExitMinutes,
            comment: text || null,
            code: d.code,
            password: pw,
          })
          const approved = result.approvedMinutes ?? result.requestedMinutes
          return result.wasReduced
            ? `${approved} min approved — cut from ${result.requestedMinutes}.`
            : `${approved} min approved.`
        }
        await requestsService.approve(requestId, { comment: text || null, code: d.code, password: pw })
        break
      case 'Reject':
        await requestsService.reject(requestId, text, { code: d.code, password: pw })
        break
      case 'Hold':
        await requestsService.hold(requestId, text, false, { code: d.code, password: pw })
        break
      case 'Delegate':
        await requestsService.delegate(requestId, 0, text, d.code)
        break
      default:
        throw new Error('This decision needs an engine action this app does not implement yet.')
    }
    return null
  }

  async function submit() {
    const text = note.trim()
    if (isWithdrawOnly) {
      if (!text) {
        setError('Say why you are withdrawing.')
        return
      }
    } else {
      if (!selected) return
      if (selected.requiresComment && !text) {
        setError('This decision needs a note.')
        return
      }
      /*
       * A DISCRETIONARY GRANT MUST SAY WHY. Waiving the deduction is the one decision here that
       * leaves no trace in any figure — the balance simply does not move — so the note is the only
       * record that it was a choice rather than an oversight, and the only thing anybody auditing
       * the balance months later has to read.
       *
       * Checked here rather than by disabling the button: the reason has to be NAMED, and a button
       * that quietly will not depress does not name it. The procedure refuses this too, so a stale
       * tab that gets past the client still lands on the same rule with the same explanation.
       */
      if (discretionaryNoteRequired && !text) {
        setError(t('workflow.leaveDiscretionary.noteRequiredError'))
        return
      }
    }
    if (isExpense && selected?.engineAction === 'Approve' && grantAmount == null) {
      setError('State the amount to grant.')
      return
    }
    if (isOvertime && selected?.engineAction === 'Approve' && grantMinutes == null) {
      setError('State the minutes to approve.')
      return
    }
    if (isExitPermission && selected?.engineAction === 'Approve' && grantExitMinutes == null) {
      setError('State the minutes to approve.')
      return
    }
    if ((isPayrollAdjustment || isSalaryAdvance) && selected?.engineAction === 'Approve') {
      if (grantSigned == null) {
        setError('State the amount to approve.')
        return
      }
      if (isSalaryAdvance && grantMonthly == null) {
        setError('State the monthly deduction.')
        return
      }
    }
    if (isTip && redistribute && selected?.engineAction === 'Approve') {
      if (zeroShare) {
        setError('Every share must be above zero. To give someone nothing, leave them off the list.')
        return
      }
      if (!splitBalances) {
        setError('Every currency must be shared out in full before this can be approved.')
        return
      }
      if (!text) {
        setError('Say why the split was changed.')
        return
      }
    }
    if (needsPassword && !password) {
      setError('Your password is required to sign this.')
      return
    }

    const pw = needsPassword ? password : undefined
    setSubmitting(true)
    setError(null)
    let outcome: string | null = null
    try {
      if (change) {
        // TWO ACTS, IN ORDER. The note is the withdrawal's reason; the withdrawal's password
        // question is the STEP's, not the request's.
        await requestsService.withdraw(
          requestId,
          change.stepNo,
          text,
          withdrawNeedsPassword ? password : undefined,
        )

        if (!isWithdrawOnly && selected) {
          try {
            outcome = await dispatch(selected, text, newDecisionNeedsPassword ? password : undefined)
          } catch {
            // HALF DONE, AND SAID SO — the withdrawal stuck, the new decision did not.
            setPassword('')
            onClose()
            await onDecided()
            notifications.show({
              message:
                'Your previous decision was withdrawn, but the new one did not save. The step is waiting for your decision.',
              color: 'orange',
              autoClose: 9000,
            })
            return
          }
        }
      } else {
        outcome = await dispatch(selected!, text, pw)
      }
      setPassword('')
      onClose()
      await onDecided()

      const base =
        change && isWithdrawOnly
          ? 'Decision withdrawn. This step is waiting for you again.'
          : 'Decision recorded.'
      const negative = outcome?.includes('negative') ?? false
      notifications.show({
        message: outcome ? `${base} ${outcome}` : base,
        color: negative ? 'orange' : 'green',
        autoClose: negative ? 9000 : outcome ? 5000 : 3000,
      })
    } catch (err) {
      // The password never outlives one attempt; everything else stays exactly as typed.
      setPassword('')
      setError(
        err instanceof ApiError && err.status === 401
          ? 'That password is not correct.'
          : getErrorMessage(err),
      )
    } finally {
      setSubmitting(false)
    }
  }

  const actWord = isWithdrawOnly
    ? 'Withdraw'
    : selected
      ? (ENGINE_LABEL[selected.engineAction] ?? selected.label)
      : 'Decide'

  const splitIncomplete =
    isTip &&
    redistribute &&
    selected?.engineAction === 'Approve' &&
    (!splitBalances || zeroShare)

  const redistributingNow = isTip && redistribute && selected?.engineAction === 'Approve'

  /**
   * Whether ticking "grant as discretionary" has made the note mandatory.
   *
   * GATED ON THE SAME THREE CONDITIONS THAT RENDER THE BOX, not on the tick alone. The tick survives
   * a change of decision — switching to Reject hides the checkbox without clearing it — and a note
   * demanded by a control the user can no longer see is a dead end with no way out of it.
   *
   * Unticking restores "(optional)" the instant it happens: the requirement belongs to the waiver,
   * and asking for a reason for something nobody is doing any more is just a stuck form.
   */
  const discretionaryNoteRequired =
    isLeave && leave != null && selected?.engineAction === 'Approve' && makeDiscretionary

  const minutesMissing =
    (isOvertime && selected?.engineAction === 'Approve' && grantMinutes == null) ||
    (isExitPermission && selected?.engineAction === 'Approve' && grantExitMinutes == null)

  const signedAmountMissing =
    (isPayrollAdjustment || isSalaryAdvance) &&
    selected?.engineAction === 'Approve' &&
    (grantSigned == null ||
      standingAmount == null ||
      (isSalaryAdvance && grantMonthly == null))

  const num = (v: number | string) => (typeof v === 'number' ? v : null)

  return (
    <Modal
      opened
      onClose={onClose}
      title={change ? 'Change decision' : 'Decide'}
      size={540}
      centered
      closeOnClickOutside={!submitting}
    >
      <div className="wf-decide-summary">{summary}</div>

      {/* The two-act truth, up front: the original is withdrawn ON THE RECORD, both stay visible. */}
      {change && (
        <div className="wf-decide-banner">
          You {change.status === 'Rejected' ? 'rejected' : 'approved'} this
          {change.actedAt ? ` on ${shortDate(change.actedAt)}` : ''}. Changing it withdraws that{' '}
          {change.status === 'Rejected' ? 'rejection' : 'approval'} and records a new decision. Both
          stay in the history.
        </div>
      )}

      {loading ? (
        <div className="page-loading">
          <Loader size={28} />
        </div>
      ) : (
        <>
          {/* The dropdown IS the choice — options, order and wording all come from the API. */}
          <div className="form-field">
            <Select
              label="Decision"
              data={choices.map((c) => ({ value: c.code, label: c.label }))}
              value={decisionCode}
              allowDeselect={false}
              disabled={submitting}
              onChange={(v) => setDecisionCode(v ?? '')}
            />
            {(selected?.description ??
              (isWithdrawOnly ? choices[0]?.description : null)) && (
              <div className="hint">
                {selected?.description ?? choices[0]?.description}
              </div>
            )}
          </div>

          {/* THE EXPENSE FIGURE — required, prefilled with the request, bounded ONLY by it. */}
          {isExpense && expense && selected?.engineAction === 'Approve' && (
            <div className="form-field">
              <label className="form-label" htmlFor="wf-grant-amount">
                Amount to grant <span className="form-optional">(required)</span>
              </label>
              <div className="wf-amount-row">
                <NumberInput
                  id="wf-grant-amount"
                  value={grantAmount ?? ''}
                  min={0}
                  max={expense.amount}
                  step={1}
                  decimalScale={2}
                  disabled={submitting}
                  onChange={(v) => setGrantAmount(num(v))}
                />
                <span className="wf-amount-ccy">{expense.currencyCode}</span>
              </div>

              {routingPreview && (
                <div
                  className={
                    routingPreview.over ? 'wf-routing wf-routing--owner' : 'wf-routing wf-routing--closes'
                  }
                >
                  {routingPreview.text}
                  {expense.currencyCode !== 'USD' && grantUsd != null && (
                    <span className="wf-routing-usd">
                      {' '}
                      · {grantUsd.toFixed(2)} USD of {expense.thresholdUsd.toFixed(2)} threshold (rate{' '}
                      {expense.rateUsed})
                    </span>
                  )}
                </div>
              )}

              {!routingPreview && expense.currencyCode !== 'USD' && grantUsd != null && (
                <div className="hint">
                  ≈ {grantUsd.toFixed(2)} USD (rate {expense.rateUsed})
                </div>
              )}

              <div className="hint">
                {expense.employeeName} claimed {expense.amount.toFixed(2)} {expense.currencyCode}. You
                cannot grant more.
              </div>
            </div>
          )}

          {/* THE OVERTIME CAP — required, prefilled with what STANDS, bounded by it. */}
          {isOvertime && overtime && standingMinutes != null && selected?.engineAction === 'Approve' && (
            <div className="form-field">
              <label className="form-label" htmlFor="wf-grant-minutes">
                Minutes to approve <span className="form-optional">(required)</span>
              </label>
              {canAdjustHere ? (
                <NumberInput
                  id="wf-grant-minutes"
                  value={grantMinutes ?? ''}
                  min={1}
                  max={standingMinutes}
                  step={15}
                  disabled={submitting}
                  onChange={(v) => setGrantMinutes(num(v))}
                />
              ) : (
                <>
                  {/* READ-ONLY, not hidden — the figure is the substance of the decision. */}
                  <NumberInput id="wf-grant-minutes" value={standingMinutes} readOnly />
                  <div className="hint">
                    This step approves or rejects; it cannot change the figure.
                  </div>
                </>
              )}

              <div className="hint">
                This is a cap. Payroll pays the actual extra time worked, up to it.
                {alreadyCapped && ` Capped at ${standingMinutes} by an earlier approver.`}
              </div>
            </div>
          )}

          {/* THE EXIT-PERMISSION MINUTES — cut allowed, never extend. */}
          {isExitPermission && exitPermission && standingExitMinutes != null &&
            selected?.engineAction === 'Approve' && (
            <div className="form-field">
              <label className="form-label" htmlFor="wf-grant-exit-minutes">
                Minutes away to approve <span className="form-optional">(required)</span>
              </label>
              {canAdjustHere ? (
                <NumberInput
                  id="wf-grant-exit-minutes"
                  value={grantExitMinutes ?? ''}
                  // MIN 1, not 0: approving zero minutes away is not an approval, it is a refusal
                  // written as one — and it would push a zero into attendance as an authorised
                  // absence of nothing. Somebody who means to refuse has Reject beside this.
                  min={1}
                  max={standingExitMinutes}
                  step={15}
                  disabled={submitting}
                  onChange={(v) => setGrantExitMinutes(num(v))}
                />
              ) : (
                <>
                  <NumberInput id="wf-grant-exit-minutes" value={standingExitMinutes} readOnly />
                  <div className="hint">This step approves or rejects; it cannot change the figure.</div>
                </>
              )}

              <div className="hint">
                {exitPermission.fullName} asked for {exitPermission.requestedMinutes} minutes on{' '}
                {shortDate(exitPermission.exitDate)}. You cannot approve more.
                {exitAlreadyCut && ` Already cut to ${standingExitMinutes} by an earlier approver.`}
                {exitPermission.convertToLeave && ' The approved time comes out of annual leave.'}
              </div>
            </div>
          )}

          {/* THE SIGNED MONEY FIGURE — adjustment and advance both. */}
          {(isPayrollAdjustment || isSalaryAdvance) &&
            standingAmount != null &&
            selected?.engineAction === 'Approve' && (
              <div className="form-field">
                <label className="form-label" htmlFor="wf-grant-signed">
                  {isSalaryAdvance ? 'Amount to lend' : 'Approved amount'}{' '}
                  <span className="form-optional">(required)</span>
                </label>
                <div className="wf-amount-row">
                  <NumberInput
                    id="wf-grant-signed"
                    value={grantSigned ?? ''}
                    min={0}
                    max={standingAmount}
                    step={1}
                    decimalScale={2}
                    disabled={submitting}
                    onChange={(v) => {
                      const next = num(v)
                      setGrantSigned(next)
                      // THE SCHEDULE FOLLOWS THE LOAN DOWN — clamped, not cleared.
                      if (isSalaryAdvance && next != null && grantMonthly != null && grantMonthly > next) {
                        setGrantMonthly(next)
                      }
                    }}
                  />
                  <span className="wf-amount-ccy">{signedCurrency}</span>
                </div>

                <div className="hint">
                  You sign this figure. Lower tightens it; more than requested needs a new request.
                </div>

                {alreadyTightened && requestedAmount != null && (
                  <div className="hint">
                    Asked for {requestedAmount.toFixed(2)} {signedCurrency}; an earlier approver set
                    it at {standingAmount.toFixed(2)}. You cannot raise it back.
                  </div>
                )}
              </div>
            )}

          {/* THE ADVANCE'S SCHEDULE — a second signed figure. */}
          {isSalaryAdvance && advance && standingAmount != null && selected?.engineAction === 'Approve' && (
            <div className="form-field">
              <label className="form-label" htmlFor="wf-grant-monthly">
                Monthly deduction <span className="form-optional">(required)</span>
              </label>
              <div className="wf-amount-row">
                <NumberInput
                  id="wf-grant-monthly"
                  value={grantMonthly ?? ''}
                  min={0}
                  // Bounded by the FIELD, not the payload.
                  max={grantSigned ?? standingAmount}
                  step={1}
                  decimalScale={2}
                  disabled={submitting}
                  onChange={(v) => setGrantMonthly(num(v))}
                />
                <span className="wf-amount-ccy">{signedCurrency}</span>
              </div>

              {advanceMonths != null && (
                <div className="hint">
                  Recovered over {advanceMonths} {advanceMonths === 1 ? 'month' : 'months'}, starting{' '}
                  {advance.firstDeductionPeriod}.
                </div>
              )}

              {standingMonthly != null && grantMonthly != null && grantMonthly < standingMonthly && (
                <div className="hint">
                  Asked for {standingMonthly.toFixed(2)}/month. A smaller deduction takes longer to
                  repay but leaves more in each payslip.
                </div>
              )}
            </div>
          )}

          {/* THE TIP SPLIT — approve-as-calculated default; redistribute behind a toggle. */}
          {isTip && tip && canAdjustHere && selected?.engineAction === 'Approve' && (
            <div className="form-field">
              <div className="wf-split-head">
                <label className="form-label" style={{ marginBottom: 0 }}>
                  The split
                </label>
                <button
                  type="button"
                  className="wf-split-toggle"
                  aria-pressed={redistribute}
                  disabled={submitting}
                  onClick={() => {
                    // Turning it OFF restores the calculated split.
                    setRedistribute((on) => {
                      if (on) setDraftLines(tip.lines.map((l) => ({ ...l })))
                      return !on
                    })
                  }}
                >
                  {redistribute ? '← Approve as calculated' : 'Redistribute…'}
                </button>
              </div>

              {!redistribute ? (
                <div className="wf-split-summary">
                  {tip.lines.length} {tip.lines.length === 1 ? 'share' : 'shares'} across{' '}
                  {new Set(tip.lines.map((l) => l.employeeId)).size} people —{' '}
                  {tip.amounts.map((a) => `${a.amount.toFixed(2)} ${a.currencyCode}`).join(' + ')}.
                </div>
              ) : (
                <>
                  <div className="wf-split-grid">
                    <div className="wf-split-row wf-split-row--head">
                      <span>Person</span>
                      <span>Currency</span>
                      <span>Amount</span>
                      <span />
                    </div>
                    {draftLines.map((line, index) => (
                      <div className="wf-split-row" key={`${line.employeeId}-${line.currencyCode}`}>
                        <span className="wf-split-name">{line.fullName}</span>
                        <span className="wf-split-ccy">{line.currencyCode}</span>
                        <NumberInput
                          value={line.amount}
                          min={0}
                          decimalScale={2}
                          disabled={submitting}
                          aria-label={`${line.fullName} — ${line.currencyCode}`}
                          onChange={(v) => {
                            const next = num(v) ?? 0
                            setDraftLines((prev) =>
                              prev.map((l, i) => (i === index ? { ...l, amount: next } : l)),
                            )
                          }}
                        />
                        <button
                          type="button"
                          className="wf-split-remove"
                          aria-label={`Remove ${line.fullName} from ${line.currencyCode}`}
                          disabled={submitting}
                          onClick={() =>
                            setDraftLines((prev) => prev.filter((_, i) => i !== index))
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* THE RUNNING TOTAL, PER CURRENCY — red until exact. */}
                  <div className="wf-split-totals">
                    {currencyTotals.map((total) => (
                      <div
                        key={total.currencyCode}
                        className={total.exact ? 'wf-split-total' : 'wf-split-total wf-split-total--off'}
                      >
                        {total.currencyCode} {total.assigned.toFixed(2)} of{' '}
                        {total.pooled.toFixed(2)}
                        {total.exact ? (
                          ' ✓'
                        ) : (
                          <>
                            {' — '}
                            {Math.abs(total.difference).toFixed(2)}{' '}
                            {total.difference > 0 ? 'unaccounted' : 'over'}
                          </>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Adding somebody the original split left out. */}
                  {addableStaff.length > 0 && (
                    <div className="wf-split-add">
                      <Select
                        data={addableStaff.map((e) => ({
                          value: String(e.employeeId),
                          label: e.fullName,
                        }))}
                        value={addEmployeeId != null ? String(addEmployeeId) : null}
                        searchable
                        placeholder="Add participant…"
                        disabled={submitting}
                        onChange={(v) => setAddEmployeeId(v != null ? Number(v) : null)}
                      />
                      <Button
                        variant="default"
                        disabled={submitting || addEmployeeId == null}
                        onClick={() => {
                          const person = addableStaff.find((p) => p.employeeId === addEmployeeId)
                          if (!person) return
                          // ONE ROW PER CURRENCY, at zero — visibly "give them something".
                          setDraftLines((prev) => [
                            ...prev,
                            ...tip.amounts.map((a) => ({
                              employeeId: person.employeeId,
                              fullName: person.fullName,
                              currencyCode: a.currencyCode,
                              amount: 0,
                            })),
                          ])
                          setAddEmployeeId(null)
                        }}
                      >
                        Add
                      </Button>
                    </div>
                  )}

                  <div className="hint">
                    Every currency must be shared out to the unit, and a note saying why is required
                    — a restated split is a change of substance.
                  </div>
                </>
              )}
            </div>
          )}

          {canAdjustValue && leave && (
            <div className="form-field">
              <label className="form-label" htmlFor="wf-grant-days">
                Days to grant <span className="form-optional">(optional)</span>
              </label>
              <NumberInput
                id="wf-grant-days"
                value={grantValue ?? ''}
                min={0.1}
                max={leave.daysRequested}
                step={0.5}
                placeholder={`${leave.daysRequested} (as requested)`}
                disabled={submitting}
                onChange={(v) => setGrantValue(num(v))}
              />
              <div className="hint">
                {leave.employeeName} asked for {balanceDaysText(leave.daysRequested)}. Leave this
                blank to grant it in full; you cannot grant more. Their {leave.leaveTypeName.toLowerCase()}{' '}
                balance is {balanceDaysText(leave.currentBalance)}
                {grantValue != null && grantValue > leave.currentBalance
                  ? ', so granting this takes it negative.'
                  : '.'}
              </div>
            </div>
          )}

          {/* DISCRETIONARY — offered to EVERY approver on an Approve, not only the one who may
              change the figure: waiving the deduction is a different question from cutting the days,
              and it is not gated by the step's CanAdjust. The last approver's answer is the one the
              procedure acts on, which is what the hint says rather than leaving people to guess. */}
          {isLeave && leave && selected?.engineAction === 'Approve' && (
            <div className="form-field">
              <Checkbox
                label={t('workflow.leaveDiscretionary.label')}
                checked={makeDiscretionary}
                disabled={submitting}
                onChange={(e) => setMakeDiscretionary(e.currentTarget.checked)}
              />
              <div className="hint">
                {makeDiscretionary
                  ? t('workflow.leaveDiscretionary.hintOn', {
                      type: leave.leaveTypeName.toLowerCase(),
                      balance: balanceDaysText(leave.currentBalance),
                    })
                  : t('workflow.leaveDiscretionary.hintOff')}
              </div>
            </div>
          )}

          {/* ALWAYS visible — only its "(required)" changes with the decision. */}
          <div className="form-field">
            <Textarea
              label={
                <>
                  {isWithdrawOnly ? 'Why are you withdrawing?' : 'Note'}{' '}
                  <span className="form-optional">
                    {/* The discretionary case says WHAT the note is for, not just that it is
                        required — "(required)" on its own beside a box somebody has just ticked
                        reads as a rule, where this reads as the question being asked. */}
                    {discretionaryNoteRequired
                      ? `(${t('workflow.leaveDiscretionary.noteRequiredLabel')})`
                      : isWithdrawOnly || selected?.requiresComment || redistributingNow
                        ? '(required)'
                        : '(optional)'}
                  </span>
                </>
              }
              value={note}
              minRows={3}
              disabled={submitting}
              onChange={(e) => setNote(e.currentTarget.value)}
            />
            {redistributingNow && (
              <div className="hint">
                Required: you are changing the split, so the record has to say why.
              </div>
            )}
            {/* Said under the box as well as in the label, because the label changed while the
                reader was looking at the checkbox above it, not at the note. */}
            {discretionaryNoteRequired && (
              <div className="hint">{t('workflow.leaveDiscretionary.noteRequiredHint')}</div>
            )}
          </div>

          {/* THE SIGNATURE — present outright when policy demands one. */}
          {needsPassword && (
            <div className="form-field">
              {/* The database's own wording, verbatim. */}
              <p className="wf-sign-explain">
                {change && withdrawNeedsPassword && !(!isWithdrawOnly && newDecisionNeedsPassword)
                  ? 'Undoing a signed decision must itself be signed with your password.'
                  : (signature?.explanation ?? 'This decision must be signed with your password.')}
              </p>

              {mySignature?.hasSignature ? (
                <div className="wf-my-sig">
                  <span className="wf-my-sig-label">Your signature</span>
                  <MySignatureImage version={mySignature.updatedAt} />
                </div>
              ) : (
                <p className="hint" style={{ marginTop: 0 }}>
                  No signature image on file.
                </p>
              )}

              <PasswordInput
                id="wf-decide-pw"
                label="Your password"
                autoComplete="off"
                value={password}
                disabled={submitting}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
            </div>
          )}
        </>
      )}

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {splitIncomplete && (
        <p className="hint" style={{ textAlign: 'end', marginTop: 0 }}>
          {zeroShare
            ? 'Every share must be above zero — remove anyone who gets nothing.'
            : 'Share out every currency in full to approve.'}
        </p>
      )}
      {minutesMissing && (
        <p className="hint" style={{ textAlign: 'end', marginTop: 0 }}>
          State the minutes to approve.
        </p>
      )}
      {signedAmountMissing && (
        <p className="hint" style={{ textAlign: 'end', marginTop: 0 }}>
          {standingAmount == null
            ? 'The requested figures could not be loaded, so there is nothing to sign. Close and reopen this.'
            : isSalaryAdvance && grantSigned != null
              ? 'State the monthly deduction.'
              : 'State the amount to approve.'}
        </p>
      )}

      {/* SHORT NOTICE, last thing before the buttons. The same advisory the request page carries,
          repeated HERE because this is the moment it matters: a signer who never opened the detail
          page would otherwise approve without ever being told. Shown whatever the chosen decision
          is — it is a fact about the request, not about the answer — and it blocks nothing. */}
      {isLeave && leave?.noticeShorterThanPreferred && (
        <div className="wf-balance-warn" role="status" style={{ marginBottom: 12 }}>
          {t('workflow.leaveNotice.short', {
            given: leave.noticeGivenDays,
            preferred: leave.noticePreferredDays,
          })}
        </div>
      )}

      <div className="form-actions">
        <Button variant="default" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        {(selected || isWithdrawOnly) && (
          <Button
            onClick={() => void submit()}
            loading={submitting}
            disabled={submitting || splitIncomplete || minutesMissing || signedAmountMissing}
          >
            {submitting
              ? 'Working…'
              : needsPassword
                ? `Sign and ${actWord.toLowerCase()}`
                : actWord}
          </Button>
        )}
      </div>
    </Modal>
  )
}
