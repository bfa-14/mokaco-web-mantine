import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ActionIcon, Button, Checkbox, Loader, Modal, Textarea, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconArrowBackUp, IconPrinter, IconRestore } from '@tabler/icons-react'
import { DirectionalIcon } from '../../components/dxIcons'
import { PageHelp } from '../../components/PageHelp'
import { useLive } from '../../live/useLive'
import { useLiveEnabled } from '../../live/useLiveSettings'
import { getErrorMessage, isForbidden } from '../../api/errorMessage'
import { AccessDenied } from '../AccessDenied'
import { useAuth } from '../../auth/useAuth'
import {
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
  tipDistributionsService,
} from '../../services/workflowService'
import type { ExpensePayload } from '../../services/workflowService'
import type {
  DecisionOption,
  DraftDecision,
  ExitPermissionDetail,
  LeaveRequestPayload,
  MySignature,
  OnboardingPayload,
  OnboardingTask,
  OvertimePayload,
  PayrollAdjustmentPayload,
  RequestDetail,
  RequestReversal,
  RequestStep,
  SalaryAdvancePayload,
  SeparationPayload,
  SignatureLogEntry,
  SignatureRequirement,
  TipDistributionPayload,
} from '../../types/workflow'
import { WF } from '../../types/workflow'
import { RequestStepper, StatusChip } from './workflowShared'
import { DecidePopup } from './DecidePopup'
import { RequestDocuments } from './RequestDocuments'
import { SeparationSettlement } from './SeparationSettlement'
import { balanceDaysText } from './newRequestShared'
import {
  clockTime,
  dateTime,
  decisionLabel,
  durationText,
  shortDate,
  statusLabel,
} from './workflowFormat'

/** The exit-permission payload, with the approved/actual/variance comparison once the day exists. */
function ExitPayload({ payload }: { payload: ExitPermissionDetail }) {
  const hasAttendance = payload.attendanceId != null
  const approved = payload.exitApprovedMinutes
  const actual = payload.exitActualMinutes
  const variance = payload.exitVarianceMinutes

  return (
    <div className="card">
      <div className="card-title">Exit permission</div>
      <div className="detail-grid">
        <div className="detail">
          <span className="detail-label">Date</span>
          <span className="detail-value">{shortDate(payload.exitDate)}</span>
        </div>
        <div className="detail">
          <span className="detail-label">Time</span>
          <span className="detail-value">
            {clockTime(payload.fromTime)}–{clockTime(payload.toTime)} (
            {durationText(payload.requestedMinutes)})
          </span>
        </div>
        <div className="detail">
          <span className="detail-label">Minutes</span>
          {/* Requested vs granted: both, but the second line only once they differ. */}
          <span className="detail-value">
            {payload.requestedMinutes} min requested
            {payload.wasReduced && (
              <>
                <br />
                <span style={{ color: '#b7791f' }}>
                  granted {payload.approvedMinutes} of {payload.requestedMinutes} requested
                </span>
              </>
            )}
          </span>
        </div>
        <div className="detail">
          <span className="detail-label">Convert to leave</span>
          <span className="detail-value">
            {payload.convertToLeave ? 'Yes — comes out of annual leave' : 'No — a pay matter'}
          </span>
        </div>
        <div className="detail">
          <span className="detail-label">Reason</span>
          <span className="detail-value">{payload.reason}</span>
        </div>
      </div>

      {/* Approved vs actual vs variance — a comparison, once attendance has recorded the day. */}
      {hasAttendance && approved != null && actual != null && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div className="detail-label" style={{ marginBottom: 6 }}>
            What attendance recorded
          </div>
          <div className="wf-compare">
            <span>Approved {approved} min</span>
            <span className="sep">·</span>
            <span>Actual {actual} min</span>
            {variance != null && variance !== 0 && (
              <>
                <span className="sep">·</span>
                <span style={{ color: variance > 0 ? '#b7791f' : 'var(--ink-muted)' }}>
                  {Math.abs(variance)} min {variance > 0 ? 'more than' : 'less than'} approved
                </span>
              </>
            )}
          </div>
        </div>
      )}
      {!hasAttendance && (
        <p className="hint" style={{ marginBottom: 0 }}>
          The attendance day has not been recorded yet, so there is nothing to compare against.
        </p>
      )}
    </div>
  )
}

/**
 * The leave payload: what was asked for, what was granted, and where that leaves the balance.
 *
 * REQUESTED AND APPROVED ARE SHOWN SEPARATELY and only converge once a decision has been made — an
 * approver may grant fewer days, and a panel showing one figure would hide that entirely. The dates
 * are NOT trimmed when fewer days are granted: the person still asked to be away over that range,
 * and the ledger, not the calendar, carries the reduction.
 */
function LeavePayload({ payload }: { payload: LeaveRequestPayload }) {
  const granted = payload.daysApproved
  const wasReduced = granted != null && granted < payload.daysRequested
  const posted = payload.appliedToLedgerAt != null

  return (
    <div className="card">
      <div className="card-title">Leave request</div>
      <div className="detail-grid">
        <div className="detail">
          <span className="detail-label">Leave type</span>
          <span className="detail-value">
            {payload.leaveTypeName}
            {!payload.isPaid && <span className="form-optional"> (unpaid)</span>}
          </span>
        </div>
        <div className="detail">
          <span className="detail-label">Dates</span>
          <span className="detail-value">
            {shortDate(payload.fromDate)} — {shortDate(payload.toDate)}
          </span>
        </div>
        <div className="detail">
          <span className="detail-label">Days</span>
          {/* Requested vs granted: both, but the second line only once they differ. */}
          <span className="detail-value">
            {balanceDaysText(payload.daysRequested)} requested
            {granted != null && (
              <>
                <br />
                <span style={{ color: wasReduced ? '#b7791f' : undefined }}>
                  {wasReduced
                    ? `granted ${balanceDaysText(granted)} of ${balanceDaysText(payload.daysRequested)} requested`
                    : `granted ${balanceDaysText(granted)}`}
                </span>
              </>
            )}
          </span>
        </div>
        <div className="detail">
          <span className="detail-label">{payload.leaveTypeName} balance</span>
          <span
            className="detail-value"
            style={payload.currentBalance < 0 ? { color: '#b7791f' } : undefined}
          >
            {balanceDaysText(payload.currentBalance)}
            {payload.currentBalance < 0 && ' — negative'}
          </span>
        </div>
        {/* Only for a relation-capped type. Absent everywhere else rather than shown as a dash —
            "Relation: —" on annual leave invites the question of what was missed. */}
        {payload.relationToEmployee && (
          <div className="detail">
            <span className="detail-label">Relation</span>
            <span className="detail-value">{payload.relationToEmployee}</span>
          </div>
        )}
        {payload.reason && (
          <div className="detail">
            <span className="detail-label">Reason</span>
            <span className="detail-value">{payload.reason}</span>
          </div>
        )}
      </div>

      {/* THE CERTIFICATE GATE, said before it bites. usp_LeaveRequest_Decide counts attachments and
          refuses to approve without one, so this is the same count and the same rule — shown here
          so the requester can act on it, instead of an approver meeting it at the moment they sign. */}
      {payload.requiresCertificate && payload.attachmentCount === 0 && (
        <div className="wf-cert-note" style={{ marginTop: 12 }}>
          <strong>No certificate attached.</strong> {payload.leaveTypeName} leave cannot be approved
          until a document is attached to this request — add one below.
        </div>
      )}

      {/* Whether the days have actually LEFT the balance yet. They are deducted at final approval,
          not at submit, so until then the balance above is untouched and saying so avoids the
          reasonable assumption that asking has already cost something. */}
      <p className="hint" style={{ marginBottom: 0 }}>
        {posted
          ? `Deducted from the balance on ${dateTime(payload.appliedToLedgerAt)}.`
          : 'Nothing has been deducted yet — days come out of the balance when the request is fully approved.'}
      </p>
    </div>
  )
}

/** Money as the tip tables print it: two decimals and thousands separators, code in the header. */
function tipMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/** "3 August 2026" — parsed as a LOCAL date, so a shift date never slips to the day before. */
function longDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return value.slice(0, 10)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * The split PIVOTED — one row per person, one column per pooled currency.
 *
 * The lines arrive one per person PER CURRENCY, which is the shape the arithmetic needs but not the
 * shape a person reads: nobody wants to hunt two lists to learn what Ali got. Pivoting here also
 * produces the thing worth proving on a money document — a total per currency that equals the pool.
 *
 * TOTALS ARE COMPARED IN INTEGER MINOR UNITS. 6.67 + 6.67 + 6.66 is not 20 in binary floating point,
 * and a red "does not match" on a split that is provably whole would discredit the one check this
 * table exists to make.
 */
function pivotTips(payload: TipDistributionPayload) {
  const currencies = payload.amounts.map((a) => a.currencyCode)
  const cents = (v: number) => Math.round(v * 100)

  // Insertion order = the order the lines came in, which is the procedure's (currency, name) order.
  const people = new Map<number, { employeeId: number; fullName: string; amounts: (number | null)[] }>()
  for (const line of payload.lines) {
    let row = people.get(line.employeeId)
    if (!row) {
      row = {
        employeeId: line.employeeId,
        fullName: line.fullName,
        amounts: currencies.map(() => null),
      }
      people.set(line.employeeId, row)
    }
    const column = currencies.indexOf(line.currencyCode)
    // A currency on a line that is not in the pool cannot happen through the app — the procedure
    // refuses it — but it must not silently vanish if the data was edited outside it.
    if (column >= 0) row.amounts[column] = (row.amounts[column] ?? 0) + line.amount
  }

  const rows = Array.from(people.values())
  const totals = currencies.map((_, i) =>
    rows.reduce((sum, r) => sum + cents(r.amounts[i] ?? 0), 0),
  )
  const pool = payload.amounts.map((a) => cents(a.amount))

  return {
    currencies,
    rows,
    totals: totals.map((c) => c / 100),
    pool: pool.map((c) => c / 100),
    matches: totals.map((t, i) => t === pool[i]),
    allMatch: totals.every((t, i) => t === pool[i]),
  }
}

