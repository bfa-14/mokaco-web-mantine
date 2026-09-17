import { useEffect, useMemo, useState } from 'react'
import { Autocomplete, NumberInput, Select, Textarea } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { expensesService } from '../../services/workflowService'
import { currenciesService } from '../../services/coreService'
import type { RequestFormBody } from './newRequestShared'
import { t } from '../../i18n/t'
import { parseDecimal } from '../../components/numeric'
import type { NumberInputValue } from '../../components/numeric'

const FALLBACK_CURRENCIES = ['USD', 'LBP']

/**
 * Offered, not enforced — the field accepts a custom entry; the procedure only requires non-empty.
 * DELIBERATELY NOT TRANSLATED: whatever is chosen is STORED and appears in reports — the stored
 * vocabulary is a data decision (see docs/TRANSLATION_REVIEW.md in the original app).
 */
const CATEGORIES = ['Transport', 'Supplies', 'Fuel', 'Maintenance', 'Meals', 'Other']

/** The owner threshold, in USD. Named so the form's three statements cannot disagree about it. */
const THRESHOLD_USD = 50

function todayYMD(): string {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

const money = (v: number) => v.toFixed(2)

/**
 * The EXPENSE REIMBURSEMENT form body — a receipted out-of-pocket cost.
 * States two truths before submit: the RECEIPT rule (attachment required at approval, attached on
 * the request page) and the THRESHOLD (a likelihood, decided by the amount GRANTED server-side).
 * (Ported: the custom-value category SelectBox is a Mantine Autocomplete.)
 */
export function useExpenseReimbursementForm(employeeName: string | null, saving: boolean): RequestFormBody {
  const [currencies, setCurrencies] = useState<string[]>(FALLBACK_CURRENCIES)
  const [expenseDate, setExpenseDate] = useState<string | null>(null) // yyyy-MM-dd
  const [category, setCategory] = useState<string>('')
  /** As the box hands it over ("12." on the way to 12.5) — the number is derived. See numeric.ts. */
  const [amountRaw, setAmountRaw] = useState<NumberInputValue>('')
  const amount = parseDecimal(amountRaw)
  const [currencyCode, setCurrencyCode] = useState<string>('USD')
  const [description, setDescription] = useState('')

  useEffect(() => {
    let cancelled = false
    currenciesService
      .getAll()
      .then((c) => {
        if (!cancelled && c.length > 0) setCurrencies(c.map((x) => x.currencyCode))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * The one threshold statement the FORM can make honestly: USD amounts only, and as a likelihood —
   * what settles it is the figure the operations manager grants, which does not exist yet.
   */
  const thresholdHint = useMemo(() => {
    if (amount == null || amount <= 0) return null
    if (currencyCode !== 'USD') return t('body.expense.thresholdNonUsd')
    return amount > THRESHOLD_USD
      ? t('body.expense.thresholdAbove', { threshold: THRESHOLD_USD })
      : t('body.expense.thresholdUnder', { threshold: THRESHOLD_USD })
  }, [amount, currencyCode])

  const trimmedCategory = category.trim()

  // Mirrors usp_Expense_Create's CONCAT exactly.
  const autoTitle =
    expenseDate && amount != null && amount > 0 && trimmedCategory && employeeName
      ? `Expense ${expenseDate} - ${money(amount)} ${currencyCode} - ${trimmedCategory} (${employeeName})`
      : null

  const missing = !expenseDate
    ? t('body.expense.missingDate')
    : !trimmedCategory
      ? t('body.expense.missingCategory')
      : amount == null || amount <= 0
        ? t('body.expense.missingAmount')
        : null

  const node = (
    <>
      <div className="form-grid">
        <div className="form-field">
          {/* An expense cannot be claimed before it is incurred — `max` → `maxDate`, same string. */}
          <DatePickerInput
            label={t('body.expense.expenseDate')}
            valueFormat="DD/MM/YYYY"
            leftSection={<IconCalendar size={14} />}
            maxDate={todayYMD()}
            value={expenseDate}
            disabled={saving}
            onChange={(v) => setExpenseDate(v || null)}
          />
        </div>
        <div className="form-field">
          {/* Autocomplete = the "offered, not enforced" list: suggestions plus free entry. */}
          <Autocomplete
            label={t('body.expense.category')}
            data={CATEGORIES}
            value={category}
            placeholder={t('body.expense.categoryPlaceholder')}
            disabled={saving}
            onChange={setCategory}
          />
        </div>
        <div className="form-field">
          <NumberInput
            label={t('common.amount')}
            value={amountRaw}
            min={0}
            decimalScale={2}
            placeholder="0.00"
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
      </div>
      {thresholdHint && <div className="hint">{thresholdHint}</div>}

      <div className="form-field">
        <Textarea
          label={
            <>
              {t('common.description')}{' '}
              <span className="form-optional">{t('common.optional')}</span>
            </>
          }
          value={description}
          minRows={2}
          placeholder={t('body.expense.descriptionPlaceholder')}
          disabled={saving}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
      </div>

      <div className="hint">{t('body.expense.receiptNote')}</div>
    </>
  )

  return {
    node,
    autoTitle,
    missing,
    async submit(empId, title) {
      if (empId == null || !expenseDate || !trimmedCategory || amount == null)
        throw new Error(t('common.formIncomplete'))
      const created = await expensesService.create({
        employeeId: empId,
        expenseDate,
        category: trimmedCategory,
        amount,
        currencyCode,
        description: description.trim() || null,
        title: title ?? undefined,
      })
      return {
        requestId: created.requestInstanceId,
        // "Expect" rather than "will": the Owner step may still be skipped if the figure is cut.
        notice: created.ownerLikelyNeeded
          ? t('body.expense.noticeOwner', {
              amount: money(created.amountUsd),
              threshold: created.thresholdUsd,
            })
          : t('body.expense.noticeReceipt'),
      }
    },
  }
}
