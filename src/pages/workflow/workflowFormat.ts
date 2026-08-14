import type {
  ActiveDefinitionStep,
  RequestHeader,
  RequestStep,
  WorkflowStep,
} from '../../types/workflow'
import { t } from '../../i18n/t'
import { currentLocale } from '../../i18n'
import './workflow.css'

/** Adapts the active-definition / definition step shapes into the ChainFlow's minimal shape. */
export function toFlowSteps(
  steps: (ActiveDefinitionStep | WorkflowStep)[],
): {
  stepNo: number
  name: string
  approverType: string
  approverRoleName?: string | null
  escalationLevels?: number | null
  resolvedApproverName?: string | null
}[] {
  return steps.map((s) => ({
    stepNo: s.stepNo,
    name: s.name,
    approverType: s.approverType,
    approverRoleName: 'approverRoleName' in s ? s.approverRoleName : null,
    escalationLevels: s.escalationLevels ?? null,
    // Only the active-definition step carries a resolved person (from a per-employee read).
    resolvedApproverName: 'resolvedApproverName' in s ? s.resolvedApproverName : null,
  }))
}

/* ── status colour system — one meaning everywhere ── */

/**
 * The chip class for a request/step status. Skipped is slate, never red — a skip is healthy. OnHold
 * is BLUE, never amber or red: a hold is a deliberate, legitimate pause, not overdue and not broken.
 */
export function statusChipClass(status: string): string {
  switch (status) {
    case 'Pending':
      return 'wf-chip wf-chip--pending'
    case 'OnHold':
      return 'wf-chip wf-chip--onhold'
    case 'Approved':
      return 'wf-chip wf-chip--approved'
    case 'Rejected':
      return 'wf-chip wf-chip--rejected'
    case 'Cancelled':
      return 'wf-chip wf-chip--cancelled'
    case 'Skipped':
      return 'wf-chip wf-chip--skipped'
    default:
      return 'wf-chip wf-chip--cancelled'
  }
}

/**
 * The status class for a grid row — a light background fill across the whole row.
 *
 * It was a 3px left rail, on the argument that a tint makes every cell harder to read. The tints
 * chosen here are light enough that the argument no longer bites (the darkest is a few per cent off
 * white, against #2E2E2A text), and a full-width fill is legible at a glance from the far end of a
 * wide row — which a 3px edge marker, scrolled off to the left, is not.
 *
 * Lives beside {@link statusChipClass} on purpose: the fill and the chip are the same status in two
 * shapes, and keeping the two switches adjacent is what stops one gaining a case the other lacks.
 * Both fall through to the cancelled grey, so one unknown status has one appearance — which is also
 * how a Withdrawn row gets the grey it shares with Cancelled without needing a case of its own.
 */
export function statusRowClass(status: string): string {
  switch (status) {
    case 'Pending':
      return 'wf-row-status wf-row-status--pending'
    case 'OnHold':
      return 'wf-row-status wf-row-status--onhold'
    case 'Approved':
      return 'wf-row-status wf-row-status--approved'
    case 'Rejected':
      return 'wf-row-status wf-row-status--rejected'
    default:
      return 'wf-row-status wf-row-status--cancelled'
  }
}

/**
 * A recorded DECISION code as words — 'ApprovedWithChanges' reads as 'Approved with changes'. The
 * step stores the code the approver chose, which says more than the resulting status does: a step
 * whose status is merely 'Approved' may have been approved *with changes*, and the chain should say
 * so. Only shown where it adds something the status has not already said.
 */
export function decisionLabel(code: string): string {
  // A KNOWN code gets its translation; anything else falls back to de-camel-casing the code, which
  // is what kept a decision type nobody had written UI for readable. That fallback is English by
  // construction — it is the database's own identifier — and that is the honest thing to show.
  const known = t(`workflow.decision.${code}`)
  if (known !== `workflow.decision.${code}`) return known
  const spaced = code.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

/** A status string as a human label — 'OnHold' reads as 'On hold', 'RestDay' as 'Rest day'. */
export function statusLabel(status: string): string {
  // Same shape as decisionLabel: translate what we know, show the raw code for what we do not, so a
  // status added to the database later renders as itself rather than as a missing-key placeholder.
  const key = `workflow.status.${status}`
  const label = t(key)
  return label === key ? status : label
}

/* ── time & duration ── */

/** A TIME value ('12:00:00' or '2026-07-14T12:00:00') as 'HH:mm'. */
export function clockTime(value: string | null | undefined): string {
  if (!value) return '—'
  const t = value.includes('T') ? value.split('T')[1] : value
  return t ? t.slice(0, 5) : '—'
}

/** A date/timestamp as a plain date. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '—'
  return value.slice(0, 10)
}

/** A UTC timestamp as a readable local date-and-time. */
export function dateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value.endsWith('Z') ? value : `${value}Z`)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString(currentLocale())
}