/**
 * The same pivot, for PAPER.
 *
 * A separate rendering rather than the screen panel with print CSS over it, because the two are
 * genuinely different documents: no card, no colour (a red total that prints grey says nothing, so
 * the mismatch is spelled out in words), and a real <thead> so a long split repeats its header on the
 * second page. The arithmetic is shared — it comes from pivotTips — so the two can never disagree.
 */
function PrintTipTable({ payload }: { payload: TipDistributionPayload }) {
  const pivot = pivotTips(payload)
  if (pivot.rows.length === 0) return null

  return (
    <table className="wf-print-table">
      <thead>
        <tr>
          <th scope="col">Person</th>
          {pivot.currencies.map((code) => (
            <th scope="col" key={code} className="wf-print-num">
              {code}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {pivot.rows.map((row) => (
          <tr key={row.employeeId}>
            <td>{row.fullName}</td>
            {row.amounts.map((amount, i) => (
              <td key={pivot.currencies[i]} className="wf-print-num">
                {amount == null ? '—' : tipMoney(amount)}
              </td>
            ))}
          </tr>
        ))}
        <tr className="wf-print-total">
          <td>Total</td>
          {pivot.totals.map((total, i) => (
            <td key={pivot.currencies[i]} className="wf-print-num">
              {tipMoney(total)}
            </td>
          ))}
        </tr>
        {!pivot.allMatch && (
          <tr>
            <td colSpan={pivot.currencies.length + 1}>
              Does not match the pool:{' '}
              {pivot.currencies
                .map((code, i) =>
                  pivot.matches[i] ? null : `${code} pooled ${tipMoney(pivot.pool[i])}`,
                )
                .filter(Boolean)
                .join('; ')}
              .
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

/**
 * The tip payload: the pool per currency, and who gets what out of it.
 *
 * A MONEY DOCUMENT, so it proves itself: the total row is computed from the lines and shown against
 * the pool. Equal is green, unequal is red. It cannot differ unless the rows were edited outside the
 * app — which is exactly why showing it is worth the space.
 */
function TipPayload({ payload }: { payload: TipDistributionPayload }) {
  const header = payload.header
  if (!header) return null
  const pivot = pivotTips(payload)

  return (
    <div className="card">
      <div className="wf-tip-head">
        <h2 className="card-title" style={{ marginBottom: 0 }}>
          Tips · {header.branchName} · {longDate(header.shiftDate)}
        </h2>
        {header.finalizedAt && (
          <span className="wf-tip-final" title={`Finalized ${dateTime(header.finalizedAt)}`}>
            Finalized ✓
          </span>
        )}
      </div>

      <div className="wf-tip-pool">
        <span className="wf-tip-pool-label">Pool</span>
        <span>
          {payload.amounts
            .map((a) => `${tipMoney(a.amount)} ${a.currencyCode}`)
            .join('  ·  ')}
        </span>
      </div>

      {pivot.rows.length === 0 ? (
        <p className="hint" style={{ marginBottom: 0 }}>No shares recorded.</p>
      ) : (
        <table className="wf-tip-table">
          <thead>
            <tr>
              <th scope="col">Person</th>
              {/* The code sits on the COLUMN, not on every cell — repeating "USD" down a column of
                  figures is noise that makes the figures harder to compare. */}
              {pivot.currencies.map((code) => (
                <th scope="col" key={code} className="wf-tip-num">
                  {code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pivot.rows.map((row) => (
              <tr key={row.employeeId}>
                <td>{row.fullName}</td>
                {row.amounts.map((amount, i) => (
                  <td key={pivot.currencies[i]} className="wf-tip-num">
                    {amount == null ? '—' : tipMoney(amount)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={pivot.allMatch ? 'wf-tip-total' : 'wf-tip-total wf-tip-total--off'}>
              <td>Total</td>
              {pivot.totals.map((total, i) => (
                <td key={pivot.currencies[i]} className="wf-tip-num">
                  {tipMoney(total)}
                  {!pivot.matches[i] && (
                    <span className="wf-tip-mismatch">
                      {' '}
                      of {tipMoney(pivot.pool[i])}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      )}

      {/* Whether payroll may act on these figures yet. Lines exist from the moment the request is
          raised, so without this the panel reads as if the money were already settled. */}
      <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
        {header.finalizedAt
          ? `Finalized on ${dateTime(header.finalizedAt)} — payroll consumes these figures.`
          : 'Not finalized yet — these figures are settled when the request is fully approved, and an approver may still restate them.'}
      </p>
    </div>
  )
}

/**
 * The overtime payload: what was asked for, what is capped, and what was actually worked.
 *
 * THREE FIGURES THAT ARE NOT THE SAME THING, and conflating them is how overtime gets paid wrong:
 * the APPROVED figure is a ceiling, the DETECTED figure is what attendance observed, and payroll pays
 * the LESSER of the two. Neither approving nor working alone earns anything.
 *
 * Everything below the cap is null until the day has been processed, and this says so rather than
 * rendering zeros — "0 minutes worked" and "not yet known" look identical as a number and mean
 * opposite things.
 */
/**
 * PAYROLL ADJUSTMENT — the claim, and how far it has travelled.
 *
 * The three badges at the foot are the whole point of showing this panel after approval. A
 * correction is not finished when it is signed: the signature writes a LEDGER ROW, and the row is
 * not money until the target period's run is locked and consumes it. Those are three distinct
 * states, and collapsing them into "approved" is how somebody concludes a person has been paid
 * when the run has not been generated yet.
 *
 * The amount is rendered WITH THE COMPONENT'S SIGN. The stored figure is always positive and the
 * component decides direction, so "20.00 USD Absence Deduction" would read as money owed to the
 * employee when it is the reverse.
 */
/**
 * A figure that was TIGHTENED on its way through the chain — what was asked for, and what was
 * actually signed for.
 *
 * BOTH NUMBERS STAY ON SCREEN, and that is the point. Showing only the approved figure loses the
 * fact that somebody asked for more and was cut; showing only the requested one is a lie about what
 * will be paid. The strike-through is what makes it readable at a glance rather than a subtraction
 * the reader has to perform.
 *
 * Renders NOTHING when the two agree. An unchanged figure decorated as though it had been reduced
 * is noise, and it would train people to stop noticing the times it really was.
 */
function TightenedFigure({
  requested,
  approved,
  suffix,
  className,
}: {
  requested: number
  approved: number | null
  /** Currency or unit — "80" alone is not a fact about money. */
  suffix?: string
  className?: string
}) {
  const tail = suffix ? ` ${suffix}` : ''

  if (approved == null || approved === requested) {
    return (
      <span className={className}>
        {requested.toFixed(2)}
        {tail}
      </span>
    )
  }

  return (
    <>
      <span className="form-optional" style={{ textDecoration: 'line-through' }}>
        Requested {requested.toFixed(2)}
      </span>{' '}
      <span aria-hidden="true">→</span>{' '}
      <strong className={className}>
        Approved {approved.toFixed(2)}
        {tail}
      </strong>
    </>
  )
}

function PayrollAdjustmentPanel({ payload }: { payload: PayrollAdjustmentPayload }) {
  const sign = payload.sign < 0 ? '−' : '+'
  const negative = payload.sign < 0 ? 'pr-neg' : undefined

  // What will actually reach the payslip — the signed figure once there is one, the claim until then.
  const standing = payload.approvedAmount ?? payload.amount
  const tightened = payload.approvedAmount != null && payload.approvedAmount !== payload.amount

  return (
    <div className="card">
      <h2 className="card-title">Payroll adjustment</h2>
      <div className="detail-grid">
        <div className="detail">
          <span className="detail-label">Employee</span>
          <span className="detail-value">{payload.employeeName}</span>
        </div>
        <div className="detail">
          <span className="detail-label">Amount</span>
          <span className="detail-value">
            {tightened ? (
              // The sign belongs to the COMPONENT, so it is carried onto the approved figure too —
              // "Approved 80.00" on an Absence Deduction would otherwise read as money owed.
              <>
                <span className="form-optional" style={{ textDecoration: 'line-through' }}>
                  Requested {sign}
                  {payload.amount.toFixed(2)}
                </span>{' '}
                <span aria-hidden="true">→</span>{' '}
                <strong className={negative}>
                  Approved {sign}
                  {standing.toFixed(2)} {payload.currencyCode}
                </strong>
              </>
            ) : (
              <span className={negative}>
                {sign}
                {standing.toFixed(2)} {payload.currencyCode}
              </span>
            )}{' '}
            {payload.componentName}
          </span>
        </div>
        <div className="detail">
          <span className="detail-label">Lands in</span>
          <span className="detail-value">{payload.targetPeriod}</span>
        </div>
        {payload.correctsPeriod && (
          <div className="detail">
            <span className="detail-label">Corrects</span>
            <span className="detail-value">{payload.correctsPeriod} (locked)</span>
          </div>
        )}
        <div className="detail">
          <span className="detail-label">Reason</span>
          <span className="detail-value">{payload.reason}</span>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        {payload.createdAdjustmentId == null ? (
          <span className="pr-chip">Waiting for approval</span>
        ) : payload.appliedToPayslipId == null ? (
          <span className="pr-chip">
            Ledger row created {shortDate(payload.adjustmentCreatedAt)} — waiting for the{' '}
            {payload.targetPeriod} run
          </span>
        ) : (
          <Link to={`/payroll/payslips/${payload.appliedToPayslipId}`}>
            <span className="pr-chip pr-chip-approved">Consumed by payslip</span>
          </Link>
        )}
      </div>
    </div>
  )
}

/**
 * Salary advance — what was asked for, what was signed for, and what is still owed.
 *
 * THREE DIFFERENT MOMENTS, kept apart on purpose. The ASK is history. The SIGNED figures are what
 * the last approver committed to and what the ledger row will be written at. The REMAINING balance
 * is live from that row and falls month by month — so a request approved in March shows what is
 * still outstanding today, not what was borrowed then.
 *
 * The months figure is RECOMPUTED from the signed pair rather than read from the request, because
 * tightening either number changes how long recovery takes, and the ask's own duration stops being
 * true the moment an approver touches it.
 */
function SalaryAdvancePanel({ payload }: { payload: SalaryAdvancePayload }) {
  const amount = payload.approvedAmount ?? payload.amount
  const monthly = payload.approvedMonthlyDeduction ?? payload.monthlyDeduction
  const months = monthly > 0 ? Math.ceil(amount / monthly) : null

  return (
    <div className="card">
      <h2 className="card-title">Salary advance</h2>
      <div className="detail-grid">
        <div className="detail">
          <span className="detail-label">Employee</span>
          <span className="detail-value">{payload.employeeName}</span>
        </div>
        <div className="detail">
          <span className="detail-label">Amount</span>
          <span className="detail-value">
            <TightenedFigure
              requested={payload.amount}
              approved={payload.approvedAmount}
              suffix={payload.currencyCode}
            />
          </span>
        </div>
        <div className="detail">
          <span className="detail-label">Monthly deduction</span>
          <span className="detail-value">
            <TightenedFigure
              requested={payload.monthlyDeduction}
              approved={payload.approvedMonthlyDeduction}
              suffix={payload.currencyCode}
            />
          </span>
        </div>
        <div className="detail">
          <span className="detail-label">Recovery</span>
          <span className="detail-value">
            {months != null
              ? `over ${months} ${months === 1 ? 'month' : 'months'}, from ${payload.firstDeductionPeriod}`
              : `from ${payload.firstDeductionPeriod}`}
          </span>
        </div>
        {payload.reason && (
          <div className="detail">
            <span className="detail-label">Reason</span>
            <span className="detail-value">{payload.reason}</span>
          </div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        {payload.createdAdvanceId == null ? (
          // Nothing has been lent yet. Saying anything about a balance here would invent one.
          <span className="pr-chip">Waiting for approval — nothing has been lent yet</span>
        ) : payload.isSettled ? (
          <span className="pr-chip pr-chip-approved">Repaid in full</span>
        ) : (
          <span className="pr-chip">
            Lent {shortDate(payload.advanceCreatedAt)} —{' '}
            {payload.remainingAmount != null
              ? `${payload.remainingAmount.toFixed(2)} ${payload.currencyCode} still to recover`
              : 'recovery in progress'}
          </span>
        )}
      </div>
    </div>
  )
}

function OvertimePayloadPanel({ payload }: { payload: OvertimePayload }) {
  const capped =
    payload.approvedMinutes != null && payload.approvedMinutes < payload.requestedMinutes

  return (
    <div className="card">
      <h2 className="card-title">Overtime</h2>
      <div className="detail-grid">
        <div className="detail">
          <span className="detail-label">Work date</span>
          <span className="detail-value">{shortDate(payload.workDate)}</span>
        </div>
        <div className="detail">
          <span className="detail-label">Shift</span>
          <span className="detail-value">
            {payload.shiftName
              ? `${payload.shiftName} ${clockTime(payload.startTime)}–${clockTime(payload.endTime)}`
              : 'No rostered shift — the whole worked time counts as overtime'}
          </span>
        </div>
        <div className="detail">
          <span className="detail-label">Approved cap</span>
          <span className="detail-value">
            {payload.approvedMinutes != null
              ? durationText(payload.approvedMinutes)
              : 'Not decided yet'}
            {capped && (
              <span className="form-optional">
                {' '}
                — cut from {durationText(payload.requestedMinutes)} requested
              </span>
            )}
          </span>
        </div>
        <div className="detail">
          <span className="detail-label">Rate</span>
          <span className="detail-value">×{payload.rateMultiplier}</span>
        </div>
        {payload.reason && (
          <div className="detail">
            <span className="detail-label">Reason</span>
            <span className="detail-value">{payload.reason}</span>
          </div>
        )}
      </div>

      {payload.attendanceProcessed ? (
        <div className="detail-grid" style={{ marginTop: 14 }}>
          <div className="detail">
            <span className="detail-label">Worked</span>
            <span className="detail-value">
              {payload.workedMinutes != null ? durationText(payload.workedMinutes) : '—'}
            </span>
          </div>
          <div className="detail">
            <span className="detail-label">Detected as extra</span>
            <span className="detail-value">
              {payload.detectedOvertimeMinutes != null
                ? durationText(payload.detectedOvertimeMinutes)
                : '—'}
            </span>
          </div>
          <div className="detail">
            <span className="detail-label">Payable</span>
            <span className="detail-value">
              {payload.payableOvertimeMinutes != null
                ? durationText(payload.payableOvertimeMinutes)
                : '—'}
            </span>
          </div>
        </div>
      ) : (
        <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
          The worked day has not been processed yet, so nothing has been measured against this cap.
          Payroll pays the actual extra time worked, up to it.
        </p>
      )}
    </div>
  )
}

/** "3 Aug" — who ticked something and when, kept short enough to sit at the end of a row. */
function tickedOn(value: string): string {
  const d = new Date(value.endsWith('Z') ? value : `${value}Z`)
  return Number.isNaN(d.getTime())
    ? value.slice(0, 10)
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/**
 * THE ONBOARDING CHECKLIST — the heart of this type.
 *
 * The last approval is REFUSED while any required item is undone, so this panel is not a to-do list
 * beside the request: it is the thing that decides whether the request can close at all. Which is why
 * the progress line is loud, and why the warning above the chain says what will happen rather than
 * quietly disabling the button — the API's refusal names every outstanding item, and no disabled
 * button could tell anyone that much.
 *
 * The tasks are held HERE rather than on the page so a tick can be optimistic. On failure the row
 * goes back exactly as it was and the API's own sentence is shown — "This onboarding is closed; its
 * checklist is now history." explains itself; a generic "could not save" would not.
 */
function OnboardingPanel({
  requestId,
  payload,
  canEdit,
  onChanged,
}: {
  requestId: number
  payload: OnboardingPayload
  /** False once the request closes — the procedure refuses, so the UI must not invite the click. */
  canEdit: boolean
  /** Lets the page refetch, so the header's own counts and any decision state stay in step. */
  onChanged: () => void
}) {
  const header = payload.header
  /* Seeded from the payload and then owned here, so a tick can be optimistic. Rendered in ARRAY
     ORDER, never sorted — see the note on OnboardingTask.sortOrder, which the set-task response does
     not carry.

     RE-SEEDING IS DONE BY A key AT THE CALL SITE, not by an effect that copies the prop into state:
     the payload is refetched after every decision, and an effect doing that would be a synchronous
     setState on every arrival. The key is a signature of the server's own checklist, so a refetch
     that changed nothing remounts nothing. */
  const [tasks, setTasks] = useState<OnboardingTask[]>(payload.tasks)
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(payload.tasks.map((t) => [t.code, t.note ?? ''])),
  )
  const [busy, setBusy] = useState<string | null>(null)

  const done = tasks.filter((t) => t.completedAt != null).length
  const outstanding = tasks.filter((t) => t.isRequired && t.completedAt == null).length

  if (!header) return null

  async function save(code: string, isComplete: boolean) {
    const before = tasks
    setBusy(code)
    // OPTIMISTIC: the tick lands immediately, because a checklist that lags behind the finger reads
    // as broken. completedBy is left alone — inventing a name here would be a guess.
    setTasks((prev) =>
      prev.map((t) =>
        t.code === code
          ? {
              ...t,
              completedAt: isComplete ? new Date().toISOString() : null,
              note: notes[code] || null,
            }
          : t,
      ),
    )
    try {
      const fresh = await onboardingService.setTask(requestId, code, {
        isComplete,
        note: notes[code]?.trim() || null,
      })
      setTasks(fresh)
      setNotes(Object.fromEntries(fresh.map((t) => [t.code, t.note ?? ''])))
      onChanged()
    } catch (err) {
      // BACK EXACTLY AS IT WAS, and the API's own words — it says whether the request is closed, or
      // that the caller may not tick, and either is worth reading.
      setTasks(before)
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 6000 })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card">
      <div className="wf-onb-head">
        <h2 className="card-title" style={{ marginBottom: 0 }}>
          New hire · {header.candidateName} · {header.positionTitle} · {header.branchName} · starts{' '}
          {longDate(header.startDate)}
        </h2>
        {header.createdEmployeeId != null ? (
          <Link className="wf-onb-created" to={`/hr/employees/${header.createdEmployeeId}`}>
            Employee record created ✓
          </Link>
        ) : (
          <span className="wf-onb-pending">Created when the hire is approved</span>
        )}
      </div>

      {/* The identifiers, as they stand. An em dash is "not collected yet", which is the normal state
          early on — the checklist is what turns them into real values. */}
      <div className="wf-onb-ids">
        ID {header.nationalId || '—'} · NSSF {header.nssfNumber || '—'} · Tax{' '}
        {header.taxNumber || '—'} · Bank {header.bankAccount || '—'}
      </div>

      <div className="wf-onb-progress-row">
        <span className="form-section-title" style={{ margin: 0 }}>
          Checklist
        </span>
        <span
          className={
            outstanding > 0 ? 'wf-onb-progress wf-onb-progress--amber' : 'wf-onb-progress wf-onb-progress--green'
          }
        >
          {done} of {tasks.length} done
          {outstanding > 0 &&
            ` · ${outstanding} required item${outstanding === 1 ? '' : 's'} outstanding`}
        </span>
      </div>

      <div className="wf-onb-list">
        {tasks.map((task) => {
          const isDone = task.completedAt != null
          return (
            <div className="wf-onb-row" key={task.code}>
              <Checkbox
                checked={isDone}
                disabled={!canEdit || busy === task.code}
                onChange={(e) => void save(task.code, e.currentTarget.checked)}
                aria-label={task.name}
              />
              <div className="wf-onb-main">
                <div className="wf-onb-name">
                  <span className={isDone ? 'wf-onb-done' : undefined}>{task.name}</span>
                  {/* Only on what is still OUTSTANDING. Every seeded item is required, so tagging
                      them all would make the word stop meaning anything. */}
                  {task.isRequired && !isDone && <span className="wf-onb-required">required</span>}
                </div>
                {/* PORT NOTE: DX underlined TextBox → standard Mantine TextInput variant. */}
                <TextInput
                  value={notes[task.code] ?? ''}
                  placeholder="Note (optional)"
                  disabled={!canEdit || busy === task.code}
                  onChange={(e) => {
                    const value = e.currentTarget.value
                    setNotes((prev) => ({ ...prev, [task.code]: value }))
                  }}
                  /* Saved with the tick, AND on blur when it changed — a note typed against an item
                     nobody is toggling would otherwise be lost the moment the page reloaded. */
                  onBlur={() => {
                    if ((notes[task.code] ?? '') !== (task.note ?? '')) void save(task.code, isDone)
                  }}
                />
              </div>
              <span className="wf-onb-meta">
                {isDone && task.completedBy
                  ? `${task.completedBy} · ${tickedOn(task.completedAt!)}`
                  : isDone
                    ? tickedOn(task.completedAt!)
                    : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ────────────────────────── reversals: retract & reopen ──────────────────────────
 *
 * Two ways back from a decision that has already taken effect, and they are not the same act.
 *
 * RETRACT is the last signer changing their mind on the same UTC day — small, immediate, and theirs
 * alone. REOPEN is the General Manager and the Owner together overriding a closed request, and it
 * takes two signatures precisely because it is not small.
 *
 * WHAT THIS CODE DELIBERATELY DOES NOT DO is decide whether a reversal is allowed. It answers only
 * "is this plausibly mine to try?", because the real conditions — whether a payslip already
 * swallowed the adjustment, whether recovery of an advance has started, whether the attendance day
 * was stamped — live in the database, and its refusals NAME THE WAY OUT ("correct with a
 * counter-adjustment", "reopening needs the GM and the Owner together"). A button hidden by a
 * client-side guess would replace that sentence with silence, and silence is the one answer that
 * helps nobody.
 */

/** The two role names that may reopen. The seeded role has a SPACE; the procedures accept both. */
const REOPEN_ROLES = ['Owner', 'General Manager', 'GeneralManager']

/**
 * THE TYPES A WITHDRAWAL IS ACTUALLY ACCEPTED FOR — mirrors RequestsController.
 *
 * Exit permissions have a typed wrapper that also puts ApprovedMinutes back. The other five stamp no
 * figure when they are decided, so handing the step back is the whole of the undo and the engine's
 * own withdrawal is enough.
 *
 * The figure-stamping types (leave, expense, overtime, salary advance, payroll adjustment) are
 * deliberately absent: the generic procedure clears the step's ValueBefore without restoring the
 * payload, so withdrawing an ApprovedWithChanges would leave the changed figure standing as though
 * the next approver had chosen it. The API refuses them, so offering the button would offer a
 * failure. KEEP THIS IN STEP with the server list.
 */
const WITHDRAWABLE_TYPES = new Set([
  'EXIT_PERMISSION',
  'AVAILABILITY_CHANGE',
  'ONBOARDING',
  'SHIFT_SWAP',
  'TIP_DISTRIBUTION',
  'SEPARATION',
])

/** 'GeneralManager' reads as "General Manager" — the stored role code is not a label. */
function reversalRoleLabel(role: string | null | undefined): string {
  if (!role) return 'someone'
  if (role === 'GeneralManager') return 'General Manager'
  if (role === 'Self') return 'the signer'
  return role
}

/**
 * Whether a UTC timestamp falls on today's UTC date.
 *
 * UTC ON BOTH SIDES, deliberately. The procedure compares
 * `CAST(ActedAt AS DATE) <> CAST(SYSUTCDATETIME() AS DATE)`, so a local-time comparison here would
 * disagree with it for part of every day — offering Retract on something the server then refuses,
 * or hiding it on something the server would have allowed. Timestamps arrive without a suffix and
 * are UTC, hence the 'Z'.
 */
function isSameUtcDayAsNow(value: string | null | undefined): boolean {
  if (!value) return false
  const at = new Date(value.endsWith('Z') ? value : `${value}Z`)
  if (Number.isNaN(at.getTime())) return false
  const now = new Date()
  return (
    at.getUTCFullYear() === now.getUTCFullYear() &&
    at.getUTCMonth() === now.getUTCMonth() &&
    at.getUTCDate() === now.getUTCDate()
  )
}

/**
 * The decision a retract would actually take back — the newest signature that still STANDS.
 *
 * Mirrors usp_Request_RetractLastDecision's own pick: not retracted, a real decision (a 'Submitted'
 * row carries no step and is not one), newest by ActedAt then SignatureId. Matching the tie-break
 * matters on the day it bites — two decisions in the same second would otherwise let the page offer
 * the button against a different signature from the one the server strikes.
 */
function lastStandingDecision(history: SignatureLogEntry[]): SignatureLogEntry | null {
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

/** The reopen that is half-signed and waiting on the other of GM/Owner, if there is one. */
function pendingReopen(reversals: RequestReversal[] | undefined): RequestReversal | null {
  return reversals?.find((r) => r.kind === 'Reopen' && r.completedAt == null) ?? null
}

export default function RequestDetailPage() {
  const { id } = useParams()
  const requestId = Number(id)
  const navigate = useNavigate()
  const location = useLocation()
  // `user` as well as the permission check: the reversals are gated on WHO you are (the signer of
  // the last decision; a holder of the GM or Owner role), not on a permission code.
  const { hasPermission, user } = useAuth()

  /**
   * An advisory carried from the form that raised this request — leave at shorter notice than the
   * type prefers, for instance. It arrives with the navigation rather than as a toast because it is
   * about THIS request and deserves to still be there when the page finishes loading.
   *
   * Read once from history state; a refresh drops it, which is right: it describes the moment of
   * raising, not a standing property of the request.
   */
  const raisedNotice = (location.state as { notice?: string } | null)?.notice ?? null

  const [detail, setDetail] = useState<RequestDetail | null>(null)
  /**
   * The chain, read FOR the caller. There is deliberately NO fallback to detail.steps: getById's
   * inline chain is read without @ForUserId, so canWithdraw/canReclaim come back 0 for everybody and
   * the actions on the chain would silently never appear. A chain nobody can act on is worse than an
   * error message, so a failure here fails the page.
   */
  const [steps, setSteps] = useState<RequestStep[]>([])
  const [payload, setPayload] = useState<ExitPermissionDetail | null>(null)
  /** The leave payload, when this is a leave request. Only ever ONE of the typed payloads is set. */
  const [leavePayload, setLeavePayload] = useState<LeaveRequestPayload | null>(null)
  /** The tip payload — the pool and the per-person lines, which an approver may restate. */
  const [tipPayload, setTipPayload] = useState<TipDistributionPayload | null>(null)
  /** The overtime payload — the requested minutes and the cap now standing over them. */
  const [overtimePayload, setOvertimePayload] = useState<OvertimePayload | null>(null)
  /**
   * The expense payload. Loaded for the PRINTED record only — an expense has no screen panel yet, but
   * a printed claim that omits the amount, the category and what was actually granted is not a
   * record of anything.
   */
  const [expensePayload, setExpensePayload] = useState<ExpensePayload | null>(null)
  const [payrollAdjustmentPayload, setPayrollAdjustmentPayload] =
    useState<PayrollAdjustmentPayload | null>(null)
  const [salaryAdvancePayload, setSalaryAdvancePayload] =
    useState<SalaryAdvancePayload | null>(null)
  /** The onboarding payload — the candidate's details and the checklist that gates the final approval. */
  const [onboardingPayload, setOnboardingPayload] = useState<OnboardingPayload | null>(null)
  /** The separation payload — the notice arithmetic, and the settlement that gates the sign-off. */
  const [separationPayload, setSeparationPayload] = useState<SeparationPayload | null>(null)
  /** Known when the PAGE loads, not when a dialog opens — a signature must never surprise anyone. */
  const [signature, setSignature] = useState<SignatureRequirement | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Set when the primary load came back 403 — a deep link to a request that is not this user's. */
  const [forbidden, setForbidden] = useState(false)
  const [busy, setBusy] = useState(false)

  // The available decisions at the current step, and the caller's own saved draft (both read on load).
  const [decisions, setDecisions] = useState<DecisionOption[]>([])
  const [draft, setDraft] = useState<DraftDecision | null>(null)
  /**
   * The caller's own signature image — a fact about the PERSON, not this request, so it is read once
   * with the page and handed to the dialog. Null means none on file, which never blocks signing.
   */
  const [mySignature, setMySignature] = useState<MySignature | null>(null)
  /** True while THE shared decision dialog is open on this request's current step. */
  const [deciding, setDeciding] = useState(false)
  /** Set when CHANGING a decision already made: withdraw first, then decide again. */
  const [changeStep, setChangeStep] = useState<RequestStep | null>(null)

  // Taking back a DELEGATED step — not a withdrawal: nothing was signed, so no password.
  const [reclaimStep, setReclaimStep] = useState<RequestStep | null>(null)
  const [reclaimReason, setReclaimReason] = useState('')

  // Reopening a CLOSED request — an administrative act, not a decision, so it lives here in the page
  // header rather than in the decision popup. The reason is mandatory (the database refuses a blank).
  const [reopenOpen, setReopenOpen] = useState(false)
  const [reopenReason, setReopenReason] = useState('')

  // The two reversals. Both are page-header acts for the same reason as the reopen above: they act
  // on the REQUEST, not on a step somebody is being asked to decide.
  const [retractOpen, setRetractOpen] = useState(false)
  const [retractReason, setRetractReason] = useState('')
  const [gmReopenOpen, setGmReopenOpen] = useState(false)
  const [gmReopenReason, setGmReopenReason] = useState('')

  const load = useCallback(async () => {
    try {
      // Header + history from getById; the CHAIN from the caller-aware endpoint (@ForUserId) so
      // canWithdraw is true only where THIS user may still take their decision back. That call is
      // NOT caught: without it the chain cannot carry its actions at all.
      const [d, callerSteps, sig, decs, drf] = await Promise.all([
        requestsService.getById(requestId),
        requestsService.getSteps(requestId),
        // Signature + decisions + my draft are read WITH the page, so nothing surprises the user mid-flow.
        requestsService.getSignatureRequirement(requestId).catch(() => null),
        requestsService.getDecisions(requestId).catch(() => [] as DecisionOption[]),
        requestsService.getDraft(requestId).catch(() => null),
      ])
      setDetail(d)
      setSteps(callerSteps)
      setSignature(sig)
      setDecisions(decs)
      setDraft(drf)
      setError(null)

      // The TYPED payload, if this type has one. Each request type answers to its own endpoint;
      // a type with no form yet simply has no payload panel.
      if (d.header.requestTypeCode === 'EXIT_PERMISSION') {
        setPayload(
          await exitPermissionsService.byRequest(requestId).catch(() => null),
        )
      } else if (d.header.requestTypeCode === 'LEAVE_REQUEST') {
        setLeavePayload(
          await leaveRequestsService.payload(requestId).catch(() => null),
        )
      } else if (d.header.requestTypeCode === 'TIP_DISTRIBUTION') {
        // Reloaded by this same load() after every decision, which is what makes a restated split
        // appear: the decision rewrote the lines, and the ones on screen are the ones it replaced.
        setTipPayload(await tipDistributionsService.payload(requestId).catch(() => null))
      } else if (d.header.requestTypeCode === 'OVERTIME') {
        // Likewise for a tightened cap: every approval writes a new one, so the figure on screen is
        // only current until the next decision.
        setOvertimePayload(await overtimeService.payload(requestId).catch(() => null))
      } else if (d.header.requestTypeCode === 'EXPENSE_REIMBURSEMENT') {
        setExpensePayload(await expensesService.payload(requestId).catch(() => null))
      } else if (d.header.requestTypeCode === 'ONBOARDING') {
        setOnboardingPayload(await onboardingService.payload(requestId).catch(() => null))
      } else if (d.header.requestTypeCode === 'SEPARATION') {
        // Reloaded after every save AND every decision: preparing the settlement stamps preparedAt
        // and the server's own total, and the final approval stamps appliedAt and leaveClearedAt.
        setSeparationPayload(await separationsService.payload(requestId).catch(() => null))
      } else if (d.header.requestTypeCode === 'PAYROLL_ADJUSTMENT') {
        // Reloaded after every decision, which is what moves the lifecycle badge: the final
        // approval writes the ledger row, and the payslip id appears later still, when the target
        // period is locked. Neither is visible without re-reading the payload.
        setPayrollAdjustmentPayload(
          await payrollAdjustmentsService.payload(requestId).catch(() => null),
        )
      } else if (d.header.requestTypeCode === 'SALARY_ADVANCE') {
        // Reloaded after every decision for the same reason as the adjustment: each approval writes
        // new signed figures, and the remaining balance is live from the ledger row once one exists.
        setSalaryAdvancePayload(
          await salaryAdvancesService.payload(requestId).catch(() => null),
        )
      }

    } catch (err) {
      // A 403 on the PRIMARY load is its own outcome, not an error message: this route is open to
      // every signed-in user (anyone may read their own requests), so the only way to reach a
      // refusal here is a deep link to somebody else's. That is a permission answer, and it reads
      // as one — see the No access panel below.
      setForbidden(isForbidden(err))
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [requestId])

  // The caller's own signature image, read once — it belongs to the person, not the request.
  useEffect(() => {
    let cancelled = false
    meService
      .signature()
      .then((s) => {
        if (!cancelled) setMySignature(s)
      })
      .catch(() => {
        /* no image on file is a normal state; it must never stop anyone signing */
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // Wrapped rather than called bare: load() resolves asynchronously and only then sets state, which
    // is what keeps this out of the "setState synchronously in an effect" trap.
    async function initial() {
      await load()
    }
    void initial()
  }, [load])

  // LIVE: this is the page most likely to be open while somebody else acts on the very same
  // request — the chain, the available decisions and the status chip all move under the reader.
  // A refetch is the whole update; nothing here trusts the socket for content.
  useLive(['workflow'], () => void load(), useLiveEnabled('workflow'))

  async function submitReclaim() {
    if (!reclaimStep) return
    setBusy(true)
    try {
      await requestsService.reclaim(requestId, reclaimReason.trim() || undefined)
      setReclaimStep(null)
      setReclaimReason('')
      await load()
      notifications.show({
        message: 'Step taken back. It is waiting for you again.',
        color: 'green',
        autoClose: 3500,
      })
    } catch (err) {
      // e.g. "That step has already been decided. Ask them to withdraw their decision instead."
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 6000 })
    } finally {
      setBusy(false)
    }
  }

  /**
   * Lifts the hold. NO reason is demanded — the hold's own reason already says what was being waited
   * for, and the answer has usually just been added as a note. The API decides who may: the approver
   * who set it, or the requester answering it.
   */
  async function submitResume() {
    setBusy(true)
    try {
      await requestsService.resume(requestId)
      await load()
      notifications.show({
        message: 'Hold lifted. The step is waiting for a decision again.',
        color: 'green',
        autoClose: 3500,
      })
    } catch (err) {
      // "This request is not on hold." / "Only the approver or the person who raised this request
      // can resume it." — both name the exact rule; show them verbatim.
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 6000 })
    } finally {
      setBusy(false)
    }
  }

  async function submitReopen() {
    if (!reopenReason.trim()) {
      notifications.show({ message: 'A reason is required.', color: 'red', autoClose: 3000 })
      return
    }
    setBusy(true)
    try {
      await requestsService.reopen(requestId, reopenReason.trim())
      setReopenOpen(false)
      setReopenReason('')
      // The closed step goes back to Pending and the request re-enters flight — chain, status and the
      // Decide button for whoever owns it all change together, so refetch rather than patch.
      await load()
      notifications.show({
        message: 'Request reopened. It is back at the step that closed it.',
        color: 'green',
        autoClose: 3500,
      })
    } catch (err) {
      // An APPROVED request refuses with actual guidance ("its result is already applied — correct the
      // attendance day instead…"). That wording IS the value; show it verbatim, never a generic failure.
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 8000 })
    } finally {
      setBusy(false)
    }
  }

  /**
   * Take back my own last decision, same UTC day.
   *
   * The refusals are the point of this handler. "Only the person who signed the LAST decision may
   * retract it…", "Same-day only: this decision is from an earlier day…", "Its adjustment was
   * consumed by a locked payslip - correct with a counter-adjustment." — each names the way out, so
   * each is shown as it arrives and given long enough on screen to be read.
   */
  async function submitRetract() {
    if (!retractReason.trim()) {
      notifications.show({ message: 'A reason is required.', color: 'red', autoClose: 3000 })
      return
    }
    setBusy(true)
    try {
      const result = await requestsService.retract(requestId, retractReason.trim())
      setRetractOpen(false)
      setRetractReason('')
      // The signature is struck, the step is unsigned and the request is back in flight at that
      // step — status, chain, history and the Decide button all move together, so refetch.
      await load()
      notifications.show({
        message: `Signature struck. The request is back at step ${result.currentStepNo ?? '—'} for a fresh decision.`,
        color: 'green',
        autoClose: 4500,
      })
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 9000 })
    } finally {
      setBusy(false)
    }
  }

  /**
   * Sign a GM + Owner reopen.
   *
   * TWO OUTCOMES, and they are reported differently on purpose. 'AwaitingSecond' means NOTHING HAS
   * MOVED — the request is still closed and the other of GM/Owner must sign — so it is an info
   * toast, not a success one, and the banner that appears after the refetch is what carries the
   * state onward. Only 'Reopened' is a success.
   */
  async function submitGmReopen() {
    setBusy(true)
    try {
      const result = await requestsService.reopenWithSecondSignature(
        requestId,
        gmReopenReason.trim(),
      )
      setGmReopenOpen(false)
      setGmReopenReason('')
      await load()

      if (result.state === 'AwaitingSecond') {
        notifications.show({
          message: `Recorded. ${reversalRoleLabel(result.firstSignRole)} has signed — the other of the GM and the Owner must sign before this reopens.`,
          color: 'blue',
          autoClose: 6000,
        })
      } else {
        notifications.show({
          message: `Reopened. The last signature is struck and the request is back at step ${result.currentStepNo ?? '—'}.`,
          color: 'green',
          autoClose: 4500,
        })
      }
    } catch (err) {
      // "Only a closed (approved or rejected) request can be reopened.", "This role already signed
      // the reopen - the OTHER of GM/Owner must sign.", and the consumption blocks.
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 9000 })
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="page-loading">
        <Loader size={40} />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div>
        <div className="page-head wf-no-print">
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Back to requests"
            onClick={() => navigate('/requests')}
          >
            <DirectionalIcon name="back" size={18} />
          </ActionIcon>
        </div>
        {forbidden ? (
          <AccessDenied inline />
        ) : (
          <div className="alert alert--error" role="alert">
            {error ?? 'Request not found.'}
          </div>
        )}
      </div>
    )
  }

  const h = detail.header
  // An EMPTY decisions list is the answer "not yours to decide" — the chain then renders read-only,
  // with no button and no explanation. A draft of the caller's own also opens the popup, to finish it.
  const canDecide = decisions.length > 0 || draft != null
  // Reopen is offered ONLY on a rejected or cancelled request, and ONLY to a version-mover. An
  // APPROVED request never shows it — its result is already applied — so the act is absent rather
  // than offered-and-refused. The server enforces the same rule; this is the door, not the lock.
  const canReopen =
    (h.status === 'Rejected' || h.status === 'Cancelled') && hasPermission(WF.versionMove)

  /* ── the two reversals ── */

  // WHAT A RETRACT WOULD ACTUALLY STRIKE. Everything below reads from this one signature, so the
  // button and the warning in its popup can never describe a different decision from the one the
  // server picks.
  const lastDecision = lastStandingDecision(detail.history)

  /*
   * Retract is offered on exactly the two conditions the client can KNOW: it is my signature, and it
   * is from today (UTC). Consumption is NOT tested here — see the note above lastStandingDecision.
   * The remaining conditions are the server's, and being refused with "correct with a
   * counter-adjustment" teaches more than a button that quietly was not there.
   */
  const canRetract =
    lastDecision != null &&
    lastDecision.actedByUserId != null &&
    user?.userId != null &&
    lastDecision.actedByUserId === user.userId &&
    isSameUtcDayAsNow(lastDecision.actedAt)

  /**
   * LIFTING A HOLD. Offered to the approver — `decisions` is non-empty only when the server says
   * this step is the caller's — and, when the hold is WAITING ON THE REQUESTER, to the person who
   * raised it: answering the question IS the resume, and making them chase the approver afterwards
   * would leave the request parked for nothing.
   *
   * This is an affordance test, not the rule. The API decides and refuses anybody else by name.
   */
  const heldStep = steps.find((s) => s.status === 'OnHold')
  const canResume =
    h.status === 'OnHold' &&
    (decisions.length > 0 ||
      (heldStep?.waitingOnRequester === true && h.raisedByUserId === user?.userId))

  // Reopen is the GM + Owner path, and it covers APPROVED requests — which the HR reopen above
  // refuses outright, because an approved request has already done something.
  const holdsReopenRole = (user?.roles ?? []).some((r) => REOPEN_ROLES.includes(r))
  const canGmReopen = (h.status === 'Approved' || h.status === 'Rejected') && holdsReopenRole

  // A reopen half-signed and waiting on the other of GM/Owner.
  const awaitingSecond = pendingReopen(detail.reversals)

  return (
    <div>
      <div className="page-head wf-no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ActionIcon
            variant="default"
            size="lg"
            title="Back to requests"
            aria-label="Back to requests"
            onClick={() => navigate('/requests')}
          >
            <DirectionalIcon name="back" size={18} />
          </ActionIcon>
          <div>
            <h1 className="page-title">{h.requestTypeName}</h1>
            <p className="page-subtitle">Request #{h.requestInstanceId}</p>
          </div>
        </div>
        <div className="page-head-actions" style={{ alignItems: 'center' }}>
          {/* The status chip lives here in the header too, so the Reopen button has the status it
              acts on right beside it — this is a closed request, and the chip says which kind. */}
          <StatusChip status={h.status} />
          {/* THE WAY OUT OF A HOLD. Primary, because on a held request it is the only thing that
              moves anything — and without it a hold "waiting on the requester" could be answered by
              nobody: only deciding or delegating ever cleared one. */}
          {canResume && (
            <Button
              leftSection={<IconRestore size={16} />}
              onClick={() => void submitResume()}
              disabled={busy}
            >
              Resume
            </Button>
          )}
          {/* MY OWN last decision, today. Not a decision of its own — it takes one back — so it is
              quiet and outlined, never the primary action on the page. */}
          {canRetract && (
            <Button
              variant="default"
              leftSection={<IconArrowBackUp size={16} />}
              onClick={() => {
                setRetractReason('')
                setRetractOpen(true)
              }}
              disabled={busy}
            >
              Retract my decision
            </Button>
          )}
          {/* The GM + Owner path. Labelled with the two roles because that IS the rule — one of them
              alone achieves nothing, and a bare "Reopen" would imply otherwise. */}
          {canGmReopen && (
            <Button
              variant="default"
              leftSection={<IconRestore size={16} />}
              onClick={() => {
                setGmReopenReason('')
                setGmReopenOpen(true)
              }}
              disabled={busy}
            >
              {awaitingSecond ? 'Countersign reopen' : 'Reopen (GM + Owner)'}
            </Button>
          )}
          {canReopen && (
            <Button
              variant="default"
              leftSection={<IconRestore size={16} />}
              onClick={() => {
                setReopenReason('')
                setReopenOpen(true)
              }}
              disabled={busy}
            >
              Reopen request
            </Button>
          )}
          <Button
            variant="default"
            leftSection={<IconPrinter size={16} />}
            onClick={() => window.print()}
          >
            Print
          </Button>
        </div>
      </div>

      <div className="wf-no-print">
        <PageHelp>
          The chain shows every step and who must sign it. A skipped step explains itself —
          usually because the approver was the person requesting, or the post was vacant.
        </PageHelp>
      </div>

      {/* The request WAS accepted; this is a caveat that came back with it, not a failure. Amber and
          never red, and placed above the record it qualifies. */}
      {raisedNotice && (
        <div className="wf-balance-warn wf-no-print" role="status">
          {raisedNotice}
        </div>
      )}

      {/* HALF-SIGNED REOPEN. The request is STILL CLOSED — this says who has asked and who is
          missing, so nobody reads a pending reopen as a done one. It names the OTHER role rather
          than "the second signature", because "awaiting the Owner" tells you who to go and find. */}
      {awaitingSecond && (
        <div className="wf-balance-warn wf-no-print" role="status">
          <strong>
            Reopen requested by {reversalRoleLabel(awaitingSecond.firstSignRole)}
            {awaitingSecond.firstSignUsername ? ` (${awaitingSecond.firstSignUsername})` : ''}
          </strong>{' '}
          — awaiting the other of the GM and the Owner. This request stays closed until they sign.
          {awaitingSecond.reason ? <> Reason: “{awaitingSecond.reason}”</> : null}
        </div>
      )}

      {/* The printable document. */}
      <div className="wf-print-root">
        {/* PRINT ONLY — a compact header and one-line payload, in place of the screen's full grids.
            display:none on screen; the @media print block turns it on and hides the screen versions. */}
        <div className="wf-print-only wf-print-head">
          <div className="wf-print-title">
            {h.requestTypeName} — {h.employeeName} · {h.branchName}
          </div>
          <div className="wf-print-sub">
            Request #{h.requestInstanceId} · submitted {dateTime(h.submittedAt)} · {statusLabel(h.status)}
            {h.closedReason ? ` · closed: ${h.closedReason}` : ''}
          </div>
          {payload && (
            <div className="wf-print-payload">
              {shortDate(payload.exitDate)} · {clockTime(payload.fromTime)}–{clockTime(payload.toTime)}{' '}
              · {payload.requestedMinutes} min requested
              {payload.wasReduced ? ` (granted ${payload.approvedMinutes})` : ''} · {payload.reason}
            </div>
          )}
          {leavePayload && (
            <div className="wf-print-payload">
              {leavePayload.leaveTypeName} · {shortDate(leavePayload.fromDate)}–
              {shortDate(leavePayload.toDate)} ·{' '}
              {balanceDaysText(leavePayload.daysRequested)} requested
              {leavePayload.daysApproved != null &&
              leavePayload.daysApproved < leavePayload.daysRequested
                ? ` (granted ${balanceDaysText(leavePayload.daysApproved)})`
                : ''}
              {leavePayload.reason ? ` · ${leavePayload.reason}` : ''}
            </div>
          )}
          {tipPayload?.header && (
            <div className="wf-print-payload">
              {tipPayload.header.branchName} · {longDate(tipPayload.header.shiftDate)} ·{' '}
              {tipPayload.amounts
                .map((a) => `${tipMoney(a.amount)} ${a.currencyCode}`)
                .join('  ·  ')}
              {/* Text, not a badge: a coloured chip is the first thing a printer discards. */}
              {tipPayload.header.finalizedAt
                ? ` · Finalized ${dateTime(tipPayload.header.finalizedAt)}`
                : ' · Not finalized'}
            </div>
          )}
          {overtimePayload && (
            <div className="wf-print-payload">
              {shortDate(overtimePayload.workDate)} ·{' '}
              {durationText(overtimePayload.requestedMinutes)} requested
              {overtimePayload.approvedMinutes != null
                ? ` → ${durationText(overtimePayload.approvedMinutes)} approved`
                : ' → not yet decided'}{' '}
              · rate ×{overtimePayload.rateMultiplier}
              {overtimePayload.attendanceProcessed && overtimePayload.payableOvertimeMinutes != null
                ? ` · payable ${durationText(overtimePayload.payableOvertimeMinutes)}`
                : ' · awaiting the worked day'}
              {overtimePayload.reason ? ` · ${overtimePayload.reason}` : ''}
            </div>
          )}
          {onboardingPayload?.header && (
            <div className="wf-print-payload">
              {onboardingPayload.header.candidateName} · {onboardingPayload.header.positionTitle} ·{' '}
              {onboardingPayload.header.branchName} · starts{' '}
              {longDate(onboardingPayload.header.startDate)} ·{' '}
              {onboardingPayload.tasks.filter((t) => t.completedAt != null).length} of{' '}
              {onboardingPayload.tasks.length} checklist items done
              {onboardingPayload.header.createdEmployeeId != null
                ? ' · employee record created'
                : ' · employee record not yet created'}
            </div>
          )}
          {expensePayload && (
            <div className="wf-print-payload">
              {shortDate(expensePayload.expenseDate)} · {expensePayload.category} ·{' '}
              {tipMoney(expensePayload.amount)} {expensePayload.currencyCode}
              {expensePayload.currencyCode !== 'USD' &&
                ` (${tipMoney(expensePayload.amountUsd)} USD)`}
              {expensePayload.approvedAmount != null
                ? ` → approved ${tipMoney(expensePayload.approvedAmount)} ${expensePayload.currencyCode}`
                : ' → not yet decided'}{' '}
              ·{' '}
              {expensePayload.receiptCount === 1
                ? '1 receipt'
                : `${expensePayload.receiptCount} receipts`}
              {expensePayload.description ? ` · ${expensePayload.description}` : ''}
            </div>
          )}
        </div>

        {/* PRINT ONLY — the per-person table. A printed tip distribution that shows the pool but not
            who got what is not a record of anything, which is the whole reason this block exists. */}
        {tipPayload?.header && (
          <div className="wf-print-only wf-print-block">
            <PrintTipTable payload={tipPayload} />
          </div>
        )}

        {/* PRINT ONLY — the checklist as it stood. A printed onboarding is the file copy of the hire,
            and a file copy that omits which of the six items were actually done is not one. */}
        {onboardingPayload?.header && (
          <div className="wf-print-only wf-print-block">
            <table className="wf-print-table">
              <thead>
                <tr>
                  <th scope="col">Checklist item</th>
                  <th scope="col">Done</th>
                  <th scope="col">By</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {onboardingPayload.tasks.map((task) => (
                  <tr key={task.code}>
                    <td>
                      {task.name}
                      {task.isRequired ? ' (required)' : ''}
                      {task.note ? ` — ${task.note}` : ''}
                    </td>
                    {/* Words, not a tick glyph — a checkbox that prints as an empty box is
                        indistinguishable from one nobody filled in. */}
                    <td>{task.completedAt ? 'Yes' : 'No'}</td>
                    <td>{task.completedBy ?? '—'}</td>
                    <td>{task.completedAt ? dateTime(task.completedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Header */}
        <div className="card wf-print-hide">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              {h.requestTypeName} for {h.employeeName}
            </div>
            <StatusChip status={h.status} />
          </div>
          <div className="detail-grid" style={{ marginTop: 12 }}>
            <div className="detail">
              <span className="detail-label">Employee</span>
              <span className="detail-value">{h.employeeName}</span>
            </div>
            <div className="detail">
              <span className="detail-label">Branch</span>
              <span className="detail-value">{h.branchName}</span>
            </div>
            <div className="detail">
              <span className="detail-label">Submitted</span>
              <span className="detail-value">{dateTime(h.submittedAt)}</span>
            </div>
            <div className="detail">
              <span className="detail-label">Chain version</span>
              <span className="detail-value">v{h.workflowVersion}</span>
            </div>
          </div>
          {h.raisedOnBehalf && (
            <p className="hint" style={{ marginBottom: 0 }}>
              Raised by <strong>{h.raisedByUsername}</strong> on behalf of{' '}
              <strong>{h.employeeName}</strong>.
            </p>
          )}
          {h.closedReason && (
            <p className="hint" style={{ marginBottom: 0 }}>
              Closed: {h.closedReason}
            </p>
          )}
        </div>

        {/* Payload — whichever type this request is. */}
        {payload && (
          <div className="wf-print-hide" style={{ marginTop: 16 }}>
            <ExitPayload payload={payload} />
          </div>
        )}
        {leavePayload && (
          <div className="wf-print-hide" style={{ marginTop: 16 }}>
            <LeavePayload payload={leavePayload} />
          </div>
        )}
        {tipPayload && (
          <div className="wf-print-hide" style={{ marginTop: 16 }}>
            <TipPayload payload={tipPayload} />
          </div>
        )}
        {overtimePayload && (
          <div className="wf-print-hide" style={{ marginTop: 16 }}>
            <OvertimePayloadPanel payload={overtimePayload} />
          </div>
        )}
        {payrollAdjustmentPayload && (
          <div className="wf-print-hide" style={{ marginTop: 16 }}>
            <PayrollAdjustmentPanel payload={payrollAdjustmentPayload} />
          </div>
        )}
        {salaryAdvancePayload && (
          <div className="wf-print-hide" style={{ marginTop: 16 }}>
            <SalaryAdvancePanel payload={salaryAdvancePayload} />
          </div>
        )}

        {onboardingPayload && (
          <div className="wf-print-hide" style={{ marginTop: 16 }}>
            <OnboardingPanel
              // The server's checklist as a signature: remount (and so re-seed the panel's local
              // state) only when what the server says has actually changed.
              key={onboardingPayload.tasks
                .map((t) => `${t.code}:${t.completedAt ?? ''}:${t.note ?? ''}`)
                .join('|')}
              requestId={requestId}
              payload={onboardingPayload}
              canEdit={h.status === 'Pending' || h.status === 'OnHold'}
              onChanged={() => void load()}
            />
          </div>
        )}

        {/* The request's own supporting documents — context for the whole request, so ABOVE the chain.
            Proof an approver relied on for a decision lives inside its step instead. Not on paper. */}
        <div className="wf-print-hide">
          <RequestDocuments requestId={requestId} canEdit={h.status === 'Pending' || h.status === 'OnHold'} />
        </div>

        {/* THE FINAL SETTLEMENT, between the documents and the chain — which is where it belongs in
            the reading order: it is the last thing prepared BEFORE anyone signs, and the final
            sign-off is refused while it does not exist. Saving refetches the request, so the
            decision dialog's refusal clears without a reload. */}
        {separationPayload && (
          <div className="wf-print-hide">
            <SeparationSettlement
              requestId={requestId}
              payload={separationPayload}
              canEdit={h.status === 'Pending' || h.status === 'OnHold'}
              onSaved={load}
            />
          </div>
        )}

        {/* WHAT WILL HAPPEN IF THEY SIGN, said before the button rather than instead of it. The
            Approve button stays live on purpose: the API's refusal NAMES every outstanding item, and
            a disabled button could not tell anybody which ones. */}
        {onboardingPayload?.header &&
          onboardingPayload.tasks.some((t) => t.isRequired && t.completedAt == null) &&
          (h.status === 'Pending' || h.status === 'OnHold') && (
            <div className="wf-onb-gate wf-print-hide" role="status">
              The final approval is refused while required items are outstanding.
            </div>
          )}

        {/* The chain — read for the caller, and now the whole record: each step carries its own
            decision, note, signer and timestamp, and the buttons that act on it. */}
        <div className="card wf-chain-card" style={{ marginTop: 16 }}>
          <div className="card-title">Approval chain</div>
          <RequestStepper
            requestId={requestId}
            header={h}
            steps={steps}
            // Passed ONLY when the caller may act — an empty decisions list draws no button at all.
            onDecide={canDecide ? () => setDeciding(true) : undefined}
            decideLabel={draft ? 'Finish decision' : 'Decide'}
            // "Change decision" is withdraw-then-re-decide, which has its own dialog. Offered only
            // for the types the API actually accepts a withdrawal for — see WITHDRAWABLE_TYPES.
            // Better to not offer the button than to offer one that always fails.
            onWithdraw={
              WITHDRAWABLE_TYPES.has(h.requestTypeCode) ? (step) => setChangeStep(step) : undefined
            }
            onReclaim={(step) => {
              setReclaimReason('')
              setReclaimStep(step)
            }}
          />
        </div>

        {/* History — the audit trail, oldest first. A Withdrawn line is slate with ↩, NOT coloured
            like a decision: it undoes one, it is not one. Screen only — the printed document is the
            chain, not the log.

            A RETRACTED SIGNATURE STAYS HERE, struck through. It is not deleted and never should be:
            the decision WAS taken, and a log that quietly loses it is no longer a record of what
            happened. The reversal that struck it is interleaved as its own event, in time order, so
            the two read as cause and effect rather than as a line that mysteriously went grey. */}
        <div className="card wf-print-hide" style={{ marginTop: 16 }}>
          <div className="card-title">History</div>
          {[
            ...detail.history.map((entry) => ({
              key: `sig-${entry.signatureId}`,
              at: entry.actedAt,
              node: (() => {
                const withdrawn = entry.action === 'Withdrawn'
                const struck = entry.retractedAt != null
                return (
                  <span
                    className={withdrawn || struck ? 'wf-history-withdrawn' : undefined}
                    style={struck ? { textDecoration: 'line-through' } : undefined}
                  >
                    <strong>{withdrawn ? '↩ Withdrawn' : entry.action}</strong>
                    {entry.actedByUsername ? ` by ${entry.actedByUsername}` : ' (by the system)'}
                    {entry.comment ? ` — ${entry.comment}` : ''}
                  </span>
                )
              })(),
              // The reason rides OUTSIDE the struck text: it explains the strike, so striking it
              // through too would be the one part of the line nobody could read.
              suffix:
                entry.retractedAt != null ? (
                  <span className="wf-history-withdrawn" style={{ marginInlineStart: 6 }}>
                    (retracted{entry.retractedReason ? `: ${entry.retractedReason}` : ''})
                  </span>
                ) : null,
            })),
            ...(detail.reversals ?? []).map((rev) => ({
              key: `rev-${rev.reversalId}`,
              // A completed reversal is dated by when it TOOK EFFECT; one still waiting on a second
              // signature by when it was asked for, which is the only time it has.
              at: rev.completedAt ?? rev.createdAt,
              node: (
                <span className="wf-history-withdrawn">
                  <strong>
                    ↩{' '}
                    {rev.kind === 'Retract'
                      ? 'Decision retracted'
                      : rev.completedAt
                        ? 'Reopened (GM + Owner)'
                        : 'Reopen requested'}
                  </strong>
                  {rev.kind === 'Retract'
                    ? rev.firstSignUsername
                      ? ` by ${rev.firstSignUsername}`
                      : ''
                    : ` by ${reversalRoleLabel(rev.firstSignRole)}${
                        rev.firstSignUsername ? ` (${rev.firstSignUsername})` : ''
                      }${
                        rev.completedAt && rev.secondSignRole
                          ? ` and ${reversalRoleLabel(rev.secondSignRole)}${
                              rev.secondSignUsername ? ` (${rev.secondSignUsername})` : ''
                            }`
                          : ' — awaiting the other of GM/Owner'
                      }`}
                  {rev.reason ? ` — ${rev.reason}` : ''}
                </span>
              ),
              suffix: null,
            })),
          ]
            // One timeline, not two lists: a strike and the reversal that caused it are seconds
            // apart, and separating them would hide exactly that.
            .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
            .map((row) => (
              <div
                key={row.key}
                style={{ display: 'flex', gap: 10, fontSize: 13, padding: '3px 0' }}
              >
                <span style={{ color: 'var(--ink-muted)', minWidth: 150 }}>{dateTime(row.at)}</span>
                <span>
                  {row.node}
                  {row.suffix}
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* THE decision dialog — literally the same component the Requests hub cards open. Nothing
          about deciding is re-implemented here; this page supplies only the summary and what to
          refresh, which is the one thing that legitimately differs between the two callers:
          the hub reloads its LIST, this page reloads THIS REQUEST so the chain, the status and the
          buttons all move together, without a page reload. */}
      {/* ONE dialog for both: deciding the current step, and changing a decision already made. The
          `change` prop is the only difference — it carries the step to withdraw first, and its own
          WithdrawNeedsSignature governs the password for that half. */}
      {(deciding || changeStep) && (
        <DecidePopup
          requestId={requestId}
          requestTypeCode={h.requestTypeCode}
          signature={signature}
          mySignature={mySignature}
          change={changeStep}
          summary={
            <>
              <strong>{h.requestTypeName}</strong>
              <br />
              {h.employeeName} · {h.branchName}
              {payload && (
                <>
                  <br />
                  {shortDate(payload.exitDate)} · {clockTime(payload.fromTime)}–
                  {clockTime(payload.toTime)} · {payload.requestedMinutes} minutes requested
                  {payload.wasReduced && ` · ${payload.approvedMinutes} currently granted`}
                </>
              )}
              {leavePayload && (
                <>
                  <br />
                  {leavePayload.leaveTypeName} · {shortDate(leavePayload.fromDate)}–
                  {shortDate(leavePayload.toDate)} ·{' '}
                  {balanceDaysText(leavePayload.daysRequested)} requested
                </>
              )}
              {tipPayload?.header && (
                <>
                  <br />
                  {shortDate(tipPayload.header.shiftDate)} ·{' '}
                  {tipPayload.amounts
                    .map((a) => `${a.amount.toFixed(2)} ${a.currencyCode}`)
                    .join(' + ')}{' '}
                  · {new Set(tipPayload.lines.map((l) => l.employeeId)).size} people
                </>
              )}
              {overtimePayload && (
                <>
                  <br />
                  {shortDate(overtimePayload.workDate)} ·{' '}
                  {durationText(overtimePayload.requestedMinutes)} requested
                  {overtimePayload.approvedMinutes != null &&
                    overtimePayload.approvedMinutes < overtimePayload.requestedMinutes &&
                    ` · ${durationText(overtimePayload.approvedMinutes)} currently capped`}
                </>
              )}
            </>
          }
          onClose={() => {
            setDeciding(false)
            setChangeStep(null)
          }}
          onDecided={load}
        />
      )}

      {reclaimStep && (
        <Modal
          opened
          onClose={() => {
            setReclaimStep(null)
            setReclaimReason('')
          }}
          title="Take this step back?"
          size={460}
          centered
        >
          <p style={{ marginTop: 0 }}>
            This returns the step to you.{' '}
            <strong>{reclaimStep.delegatedToUsername ?? 'They'}</strong> will no longer see it in
            their inbox.
          </p>
          <div className="form-field">
            <label className="form-label">
              Reason <span className="form-optional">(optional)</span>
            </label>
            <Textarea
              value={reclaimReason}
              onChange={(e) => setReclaimReason(e.currentTarget.value)}
              minRows={2}
              disabled={busy}
            />
          </div>
          <div className="form-actions">
            <Button
              variant="default"
              onClick={() => {
                setReclaimStep(null)
                setReclaimReason('')
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={() => void submitReclaim()} disabled={busy}>
              {busy ? 'Taking back…' : 'Take this step back'}
            </Button>
          </div>
        </Modal>
      )}

      {/* RETRACT. The warning is the whole dialog: it names the decision being struck and says
          plainly what happens to it, because "retract" on its own does not tell anyone that their
          signature survives on the record, struck through, with this reason attached to it. */}
      {retractOpen && lastDecision && (
        <Modal
          opened
          onClose={() => {
            setRetractOpen(false)
            setRetractReason('')
          }}
          title="Retract your decision?"
          size={480}
          centered
        >
          <div className="wf-balance-warn" role="status" style={{ marginTop: 0 }}>
            Your signature will be struck and the request returns to this step.
          </div>
          <p>
            Striking your <strong>{decisionLabel(lastDecision.action)}</strong> on{' '}
            <strong>step {lastDecision.stepNo}</strong>, signed {dateTime(lastDecision.actedAt)}. It
            stays in the history, struck through, with your reason beside it — and the step comes
            back to whoever owns it for a fresh decision.
          </p>
          <div className="form-field">
            <label className="form-label">
              Why? <span className="form-optional">(required)</span>
            </label>
            <Textarea
              value={retractReason}
              onChange={(e) => setRetractReason(e.currentTarget.value)}
              minRows={3}
              disabled={busy}
            />
          </div>
          <div className="form-actions">
            <Button
              variant="default"
              onClick={() => {
                setRetractOpen(false)
                setRetractReason('')
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={() => void submitRetract()} disabled={busy}>
              {busy ? 'Retracting…' : 'Retract my decision'}
            </Button>
          </div>
        </Modal>
      )}

      {/* REOPEN, GM + Owner. The dialog says which half of the act this is, because signing first
          and signing second do completely different things — one records an intention, the other
          reopens the request. */}
      {gmReopenOpen && (
        <Modal
          opened
          onClose={() => {
            setGmReopenOpen(false)
            setGmReopenReason('')
          }}
          title={awaitingSecond ? 'Countersign this reopen?' : 'Reopen this request?'}
          size={480}
          centered
        >
          {awaitingSecond ? (
            <>
              <div className="wf-balance-warn" role="status" style={{ marginTop: 0 }}>
                This is the second signature — the request reopens as soon as you sign.
              </div>
              <p>
                {reversalRoleLabel(awaitingSecond.firstSignRole)}
                {awaitingSecond.firstSignUsername
                  ? ` (${awaitingSecond.firstSignUsername})`
                  : ''}{' '}
                asked for this
                {awaitingSecond.reason ? <>: “{awaitingSecond.reason}”</> : null}. Countersigning
                strikes the last signature on the chain and returns the request to that step.
              </p>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                Reopening a closed request takes <strong>both</strong> the General Manager and the
                Owner. Yours is the first signature: nothing changes until the other of the two
                signs as well, and until then the request stays{' '}
                <strong>{statusLabel(h.status).toLowerCase()}</strong>.
              </p>
              <div className="form-field">
                <label className="form-label">
                  Why? <span className="form-optional">(required)</span>
                </label>
                <Textarea
                  value={gmReopenReason}
                  onChange={(e) => setGmReopenReason(e.currentTarget.value)}
                  minRows={3}
                  disabled={busy}
                />
              </div>
            </>
          )}
          <div className="form-actions">
            <Button
              variant="default"
              onClick={() => {
                setGmReopenOpen(false)
                setGmReopenReason('')
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void submitGmReopen()}
              // The reason is required on the FIRST signature only — the second inherits it, which
              // is why this is not a flat "reason must be non-empty" rule.
              disabled={busy || (!awaitingSecond && !gmReopenReason.trim())}
            >
              {busy
                ? 'Signing…'
                : awaitingSecond
                  ? 'Countersign and reopen'
                  : 'Sign the reopen request'}
            </Button>
          </div>
        </Modal>
      )}

      {reopenOpen && (
        <Modal
          opened
          onClose={() => {
            setReopenOpen(false)
            setReopenReason('')
          }}
          title="Reopen this request?"
          size={460}
          centered
        >
          <p style={{ marginTop: 0 }}>
            It returns to the step that closed it, unsigned. The{' '}
            {h.status === 'Cancelled' ? 'cancellation' : 'rejection'} stays in the history.
          </p>
          <div className="form-field">
            <label className="form-label">
              Why? <span className="form-optional">(required)</span>
            </label>
            <Textarea
              value={reopenReason}
              onChange={(e) => setReopenReason(e.currentTarget.value)}
              minRows={3}
              disabled={busy}
            />
          </div>
          <div className="form-actions">
            <Button
              variant="default"
              onClick={() => {
                setReopenOpen(false)
                setReopenReason('')
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={() => void submitReopen()} disabled={busy}>
              {busy ? 'Reopening…' : 'Reopen'}
            </Button>
          </div>
        </Modal>
      )}

    </div>
  )
}
