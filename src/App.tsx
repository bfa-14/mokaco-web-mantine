import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { RequirePermission } from './auth/RequirePermission'
import { accessFor } from './auth/routeAccess'
import { SettingsProvider } from './settings/SettingsProvider'
import { LiveSettingsProvider } from './live/LiveSettingsProvider'
import { LanguageProvider } from './i18n/LanguageProvider'
import { AppLayout } from './layout/AppLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import UsersPage from './pages/security/UsersPage'
import RolesPage from './pages/security/RolesPage'
import RolePermissionsPage from './pages/security/RolePermissionsPage'
import EmployeesPage from './pages/hr/EmployeesPage'
import OrgChartPage from './pages/hr/OrgChartPage'
import EmployeeProfilePage from './pages/hr/EmployeeProfilePage'
import EmployeeAccountsPage from './pages/hr/EmployeeAccountsPage'
import BranchesPage from './pages/hr/BranchesPage'
import DepartmentsPage from './pages/hr/DepartmentsPage'
import PositionsPage from './pages/hr/PositionsPage'
import ComponentTypesPage from './pages/hr/ComponentTypesPage'
import LeaveTypesPage from './pages/hr/LeaveTypesPage'
import LeavePolicyPage from './pages/hr/LeavePolicyPage'
import CurrenciesPage from './pages/core/CurrenciesPage'
import ExchangeRatesPage from './pages/core/ExchangeRatesPage'
import AttendanceHomePage from './pages/attendance/AttendanceHomePage'
import DailyAttendancePage from './pages/attendance/DailyAttendancePage'
import RosterPage from './pages/attendance/RosterPage'
import ImportPage from './pages/attendance/ImportPage'
import UnresolvedPinsPage from './pages/attendance/UnresolvedPinsPage'
import AnomaliesPage from './pages/attendance/AnomaliesPage'
import ExitVariancesPage from './pages/attendance/ExitVariancesPage'
import CorrectionsPage from './pages/attendance/CorrectionsPage'
import ShiftsPage from './pages/attendance/ShiftsPage'
import DevicesPage from './pages/attendance/DevicesPage'
import RequestsHubPage from './pages/workflow/RequestsHubPage'
import NewRequestPage from './pages/workflow/NewRequestPage'
import RequestDetailPage from './pages/workflow/RequestDetailPage'
import ChainsPage from './pages/workflow/ChainsPage'
import ChainBuilderPage from './pages/workflow/ChainBuilderPage'
import OldVersionsPage from './pages/workflow/OldVersionsPage'
import BranchManagersPage from './pages/workflow/BranchManagersPage'
import WorkflowSignaturesPage from './pages/workflow/WorkflowSignaturesPage'
import WorkflowOversightPage from './pages/workflow/WorkflowOversightPage'
import PayrollRunsPage from './pages/payroll/PayrollRunsPage'
import PayrollRunDetailPage from './pages/payroll/PayrollRunDetailPage'
import PayslipPage from './pages/payroll/PayslipPage'
import AdvancesPage from './pages/payroll/AdvancesPage'
import AdjustmentsPage from './pages/payroll/AdjustmentsPage'
import TiersCeilingsPage from './pages/payroll/TiersCeilingsPage'
import MonthlyAttendanceReportPage from './pages/reports/MonthlyAttendanceReportPage'
import DailyAttendanceReportPage from './pages/reports/DailyAttendanceReportPage'
import LeaveBalanceReportPage from './pages/reports/LeaveBalanceReportPage'
import SettingsPage from './pages/settings/SettingsPage'
import MyProfilePage from './pages/profile/MyProfilePage'

/**
 * Wraps a route's element in its guard, IF the shared map says the route needs one.
 *
 * The requirement is never written here — it is looked up from src/auth/routeAccess.ts by the same
 * path string the Route uses, which is the same lookup the side nav performs to decide whether to
 * show the link. One table, two readers, no way for them to disagree.
 *
 * A path absent from the map returns the element untouched, which is how the open routes (the
 * dashboard, the requests hub, raising a request, one's own profile, settings) stay open.
 */
function guard(path: string, element: ReactNode): ReactNode {
  const rule = accessFor(path)
  if (!rule) return element
  return <RequirePermission anyOf={rule.anyOf}>{element}</RequirePermission>
}

