/* src/pages/workflow/RosterApprovalBody.tsx */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Select } from '@mantine/core'
import { MonthPickerInput } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { rosterApprovalsService } from '../../services/workflowService'
import { branchesService } from '../../services/hrService'
import type { Branch } from '../../types/hr'
import type { RequestFormBody } from './newRequestShared'
import { t } from '../../i18n/t'

/**
 * The month a roster approval starts on — THIS month, as its first day.
 *
 * Built from the local calendar rather than an ISO slice, because toISOString() is UTC and would
 * hand somebody east of Greenwich the previous month for the first few hours of every first.
 */
export function currentMonthDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

/** Whatever the picker hands back, normalised to the first of that month. */
function firstOfMonth(value: string): string {
  return `${value.slice(0, 7)}-01`
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/**
 * 'yyyy-MM-01' → 'August 2026', IN ENGLISH and deliberately so.
 *
 * This feeds the auto-title, which exists to mirror what the procedure will store — and the
 * procedure composes its month name in English. A title that translated itself would show one
 * thing in the preview and another in the request list the moment the page is read in Arabic.
 * The FIELD is localised (MonthPickerInput formats in the app's locale); only the stored title
 * is fixed, exactly as every other body's composed title is.
 */
export function titleMonth(monthDate: string): string | null {
  const [year, month] = monthDate.split('-').map(Number)
  if (!year || !month || month < 1 || month > 12) return null
  return `${MONTH_NAMES[month - 1]} ${year}`
}

/**
 * The ROSTER APPROVAL form body — a branch's WHOLE MONTH of roster, put up for signature.
 *
 * THE SUBJECT IS A BRANCH AND A MONTH, NOT A PERSON. There is no employee in the payload at all,
 * so the shell's Employee field is removed rather than ignored (`hidesEmployee`) — the same
 * arrangement tip distribution uses, and for the same reason.
 *
 * NOTHING IS VALIDATED HERE THAT THE SERVER OWNS. Whether this branch-month is already approved,
 * or already pending on somebody's desk, is the endpoint's rule and its refusal is a sentence
 * worth reading — so `submit` lets the 400 through untouched and the shell prints it verbatim on
 * the form, where the user is still standing. Swallowing it into a toast would lose the one piece
 * of information that tells them what to do next.
 */
export function useRosterApprovalForm(
  myBranchId: number | null,
  saving: boolean,
): RequestFormBody {
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchId] = useState<number | null>(null)
  /** Whether the raiser's own branch has been applied yet — applied EXACTLY ONCE. */
  const defaulted = useRef(false)
  /** 'yyyy-MM-01'. Never blank: the picker cannot clear it and the guard below refuses an empty. */
  const [monthDate, setMonthDate] = useState(currentMonthDate())

  useEffect(() => {
    let cancelled = false
    branchesService
      .getAll()
      .catch(() => [] as Branch[])
      .then((list) => {
        if (!cancelled) setBranches(list.filter((b) => b.isActive))
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** START ON THE RAISER'S OWN BRANCH — once, never overriding a deliberate switch. */
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

  const monthLabel = titleMonth(monthDate)

  // Mirrors what the procedure composes: "Roster — Hamra August 2026".
  const autoTitle = branch && monthLabel ? `Roster — ${branch.name} ${monthLabel}` : null

  // Shape only. One-per-branch-month is the server's rule and stays there.
  const missing = !branchId ? t('body.rosterApproval.missingBranch') : null

  const node = (
    <>
      <div className="form-grid">
        <div className="form-field">
          <Select
            label={t('common.branch')}
            data={branches.map((b) => ({ value: String(b.branchId), label: b.name }))}
            value={branchId != null ? String(branchId) : null}
            placeholder={t('body.rosterApproval.branchPlaceholder')}
            disabled={saving}
            allowDeselect={false}
            onChange={(v) => setBranchId(v != null ? Number(v) : null)}
          />
        </div>

        <div className="form-field">
          {/* A month is REQUIRED, so an empty value is refused rather than stored: the state never
              goes blank, the same guard the salary-advance month uses. The picker speaks
              'YYYY-MM-DD' and this state IS that shape already — day 01 — so no adapter is
              needed; the normalisation is only there in case a picker hands back another day. */}
          <MonthPickerInput
            label={t('body.rosterApproval.month')}
            valueFormat="MMMM YYYY"
            leftSection={<IconCalendar size={14} />}
            value={monthDate}
            disabled={saving}
            onChange={(v) => {
              if (v) setMonthDate(firstOfMonth(v))
            }}
          />
          <div className="hint">{t('body.rosterApproval.monthHint')}</div>
        </div>
      </div>

      {branch && monthLabel && (
        <p className="hint">
          {t('body.rosterApproval.covers', { branch: branch.name, month: monthLabel })}
        </p>
      )}
    </>
  )

  return {
    node,
    autoTitle,
    missing,
    // The subject is the BRANCH AND THE MONTH — there is no employee in the payload.
    hidesEmployee: true,
    async submit(_employeeId, title) {
      if (!branchId || !monthDate) throw new Error(t('common.formIncomplete'))
      const created = await rosterApprovalsService.create({
        branchId,
        monthDate,
        title: title ?? undefined,
      })
      return { requestId: created.requestInstanceId }
    },
  }
}
