/**
 * WHAT THE RUN AND PAYSLIP PAGES OFFER, mirrored from the procedures of docs/103_qa3_payroll.sql in the API
 * so a button appears exactly where the server would honour it. The server stays the lock: every refusal
 * still arrives as its own sentence and is shown as it is.
 *
 *   - Approving and locking is the OWNER's act (QA3 PAY-12 / WEB-15). PAYROLL_APPROVE lets a caller reach
 *     the endpoint; usp_PayrollRun_Approve then admits the Owner role alone — so the page offers the button
 *     to the Owner only, instead of to a General Manager who would meet "Only the Owner approves".
 *   - A PRIMARY run is locked once its last day is over in Beirut (QA3 PAY-3). Before that, only as an
 *     EARLY LOCK the Owner asks for explicitly — the page says what an early lock leaves out and sends
 *     { allowEarlyLock: true } only after the Owner confirmed it.
 *   - A run whose inputs changed since it was generated is OUT OF DATE (QA3 PAY-5 / REL-3): the server
 *     names each employee and source, the page lists them and offers Regenerate to whoever may.
 *   - Recording a payment is PAYROLL_APPROVE (QA3 WEB-14); an employee reading their own payslip gets no
 *     links into the payroll pages they cannot open.
 *
 * No imports but types, and nothing that reads the browser: `npm test` runs this with Node alone.
 */
import type { PayrollRunStaleInput, PayrollRunStaleSource } from '../../types/payroll'

/** The company's day. A period is "over" when its last day has ended in Beirut — in SQL and here. */
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

/** YYYY-MM-DD minus one day (calendar arithmetic on the date alone, no time zone involved). */
export function dayBefore(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** YYYY-MM-DD plus one day. */
export function dayAfter(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** The role name usp_PayrollRun_Approve admits (payroll.fn_UserHasRole(..., N'Owner')). */
export const OWNER_ROLE = 'Owner'

/** Is the Approve & lock button worth showing? PAYROLL_APPROVE AND the Owner role — the procedure's own test. */
export function canOfferApprove(roles: readonly string[] | null | undefined, hasApprovePermission: boolean): boolean {
  return hasApprovePermission && (roles ?? []).includes(OWNER_ROLE)
}

/**
 * Would approving this run NOW be an early lock? A primary whose last day is today or later, in Beirut.
 * A supplemental is never early: it pays signed adjustments and nothing that happens later in the month.
 */
export function isEarlyLock(run: { runType: string; periodEnd: string }, now: Date): boolean {
  if (run.runType !== 'Primary') return false
  return beirutDay(now) <= run.periodEnd.slice(0, 10)
}

/**
 * The last day an early lock pays from attendance: the day the run's last generation counted up to, or
 * — never generated with the cut-off recorded — yesterday in Beirut (the procedure's own fallback).
 */
export function earlyLockCutoff(generatedUpTo: string | null | undefined, now: Date): string {
  return generatedUpTo ? generatedUpTo.slice(0, 10) : dayBefore(beirutDay(now))
}

/**
 * The approve call's body. The flag is true only when the lock IS early and the Owner confirmed it — a
 * confirmation left ticked from an earlier visit never turns an ordinary lock into an early one.
 */
export function approveBody(early: boolean, earlyLockConfirmed: boolean): { allowEarlyLock: boolean } {
  return { allowEarlyLock: early && earlyLockConfirmed }
}

/** The sources in the order the banner names them; translation keys are payroll.run.source.<Source>. */
export const STALE_SOURCE_ORDER: readonly PayrollRunStaleSource[] = [
  'Missing', 'NotInRun', 'Employee', 'Salary', 'Attendance', 'Roster', 'Leave', 'Overtime', 'Tips',
  'Expenses', 'Adjustments', 'Advances', 'Separation', 'Payout', 'Settings',
]

export interface StalePerson {
  employeeId: number
  name: string
  sources: PayrollRunStaleSource[]
}

export interface StaleSummary {
  /** Nothing changed: no banner. */
  isStale: boolean
  /** A run-wide input changed (settings, NSSF / tax, types, holidays, roster approvals, rates). */
  runWide: boolean
  /** The employees to name, by name, at most `maxPeople` of them. */
  people: StalePerson[]
  /** How many more employees changed than are named. */
  morePeople: number
  /** Every employee with a change. */
  peopleCount: number
}

function sourceRank(source: string): number {
  const i = STALE_SOURCE_ORDER.indexOf(source as PayrollRunStaleSource)
  return i < 0 ? STALE_SOURCE_ORDER.length : i
}

/**
 * The banner's content from GET /api/payroll/runs/{id}/staleness: one entry per employee (sources in a
 * fixed order, each once), employees by name, the run-wide "Settings" row set apart.
 */
export function summarizeStaleness(items: readonly PayrollRunStaleInput[] | null | undefined, maxPeople = 6): StaleSummary {
  const byEmployee = new Map<number, StalePerson>()
  let runWide = false
  for (const item of items ?? []) {
    if (item.employeeId == null) {
      runWide = true
      continue
    }
    const person = byEmployee.get(item.employeeId)
      ?? { employeeId: item.employeeId, name: item.employeeName ?? `#${item.employeeId}`, sources: [] }
    if (!person.sources.includes(item.source)) person.sources.push(item.source)
    byEmployee.set(item.employeeId, person)
  }
  const everyone = [...byEmployee.values()]
    .map((p) => ({ ...p, sources: [...p.sources].sort((a, b) => sourceRank(a) - sourceRank(b)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    isStale: runWide || everyone.length > 0,
    runWide,
    people: everyone.slice(0, Math.max(0, maxPeople)),
    morePeople: Math.max(0, everyone.length - Math.max(0, maxPeople)),
    peopleCount: everyone.length,
  }
}

/** Record payment: PAYROLL_APPROVE, an approved run, and nothing recorded yet. */
export function canRecordPayment(hasApprovePermission: boolean, runStatus: string, paidAt: string | null | undefined): boolean {
  return hasApprovePermission && runStatus === 'Approved' && !paidAt
}

/**
 * The two nets of a payslip as separate figures, the zero one left out — currencies are never merged.
 * A payslip that pays nothing still says so: [] is "nothing", which the page prints as 0 USD.
 */
export function netParts(p: { netUsd: number; netLbp: number }): { currency: 'USD' | 'LBP'; amount: number }[] {
  const parts: { currency: 'USD' | 'LBP'; amount: number }[] = []
  if (p.netUsd !== 0) parts.push({ currency: 'USD', amount: p.netUsd })
  if (p.netLbp !== 0) parts.push({ currency: 'LBP', amount: p.netLbp })
  return parts
}
