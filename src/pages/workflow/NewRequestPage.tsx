import { useTranslation } from 'react-i18next'
import { Loader } from '@mantine/core'
import { PageHelp } from '../../components/PageHelp'
import { useRaiseContext } from './newRequestShared'
import { NewRequestShell } from './NewRequestShell'
import { useExitPermissionForm } from './ExitPermissionBody'
import { useLeaveRequestForm } from './LeaveRequestBody'
import { useTipDistributionForm } from './TipDistributionBody'
import { useOvertimeForm } from './OvertimeBody'
import { useShiftSwapForm } from './ShiftSwapBody'
import { useExpenseReimbursementForm } from './ExpenseReimbursementBody'
import { useAvailabilityChangeForm } from './AvailabilityChangeBody'
import { useOnboardingForm } from './OnboardingBody'
import { useSeparationForm } from './SeparationBody'
import { usePayrollAdjustmentForm } from './PayrollAdjustmentBody'
import { useSalaryAdvanceForm } from './SalaryAdvanceBody'

/**
 * Raise a request, of whatever kind. A switchboard: the shell owns the chrome, each type
 * contributes a FORM BODY. All body hooks run every render — the rules of hooks demand it, and it
 * keeps half-typed forms alive across a type-switch. A code absent from the map shows the honest
 * "no form yet" panel; that is the contract, not a failure. (All 11 bodies ported.)
 */
export default function NewRequestPage() {
  const { t } = useTranslation()
  const ctx = useRaiseContext()

  const selectedName =
    ctx.employees.find((e) => e.employeeId === ctx.employeeId)?.fullName ??
    (ctx.employeeId === ctx.me?.employeeId ? (ctx.me?.fullName ?? null) : null)

  const exitPermission = useExitPermissionForm(false)
  const leaveRequest = useLeaveRequestForm(ctx.employeeId, false)
  // The RAISER'S branch, not the selected employee's — a tip distribution is about the branch
  // whose till it came out of.
  const tipDistribution = useTipDistributionForm(ctx.me?.branchId ?? null, false)
  const overtime = useOvertimeForm(ctx.employeeId, selectedName, false)
  const shiftSwap = useShiftSwapForm(ctx.employeeId, false)
  const expense = useExpenseReimbursementForm(selectedName, false)
  const availability = useAvailabilityChangeForm(ctx.employeeId, false)
  // No employee argument: the candidate is not an employee yet (hidesEmployee).
  const onboarding = useOnboardingForm(false)
  // A separation IS about an existing employee, so unlike onboarding it takes the selected one.
  const separation = useSeparationForm(ctx.employeeId, false)
  // Name-only: mirrors the procedure's composed title; HR raising on behalf keeps the field.
  const payrollAdjustment = usePayrollAdjustmentForm(selectedName, false)
  const salaryAdvance = useSalaryAdvanceForm(selectedName, false)

  // The keys are the API's RequestTypeCodes, exactly — a mismatch here is a type that silently
  // shows the "no form yet" panel rather than its form.
  const bodies: Record<string, typeof exitPermission> = {
    EXIT_PERMISSION: exitPermission,
    LEAVE_REQUEST: leaveRequest,
    TIP_DISTRIBUTION: tipDistribution,
    OVERTIME: overtime,
    SHIFT_SWAP: shiftSwap,
    EXPENSE_REIMBURSEMENT: expense,
    AVAILABILITY_CHANGE: availability,
    ONBOARDING: onboarding,
    SEPARATION: separation,
    PAYROLL_ADJUSTMENT: payrollAdjustment,
    SALARY_ADVANCE: salaryAdvance,
  }
  const body = ctx.type ? (bodies[ctx.type] ?? null) : null

  if (ctx.loading) {
    return (
      <div>
        <div className="page-head">
          <h1 className="page-title">{t('requests.new.pageTitle')}</h1>
        </div>
        <div className="page-loading">
          <Loader size={40} />
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('requests.new.pageTitle')}</h1>
          <p className="page-subtitle">{t('requests.new.pageSubtitle')}</p>
        </div>
      </div>

      <PageHelp>{t('requests.new.pageHelp')}</PageHelp>

      <NewRequestShell ctx={ctx} body={body} />
    </div>
  )
}