/** A byte count as '12 KB' / '3.4 MB' — for a file list, never precise-to-the-byte. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return t('common.bytes', { count: bytes })
  const kb = bytes / 1024
  if (kb < 1024) return t('common.kilobytes', { count: Math.round(kb) })
  return t('common.megabytes', { value: (kb / 1024).toFixed(1) })
}

/** Minutes as 'Nh Nm'. */
export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return t('common.minutesOnly', { minutes: m })
  return t('common.hoursMinutes', { hours: h, minutes: m })
}

/**
 * "2h 0m — about 0.25 of a working day". The day length is the configured standard (8h by default);
 * shown so a requester sees the leave impact of the hours they are asking for.
 */
export function minutesWithDayFraction(minutes: number, standardHours = 8): string {
  const fraction = minutes / (standardHours * 60)
  return t('workflow.dayFraction', {
    duration: durationText(minutes),
    fraction: fraction.toFixed(2),
  })
}

/** Minutes between two 'HH:mm' times, or null if the order is wrong. */
export function minutesBetween(from: string, to: string): number | null {
  if (!from || !to) return null
  const [fh, fm] = from.split(':').map(Number)
  const [th, tm] = to.split(':').map(Number)
  const mins = th * 60 + tm - (fh * 60 + fm)
  return mins > 0 ? mins : null
}

/* ── inbox ageing — the one place colour should nag ── */

export interface Ageing {
  cardClass: string
  label: string
  labelRed: boolean
}

export function ageing(daysWaiting: number): Ageing {
  // One plural-aware key for every branch — the thresholds decide the COLOUR, not the wording.
  const label =
    daysWaiting <= 0
      ? t('workflow.ageing.today')
      : t('workflow.ageing.waiting', { count: daysWaiting })

  if (daysWaiting >= 6) {
    return { cardClass: 'wf-card wf-card--age-red', label, labelRed: true }
  }
  if (daysWaiting >= 3) {
    return { cardClass: 'wf-card wf-card--age-amber', label, labelRed: false }
  }
  return { cardClass: 'wf-card', label, labelRed: false }
}

/* ── step state in the stepper ── */

export type StepState =
  | 'done'
  | 'current'
  | 'onhold'
  | 'waiting'
  | 'notreached'
  | 'skipped'
  | 'rejected'
  | 'advisory'

/**
 * The visual state of a materialised step. 'current' is the one the request is waiting on, and the
 * only thing that animates. 'onhold' is a deliberate blue pause. A rejection that was OVERRULED (an
 * advisory step whose chain continued) is 'advisory' — "did not recommend", hollow red — because the
 * request is still alive; solid red would say it is dead. A skipped step is its own slate/dashed state.
 */
export function stepState(step: RequestStep, header: RequestHeader): StepState {
  if (step.status === 'Approved') return 'done'
  if (step.status === 'Rejected') return step.wasOverruled ? 'advisory' : 'rejected'
  if (step.status === 'Skipped') return 'skipped'
  if (step.status === 'OnHold') return 'onhold'

  // Pending means SOMEBODY OWES A DECISION. On a closed request nobody does — a step still marked
  // Pending was simply never reached, and must not read as if it is waiting on someone.
  const requestOpen = header.status === 'Pending' || header.status === 'OnHold'
  if (!requestOpen) return 'notreached'

  // The step the request is waiting on is 'current'; the rest are still to come.
  if (header.currentStepNo === step.stepNo) return 'current'
  return 'waiting'
}

/** A step's approver, in words — "Joe Khoury" for a resolved person, "anyone in HR" for a role. */
export function approverText(step: {
  approverType: string
  resolvedUsername?: string | null
  approverRoleName?: string | null
  escalationLevels?: number | null
  resolvedApproverName?: string | null
}): string {
  if (step.approverType === 'BranchManager')
    return step.resolvedUsername
      ? t('workflow.approver.branchManagerNamed', { name: step.resolvedUsername })
      : t('workflow.approver.branchManager')
  if (step.approverType === 'Role')
    return step.approverRoleName
      ? t('workflow.approver.anyoneInRole', { role: step.approverRoleName })
      : t('workflow.approver.aRole')
  if (step.approverType === 'LineManager') {
    const levels = step.escalationLevels ?? 1
    // "Line manager" for the direct one, "Line manager (2 levels up)" beyond it; and if the read
    // resolved it for a specific requester, name the actual person.
    const base =
      levels <= 1
        ? t('workflow.approver.lineManager')
        : t('workflow.approver.lineManagerLevels', { count: levels })
    return step.resolvedApproverName
      ? t('workflow.approver.lineManagerNamed', { base, name: step.resolvedApproverName })
      : base
  }
  return step.resolvedUsername ?? t('workflow.approver.specificPerson')
}
