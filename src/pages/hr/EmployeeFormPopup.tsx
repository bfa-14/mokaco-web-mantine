import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Select, TextInput } from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { DatePickerInput } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import {
  branchesService,
  departmentsService,
  employeesService,
  positionsService,
} from '../../services/hrService'
import { branchManagerService } from '../../services/workflowService'
import type { BranchWithManager } from '../../types/workflow'
import { usersService } from '../../services/securityService'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import type {
  Branch,
  Department,
  EmployeeListItem,
  EmployeeLoginStatus,
  EmployeeProfile,
  Position,
  ReportingLineEntry,
} from '../../types/hr'
import { employeeLabel } from '../../types/hr'
import { useApprovalTiers } from '../../hr/useApprovalTiers'
import { branchOptions, departmentOptions, positionOptions } from '../../hr/assignableOptions'
import { useTranslation } from 'react-i18next'
import type { UnlinkedUser } from '../../types/security'

/**
 * notify(msg, type, ms) → Mantine notifications, adapted once so every call site below
 * stays byte-identical to the original.
 */
function notify(message: string, type: 'success' | 'warning' | 'error', ms: number) {
  notifications.show({
    message,
    color: type === 'success' ? 'green' : type === 'warning' ? 'orange' : 'red',
    autoClose: ms,
  })
}

/**
 * DevExtreme's `confirm(message, title)` dialog, rebuilt as a promise-backed Mantine Modal so the
 * call site keeps its original `const ok = await …; if (!ok) return` shape. Closing the dialog any
 * other way answers "no".
 */
interface ConfirmState {
  title: string
  message: ReactNode
  resolve: (proceed: boolean) => void
}

interface FormState {
  fullName: string
  branchId: number | null
  departmentId: number | null
  positionId: number | null
  hireDate: string
  nationalId: string
  nssfNumber: string
  email: string
  phoneNumber: string
  preferredLanguage: string
  userId: number | null
  terminationDate: string
  /**
   * 1 = head of the organisation, and a bigger number is more junior.
   *
   * NULL IS A REAL STATE ON CREATE — "not chosen yet" — and it is load-bearing: the "Reports to"
   * candidates are derived from this number, so offering that field before a tier exists would
   * offer a list nobody can yet say is right. On edit it is always filled from the record.
   */
  approvalTier: number | null
  /** Who this person reports to, or null for the top of a line. Saved via its own endpoint. */
  reportsToEmployeeId: number | null
}

const EMPTY: FormState = {
  fullName: '',
  branchId: null,
  departmentId: null,
  positionId: null,
  hireDate: '',
  nationalId: '',
  nssfNumber: '',
  email: '',
  phoneNumber: '',
  preferredLanguage: 'en',
  userId: null,
  terminationDate: '',
  approvalTier: null,
  reportsToEmployeeId: null,
}

/* PORT NOTE: DevExtreme ValidationGroup/RequiredRule → the same five required checks, message for
   message, run in submit() and shown as field-level errors. */
/**
 * DELIBERATELY LOOSE: one @, a dot after it, no spaces.
 *
 * The strict RFC grammar is famously enormous, and every compact approximation of it rejects
 * addresses that genuinely deliver. What this is actually for is catching the typo — the missing
 * @, the trailing comma from a pasted list — and the real verification is the mail either arriving
 * or bouncing into EMAIL_OUTBOX.Error, which is a better test than any regex.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface FieldErrors {
  fullName?: string
  /** Only ever set for a MALFORMED address — an empty box is a valid answer, not an error. */
  email?: string
  branchId?: string
  departmentId?: string
  positionId?: string
  hireDate?: string
  /**
   * The reporting-line endpoint's own refusal.
   *
   * A FIELD ERROR RATHER THAN A TOAST, because the tier rule is enforced by a database trigger and
   * the client's filter is only its best guess at the same rule: when the two disagree the server
   * is right, and its sentence has to sit under the box still holding the wrong answer — a toast
   * would fade while the bad selection stayed on screen looking accepted.
   */
  reportsTo?: string
}

/**
 * One "Reports to" candidate. The tier rides along so the option can NAME it — the filter alone
 * leaves the reader to trust a list they cannot check.
 */
