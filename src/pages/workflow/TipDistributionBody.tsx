import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Button, MultiSelect, NumberInput, Select } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { IconCalendar, IconPlus, IconTrash } from '@tabler/icons-react'
import { tipDistributionsService } from '../../services/workflowService'
import { branchesService, employeesService } from '../../services/hrService'
import { currenciesService } from '../../services/coreService'
import type { Branch, EmployeeListItem } from '../../types/hr'
import type { Currency } from '../../types/core'
import type { RequestFormBody } from './newRequestShared'
import { t } from '../../i18n/t'

const FALLBACK_CURRENCIES = ['USD', 'LBP']
const NO_EMPLOYEES: EmployeeListItem[] = []

/** One entered pool amount. `key` is a stable row identity for React, never sent anywhere. */
interface AmountRow {
  key: number
  currencyCode: string
  amount: number | null
}

/** The split in integer cents — the procedure's own arithmetic; last person absorbs the remainder. */
export function splitTips(total: number, count: number): { perPerson: number; lastPerson: number } | null {
  if (!Number.isFinite(total) || total <= 0 || count < 1) return null
  const totalCents = Math.round(total * 100)
  const perCents = Math.round(totalCents / count)
  const lastCents = totalCents - perCents * (count - 1)
  return { perPerson: perCents / 100, lastPerson: lastCents / 100 }
}

const money = (v: number) => v.toFixed(2)

/**
 * The TIP DISTRIBUTION form body — a shift's pooled tips, in ONE OR MORE CURRENCIES, split equally.
 * THE SUBJECT IS A BRANCH, NOT A PERSON — the procedure derives the raiser from the token, so the
 * shell's Employee field is hidden (`hidesEmployee`). Starts on the raiser's own branch, applied
 * exactly once and only into an empty field. (Unchanged.)
 */