/**
 * Full route table.
 *
 * The provider nesting is UNCHANGED from the original, and load-bearing: LiveSettingsProvider
 * inside AuthProvider (the socket authenticates with this tab's token), LanguageProvider outside
 * SettingsProvider but inside LiveSettingsProvider (a language switch remounts everything below
 * it, and the live socket must survive that).
 */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LiveSettingsProvider>
          <LanguageProvider>
            <SettingsProvider>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route element={<AppLayout />}>
                    <Route path="/" element={<DashboardPage />} />

                    {/* The section landing routes are plain redirects that render no page and fetch
                        nothing, so they are deliberately NOT guarded — the route they land on is,
                        and denying twice would only mean a No access panel at an address the user
                        never typed. */}
                    <Route path="/security" element={<Navigate to="/security/users" replace />} />
                    <Route
                      path="/security/users"
                      element={guard('/security/users', <UsersPage />)}
                    />
                    <Route
                      path="/security/roles"
                      element={guard('/security/roles', <RolesPage />)}
                    />
                    <Route
                      path="/security/role-permissions"
                      element={guard('/security/role-permissions', <RolePermissionsPage />)}
                    />

                    <Route path="/hr" element={<Navigate to="/hr/employees" replace />} />
                    <Route
                      path="/hr/employees"
                      element={guard('/hr/employees', <EmployeesPage />)}
                    />
                    <Route
                      path="/hr/org-chart"
                      element={guard('/hr/org-chart', <OrgChartPage />)}
                    />
                    <Route
                      path="/hr/employees/:id"
                      element={guard('/hr/employees/:id', <EmployeeProfilePage />)}
                    />
                    <Route
                      path="/hr/employee-accounts"
                      element={guard('/hr/employee-accounts', <EmployeeAccountsPage />)}
                    />
                    <Route
                      path="/hr/branches"
                      element={guard('/hr/branches', <BranchesPage />)}
                    />
                    <Route
                      path="/hr/departments"
                      element={guard('/hr/departments', <DepartmentsPage />)}
                    />
                    <Route
                      path="/hr/positions"
                      element={guard('/hr/positions', <PositionsPage />)}
                    />
                    <Route
                      path="/hr/component-types"
                      element={guard('/hr/component-types', <ComponentTypesPage />)}
                    />
                    <Route
                      path="/hr/leave-types"
                      element={guard('/hr/leave-types', <LeaveTypesPage />)}
                    />
                    <Route
                      path="/hr/leave-policy"
                      element={guard('/hr/leave-policy', <LeavePolicyPage />)}
                    />

                    <Route path="/core" element={<Navigate to="/core/currencies" replace />} />
                    <Route
                      path="/core/currencies"
                      element={guard('/core/currencies', <CurrenciesPage />)}
                    />
                    <Route
                      path="/core/exchange-rates"
                      element={guard('/core/exchange-rates', <ExchangeRatesPage />)}
                    />

                    <Route
                      path="/attendance"
                      element={guard('/attendance', <AttendanceHomePage />)}
                    />
                    <Route
                      path="/attendance/daily"
                      element={guard('/attendance/daily', <DailyAttendancePage />)}
                    />
                    <Route
                      path="/attendance/roster"
                      element={guard('/attendance/roster', <RosterPage />)}
                    />
                    <Route
                      path="/attendance/import"
                      element={guard('/attendance/import', <ImportPage />)}
                    />
                    <Route
                      path="/attendance/unresolved"
                      element={guard('/attendance/unresolved', <UnresolvedPinsPage />)}
                    />
                    <Route
                      path="/attendance/anomalies"
                      element={guard('/attendance/anomalies', <AnomaliesPage />)}
                    />
                    <Route
                      path="/attendance/exit-variances"
                      element={guard('/attendance/exit-variances', <ExitVariancesPage />)}
                    />
                    <Route
                      path="/attendance/corrections"
                      element={guard('/attendance/corrections', <CorrectionsPage />)}
                    />
                    <Route
                      path="/attendance/shifts"
                      element={guard('/attendance/shifts', <ShiftsPage />)}
                    />
                    <Route
                      path="/attendance/devices"
                      element={guard('/attendance/devices', <DevicesPage />)}
                    />

                    {/* Payroll — PayrollController gates its whole class on PAYROLL_RUN, so every
                        one of these needs it, deep links to a run or a payslip included. */}
                    <Route path="/payroll" element={<Navigate to="/payroll/runs" replace />} />
                    <Route
                      path="/payroll/runs"
                      element={guard('/payroll/runs', <PayrollRunsPage />)}
                    />
                    <Route
                      path="/payroll/runs/:id"
                      element={guard('/payroll/runs/:id', <PayrollRunDetailPage />)}
                    />
                    <Route
                      path="/payroll/payslips/:id"
                      element={guard('/payroll/payslips/:id', <PayslipPage />)}
                    />
                    <Route
                      path="/payroll/advances"
                      element={guard('/payroll/advances', <AdvancesPage />)}
                    />
                    <Route
                      path="/payroll/adjustments"
                      element={guard('/payroll/adjustments', <AdjustmentsPage />)}
                    />
                    <Route
                      path="/payroll/tiers"
                      element={guard('/payroll/tiers', <TiersCeilingsPage />)}
                    />

                    <Route
                      path="/reports"
                      element={<Navigate to="/reports/monthly-attendance" replace />}
                    />
                    <Route
                      path="/reports/monthly-attendance"
                      element={guard('/reports/monthly-attendance', <MonthlyAttendanceReportPage />)}
                    />
                    <Route
                      path="/reports/daily-attendance"
                      element={guard('/reports/daily-attendance', <DailyAttendanceReportPage />)}
                    />
                    <Route
                      path="/reports/leave-balance"
                      element={guard('/reports/leave-balance', <LeaveBalanceReportPage />)}
                    />

                    {/* Workflow — operations are open to any authenticated user; setup is guarded
                        leaf by leaf, because the four setup pages answer to three different codes. */}
                    <Route path="/requests" element={<RequestsHubPage />} />
                    <Route
                      path="/requests/oversight"
                      element={guard('/requests/oversight', <WorkflowOversightPage />)}
                    />
                    <Route path="/requests/new" element={<NewRequestPage />} />
                    <Route path="/requests/:id" element={<RequestDetailPage />} />
                    <Route
                      path="/workflow/chains"
                      element={guard('/workflow/chains', <ChainsPage />)}
                    />
                    <Route
                      path="/workflow/chains/:definitionId"
                      element={guard('/workflow/chains/:definitionId', <ChainBuilderPage />)}
                    />
                    <Route
                      path="/workflow/old-versions"
                      element={guard('/workflow/old-versions', <OldVersionsPage />)}
                    />
                    <Route
                      path="/workflow/branch-managers"
                      element={guard('/workflow/branch-managers', <BranchManagersPage />)}
                    />
                    <Route
                      path="/workflow/signatures"
                      element={guard('/workflow/signatures', <WorkflowSignaturesPage />)}
                    />

                    <Route path="/profile" element={<MyProfilePage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </SettingsProvider>
          </LanguageProvider>
        </LiveSettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
