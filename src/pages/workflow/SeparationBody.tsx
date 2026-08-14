import { useEffect, useMemo, useState } from 'react'
import { Select, Textarea } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { separationsService } from '../../services/workflowService'
import type { SeparationContext } from '../../types/workflow'
import type { RequestFormBody } from './newRequestShared'
import { t } from '../../i18n/t'
import { Trans } from 'react-i18next'

/** The stored codes. The LABEL is resolved at render, so the list follows the language. */
const TYPE_CODES = ['Resignation', 'Termination', 'EndOfContract', 'Retirement'] as const

function todayYMD(): string {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

/**
 * The SEPARATION form body — how employment ends.
 * Asks only what a human knows (kind, notice date, last day, why); SHOWS what the system already
 * knows (service length, required notice, shortfall, leave ledger). No money here — the settlement
 * is prepared on the request page; a short notice period is a WARNING, never a block.
 */
export function useSeparationForm(employeeId: number | null, saving: boolean): RequestFormBody {
  const [separationType, setSeparationType] = useState<string | null>('Resignation')
  const [noticeGiven, setNoticeGiven] = useState<string | null>(todayYMD()) // yyyy-MM-dd
  const [lastDay, setLastDay] = useState<string | null>(null) // yyyy-MM-dd
  const [reason, setReason] = useState('')
  const [ctx, setCtx] = useState<{ key: string; data: SeparationContext } | null>(null)

  const givenYMD = noticeGiven
  const lastYMD = lastDay

  /* the context is read for a specific person and pair of dates, and tagged with them */
  useEffect(() => {
    if (!employeeId || !lastYMD || !givenYMD) return
    const key = `${employeeId}|${givenYMD}|${lastYMD}`
    let cancelled = false
    separationsService
      .context(employeeId, lastYMD, givenYMD)
      .then((data) => {
        if (!cancelled) setCtx({ key, data })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [employeeId, givenYMD, lastYMD])

  const info =
    employeeId && lastYMD && givenYMD && ctx?.key === `${employeeId}|${givenYMD}|${lastYMD}`
      ? ctx.data
      : null

  const leaveTotal = useMemo(
    () => (info?.leaveBalances ?? []).reduce((sum, l) => sum + l.balanceDays, 0),
    [info],
  )

  const types = useMemo(
    () => TYPE_CODES.map((value) => ({ value, label: t(`body.separation.kinds.${value}`) })),
    [],
  )
  const typeLabel = types.find((x) => x.value === separationType)?.label ?? null

  const autoTitle =
    separationType && lastYMD && info
      ? `${separationType} - ${info.header.fullName}, last day ${lastYMD}`
      : null

  const missing = !separationType
    ? t('body.separation.missingKind')
    : !givenYMD
      ? t('body.separation.missingNotice')
      : !lastYMD
        ? t('body.separation.missingLastDay')
        : null

  const node = (
    <>
      <div className="form-grid">
        <div className="form-field">
          <Select
            label={t('body.separation.kind')}
            data={types}
            value={separationType}
            allowDeselect={false}
            disabled={saving}
            onChange={(v) => setSeparationType(v)}
          />
        </div>
        <div className="form-field">
          <DatePickerInput
            label={t('body.separation.noticeGiven')}
            valueFormat="DD/MM/YYYY"
            leftSection={<IconCalendar size={14} />}
            value={noticeGiven}
            disabled={saving}
            onChange={(v) => setNoticeGiven(v || null)}
          />
        </div>
        <div className="form-field">
          {/* The last day cannot precede the notice — `min` → `minDate`, the same string, and it
              stays undefined until a notice date exists, exactly as before. */}
          <DatePickerInput
            label={t('body.separation.lastDay')}
            valueFormat="DD/MM/YYYY"
            leftSection={<IconCalendar size={14} />}
            minDate={givenYMD ?? undefined}
            value={lastDay}
            disabled={saving}
            onChange={(v) => setLastDay(v || null)}
          />
        </div>
      </div>

      {info && (
        <div className="wf-separation-context">
          <div>
            {/* Trans keeps the sentence whole for the translator. (Unchanged.) */}
            <Trans
              i18nKey="body.separation.contextLine"
              values={{
                years: t('common.years', { count: info.header.serviceYears }),
                required: t('common.days', { count: info.header.requiredNoticeDays }),
                given: t('common.days', { count: info.header.noticeGivenDays }),
              }}
              components={{ b: <strong /> }}
            />
          </div>
          {info.header.noticeShortfallDays > 0 && (
            <div className="wf-balance-warn" role="status">
              {t('body.separation.shortfall', { count: info.header.noticeShortfallDays })}
            </div>
          )}
          {leaveTotal !== 0 && (
            <div className="hint">
              {t('body.separation.leaveLedger', { days: leaveTotal.toFixed(2) })}
              {info.leaveBalances.length > 1 &&
                t('body.separation.leaveBreakdown', {
                  list: info.leaveBalances
                    .map((l) => `${l.leaveTypeName} ${l.balanceDays}`)
                    .join(', '),
                })}
              {t('body.separation.leaveLedgerTail')}
            </div>
          )}
          {info.header.provisionalIndemnity == null && (
            <div className="hint">{t('body.separation.noIndemnity')}</div>
          )}
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
    async submit(empId, title) {
      // empId is nullable on RequestFormBody; the incomplete-form guard narrows it back.
      if (empId == null || !separationType || !givenYMD || !lastYMD)
        throw new Error(t('common.formIncomplete'))
      const created = await separationsService.create({
        employeeId: empId,
        separationType,
        noticeGivenDate: givenYMD,
        lastWorkingDate: lastYMD,
        reason: reason.trim() || null,
        title: title ?? undefined,
      })
      return {
        requestId: created.requestInstanceId,
        notice:
          created.noticeShortfallDays > 0
            ? t('body.separation.noticeShortfall', {
                count: created.noticeShortfallDays,
                required: created.requiredNoticeDays,
              })
            : t('body.separation.noticeRecorded', { kind: typeLabel }),
      }
    },
  }
}
