import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, NumberInput, Select, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { ApiError } from '../../api/client'
import { getErrorMessage } from '../../api/errorMessage'
import { currenciesService } from '../../services/coreService'
import { separationsService } from '../../services/workflowService'
import type { Currency } from '../../types/core'
import type { SeparationPayload } from '../../types/workflow'
import { dateTime } from './workflowFormat'

/** Shown until the lookup answers — and if it never does, this is still a usable list. */
const FALLBACK_CURRENCIES = ['USD', 'LBP']

/** The six figures the preparer enters. Days sit with the money because they are entered together. */
type FigureKey =
  | 'unusedLeaveDays'
  | 'unusedLeaveAmount'
  | 'indemnityAmount'
  | 'noticePayAmount'
  | 'otherDues'
  | 'deductions'

/**
 * A field holds '' until somebody types in it, which is why these are not plain numbers: seeding an
 * unprepared settlement with zeros would show six figures nobody has agreed to, and a cleared field
 * would spring back to 0 under the cursor.
 */
type Figures = Record<FigureKey, number | string>

function seedFigures(payload: SeparationPayload): Figures {
  return {
    unusedLeaveDays: payload.unusedLeaveDays ?? '',
    unusedLeaveAmount: payload.unusedLeaveAmount ?? '',
    indemnityAmount: payload.indemnityAmount ?? '',
    noticePayAmount: payload.noticePayAmount ?? '',
    otherDues: payload.otherDues ?? '',
    deductions: payload.deductions ?? '',
  }
}

/** '' and a half-typed '-' both mean "nothing entered here", which is zero for the arithmetic. */
function n(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Money as the other panels print it: two decimals and thousands separators, code alongside. */
function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * The server's own sentence, INCLUDING on a 403.
 *
 * getErrorMessage collapses every 403 to one generic line, which is right for a page somebody
 * simply may not read — but wrong here. WHO MAY PREPARE A SETTLEMENT IS THE SERVER'S DECISION (the
 * approver whose step is current, or a holder of EMP_EDIT), and its refusal names that rule. Replacing
 * it with "You don't have permission for this action" would throw away the only useful half of the
 * answer: which of the two routes the reader is missing.
 */
function refusalText(err: unknown): string {
  if (err instanceof ApiError && err.status === 403 && err.message) return err.message
  return getErrorMessage(err)
}

/**
 * THE FINAL SETTLEMENT — the figures a separation cannot close without.
 *
 * usp_Separation_Decide REFUSES THE LAST SIGN-OFF while `preparedAt` is null, so this panel is not a
 * form beside the request: it is the thing that decides whether the request can close at all. Hence
 * the amber banner saying so before anybody meets the refusal in the decision dialog, and hence the
 * refetch after a save — the popup's "not prepared" complaint is answered by this card, and it must
 * clear without anyone reloading the page.
 *
 * THE TOTAL ON SCREEN IS A PREVIEW, NOT THE RECORD. The procedure computes and stores its own
 * (leave + indemnity + notice pay + other − deductions), which is why the prepared summary shows
 * `settlementTotal` as it came back rather than re-adding the parts: the client never has to agree
 * with the server about money, and a panel that recomputed could quietly disagree.
 */
