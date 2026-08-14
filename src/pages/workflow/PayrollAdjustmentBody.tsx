/* src/pages/workflow/PayrollAdjustmentBody.tsx */
import { useEffect, useMemo, useState } from 'react'
import { NumberInput, Select, Textarea } from '@mantine/core'
import { MonthPickerInput } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { monthFromPicker, monthToPicker } from '../../components/date/pickerValue'
import { payrollAdjustmentsService } from '../../services/workflowService'
import { adjustmentsService, payrollRunsService } from '../../services/payrollService'
import { currenciesService } from '../../services/coreService'
import type { PayrollComponentType, PayrollRunListItem } from '../../types/payroll'
import type { RequestFormBody } from './newRequestShared'
import { t } from '../../i18n/t'
import { referenceName } from '../../i18n/referenceName'

const NO_TYPES: PayrollComponentType[] = []
const NO_RUNS: PayrollRunListItem[] = []

const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const fmt = (v: number) => v.toFixed(2)

/**
 * PAYROLL ADJUSTMENT — a correction raised as a request. HR states the claim; the Owner signs it;
 * only that final approval creates the ledger row the next Generate consumes. The SHELL's employee
 * dropdown is the subject — HR raising on behalf is the standard flow, so no hidesEmployee.
 */
export function usePayrollAdjustmentForm(employeeName: string | null, saving: boolean): RequestFormBody {
  const [types, setTypes] = useState<PayrollComponentType[]>(NO_TYPES)
  const [runs, setRuns] = useState<PayrollRunListItem[]>(NO_RUNS)
  const [currencies, setCurrencies] = useState<string[]>(['USD', 'LBP'])

  const [componentTypeId, setComponentTypeId] = useState<number | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [currencyCode, setCurrencyCode] = useState('USD')
  const [targetPeriod, setTargetPeriod] = useState(currentMonth())
  const [correctsRunId, setCorrectsRunId] = useState<number | null>(null)
  const [reason, setReason] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      adjustmentsService.componentTypes().catch(() => NO_TYPES),
      payrollRunsService.getList().catch(() => NO_RUNS),
      currenciesService.getAll().catch(() => []),
    ]).then(([ty, r, c]) => {
      if (cancelled) return
      setTypes(ty)
      setRuns(r.filter((x) => x.status === 'Approved'))
      if (c.length) setCurrencies(c.map((x) => x.currencyCode))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const chosenType = useMemo(
    () => types.find((ct) => ct.componentTypeId === componentTypeId) ?? null,
    [types, componentTypeId],
  )

  // The component's NAME is reference data with its own Arabic column; the category is a code.
  const typeLabel = (ct: PayrollComponentType): string =>
    t('body.payrollAdjustment.componentOption', {
      name: referenceName(ct),
      category: ct.category,
    })
  const runLabel = (r: PayrollRunListItem): string =>
    t('body.payrollAdjustment.runOption', { period: r.periodYearMonth })

  // Mirrors usp_PayrollAdjustment_Create's CONCAT.
  const autoTitle =
    chosenType && amount != null && amount > 0 && employeeName
      ? `Adjustment ${targetPeriod} - ${chosenType.sign < 0 ? '-' : '+'}${fmt(amount)} ${currencyCode} ${chosenType.name} (${employeeName})`
      : null

  const missing = !componentTypeId
    ? t('body.payrollAdjustment.missingComponent')
    : amount == null || amount <= 0
      ? t('body.payrollAdjustment.missingAmount')
      : reason.trim() === ''
        ? t('body.payrollAdjustment.missingReason')
        : null

  const node = (
    <>
      <div className="form-grid">
        <div className="form-field">
          <Select
            label={t('body.payrollAdjustment.component')}
            data={types.map((ct) => ({ value: String(ct.componentTypeId), label: typeLabel(ct) }))}
            value={componentTypeId != null ? String(componentTypeId) : null}
            searchable
            disabled={saving}
            onChange={(v) => setComponentTypeId(v != null ? Number(v) : null)}
          />
        </div>
        <div className="form-field">
          <NumberInput
            label={t('common.amount')}
            value={amount ?? ''}
            min={0}
            decimalScale={2}
            disabled={saving}
            onChange={(v) => setAmount(typeof v === 'number' ? v : null)}
          />
          {chosenType && (
            <div className="hint">
              {chosenType.sign < 0
                ? t('body.payrollAdjustment.deduction')
                : t('body.payrollAdjustment.earning')}
            </div>
          )}
        </div>
        <div className="form-field">
          <Select
            label={t('common.currency')}
            data={currencies}
            value={currencyCode}
            allowDeselect={false}
            disabled={saving}
            onChange={(v) => setCurrencyCode(v ?? 'USD')}
          />
        </div>
        <div className="form-field">
          {/* An adjustment must land in a real month, so an empty value is refused exactly as the
              native input's `if (v)` guard refused it — the state never goes blank. */}
          <MonthPickerInput
            label={t('body.payrollAdjustment.landsIn')}
            valueFormat="MMMM YYYY"
            leftSection={<IconCalendar size={14} />}
            value={monthToPicker(targetPeriod)}
            disabled={saving}
            onChange={(v) => {
              const month = monthFromPicker(v)
              if (month) setTargetPeriod(month)
            }}
          />
          <div className="hint">{t('body.payrollAdjustment.landsInHint')}</div>
        </div>
        <div className="form-field">
          <Select
            label={
              <>
                {t('body.payrollAdjustment.correctsRun')}{' '}
                <span className="form-optional">{t('common.optional')}</span>
              </>
            }
            data={runs.map((r) => ({ value: String(r.payrollRunId), label: runLabel(r) }))}
            value={correctsRunId != null ? String(correctsRunId) : null}
            clearable
            disabled={saving}
            onChange={(v) => setCorrectsRunId(v != null ? Number(v) : null)}
          />
          <div className="hint">{t('body.payrollAdjustment.correctsRunHint')}</div>
        </div>
      </div>

      <div className="form-field">
        <Textarea
          label={t('common.reason')}
          value={reason}
          minRows={2}
          placeholder={t('body.payrollAdjustment.reasonPlaceholder')}
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
      // `empId` is number | null because a hidesEmployee body has no subject. This type DOES have
      // one, so it is guarded here with the rest — which is also what narrows it back to a number.
      if (!empId || !componentTypeId || amount == null) throw new Error(t('common.formIncomplete'))
      const created = await payrollAdjustmentsService.create({
        employeeId: empId,
        componentTypeId,
        amount,
        currencyCode,
        targetPeriod,
        correctsRunId,
        reason: reason.trim(),
        title: title ?? undefined,
      })
      return {
        requestId: created.requestInstanceId,
        notice: t('body.payrollAdjustment.notice', { period: targetPeriod }),
      }
    },
  }
}
