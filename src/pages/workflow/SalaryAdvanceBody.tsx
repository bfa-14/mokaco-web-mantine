/* src/pages/workflow/SalaryAdvanceBody.tsx */
import { useEffect, useMemo, useState } from 'react'
import { NumberInput, Select, Textarea } from '@mantine/core'
import { MonthPickerInput } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { monthFromPicker, monthToPicker } from '../../components/date/pickerValue'
import { salaryAdvancesService } from '../../services/workflowService'
import { currenciesService } from '../../services/coreService'
import type { RequestFormBody } from './newRequestShared'
import { t } from '../../i18n/t'
import { parseDecimal } from '../../components/numeric'
import type { NumberInputValue } from '../../components/numeric'

const nextMonth = () => {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const fmt = (v: number) => v.toFixed(2)

/**
 * SALARY ADVANCE — money lent against future pay, asked for as a request.
 * The recovery line is computed and shown (the same CEILING the procedure computes). Recovery
 * starts in an OPEN month — the procedure refuses a locked period, at creation and at the final
 * signature. (Ported: the month field is a MonthPickerInput; the state stays 'yyyy-MM' — see
 * pickerValue.ts for why that needs an adapter and the date fields do not.)
 */
export function useSalaryAdvanceForm(employeeName: string | null, saving: boolean): RequestFormBody {
  const [currencies, setCurrencies] = useState<string[]>(['USD', 'LBP'])

  /* Both figures are held AS THE BOX HANDS THEM OVER ("12." on the way to 12.5) and the numbers
     are derived; writing a number back mid-decimal is what made "8.2" collapse to 0 elsewhere. */
  const [amountRaw, setAmountRaw] = useState<NumberInputValue>('')
  const amount = parseDecimal(amountRaw)
  const [currencyCode, setCurrencyCode] = useState('USD')
  const [monthlyDeductionRaw, setMonthlyDeductionRaw] = useState<NumberInputValue>('')
  const monthlyDeduction = parseDecimal(monthlyDeductionRaw)
  const [firstDeductionPeriod, setFirstDeductionPeriod] = useState(nextMonth())
  const [reason, setReason] = useState('')

  useEffect(() => {
    let cancelled = false
    currenciesService
      .getAll()
      .catch(() => [])
      .then((c) => {
        if (cancelled) return
        if (c.length) setCurrencies(c.map((x) => x.currencyCode))
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** Months to recover — null until BOTH figures are usable. */
  const months = useMemo(() => {
    if (amount == null || amount <= 0) return null
    if (monthlyDeduction == null || monthlyDeduction <= 0) return null
    return Math.ceil(amount / monthlyDeduction)
  }, [amount, monthlyDeduction])

  // Mirrors usp_SalaryAdvance_Create's CONCAT.
  const autoTitle =
    amount != null && amount > 0 && months != null && employeeName
      ? `Advance ${fmt(amount)} ${currencyCode} over ${months} month(s) (${employeeName})`
      : null

  // Shape only — the open-period and one-advance-at-a-time rules are the procedure's.
  const missing =
    amount == null || amount <= 0
      ? t('body.salaryAdvance.missingAmount')
      : monthlyDeduction == null || monthlyDeduction <= 0
        ? t('body.salaryAdvance.missingDeduction')
        : monthlyDeduction > amount
          ? t('body.salaryAdvance.missingDeductionSize')
          : null

  const node = (
    <>
      <div className="form-grid">
        <div className="form-field">
          <NumberInput
            label={t('common.amount')}
            value={amountRaw}
            min={0}
            decimalScale={2}
            disabled={saving}
            onChange={setAmountRaw}
          />
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
          <NumberInput
            label={t('body.salaryAdvance.monthlyDeduction')}
            value={monthlyDeductionRaw}
            min={0}
            decimalScale={2}
            disabled={saving}
            onChange={setMonthlyDeductionRaw}
          />
          <div className="hint">{t('body.salaryAdvance.monthlyHint')}</div>
        </div>
        <div className="form-field">
          {/* Recovery must start in a real month, so an empty value is refused exactly as the
              native input's `if (v)` guard refused it — the state never goes blank. */}
          <MonthPickerInput
            label={t('body.salaryAdvance.firstDeducted')}
            valueFormat="MMMM YYYY"
            leftSection={<IconCalendar size={14} />}
            value={monthToPicker(firstDeductionPeriod)}
            disabled={saving}
            onChange={(v) => {
              const month = monthFromPicker(v)
              if (month) setFirstDeductionPeriod(month)
            }}
          />
          <div className="hint">{t('body.salaryAdvance.firstDeductedHint')}</div>
        </div>
      </div>

      {months != null && (
        <div className="hint">
          {t('body.salaryAdvance.recoveredOver', { months: t('common.months', { count: months }) })}
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
          placeholder={t('body.salaryAdvance.reasonPlaceholder')}
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
      if (!empId || amount == null || monthlyDeduction == null)
        throw new Error(t('common.formIncomplete'))
      const created = await salaryAdvancesService.create({
        employeeId: empId,
        amount,
        currencyCode,
        monthlyDeduction,
        firstDeductionPeriod,
        reason: reason.trim() || null,
        title: title ?? undefined,
      })
      return {
        requestId: created.requestInstanceId,
        notice: t('body.salaryAdvance.notice', { period: firstDeductionPeriod }),
      }
    },
  }
}