export function SeparationSettlement({
  requestId,
  payload,
  canEdit,
  onSaved,
}: {
  requestId: number
  payload: SeparationPayload
  /** False once the request leaves Pending/OnHold — the procedure refuses, so do not invite the click. */
  canEdit: boolean
  /** Refetches the request, so the chain, the decisions and the popup's refusal all move together. */
  onSaved: () => Promise<void> | void
}) {
  const { t } = useTranslation()
  const prepared = payload.preparedAt != null

  /* Open on arrival only when there is nothing yet AND this user could act — a prepared settlement
     opens read-only, and "Edit figures" is the deliberate act that reopens it. */
  const [editing, setEditing] = useState(!prepared && canEdit)
  const [figures, setFigures] = useState<Figures>(() => seedFigures(payload))
  const [currencyCode, setCurrencyCode] = useState<string | null>(payload.currencyCode ?? 'USD')
  const [note, setNote] = useState(payload.settlementNote ?? '')
  const [currencies, setCurrencies] = useState<string[]>(FALLBACK_CURRENCIES)
  const [saving, setSaving] = useState(false)
  /** The server's refusal, in place under the form. Never a toast: it belongs to these figures. */
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    currenciesService
      .getAll()
      .then((rows: Currency[]) => {
        if (!cancelled && rows.length > 0) setCurrencies(rows.map((c) => c.currencyCode))
      })
      .catch(() => {
        /* the lookup needs EMP_VIEW; without it the fallback list still lets a preparer work */
      })
    return () => {
      cancelled = true
    }
  }, [])

  /* The stored currency may predate the list, or outlive a lookup that failed. Folding it in keeps
     the Select from rendering blank over a value that is really there. */
  const currencyData = useMemo(() => {
    const codes = new Set(currencies)
    if (currencyCode) codes.add(currencyCode)
    return Array.from(codes)
  }, [currencies, currencyCode])

  /** Live, and the procedure's own arithmetic — days are not money and are deliberately absent. */
  const total = useMemo(
    () =>
      n(figures.unusedLeaveAmount) +
      n(figures.indemnityAmount) +
      n(figures.noticePayAmount) +
      n(figures.otherDues) -
      n(figures.deductions),
    [figures],
  )

  function setFigure(key: FigureKey, value: number | string) {
    setFigures((prev) => ({ ...prev, [key]: value }))
  }

  /* Re-seeded from the payload, not from whatever was left in state: between the last save and this
     click the request may have been refetched, or somebody else may have restated the figures. */
  function openForm() {
    setFigures(seedFigures(payload))
    setCurrencyCode(payload.currencyCode ?? 'USD')
    setNote(payload.settlementNote ?? '')
    setError(null)
    setEditing(true)
  }

  async function save() {
    if (!currencyCode) {
      setError(t('requests.settlement.currencyRequired'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await separationsService.setSettlement(requestId, {
        currencyCode,
        unusedLeaveDays: n(figures.unusedLeaveDays),
        unusedLeaveAmount: n(figures.unusedLeaveAmount),
        indemnityAmount: n(figures.indemnityAmount),
        noticePayAmount: n(figures.noticePayAmount),
        otherDues: n(figures.otherDues),
        deductions: n(figures.deductions),
        settlementNote: note.trim() || null,
      })
      setEditing(false)
      // THE POINT OF THE REFETCH: the decision dialog refuses the final sign-off on an unprepared
      // settlement, and that refusal is answered by the save above. Without this, the request on
      // screen still says unprepared and the only way out looks like a page reload.
      await onSaved()
      notifications.show({
        message: t('requests.settlement.saved'),
        color: 'green',
        autoClose: 4000,
      })
    } catch (err) {
      // "Amounts cannot be negative - money withheld belongs in Deductions.", and the 403 naming who
      // may prepare. Both say what to do next, so both are shown as they arrived.
      setError(refusalText(err))
    } finally {
      setSaving(false)
    }
  }

  const shortfall = payload.noticeShortfallDays
  const code = payload.currencyCode ?? ''

  /** One stored figure, or an em dash — a null here means "never entered", not zero. */
  function stored(value: number | null, negative = false): string {
    if (value == null) return t('common.dash')
    return `${negative ? '−' : ''}${money(value)} ${code}`.trim()
  }

  return (
    <div className="card wf-settle" style={{ marginTop: 16 }}>
      <div className="wf-settle-head">
        <h2 className="card-title" style={{ marginBottom: 0 }}>
          {t('requests.settlement.title')}
        </h2>
        {prepared && <span className="wf-settle-badge">{t('requests.settlement.preparedBadge')}</span>}
      </div>

      {/* THE CONTEXT THE FIGURES ARE WORKED OUT FROM, read-only. Service length drives the indemnity
          and the notice pair drives any pay in lieu, so they belong above the form rather than in a
          card somebody has to scroll back to. */}
      <div className="detail-grid wf-settle-context">
        <div className="detail">
          <span className="detail-label">{t('requests.settlement.service')}</span>
          <span className="detail-value">
            {t('common.years', { count: payload.serviceYears })}
          </span>
        </div>
        <div className="detail">
          <span className="detail-label">{t('requests.settlement.requiredNotice')}</span>
          <span className="detail-value">
            {t('common.days', { count: payload.requiredNoticeDays })}
          </span>
        </div>
        <div className="detail">
          <span className="detail-label">{t('requests.settlement.givenNotice')}</span>
          <span className="detail-value">
            {t('common.days', { count: payload.noticeGivenDays })}
          </span>
        </div>
        <div className="detail">
          <span className="detail-label">{t('requests.settlement.shortfall')}</span>
          {/* Amber only when there IS one. A shortfall of zero coloured like a warning would train
              people to stop reading the ones that matter. */}
          <span
            className="detail-value"
            style={shortfall > 0 ? { color: '#b7791f' } : undefined}
          >
            {shortfall > 0
              ? t('common.days', { count: shortfall })
              : t('requests.settlement.noShortfall')}
          </span>
        </div>
      </div>

      {/* Said HERE, before the decision dialog says it — the final sign-off is refused outright while
          this is unprepared, and meeting that at the moment of signing helps nobody. */}
      {!prepared && (
        <div className="wf-balance-warn" role="status">
          {t('requests.settlement.notPrepared')}
        </div>
      )}

      {editing ? (
        <div className="wf-settle-form">
          {shortfall > 0 && (
            <p className="hint" style={{ marginBottom: 12 }}>
              {t('requests.settlement.shortfallHint', {
                days: t('common.days', { count: shortfall }),
              })}
            </p>
          )}

          <div className="form-grid">
            <div className="form-field">
              <Select
                label={t('common.currency')}
                data={currencyData}
                value={currencyCode}
                allowDeselect={false}
                disabled={saving}
                onChange={(v) => setCurrencyCode(v)}
              />
            </div>
            <div className="form-field">
              {/* Days, not money — it does not enter the total, and its amount is the field beside it. */}
              <NumberInput
                label={t('requests.settlement.unusedLeaveDays')}
                value={figures.unusedLeaveDays}
                min={0}
                step={0.5}
                decimalScale={2}
                disabled={saving}
                onChange={(v) => setFigure('unusedLeaveDays', v)}
              />
            </div>
            <div className="form-field">
              <NumberInput
                label={t('requests.settlement.unusedLeaveAmount')}
                value={figures.unusedLeaveAmount}
                min={0}
                decimalScale={2}
                disabled={saving}
                onChange={(v) => setFigure('unusedLeaveAmount', v)}
              />
            </div>
            <div className="form-field">
              <NumberInput
                label={t('requests.settlement.indemnityAmount')}
                value={figures.indemnityAmount}
                min={0}
                decimalScale={2}
                disabled={saving}
                onChange={(v) => setFigure('indemnityAmount', v)}
              />
            </div>
            <div className="form-field">
              <NumberInput
                label={t('requests.settlement.noticePayAmount')}
                value={figures.noticePayAmount}
                min={0}
                decimalScale={2}
                disabled={saving}
                onChange={(v) => setFigure('noticePayAmount', v)}
              />
            </div>
            <div className="form-field">
              <NumberInput
                label={t('requests.settlement.otherDues')}
                value={figures.otherDues}
                min={0}
                decimalScale={2}
                disabled={saving}
                onChange={(v) => setFigure('otherDues', v)}
              />
            </div>
            <div className="form-field">
              {/* POSITIVE, and subtracted. The procedure refuses a negative anywhere and says so:
                  money withheld belongs here, not as a minus sign on one of the dues above. */}
              <NumberInput
                label={t('requests.settlement.deductions')}
                value={figures.deductions}
                min={0}
                decimalScale={2}
                disabled={saving}
                onChange={(v) => setFigure('deductions', v)}
              />
            </div>
            <div className="form-field full">
              <Textarea
                label={
                  <>
                    {t('requests.settlement.note')}{' '}
                    <span className="form-optional">{t('common.optional')}</span>
                  </>
                }
                value={note}
                minRows={2}
                disabled={saving}
                onChange={(e) => setNote(e.currentTarget.value)}
              />
            </div>
          </div>

          {/* Live, so the arithmetic is visible while it is being typed rather than after it is
              saved — the one moment a wrong figure is still cheap to notice. */}
          <div className="wf-settle-total">
            <span>{t('requests.settlement.total')}</span>
            <strong className="wf-settle-figure">
              {money(total)} {currencyCode ?? ''}
            </strong>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            {t('requests.settlement.totalFormula')}
          </p>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="form-actions">
            {/* Only once there is something to go back TO. On a first preparation, Cancel would
                simply hide the form the request cannot close without. */}
            {prepared && (
              <Button
                variant="default"
                onClick={() => {
                  setEditing(false)
                  setError(null)
                }}
                disabled={saving}
              >
                {t('common.cancel')}
              </Button>
            )}
            <Button onClick={() => void save()} disabled={saving || !currencyCode}>
              {saving ? t('common.saving') : t('requests.settlement.save')}
            </Button>
          </div>
        </div>
      ) : prepared ? (
        <>
          <div className="wf-settle-summary">
            <div className="wf-settle-rows">
              <div className="wf-settle-row">
                <span className="wf-settle-label">{t('requests.settlement.unusedLeaveDays')}</span>
                <span className="wf-settle-value">
                  {payload.unusedLeaveDays != null
                    ? t('common.days', { count: payload.unusedLeaveDays })
                    : t('common.dash')}
                </span>
              </div>
              <div className="wf-settle-row">
                <span className="wf-settle-label">{t('requests.settlement.unusedLeaveAmount')}</span>
                <span className="wf-settle-value">{stored(payload.unusedLeaveAmount)}</span>
              </div>
              <div className="wf-settle-row">
                <span className="wf-settle-label">{t('requests.settlement.indemnityAmount')}</span>
                <span className="wf-settle-value">{stored(payload.indemnityAmount)}</span>
              </div>
              <div className="wf-settle-row">
                <span className="wf-settle-label">{t('requests.settlement.noticePayAmount')}</span>
                <span className="wf-settle-value">{stored(payload.noticePayAmount)}</span>
              </div>
              <div className="wf-settle-row">
                <span className="wf-settle-label">{t('requests.settlement.otherDues')}</span>
                <span className="wf-settle-value">{stored(payload.otherDues)}</span>
              </div>
              <div className="wf-settle-row">
                <span className="wf-settle-label">{t('requests.settlement.deductions')}</span>
                {/* Carried with its sign: "50.00 USD" under Deductions reads as money owed. */}
                <span className="wf-settle-value">{stored(payload.deductions, true)}</span>
              </div>
            </div>

            {/* THE SERVER'S FIGURE, not a re-addition of the parts above. */}
            <div className="wf-settle-sum">
              <span>{t('requests.settlement.total')}</span>
              <strong className="wf-settle-figure">
                {money(payload.settlementTotal)} {code}
              </strong>
            </div>

            {payload.settlementNote && (
              <p className="wf-settle-note">“{payload.settlementNote}”</p>
            )}
            <p className="wf-settle-when">
              {payload.preparedBy
                ? t('requests.settlement.preparedByLine', {
                    name: payload.preparedBy,
                    when: dateTime(payload.preparedAt),
                  })
                : t('requests.settlement.preparedAtLine', { when: dateTime(payload.preparedAt) })}
            </p>
          </div>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          {canEdit && (
            <div className="form-actions">
              <Button variant="default" onClick={openForm}>
                {t('requests.settlement.edit')}
              </Button>
            </div>
          )}
        </>
      ) : (
        /* Closed and never prepared. The banner above already says the sign-off was blocked; this
           says why nothing can be done about it now, rather than showing a form the server refuses. */
        <p className="hint" style={{ marginBottom: 0 }}>
          {t('requests.settlement.closedUnprepared')}
        </p>
      )}
    </div>
  )
}
