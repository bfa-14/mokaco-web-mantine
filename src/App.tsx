import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
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
import MonthlyAttendanceReportPage from './pages/reports/MonthlyAttendanceReportPage'
import DailyAttendanceReportPage from './pages/reports/DailyAttendanceReportPage'
import LeaveBalanceReportPage from './pages/reports/LeaveBalanceReportPage'
import SettingsPage from './pages/settings/SettingsPage'
import MyProfilePage from './pages/profile/MyProfilePage'

/**
 * Full route table — identical to the original app's App.tsx. Every page is now the real
 * Mantine port.
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

                    <Route path="/security" element={<Navigate to="/security/users" replace />} />
                    <Route path="/security/users" element={<UsersPage />} />
                    <Route path="/security/roles" element={<RolesPage />} />
                    <Route path="/security/role-permissions" element={<RolePermissionsPage />} />

                    <Route path="/hr" element={<Navigate to="/hr/employees" replace />} />
                    <Route path="/hr/employees" element={<EmployeesPage />} />
                    <Route path="/hr/org-chart" element={<OrgChartPage />} />
                    <Route path="/hr/employees/:id" element={<EmployeeProfilePage />} />
                    <Route path="/hr/employee-accounts" element={<EmployeeAccountsPage />} />
                    <Route path="/hr/branches" element={<BranchesPage />} />
                    <Route path="/hr/departments" element={<DepartmentsPage />} />
                    <Route path="/hr/positions" element={<PositionsPage />} />
                    <Route path="/hr/component-types" element={<ComponentTypesPage />} />
                    <Route path="/hr/leave-types" element={<LeaveTypesPage />} />
                    <Route path="/hr/leave-policy" element={<LeavePolicyPage />} />

                    <Route path="/core" element={<Navigate to="/core/currencies" replace />} />
                    <Route path="/core/currencies" element={<CurrenciesPage />} />
                    <Route path="/core/exchange-rates" element={<ExchangeRatesPage />} />

                    <Route path="/attendance" element={<AttendanceHomePage />} />
                    <Route path="/attendance/daily" element={<DailyAttendancePage />} />
                    <Route path="/attendance/roster" element={<RosterPage />} />
                    <Route path="/attendance/import" element={<ImportPage />} />
                    <Route path="/attendance/unresolved" element={<UnresolvedPinsPage />} />
                    <Route path="/attendance/anomalies" element={<AnomaliesPage />} />
                    <Route path="/attendance/exit-variances" element={<ExitVariancesPage />} />
                    <Route path="/attendance/corrections" element={<CorrectionsPage />} />
                    <Route path="/attendance/shifts" element={<ShiftsPage />} />
                    <Route path="/attendance/devices" element={<DevicesPage />} />

                    {/* Payroll — the nav hides this without PAYROLL_RUN; the API 403 is the gate. */}
                    <Route path="/payroll" element={<Navigate to="/payroll/runs" replace />} />
                    <Route path="/payroll/runs" element={<PayrollRunsPage />} />
                    <Route path="/payroll/runs/:id" element={<PayrollRunDetailPage />} />
                    <Route path="/payroll/payslips/:id" element={<PayslipPage />} />
                    <Route path="/payroll/advances" element={<AdvancesPage />} />
                    <Route path="/payroll/adjustments" element={<AdjustmentsPage />} />

                    <Route
                      path="/reports"
                      element={<Navigate to="/reports/monthly-attendance" replace />}
                    />
                    <Route
                      path="/reports/monthly-attendance"
                      element={<MonthlyAttendanceReportPage />}
                    />
                    <Route
                      path="/reports/daily-attendance"
                      element={<DailyAttendanceReportPage />}
                    />
                    <Route path="/reports/leave-balance" element={<LeaveBalanceReportPage />} />

                    {/* Workflow — operations (any authenticated user) and setup (gated in the nav). */}
                    <Route path="/requests" element={<RequestsHubPage />} />
                    <Route path="/requests/oversight" element={<WorkflowOversightPage />} />
                    <Route path="/requests/new" element={<NewRequestPage />} />
                    <Route path="/requests/:id" element={<RequestDetailPage />} />
                    <Route path="/workflow/chains" element={<ChainsPage />} />
                    <Route path="/workflow/chains/:definitionId" element={<ChainBuilderPage />} />
                    <Route path="/workflow/old-versions" element={<OldVersionsPage />} />
                    <Route path="/workflow/branch-managers" element={<BranchManagersPage />} />
                    <Route path="/workflow/signatures" element={<WorkflowSignaturesPage />} />

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