export function useTipDistributionForm(
  myBranchId: number | null,
  saving: boolean,
): RequestFormBody {
  const [branches, setBranches] = useState<Branch[]>([])
  const [currencies, setCurrencies] = useState<string[]>(FALLBACK_CURRENCIES)
  const [employees, setEmployees] = useState<EmployeeListItem[]>([])

  const [branchId, setBranchId] = useState<number | null>(null)
  /** Whether the raiser's own branch has been applied yet — applied EXACTLY ONCE. */
  const defaulted = useRef(false)
  const [shiftDate, setShiftDate] = useState<string | null>(null) // yyyy-MM-dd
  const nextKey = useRef(2)
  const [amounts, setAmounts] = useState<AmountRow[]>([{ key: 1, currencyCode: 'USD', amount: null }])
  const [participantIds, setParticipantIds] = useState<number[]>([])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      branchesService.getAll().catch(() => [] as Branch[]),
      currenciesService.getAll().catch(() => [] as Currency[]),
      employeesService.getAll().catch(() => [] as EmployeeListItem[]),
    ])
      .then(([b, c, e]) => {
        if (cancelled) return
        const active = b.filter((x) => x.isActive)
        setBranches(active)
        if (c.length > 0) setCurrencies(c.map((x) => x.currencyCode))
        setEmployees(e)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  /** START ON THE RAISER'S OWN BRANCH — once, never overriding a deliberate switch. (Unchanged.) */
  useEffect(() => {
    if (defaulted.current || branches.length === 0) return
    const mine = myBranchId != null ? branches.find((b) => b.branchId === myBranchId) : null
    const start = mine ?? (branches.length === 1 ? branches[0] : null)
    if (!start) return
    defaulted.current = true
    setBranchId((prev) => (prev == null ? start.branchId : prev))
  }, [branches, myBranchId])

  const branch = useMemo(
    () => branches.find((b) => b.branchId === branchId) ?? null,
    [branches, branchId],
  )

  const branchEmployees = useMemo(
    () =>
      branch
        ? employees.filter((e) => e.branch === branch.name && !e.terminationDate)
        : NO_EMPLOYEES,
    [employees, branch],
  )

  const chosen = useMemo(() => {
    const kept = participantIds.filter((id) => branchEmployees.some((e) => e.employeeId === id))
    return kept.length === participantIds.length ? participantIds : kept
  }, [participantIds, branchEmployees])

  /** Rows that are actually fillable: a currency and a positive amount. */
  const filled = useMemo(
    () => amounts.filter((a) => a.currencyCode && a.amount != null && a.amount > 0),
    [amounts],
  )

  /** One currency, one row — a duplicate is named before the procedure has to refuse it. */
  const duplicateCurrency = useMemo(() => {
    const seen = new Set<string>()
    for (const a of amounts) {
      if (!a.currencyCode) continue
      if (seen.has(a.currencyCode)) return a.currencyCode
      seen.add(a.currencyCode)
    }
    return null
  }, [amounts])

  /** The per-currency splits, derived — never state. */
  const splits = useMemo(
    () =>
      chosen.length > 0
        ? filled.map((a) => ({ ...a, split: splitTips(a.amount as number, chosen.length) }))
        : [],
    [filled, chosen],
  )

  const setRowCurrency = useCallback((key: number, code: string) => {
    setAmounts((prev) =>
      prev.some((r) => r.key === key && r.currencyCode !== code)
        ? prev.map((r) => (r.key === key ? { ...r, currencyCode: code } : r))
        : prev,
    )
  }, [])

  const setRowAmount = useCallback((key: number, value: number | null) => {
    setAmounts((prev) =>
      prev.some((r) => r.key === key && r.amount !== value)
        ? prev.map((r) => (r.key === key ? { ...r, amount: value } : r))
        : prev,
    )
  }, [])

  const addRow = useCallback(() => {
    setAmounts((prev) => {
      const used = new Set(prev.map((r) => r.currencyCode))
      const free = currencies.find((c) => !used.has(c)) ?? ''
      return [...prev, { key: nextKey.current++, currencyCode: free, amount: null }]
    })
  }, [currencies])

  const removeRow = useCallback((key: number) => {
    setAmounts((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev))
  }, [])

  /* ── derived text ── */

  const dateYMD = shiftDate

  // Mirrors the procedure: "Tips 2026-08-02 - 20.00 USD + 300000.00 LBP / 8 people".
  const amountsText =
    filled.length > 0 ? filled.map((a) => `${money(a.amount as number)} ${a.currencyCode}`).join(' + ') : null
  const autoTitle =
    dateYMD && amountsText && chosen.length > 0
      ? `Tips ${dateYMD} - ${amountsText} / ${chosen.length} people`
      : null

  const missing = !branchId
    ? t('body.tip.missingBranch')
    : !shiftDate
      ? t('body.tip.missingDate')
      : filled.length === 0
        ? t('body.tip.missingAmount')
        : duplicateCurrency
          ? t('body.tip.missingDuplicate', { currency: duplicateCurrency })
          : chosen.length === 0
            ? t('body.tip.missingParticipants')
            : null

  const node = (
    <>
      <div className="form-field">
        <Select
          label={t('common.branch')}
          data={branches.map((b) => ({ value: String(b.branchId), label: b.name }))}
          value={branchId != null ? String(branchId) : null}
          placeholder={t('body.tip.branchPlaceholder')}
          disabled={saving}
          onChange={(v) => {
            const next = v != null ? Number(v) : null
            setBranchId(next)
            setParticipantIds((prev) => (prev.length === 0 ? prev : []))
          }}
        />
      </div>

      <div className="form-field">
        <DatePickerInput
          label={t('body.tip.shiftDate')}
          valueFormat="DD/MM/YYYY"
          leftSection={<IconCalendar size={14} />}
          value={shiftDate}
          disabled={saving}
          onChange={(v) => setShiftDate(v || null)}
        />
      </div>

      <div className="form-field">
        <label className="form-label">{t('body.tip.amounts')}</label>
        {amounts.map((row) => (
          <div key={row.key} className="wf-amount-row">
            <Select
              data={currencies}
              value={row.currencyCode || null}
              w={110}
              disabled={saving}
              onChange={(v) => setRowCurrency(row.key, v ?? '')}
            />
            <NumberInput
              value={row.amount ?? ''}
              min={0}
              decimalScale={2}
              placeholder="0.00"
              disabled={saving}
              onChange={(v) => setRowAmount(row.key, typeof v === 'number' ? v : null)}
            />
            {amounts.length > 1 && (
              <ActionIcon
                variant="subtle"
                color="gray"
                disabled={saving}
                onClick={() => removeRow(row.key)}
                aria-label={t('common.remove', { defaultValue: 'Remove' })}
              >
                <IconTrash size={16} />
              </ActionIcon>
            )}
          </div>
        ))}
        {duplicateCurrency && (
          <div className="hint">
            {t('body.tip.duplicateCurrency', { currency: duplicateCurrency })}
          </div>
        )}
        {amounts.length < currencies.length && (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconPlus size={14} />}
            disabled={saving}
            onClick={addRow}
          >
            {t('body.tip.addCurrency')}
          </Button>
        )}
      </div>

      <div className="form-field">
        <MultiSelect
          label={t('body.tip.participants')}
          data={branchEmployees.map((e) => ({ value: String(e.employeeId), label: e.fullName }))}
          value={chosen.map(String)}
          searchable
          placeholder={
            branch ? t('body.tip.participantsPlaceholder') : t('body.tip.chooseBranchFirst')
          }
          nothingFoundMessage={t('body.tip.noEmployees')}
          disabled={saving || !branch}
          onChange={(vals) => setParticipantIds(vals.map(Number))}
        />

        {/* Said out loud: the raiser worked the shift too — leaving themselves out is a share of
            their own tips they will not notice missing until payroll. (Unchanged.) */}
        {branch && (
          <div className="hint">{t('body.tip.includingRaiser', { branch: branch.name })}</div>
        )}

        {splits.length > 0 && (
          <div className="wf-tip-preview">
            {splits.map((s) =>
              s.split ? (
                <div key={s.key}>
                  <strong>
                    {t('body.tip.splitLine', {
                      people: t('common.people', { count: chosen.length }),
                      amount: money(s.split.perPerson),
                      currency: s.currencyCode,
                    })}
                  </strong>
                  {s.split.perPerson !== s.split.lastPerson && (
                    <span className="wf-tip-remainder">
                      {t('body.tip.lastPerson', { amount: money(s.split.lastPerson) })}
                    </span>
                  )}
                </div>
              ) : null,
            )}
          </div>
        )}
      </div>
    </>
  )

  return {
    node,
    autoTitle,
    missing,
    // The subject is the BRANCH — the procedure derives the person from the token.
    hidesEmployee: true,
    async submit(_employeeId, title) {
      if (!branchId || !dateYMD || filled.length === 0) throw new Error(t('common.formIncomplete'))
      const created = await tipDistributionsService.create({
        branchId,
        shiftDate: dateYMD,
        amounts: filled.map((a) => ({ currencyCode: a.currencyCode, amount: a.amount as number })),
        participantIds: chosen,
        title: title ?? undefined,
      })
      return {
        requestId: created.requestInstanceId,
        notice: created.noAttendanceWarning
          ? t('body.tip.noticeNoAttendance', { names: created.noAttendanceWarning })
          : null,
      }
    },
  }
}