interface ManagerOption {
  employeeId: number
  fullName: string
  approvalTier: number | null
}

/** The shape the account picker renders — unlinked accounts, plus (in edit) the currently-linked one. */
interface AccountOption {
  userId: number
  username: string
  isActive: boolean
}

/** ONE WORDING for an account, in the picker: "username — disabled" when the login is off. */
const accountLabel = (u: AccountOption): string =>
  `${u.username}${u.isActive ? '' : ' — disabled'}`

interface EmployeeFormPopupProps {
  visible: boolean
  /** null → create; a profile → edit. */
  employee: EmployeeProfile | null
  onClose: () => void
  onSaved: () => void
}

export function EmployeeFormPopup({
  visible,
  employee,
  onClose,
  onSaved,
}: EmployeeFormPopupProps) {
  const isEdit = employee !== null
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  // Linking an account is account administration; hide the whole section from anyone who cannot do it.
  const canManageAccounts = hasPermission('USER_MANAGE')

  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [unlinked, setUnlinked] = useState<UnlinkedUser[]>([])
  /** Every active employee — the "Reports to" options (self excluded when rendering). */
  const [employees, setEmployees] = useState<EmployeeListItem[]>([])
  /** Branch → manager, so a new employee can default their "Reports to" to their branch's manager. */
  const [branchManagers, setBranchManagers] = useState<BranchWithManager[]>([])
  /** This person's chain of command (edit only), bottom-up from usp_Employee_GetReportingLine. */
  const [reportingLine, setReportingLine] = useState<ReportingLineEntry[]>([])
  /** This employee's login row (edit only) — the source of the current username and branch-manager status. */
  const [loginRow, setLoginRow] = useState<EmployeeLoginStatus | null>(null)

  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  /**
   * A manager choice that a TIER CHANGE has just invalidated and removed.
   *
   * Kept as its own flag rather than folded into fieldErrors: nothing was refused and nothing is
   * wrong — the form quietly stopped being true, and saying so is the difference between a field
   * that emptied itself for a reason and one that looks like it lost the value.
   */
  const [tierClearedManager, setTierClearedManager] = useState(false)

  /**
   * The seniority dictionary, from the shared cache.
   *
   * The employee may ALREADY hold a tier the dictionary no longer lists — a Select whose value is
   * absent from its data renders blank, and saving that blank would silently demote them. So a
   * missing tier is added back as its own option rather than dropped.
   */
  const { options: tierOptionsFromDict, tierName } = useApprovalTiers()
  const tierOptions =
    form.approvalTier == null ||
    tierOptionsFromDict.some((o) => o.value === String(form.approvalTier))
      ? tierOptionsFromDict
      : [
          ...tierOptionsFromDict,
          { value: String(form.approvalTier), label: tierName(form.approvalTier) },
        ]

  /** The confirm dialog currently on screen, if any — see ConfirmState. */
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  const askConfirm = (message: ReactNode, title: string): Promise<boolean> =>
    new Promise<boolean>((resolve) => setConfirmState({ title, message, resolve }))

  function settleConfirm(proceed: boolean) {
    confirmState?.resolve(proceed)
    setConfirmState(null)
  }

  // Unlinked accounts + (in edit) this employee's login status. Refreshed after an unlink.
  async function loadAccounts() {
    if (!canManageAccounts) return
    const [unlinkedList, statusList] = await Promise.all([
      usersService.unlinked().catch(() => [] as UnlinkedUser[]),
      isEdit && employee
        ? employeesService.getLoginStatus().catch(() => [] as EmployeeLoginStatus[])
        : Promise.resolve([] as EmployeeLoginStatus[]),
    ])
    setUnlinked(unlinkedList)
    if (isEdit && employee)
      setLoginRow(statusList.find((r) => r.employeeId === employee.employeeId) ?? null)
  }

  /** Refresh the chain of command shown under "Reports to" — edit only; a new employee has none yet. */
  async function loadReportingLine() {
    if (!isEdit || !employee) return
    const line = await employeesService
      .getReportingLine(employee.employeeId)
      .catch(() => [] as ReportingLineEntry[])
    setReportingLine(line)
  }

  // Load the lookup lists once.
  useEffect(() => {
    let cancelled = false
    async function loadLookups() {
      const [b, d, p, emps, bm] = await Promise.all([
        branchesService.getAll().catch(() => [] as Branch[]),
        departmentsService.getAll().catch(() => [] as Department[]),
        positionsService.getAll().catch(() => [] as Position[]),
        employeesService.getAll().catch(() => [] as EmployeeListItem[]),
        // Best-effort: needs branch-manager read access. Its absence just means no auto-default.
        branchManagerService.getAll().catch(() => [] as BranchWithManager[]),
      ])
      if (!cancelled) {
        setBranches(b)
        setDepartments(d)
        setPositions(p)
        setEmployees(emps)
        setBranchManagers(bm)
      }
      await loadAccounts()
      await loadReportingLine()
    }
    void loadLookups()
    return () => {
      cancelled = true
    }
    // Mount-once; canManageAccounts/employee are stable for a given mounted popup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Populate the form when the popup opens (an event, so React state stays in sync
  // without a cascading-render effect).
  function populateForm() {
    setFieldErrors({})
    if (employee) {
      setForm({
        fullName: employee.fullName,
        branchId: employee.branchId,
        departmentId: employee.departmentId,
        positionId: employee.positionId,
        hireDate: employee.hireDate?.slice(0, 10) ?? '',
        nationalId: employee.nationalId ?? '',
        nssfNumber: employee.nssfNumber ?? '',
        email: employee.email ?? '',
        phoneNumber: employee.phoneNumber ?? '',
        // Defaulted rather than blanked: the column is NOT NULL, so an employee loaded without one
        // is a read that predates the column, not a person with no language.
        preferredLanguage: employee.preferredLanguage ?? 'en',
        userId: employee.userId,
        terminationDate: employee.terminationDate?.slice(0, 10) ?? '',
        approvalTier: employee.approvalTier ?? null,
        reportsToEmployeeId: employee.reportsToEmployeeId ?? null,
      })
    } else {
      setForm(EMPTY)
    }
    setTierClearedManager(false)
  }

  /* PORT NOTE: the DX Popup's onShowing event → state adjusted during render when `visible` flips
     open, the sanctioned pattern for prop-derived state (same as RequestsHubPage's view pref).
     Starts false so a popup mounted already-visible still populates on its first render. */
  const [wasVisible, setWasVisible] = useState(false)
  if (visible !== wasVisible) {
    setWasVisible(visible)
    if (visible) populateForm()
  }

  // Edit picker options: the current account (so leaving the field untouched keeps it) + unlinked ones.
  const currentAccount: AccountOption | null =
    isEdit && employee?.userId != null
      ? {
          userId: employee.userId,
          username: loginRow?.username ?? 'Current account',
          isActive: loginRow?.userIsActive ?? true,
        }
      : null
  const editAccountItems: AccountOption[] = currentAccount
    ? [currentAccount, ...unlinked]
    : unlinked

  /** The tier of a candidate, from the list the API already returns. Null = never assigned one. */
  const tierOf = (employeeId: number): number | null =>
    employees.find((e) => e.employeeId === employeeId)?.approvalTier ?? null

  /**
   * "REPORTS TO" — SENIORITY-FILTERED.
   *
   * A manager must sit at this person's tier or ABOVE it, and 1 is the head, so "above" is a
   * SMALLER number: `candidate.approvalTier <= form.approvalTier`. Same-tier is allowed on purpose —
   * a shift supervisor reporting to another supervisor is an ordinary arrangement, and it is the
   * database trigger, not this list, that owns the final word.
   *
   * Three exclusions beyond the tier test: the person being edited (you cannot report to yourself),
   * anybody who has LEFT (terminationDate set — a departed manager makes every line-manager step
   * resolve to nobody), and anybody with no tier at all, whose seniority is simply unknown and so
   * cannot be shown to satisfy the rule.
   *
   * THE CURRENT MANAGER IS KEPT WHATEVER THE FILTER SAYS. The Select is keyed off the value the form
   * holds, so dropping a stored manager who no longer qualifies would render a blank box over a real
   * value and save that blank. Tier changes clear it deliberately, with a sentence — see the tier
   * Select's onChange; silence is the one outcome that must not happen here.
   */
  const managerOptions: ManagerOption[] = (() => {
      const tier = form.approvalTier
      const opts: ManagerOption[] =
        tier == null
          ? []
          : employees
              .filter(
                (e) =>
                  e.employeeId !== employee?.employeeId &&
                  e.terminationDate == null &&
                  e.approvalTier != null &&
                  e.approvalTier <= tier,
              )
              .map((e) => ({
                employeeId: e.employeeId,
                fullName: e.fullName,
                approvalTier: e.approvalTier,
              }))
      const current = form.reportsToEmployeeId
      if (current != null && !opts.some((o) => o.employeeId === current)) {
        opts.unshift({
          employeeId: current,
          fullName: employee?.reportsToName ?? 'Current manager',
          approvalTier: tierOf(current),
        })
      }
      return opts
    })()

  async function confirmUnlink() {
    if (!employee) return
    const ok = await askConfirm(
      <>
        <b>{employee.fullName}</b> will no longer be able to sign in or raise requests. Requests
        they already raised are not affected.
        {loginRow?.isBranchManager && (
          <>
            <br />
            <br />
            <span style={{ color: '#c53030' }}>
              They manage {loginRow.branchName}. Branch-manager approvals for that branch will be
              skipped until you link them again or set a different manager.
            </span>
          </>
        )}
      </>,
      'Unlink account',
    )
    if (!ok) return
    try {
      const result = await employeesService.unlinkUser(employee.employeeId)
      if (result.requestsLeftWaiting > 0)
        notify(
          `${result.requestsLeftWaiting} request${result.requestsLeftWaiting === 1 ? ' was' : 's were'} waiting on this person and can no longer be signed by them.`,
          'warning',
          6000,
        )
      else notify('Account unlinked.', 'success', 2500)
      setForm((f) => ({ ...f, userId: null }))
      await loadAccounts()
      onSaved()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 5000)
    }
  }

  async function submit() {
    // The DX RequiredRules are gone with DevExtreme; the same rules, in the same words, run here.
    const errors: FieldErrors = {}
    if (!form.fullName.trim()) errors.fullName = 'Full name is required'
    if (form.branchId == null) errors.branchId = 'Branch is required'
    if (form.departmentId == null) errors.departmentId = 'Department is required'
    if (form.positionId == null) errors.positionId = 'Position is required'
    if (!form.hireDate) errors.hireDate = 'Hire date is required'
    // OPTIONAL, SO ONLY A FILLED BOX IS JUDGED. The check is deliberately loose — one @, a dot
    // after it, no spaces — because the strict grammar rejects addresses that genuinely deliver,
    // and the cost of a typo here is a mail nobody receives, not a corrupted record.
    if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim()))
      errors.email = t('hr.employee.emailInvalid')
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSaving(true)
    try {
      if (isEdit && employee) {
        await employeesService.update(employee.employeeId, {
          branchId: form.branchId!,
          departmentId: form.departmentId!,
          positionId: form.positionId!,
          fullName: form.fullName.trim(),
          nationalId: form.nationalId.trim() || null,
          nssfNumber: form.nssfNumber.trim() || null,
          email: form.email.trim() || null,
          phoneNumber: form.phoneNumber.trim() || null,
          preferredLanguage: form.preferredLanguage,
          hireDate: form.hireDate,
          terminationDate: form.terminationDate || null,
        })
        // The account is linked separately (usp_Employee_Update does not touch UserId). Only when the
        // picked account actually changed — leaving the field alone must never re-link or clear.
        if (form.userId != null && form.userId !== employee.userId) {
          const link = await employeesService.linkUser(employee.employeeId, form.userId)
          if (link.warning) notify(link.warning, 'warning', 6000)
        }
        // The tier has its own endpoint too; only touch it when it actually changed. Null means
        // "left alone" — the field cannot be un-set once chosen, so this only skips.
        if (form.approvalTier != null && form.approvalTier !== (employee.approvalTier ?? 1)) {
          await employeesService.setApprovalTier(employee.employeeId, form.approvalTier)
        }
        /* Reports-to is its own endpoint as well; only when changed. THE TRIGGER IS THE REAL RULE —
           it refuses a junior manager, a self-reference and any loop — and the list above is only
           this client's reading of it. So a refusal here lands UNDER THE FIELD and the popup stays
           open on the offending selection, rather than closing over a change that did not happen.
           The rest of the edit did save, so the grid is refreshed either way. */
        if (form.reportsToEmployeeId !== (employee.reportsToEmployeeId ?? null)) {
          try {
            const res = await employeesService.setReportsTo(
              employee.employeeId,
              form.reportsToEmployeeId,
            )
            if (res.warning) notify(res.warning, 'warning', 6000)
          } catch (err) {
            setFieldErrors((fe) => ({ ...fe, reportsTo: getErrorMessage(err) }))
            setTierClearedManager(false)
            onSaved()
            return
          }
        }
        notify('Employee updated.', 'success', 2200)
      } else {
        const created = await employeesService.create({
          userId: form.userId,
          branchId: form.branchId!,
          departmentId: form.departmentId!,
          positionId: form.positionId!,
          fullName: form.fullName.trim(),
          nationalId: form.nationalId.trim() || null,
          nssfNumber: form.nssfNumber.trim() || null,
          email: form.email.trim() || null,
          phoneNumber: form.phoneNumber.trim() || null,
          preferredLanguage: form.preferredLanguage,
          hireDate: form.hireDate,
        })
        // Create defaults everyone to Staff; set the tier straight after only when it differs.
        // An untouched tier (null) leaves the server's own default standing, as before.
        if (form.approvalTier != null && form.approvalTier !== 1) {
          await employeesService.setApprovalTier(created.employeeId, form.approvalTier)
        }
        /* A new employee reports to nobody by default; set it only when one was chosen. The
           employee EXISTS by now, so a refusal here cannot be undone by closing — the message goes
           under the field and the popup stays open on it, the same as the edit path. */
        if (form.reportsToEmployeeId != null) {
          try {
            const res = await employeesService.setReportsTo(created.employeeId, form.reportsToEmployeeId)
            if (res.warning) notify(res.warning, 'warning', 6000)
          } catch (err) {
            setFieldErrors((fe) => ({ ...fe, reportsTo: getErrorMessage(err) }))
            setTierClearedManager(false)
            notify('Employee created, but the reporting line was refused.', 'warning', 6000)
            onSaved()
            return
          }
        }
        notify('Employee created.', 'success', 2200)
      }
      onSaved()
      onClose()
    } catch (err) {
      // A taken login comes back as the friendly "already linked to {name}" message, verbatim.
      notify(getErrorMessage(err), 'error', 5000)
    } finally {
      setSaving(false)
    }
  }

  const accountHint =
    'Without an account this employee cannot sign in or raise requests. You can link one later.'

  return (
    <>
      <Modal
        opened={visible}
        onClose={onClose}
        title={isEdit ? 'Edit Employee' : 'New Employee'}
        size={560}
        centered
      >
        <div className="form-grid">
          <div className="form-field full">
            <label className="form-label" htmlFor="emp-name">
              Full name
            </label>
            <TextInput
              id="emp-name"
              value={form.fullName}
              onChange={(e) => {
                const value = e.currentTarget.value
                setForm((f) => ({ ...f, fullName: value }))
              }}
              disabled={saving}
              error={fieldErrors.fullName}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="emp-branch">
              Branch
            </label>
            <Select
              id="emp-branch"
              /* ACTIVE ONLY — plus this employee's own branch if it has since been deactivated,
                 which is the only way the field can still show what they actually hold. */
              data={branchOptions(branches, form.branchId)}
              value={form.branchId != null ? String(form.branchId) : null}
              placeholder="Select branch…"
              allowDeselect={false}
              disabled={saving}
              error={fieldErrors.branchId}
              onChange={(v) => {
                const branchId = v != null ? Number(v) : null
                setForm((f) => {
                  const next = { ...f, branchId }
                  // On CREATE, seed "Reports to" with the branch's manager — the natural default line
                  // manager. Editing an existing person never re-defaults; their manager is theirs.
                  if (!isEdit && branchId != null) {
                    next.reportsToEmployeeId =
                      branchManagers.find((b) => b.branchId === branchId)?.managerEmployeeId ?? null
                  }
                  return next
                })
              }}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="emp-dept">
              Department
            </label>
            <Select
              id="emp-dept"
              data={departmentOptions(departments, form.departmentId)}
              value={form.departmentId != null ? String(form.departmentId) : null}
              placeholder="Select department…"
              allowDeselect={false}
              disabled={saving}
              error={fieldErrors.departmentId}
              onChange={(v) =>
                setForm((f) => ({ ...f, departmentId: v != null ? Number(v) : null }))
              }
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="emp-position">
              Position
            </label>
            <Select
              id="emp-position"
              data={positionOptions(positions, form.positionId)}
              value={form.positionId != null ? String(form.positionId) : null}
              placeholder="Select position…"
              allowDeselect={false}
              disabled={saving}
              error={fieldErrors.positionId}
              onChange={(v) =>
                setForm((f) => ({ ...f, positionId: v != null ? Number(v) : null }))
              }
            />
          </div>

          {/* Reports to — the reporting line a LineManager chain step climbs. Optional (the top of the
              org reports to nobody), self excluded, saved via its own endpoint. */}
          <div className="form-field full">
            <label className="form-label" htmlFor="emp-reports-to">
              Reports to <span className="form-optional">(optional)</span>
            </label>
            {/* PORT NOTE: searchEnabled + searchExpr → Mantine `searchable`, which matches on the
                option label (the same employeeLabel wording the DX displayExpr rendered). */}
            <Select
              id="emp-reports-to"
              /* THE TIER IS IN THE LABEL, not just in the filter. "Reports to Sara" is a choice
                 somebody has to justify to themselves; "Sara — Management" is one they can. */
              data={managerOptions.map((o) => ({
                value: String(o.employeeId),
                label:
                  o.approvalTier != null
                    ? t('hr.employeeForm.managerOption', {
                        name: employeeLabel(o),
                        tier: tierName(o.approvalTier),
                      })
                    : employeeLabel(o),
              }))}
              value={form.reportsToEmployeeId != null ? String(form.reportsToEmployeeId) : null}
              searchable
              clearable
              // The candidates ARE the tier's; without one there is no list to offer, so the field
              // says which question to answer first instead of presenting an empty dropdown.
              disabled={saving || form.approvalTier == null}
              placeholder={
                form.approvalTier == null
                  ? t('hr.employeeForm.tierFirst')
                  : 'Select a manager…'
              }
              error={fieldErrors.reportsTo}
              onChange={(v) => {
                setForm((f) => ({ ...f, reportsToEmployeeId: v != null ? Number(v) : null }))
                setTierClearedManager(false)
                setFieldErrors((fe) => ({ ...fe, reportsTo: undefined }))
              }}
            />
            {/* Why the box just emptied itself. Above the "steps will skip" note, because it is the
                newer fact and it explains the state the other one is describing. */}
            {tierClearedManager && (
              <div className="form-error">{t('hr.employeeForm.managerCleared')}</div>
            )}
            {form.approvalTier == null ? (
              <div className="hint">{t('hr.employeeForm.tierFirst')}</div>
            ) : (
              managerOptions.length === 0 && (
                <div className="hint">{t('hr.employeeForm.noCandidates')}</div>
              )
            )}
            {/* Left empty, any line-manager approval step for this person has nobody to resolve to
                and will skip. Quiet, not an error — a top-of-org person genuinely reports to nobody. */}
            {form.reportsToEmployeeId == null && (
              <div className="hint">Line-manager steps will skip for this person.</div>
            )}
            {/* The chain of command upward — each superior, flagged if they have no login (a
                line-manager step resolving to them would skip). Managers are lvl > 0; lvl 0 is self. */}
            {form.reportsToEmployeeId != null && reportingLine.length > 1 && (
              <div className="hint wf-reporting-line">
                {reportingLine
                  .filter((r) => r.lvl > 0)
                  .map((r) => (
                    <span key={r.employeeId} className="wf-reporting-step">
                      <span className="wf-reporting-arrow">→</span>
                      <span className={r.hasLogin ? undefined : 'wf-reporting-nologin'}>
                        {r.fullName}
                        {!r.hasLogin && ' (no login)'}
                      </span>
                    </span>
                  ))}
              </div>
            )}
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="emp-hire">
              Hire date
            </label>
            {/* Required, so not clearable. State stays 'yyyy-MM-dd'. */}
            <DatePickerInput
              id="emp-hire"
              valueFormat="DD/MM/YYYY"
              leftSection={<IconCalendar size={14} />}
              value={form.hireDate || null}
              disabled={saving}
              error={fieldErrors.hireDate}
              onChange={(v) => setForm((f) => ({ ...f, hireDate: v ?? '' }))}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="emp-national">
              National ID
            </label>
            <TextInput
              id="emp-national"
              value={form.nationalId}
              onChange={(e) => {
                const value = e.currentTarget.value
                setForm((f) => ({ ...f, nationalId: value }))
              }}
              disabled={saving}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="emp-nssf">
              NSSF number
            </label>
            <TextInput
              id="emp-nssf"
              value={form.nssfNumber}
              onChange={(e) => {
                const value = e.currentTarget.value
                setForm((f) => ({ ...f, nssfNumber: value }))
              }}
              disabled={saving}
            />
          </div>

          {/* CONTACT. Optional, both of them — plenty of staff have neither on file, and refusing
              to save an employee record over a missing phone number would be absurd. The email is
              the one the SYSTEM uses: request-closed notifications go to it, and somebody without
              one simply gets none. */}
          <div className="form-field">
            <label className="form-label" htmlFor="emp-email">
              {t('hr.employee.email')}
            </label>
            <TextInput
              id="emp-email"
              type="email"
              value={form.email}
              onChange={(e) => {
                const value = e.currentTarget.value
                setForm((f) => ({ ...f, email: value }))
              }}
              placeholder={t('hr.employee.emailPlaceholder')}
              error={fieldErrors.email}
              disabled={saving}
            />
            <p className="hint" style={{ marginTop: 6 }}>
              {t('hr.employee.emailHint')}
            </p>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="emp-phone">
              {t('hr.employee.phoneNumber')}
            </label>
            <TextInput
              id="emp-phone"
              value={form.phoneNumber}
              onChange={(e) => {
                const value = e.currentTarget.value
                setForm((f) => ({ ...f, phoneNumber: value }))
              }}
              disabled={saving}
            />
          </div>

          {/* BESIDE THE TWO ADDRESSES, because it is a fact about them: it decides which language the
              mail and the WhatsApp message are written in, not which language this person sees when
              they sign in. Not clearable — every employee is written to in one language or the other,
              and 'none' is not a third option. The labels are in their own scripts on purpose: an
              Arabic option written "Arabic" is chosen by the person configuring, not by the person
              who reads it. */}
          <div className="form-field">
            <label className="form-label" htmlFor="emp-language">
              {t('hr.employee.preferredLanguage')}
            </label>
            <Select
              id="emp-language"
              data={[
                { value: 'en', label: 'English' },
                { value: 'ar', label: 'العربية' },
              ]}
              value={form.preferredLanguage}
              onChange={(value) =>
                setForm((f) => ({ ...f, preferredLanguage: value ?? 'en' }))
              }
              allowDeselect={false}
              disabled={saving}
            />
            <p className="hint" style={{ marginTop: 6 }}>
              {t('hr.employee.preferredLanguageHint')}
            </p>
          </div>

          {isEdit && (
            <div className="form-field">
              <label className="form-label" htmlFor="emp-termination">
                Termination date
              </label>
              {/* PORT NOTE: the DX showClearButton + "— still employed —" placeholder is back as
                  the picker's own clear button and placeholder. Empty means still employed, so
                  this one MUST be clearable — un-terminating somebody is a real edit. */}
              <DatePickerInput
                id="emp-termination"
                valueFormat="DD/MM/YYYY"
                leftSection={<IconCalendar size={14} />}
                clearable
                placeholder="— still employed —"
                value={form.terminationDate || null}
                disabled={saving}
                onChange={(v) => setForm((f) => ({ ...f, terminationDate: v ?? '' }))}
              />
            </div>
          )}
        </div>

        {/* System access — deliberately its own section, below employment. Position (the job) and
            Role (system access) are INDEPENDENT: this form links an account, it never grants a role
            or infers one from the position. Roles are assigned on the Users page. */}
        {canManageAccounts && (
          <div className="form-section">
            <h3 className="form-section-title">System access</h3>

            {/* Approval tier — which population's chain this person's requests follow. Staff is the
                default; management and executive may follow shorter chains. */}
            <div className="form-field full">
              <label className="form-label" htmlFor="emp-tier">
                Approval tier
              </label>
              <Select
                id="emp-tier"
                // From the dictionary, not a constant — a company that renames tier 2 or adds a
                // fourth sees it here without a release.
                data={tierOptions}
                value={form.approvalTier != null ? String(form.approvalTier) : null}
                allowDeselect={false}
                placeholder={t('hr.employeeForm.tierPlaceholder')}
                w={220}
                disabled={saving}
                /* CHANGING THE TIER CAN INVALIDATE THE MANAGER. Promote somebody to tier 1 and the
                   tier-2 manager above them is suddenly junior to them, which the trigger refuses.
                   Cleared here, WITH a sentence, rather than left to fail at save — and computed
                   from `form` outside the updater, since a setState cannot be issued inside one. */
                onChange={(v) => {
                  const tier = v != null ? Number(v) : null
                  const managerTier =
                    form.reportsToEmployeeId != null ? tierOf(form.reportsToEmployeeId) : null
                  const keeps =
                    form.reportsToEmployeeId == null ||
                    (tier != null && managerTier != null && managerTier <= tier)
                  setForm((f) => ({
                    ...f,
                    approvalTier: tier,
                    reportsToEmployeeId: keeps ? f.reportsToEmployeeId : null,
                  }))
                  setTierClearedManager(!keeps)
                  // A stale server refusal about a manager who is no longer selected is noise.
                  if (!keeps) setFieldErrors((fe) => ({ ...fe, reportsTo: undefined }))
                }}
              />
              <div className="hint">
                Management and executive requests may follow shorter approval chains.
              </div>
            </div>

            {/* No unlinked accounts and none currently linked → offer the path to create one, on the
                Users page, because creating a login is a security action and stays there. */}
            {editAccountItems.length === 0 && !currentAccount ? (
              <div className="form-field full">
                <label className="form-label">User account</label>
                <div className="empty-inline">
                  <span>No unlinked accounts available.</span>
                  <Button variant="subtle" onClick={() => navigate('/security/users')}>
                    Create a user account →
                  </Button>
                </div>
                <div className="hint">{accountHint}</div>
              </div>
            ) : (
              <div className="form-field full">
                <label className="form-label" htmlFor="emp-user">
                  User account <span className="form-optional">(optional)</span>
                </label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Select
                    id="emp-user"
                    data={(isEdit ? editAccountItems : unlinked).map((u) => ({
                      value: String(u.userId),
                      label: accountLabel(u),
                    }))}
                    value={form.userId != null ? String(form.userId) : null}
                    searchable
                    // Create can clear back to "no account"; edit removes via the explicit Unlink action.
                    clearable={!isEdit}
                    allowDeselect={!isEdit}
                    placeholder="Select an account…"
                    disabled={saving}
                    onChange={(v) =>
                      setForm((f) => ({ ...f, userId: v != null ? Number(v) : null }))
                    }
                    style={{ flex: 1 }}
                  />
                  {isEdit && employee?.userId != null && (
                    <Button
                      variant="outline"
                      color="red"
                      disabled={saving}
                      onClick={() => void confirmUnlink()}
                    >
                      Unlink
                    </Button>
                  )}
                </div>
                <div className="hint">{accountHint}</div>
              </div>
            )}
          </div>
        )}

        <div className="form-actions">
          <Button variant="default" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create employee'}
          </Button>
        </div>
      </Modal>

      {/* The confirm dialog — devextreme/ui/dialog's confirm(), as a Mantine Modal. */}
      {confirmState && (
        <Modal
          opened
          onClose={() => settleConfirm(false)}
          title={confirmState.title}
          size={480}
          centered
        >
          <div>{confirmState.message}</div>
          <div className="form-actions">
            <Button variant="default" onClick={() => settleConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={() => settleConfirm(true)}>OK</Button>
          </div>
        </Modal>
      )}
    </>
  )
}
