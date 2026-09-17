import { useEffect, useState } from 'react'
import { Select, Textarea } from '@mantine/core'
import { DateRangeField } from '../../components/DateRangeField'
import { leaveRequestsService } from '../../services/workflowService'
import { leaveTypesService } from '../../services/hrService'
import { isActiveRow } from '../../types/hr'
import type { LeaveRelationEntitlement, LeaveType } from '../../types/hr'
import type { LeaveBalanceSummary } from '../../types/workflow'
import { balanceDaysText, dayCountText, inclusiveDays } from './newRequestShared'
import type { RequestFormBody } from './newRequestShared'
import { t } from '../../i18n/t'
import { referenceName } from '../../i18n/referenceName'

/**
 * The LEAVE REQUEST form body — leave type, dates, the inclusive day count, a reason, and the
 * employee's balance for the type they picked.
 *
 * THE BALANCE IS SHOWN, NOT ENFORCED — days come out of the ledger at APPROVAL, and a balance may
 * legitimately go negative when HR or the Owner decide it should. The one hard rule at this stage
 * is the overlap refusal, which lives in the procedure where it cannot be bypassed. (Unchanged;
 * the DevExtreme controls are Mantine now, and dates are native date inputs.)
 */
export function useLeaveRequestForm(employeeId: number | null, saving: boolean): RequestFormBody {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [entitlements, setEntitlements] = useState<LeaveRelationEntitlement[]>([])
  const [leaveTypeId, setLeaveTypeId] = useState<number | null>(null)
  const [relation, setRelation] = useState<string | null>(null)
  const [fromDate, setFromDate] = useState<string | null>(null)
  const [toDate, setToDate] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  /** The balance, TAGGED with the person-and-type it was read for — see the original's rationale. */
  const [fetched, setFetched] = useState<{ key: string; data: LeaveBalanceSummary } | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      leaveTypesService.getAll(),
      leaveTypesService.getRelationEntitlements().catch(() => [] as LeaveRelationEntitlement[]),
    ])
      .then(([all, rels]) => {
        if (cancelled) return
        // A deactivated type is history, not a choice — it stays on old requests, off new ones.
        const list = all.filter(isActiveRow)
        setLeaveTypes(list)
        setEntitlements(rels)
        // Pre-select when there is only one — the same rule the type cards follow.
        if (list.length === 1) setLeaveTypeId(list[0].leaveTypeId)
      })
      .catch(() => {
        /* the dropdown stays empty and "a leave type" is reported missing, which is the honest state */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const balanceKey =
    employeeId != null && leaveTypeId != null ? `${employeeId}:${leaveTypeId}` : null

  useEffect(() => {
    if (balanceKey == null || employeeId == null || leaveTypeId == null) return
    let cancelled = false
    leaveRequestsService
      .balance(employeeId, leaveTypeId)
      .then((data) => {
        if (!cancelled) setFetched({ key: balanceKey, data })
      })
      .catch(() => {
        // A balance we could not read must not masquerade as zero — the line is simply not shown.
      })
    return () => {
      cancelled = true
    }
  }, [balanceKey, employeeId, leaveTypeId])

  /** Only ever the balance for THE CURRENT selection. */
  const balance = fetched && fetched.key === balanceKey ? fetched.data : null

  const fromYMD = fromDate ? fromDate.slice(0, 10) : null
  const toYMD = toDate ? toDate.slice(0, 10) : null
  const days = fromYMD && toYMD ? inclusiveDays(fromYMD, toYMD) : null
  const leaveType = leaveTypes.find((lt) => lt.leaveTypeId === leaveTypeId) ?? null
  const leaveTypeName = leaveType?.name ?? null

  /** The relations THIS type covers — empty means the dropdown does not exist at all. (Unchanged.) */
  const relations = entitlements.filter((r) => r.leaveTypeId === leaveTypeId)
  const needsRelation = relations.length > 0
  const relationCap = relations.find((r) => r.relation === relation)?.days ?? null

  // Composed to match usp_LeaveRequest_Create's format EXACTLY — any drift here would be a lie.
  const autoTitle =
    leaveTypeName && fromYMD && toYMD && days != null
      ? `${leaveTypeName} leave ${fromYMD} to ${toYMD} (${days} days)`
      : null

  /*
   * ONE MESSAGE FOR THE DATES, because there is now one control and one way to be wrong about it.
   * `days` is null exactly when the period is incomplete — the range picker cannot produce an
   * inverted one — so the three old messages collapse into the single thing left to say.
   */
  const missing = !leaveTypeId
    ? t('body.leave.missingType')
    : needsRelation && !relation
      ? t('body.leave.missingRelation')
      : days == null
        ? t('body.leave.missingPeriod')
        : null

  /** More days asked for than are left. Amber, and only amber: the approver decides. */
  const overBalance = balance != null && days != null && days > balance.currentBalance

  const typeLabel = (lt: LeaveType): string =>
    lt.isPaid ? referenceName(lt) : t('body.leave.unpaidSuffix', { name: referenceName(lt) })

  const node = (
    <>
      <div className="form-field">
        <Select
          label={t('body.leave.type')}
          data={leaveTypes.map((lt) => ({ value: String(lt.leaveTypeId), label: typeLabel(lt) }))}
          value={leaveTypeId != null ? String(leaveTypeId) : null}
          placeholder={t('body.leave.typePlaceholder')}
          disabled={saving}
          allowDeselect={false}
          onChange={(v) => {
            setLeaveTypeId(v != null ? Number(v) : null)
            // The relation belongs to the TYPE — never carried across to one that never asked.
            setRelation(null)
          }}
        />

        {/* THE BALANCE LINE — the same figure the approver will see on the request. */}
        {balance && (
          <div className="hint">
            {t('body.leave.balanceLine', { type: balance.leaveTypeName })}{' '}
            <strong>{balanceDaysText(balance.currentBalance)}</strong>
            {balance.annualEntitlementDays > 0 && (
              <>{t('body.leave.ofPerYear', { days: balanceDaysText(balance.annualEntitlementDays) })}</>
            )}
          </div>
        )}
      </div>

      {/* RELATION — only for relation-capped types; the options ARE the entitlements. */}
      {needsRelation && (
        <div className="form-field">
          <Select
            label={t('body.leave.relation')}
            data={relations.map((r) => ({
              value: r.relation,
              label: t('body.leave.relationOption', {
                relation: r.relation,
                days: balanceDaysText(r.days),
              }),
            }))}
            value={relation}
            placeholder={t('body.leave.relationPlaceholder')}
            disabled={saving}
            onChange={(v) => setRelation(v)}
          />
          <div className="hint">{t('body.leave.relationCapNote', { type: leaveTypeName })}</div>
        </div>
      )}

      {/* CERTIFICATE — said at the point of asking, not discovered at the point of approving. */}
      {leaveType?.requiresCertificate && (
        <div className="wf-cert-note">
          <strong>{t('body.leave.certificateTitle', { type: leaveTypeName })}</strong>{' '}
          {t('body.leave.certificateBody')}
        </div>
      )}

      {/* ONE CONTROL, ONE CALENDAR — click the first day, hover to see the span light up, click the
          last.

          TWO INPUTS MADE AN INVERTED RANGE TYPEABLE: pick the 20th, then the 5th, and the form had
          to catch it afterwards and explain it. They also left three separate ways to be incomplete
          — no start, no end, end before start — each with its own message. A range picker cannot
          express any of them: the first click is the start and the second is the end, so
          `missingOrder` is gone as a STATE rather than merely unreported.

          NO minDate. Leave is routinely raised for days already past — sick leave is reported the
          morning after — and a picker that refuses yesterday would block the commonest entry of all.

          THE CONTRACT IS UNCHANGED. Mantine 8 speaks 'YYYY-MM-DD' natively, so the value here is a
          tuple of the very strings the state and the payload already hold: the only conversion at
          this boundary is one tuple to two fields. No Date is constructed, so no timezone can shift
          a day underneath it. */}
      <div className="form-field">
        <DateRangeField
          label={t('body.leave.period')}
          from={fromYMD}
          to={toYMD}
          disabled={saving}
          onChange={(nextFrom, nextTo) => {
            setFromDate(nextFrom)
            setToDate(nextTo)
          }}
        />
      </div>

      {/* The day count, live — inclusive calendar days, same arithmetic as the procedure. */}
      {days != null && (
        <p className="hint">
          <strong>{dayCountText(days)}</strong> {t('body.leave.countedInclusively')}
          {relationCap != null &&
            t('body.leave.relationAllows', {
              relation: relation,
              days: balanceDaysText(relationCap),
            })}
        </p>
      )}

      {/* Over the relation's cap IS fatal — the procedure refuses it — so it is said beforehand. */}
      {relationCap != null && days != null && days > relationCap && (
        <div className="wf-balance-warn" role="status">
          {t('body.leave.overCap', {
            type: leaveTypeName,
            days: balanceDaysText(relationCap),
            relation: relation,
          })}
        </div>
      )}

      {overBalance && balance && (
        <div className="wf-balance-warn" role="status">
          {t('body.leave.overBalance', {
            type: balance.leaveTypeName,
            days: balanceDaysText(balance.currentBalance),
          })}
        </div>
      )}

      <div className="form-field">
        <Textarea
          label={
            <>
              {t('common.reason')} <span className="form-optional">{t('common.optional')}</span>
            </>
          }
          value={reason}
          minRows={2}
          disabled={saving}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
      </div>
    </>
  )

  return {
    node,
    autoTitle,
    missing,
    async submit(id, title) {
      if (id == null || !leaveTypeId || !fromYMD || !toYMD)
        throw new Error(t('common.formIncomplete'))

      const created = await leaveRequestsService.create({
        employeeId: id,
        leaveTypeId,
        fromDate: fromYMD,
        toDate: toYMD,
        reason: reason.trim() || null,
        title: title ?? undefined,
        // Only for a relation-capped type; the procedure ignores it on every other.
        relationToEmployee: needsRelation ? relation : null,
      })

      return {
        requestId: created.requestInstanceId,
        // ACCEPTED, with something worth saying — short notice travels to the request it created.
        notice: created.noticeShorterThanPreferred
          ? created.noticePreferredDays > 0
            ? t('body.leave.noticeShortWithPreferred', { count: created.noticePreferredDays })
            : t('body.leave.noticeShort')
          : null,
      }
    },
  }
}
