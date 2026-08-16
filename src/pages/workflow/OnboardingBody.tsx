import { useEffect, useMemo, useState } from 'react'
import { Select, Textarea, TextInput } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { onboardingService } from '../../services/workflowService'
import { branchesService, departmentsService, positionsService } from '../../services/hrService'
import { branchOptions, departmentOptions, positionOptions } from '../../hr/assignableOptions'
import type { Branch, Department, Position } from '../../types/hr'
import type { RequestFormBody } from './newRequestShared'
import { t } from '../../i18n/t'

function todayYMD(): string {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

/**
 * The NEW HIRE ONBOARDING form body — the candidate's details and where they will work.
 * The candidate is NOT an employee yet, so this form has no employee picker (hidesEmployee); the
 * hr.EMPLOYEE record is created by the system when the hire is approved. Registration numbers are
 * optional here on purpose — the CHECKLIST on the request page is where they get filled in, and
 * the final step refuses to close while a required item is outstanding. (Unchanged.)
 */
export function useOnboardingForm(saving: boolean): RequestFormBody {
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [positions, setPositions] = useState<Position[]>([])

  const [candidateName, setCandidateName] = useState('')
  const [branchId, setBranchId] = useState<number | null>(null)
  const [departmentId, setDepartmentId] = useState<number | null>(null)
  const [positionId, setPositionId] = useState<number | null>(null)
  const [startDate, setStartDate] = useState<string | null>(null) // yyyy-MM-dd
  const [nationalId, setNationalId] = useState('')
  const [nssfNumber, setNssfNumber] = useState('')
  const [taxNumber, setTaxNumber] = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      branchesService.getAll().catch(() => [] as Branch[]),
      departmentsService.getAll().catch(() => [] as Department[]),
      positionsService.getAll().catch(() => [] as Position[]),
    ])
      .then(([b, d, p]) => {
        if (cancelled) return
        const active = b.filter((x) => x.isActive)
        setBranches(active)
        setDepartments(d)
        setPositions(p)
        if (active.length === 1) setBranchId(active[0].branchId)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const startYMD = startDate

  const positionTitle = useMemo(
    () => positions.find((p) => p.positionId === positionId)?.title ?? null,
    [positions, positionId],
  )
  const branchName = useMemo(
    () => branches.find((b) => b.branchId === branchId)?.name ?? null,
    [branches, branchId],
  )

  // Mirrors usp_Onboarding_Create's CONCAT.
  const autoTitle =
    candidateName.trim() && positionTitle && branchName && startYMD
      ? `New hire: ${candidateName.trim()} - ${positionTitle} at ${branchName} (from ${startYMD})`
      : null

  const missing = !candidateName.trim()
    ? t('body.onboarding.missingName')
    : !branchId
      ? t('body.onboarding.missingBranch')
      : !departmentId
        ? t('body.onboarding.missingDepartment')
        : !positionId
          ? t('body.onboarding.missingPosition')
          : !startYMD
            ? t('body.onboarding.missingStart')
            : null

  const node = (
    <>
      <div className="form-field">
        <TextInput
          label={t('body.onboarding.candidate')}
          value={candidateName}
          placeholder={t('body.onboarding.candidatePlaceholder')}
          disabled={saving}
          onChange={(e) => setCandidateName(e.currentTarget.value)}
        />
        <div className="hint">{t('body.onboarding.notEmployeeYet')}</div>
      </div>

      <div className="form-grid">
        <div className="form-field">
          <Select
            label={t('common.branch')}
            /* No `current` on any of the three: a new hire is being placed for the first time, so
               there is no existing assignment to preserve — only active postings are offerable. */
            data={branchOptions(branches, null)}
            value={branchId != null ? String(branchId) : null}
            disabled={saving}
            onChange={(v) => setBranchId(v != null ? Number(v) : null)}
          />
        </div>
        <div className="form-field">
          <Select
            label={t('common.department')}
            data={departmentOptions(departments, null)}
            value={departmentId != null ? String(departmentId) : null}
            disabled={saving}
            onChange={(v) => setDepartmentId(v != null ? Number(v) : null)}
          />
        </div>
        <div className="form-field">
          <Select
            label={t('common.position')}
            data={positionOptions(positions, null)}
            value={positionId != null ? String(positionId) : null}
            searchable
            disabled={saving}
            onChange={(v) => setPositionId(v != null ? Number(v) : null)}
          />
        </div>
        <div className="form-field">
          <DatePickerInput
            label={t('body.onboarding.startDate')}
            valueFormat="DD/MM/YYYY"
            leftSection={<IconCalendar size={14} />}
            minDate={todayYMD()}
            value={startDate}
            disabled={saving}
            onChange={(v) => setStartDate(v || null)}
          />
        </div>
      </div>

      <div className="form-grid">
        <div className="form-field">
          <TextInput
            label={
              <>
                {t('body.onboarding.nationalId')}{' '}
                <span className="form-optional">{t('common.optional')}</span>
              </>
            }
            value={nationalId}
            disabled={saving}
            onChange={(e) => setNationalId(e.currentTarget.value)}
          />
        </div>
        <div className="form-field">
          <TextInput
            label={
              <>
                {t('body.onboarding.nssfNumber')}{' '}
                <span className="form-optional">{t('common.optional')}</span>
              </>
            }
            value={nssfNumber}
            disabled={saving}
            onChange={(e) => setNssfNumber(e.currentTarget.value)}
          />
        </div>
        <div className="form-field">
          <TextInput
            label={
              <>
                {t('body.onboarding.taxNumber')}{' '}
                <span className="form-optional">{t('common.optional')}</span>
              </>
            }
            value={taxNumber}
            disabled={saving}
            onChange={(e) => setTaxNumber(e.currentTarget.value)}
          />
        </div>
        <div className="form-field">
          <TextInput
            label={
              <>
                {t('body.onboarding.bankAccount')}{' '}
                <span className="form-optional">{t('common.optional')}</span>
              </>
            }
            value={bankAccount}
            disabled={saving}
            onChange={(e) => setBankAccount(e.currentTarget.value)}
          />
        </div>
      </div>
      <div className="hint">{t('body.onboarding.registrationNote')}</div>

      <div className="form-field">
        <Textarea
          label={
            <>
              {t('common.notes')} <span className="form-optional">{t('common.optional')}</span>
            </>
          }
          value={notes}
          minRows={2}
          disabled={saving}
          onChange={(e) => setNotes(e.currentTarget.value)}
        />
      </div>
    </>
  )

  return {
    node,
    autoTitle,
    missing,
    hidesEmployee: true, // the subject is the raiser; the candidate is not an employee yet
    async submit(_employeeId, title) {
      if (!branchId || !departmentId || !positionId || !startYMD) {
        throw new Error(t('common.formIncomplete'))
      }
      const created = await onboardingService.create({
        candidateName: candidateName.trim(),
        branchId,
        departmentId,
        positionId,
        startDate: startYMD,
        nationalId: nationalId.trim() || null,
        nssfNumber: nssfNumber.trim() || null,
        taxNumber: taxNumber.trim() || null,
        bankAccount: bankAccount.trim() || null,
        notes: notes.trim() || null,
        title: title ?? undefined,
      })
      return {
        requestId: created.requestInstanceId,
        notice: t('body.onboarding.noticeChecklist', { count: created.taskCount }),
      }
    },
  }
}
