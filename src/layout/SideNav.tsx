import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { canOpen } from '../auth/routeAccess'
import { dxIcon } from '../components/dxIcons'

/** The group expander, resolved through the same map as everything else. */
const ChevronIcon = dxIcon('spf')

/**
 * The nav carries translation KEYS, not text — these tables are module constants, evaluated once at
 * import, so a `t('…')` call here would freeze the startup language. Holding the key and
 * translating at render is what makes the menu follow the language. (Unchanged from the original.)
 *
 * PORT NOTE: icons were DevExtreme font-icon names; they stay STRING KEYS in the same tables (so
 * the tables diff cleanly against the original) and resolve to Tabler components at render — now
 * through the shared map in components/dxIcons.tsx, which is where the glyph each DX name actually
 * drew is written down once.
 */
function NavIcon({ name }: { name: string }) {
  const Cmp = dxIcon(name)
  // 18px, matching the original's `.side-nav-link .dx-icon { font-size: 18px }`.
  return <Cmp size={18} stroke={1.75} className="side-nav-icon" aria-hidden="true" />
}

/**
 * A leaf carries NO permission of its own any more.
 *
 * Whether it is visible is decided by `canOpen(leaf.to)` against src/auth/routeAccess.ts — the same
 * table the route guards read. That is the whole point of this refactor: a link used to be hidden by
 * one list and the page behind it guarded by another (or, until now, by nothing at all), so the two
 * could drift and did. There is now exactly one place a requirement is written down, and a link is
 * visible precisely when the page behind it will open.
 */
interface NavLeaf {
  to: string
  labelKey: string
  icon: string
  end?: boolean
}

interface NavGroup {
  labelKey: string
  icon: string
  basePath: string
  children: NavLeaf[]
}

const DASHBOARD: NavLeaf = { to: '/', labelKey: 'nav.dashboard', icon: 'home', end: true }

const SETTINGS: NavLeaf = { to: '/settings', labelKey: 'nav.settings', icon: 'preferences' }
/** Every signed-in user has one, so it is never permission-gated. */
const PROFILE: NavLeaf = { to: '/profile', labelKey: 'nav.myProfile', icon: 'user' }

const GROUPS: NavGroup[] = [
  {
    // Operations — everyone raises requests and, if they approve anything, has an inbox.
    labelKey: 'nav.requests.group',
    icon: 'checklist',
    basePath: '/requests',
    children: [
      { to: '/requests', labelKey: 'nav.requests.hub', icon: 'home', end: true },
      { to: '/requests/new', labelKey: 'nav.requests.new', icon: 'plus' },
      { to: '/requests/oversight', labelKey: 'nav.requests.oversight', icon: 'clock' },
    ],
  },
  {
    /* No group-level requirement any more. The four leaves below answer to THREE different codes
       (chains and branch managers to WORKFLOW_CONFIGURE, old versions to WORKFLOW_VERSION_MOVE,
       signatures to USER_MANAGE), so a single gate over all of them was always going to show
       somebody a link they could not use. Each leaf now gates itself and the group disappears when
       none survive. */
    labelKey: 'nav.workflowSetup.group',
    icon: 'preferences',
    basePath: '/workflow',
    children: [
      { to: '/workflow/chains', labelKey: 'nav.workflowSetup.chains', icon: 'orderedlist' },
      { to: '/workflow/old-versions', labelKey: 'nav.workflowSetup.oldVersions', icon: 'clock' },
      { to: '/workflow/branch-managers', labelKey: 'nav.workflowSetup.branchManagers', icon: 'group' },
      { to: '/workflow/signatures', labelKey: 'nav.workflowSetup.signatures', icon: 'edit' },
    ],
  },
  {
    labelKey: 'nav.attendance.group',
    icon: 'clock',
    basePath: '/attendance',
    children: [
      { to: '/attendance', labelKey: 'nav.attendance.overview', icon: 'home', end: true },
      { to: '/attendance/daily', labelKey: 'nav.attendance.daily', icon: 'event' },
      { to: '/attendance/roster', labelKey: 'nav.attendance.roster', icon: 'card' },
      { to: '/attendance/import', labelKey: 'nav.attendance.import', icon: 'upload' },
      { to: '/attendance/unresolved', labelKey: 'nav.attendance.unresolvedPins', icon: 'help' },
      { to: '/attendance/anomalies', labelKey: 'nav.attendance.anomalies', icon: 'warning' },
      { to: '/attendance/exit-variances', labelKey: 'nav.attendance.exitVariances', icon: 'clock' },
      { to: '/attendance/corrections', labelKey: 'nav.attendance.corrections', icon: 'edit' },
      { to: '/attendance/shifts', labelKey: 'nav.attendance.shifts', icon: 'clock' },
      { to: '/attendance/devices', labelKey: 'nav.attendance.devices', icon: 'tips' },
    ],
  },
  {
    // Every leaf here is PAYROLL_RUN, because PayrollController gates the whole class on it. The
    // group therefore vanishes as a whole for anyone without it — same outcome as the old
    // group-level flag, now derived from the endpoints rather than restated here.
    labelKey: 'nav.payroll.group',
    icon: 'money',
    basePath: '/payroll',
    children: [
      { to: '/payroll/runs', labelKey: 'nav.payroll.runs', icon: 'event' },
      { to: '/payroll/advances', labelKey: 'nav.payroll.advances', icon: 'card' },
      { to: '/payroll/adjustments', labelKey: 'nav.payroll.adjustments', icon: 'edit' },
      { to: '/payroll/tiers', labelKey: 'nav.payroll.tiers', icon: 'money' },
    ],
  },
  {
    labelKey: 'nav.hr.group',
    icon: 'group',
    basePath: '/hr',
    children: [
      { to: '/hr/employees', labelKey: 'nav.hr.employees', icon: 'user' },
      { to: '/hr/org-chart', labelKey: 'nav.hr.orgChart', icon: 'hierarchy' },
      { to: '/hr/employee-accounts', labelKey: 'nav.hr.employeeAccounts', icon: 'key' },
      { to: '/hr/branches', labelKey: 'nav.hr.branches', icon: 'home' },
      { to: '/hr/departments', labelKey: 'nav.hr.departments', icon: 'hierarchy' },
      { to: '/hr/positions', labelKey: 'nav.hr.positions', icon: 'taskhelpneeded' },
      { to: '/hr/component-types', labelKey: 'nav.hr.componentTypes', icon: 'money' },
      { to: '/hr/leave-types', labelKey: 'nav.hr.leaveTypes', icon: 'event' },
      { to: '/hr/leave-policy', labelKey: 'nav.hr.leavePolicy', icon: 'detailslayout' },
      { to: '/hr/tiers', labelKey: 'nav.hr.tiers', icon: 'hierarchy' },
    ],
  },
  {
    labelKey: 'nav.core.group',
    icon: 'preferences',
    basePath: '/core',
    children: [
      { to: '/core/currencies', labelKey: 'nav.core.currencies', icon: 'money' },
      { to: '/core/exchange-rates', labelKey: 'nav.core.exchangeRates', icon: 'chart' },
    ],
  },
  {
    labelKey: 'nav.reports.group',
    icon: 'print',
    basePath: '/reports',
    children: [
      {
        to: '/reports/monthly-attendance',
        labelKey: 'nav.reports.monthlyAttendance',
        icon: 'event',
      },
      {
        to: '/reports/daily-attendance',
        labelKey: 'nav.reports.dailyAttendance',
        icon: 'clock',
      },
      { to: '/reports/leave-balance', labelKey: 'nav.reports.leaveBalance', icon: 'card' },
    ],
  },
  {
    labelKey: 'nav.security.group',
    icon: 'lock',
    basePath: '/security',
    children: [
      { to: '/security/users', labelKey: 'nav.security.users', icon: 'group' },
      { to: '/security/roles', labelKey: 'nav.security.roles', icon: 'card' },
      {
        to: '/security/role-permissions',
        labelKey: 'nav.security.rolePermissions',
        icon: 'key',
      },
    ],
  },
]

function leafClassName({ isActive }: { isActive: boolean }): string {
  return isActive ? 'side-nav-link side-nav-link--active' : 'side-nav-link'
}

function NavGroupSection({
  group,
  onNavigate,
}: {
  group: NavGroup
  onNavigate?: () => void
}) {
  const { t } = useTranslation()
  const location = useLocation()
  const containsActive = location.pathname.startsWith(group.basePath)
  const [open, setOpen] = useState(containsActive)

  return (
    <div className="side-nav-group">
      <button
        type="button"
        className={
          containsActive
            ? 'side-nav-group-header side-nav-group-header--active'
            : 'side-nav-group-header'
        }
        onClick={() => setOpen((value) => !value)}
      >
        <NavIcon name={group.icon} />
        <span className="side-nav-label">{t(group.labelKey)}</span>
        {/* DX's 'spf': a DOWN chevron rotating 180° on open. Down/up are direction-neutral, so
            this is the one arrow in the app that needs no RTL handling. */}
        <ChevronIcon
          size={14}
          className={`side-nav-chevron${open ? ' side-nav-chevron--open' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="side-nav-children">
          {group.children.map((leaf) => (
            <NavLink
              key={leaf.to}
              to={leaf.to}
              end={leaf.end}
              className={leafClassName}
              onClick={onNavigate}
            >
              <NavIcon name={leaf.icon} />
              <span className="side-nav-label">{t(leaf.labelKey)}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

export function SideNav({
  className = 'side-nav',
  /**
   * Fired by a LEAF only — going somewhere is what dismisses the overlay drawer. A group header
   * expands or collapses in place and must NOT close it, or opening a section on a narrow screen
   * would slam the drawer shut before anything could be picked from it.
   */
  onNavigate,
}: {
  className?: string
  onNavigate?: () => void
} = {}) {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()

  /**
   * Every leaf is filtered through the SAME predicate the route guard uses, then a group that has
   * emptied out disappears — the existing behaviour, now applied over the full map rather than the
   * three leaves that happened to be gated by hand.
   *
   * There is no group-level check left. A group is exactly the sum of the leaves this user can
   * open, which is the only definition that cannot disagree with the routes: the old version could
   * pass a group gate and then show four links to a user who could open one of them.
   */
  const visibleGroups = GROUPS.map((group) => ({
    ...group,
    children: group.children.filter((leaf) => canOpen(leaf.to, hasPermission)),
  })).filter((group) => group.children.length > 0)

  return (
    <nav className={className}>
      <NavLink
        to={DASHBOARD.to}
        end={DASHBOARD.end}
        className={leafClassName}
        onClick={onNavigate}
      >
        <NavIcon name={DASHBOARD.icon} />
        <span className="side-nav-label">{t(DASHBOARD.labelKey)}</span>
      </NavLink>

      {visibleGroups.map((group) => (
        <NavGroupSection key={group.basePath} group={group} onNavigate={onNavigate} />
      ))}

      <NavLink to={PROFILE.to} className={leafClassName} onClick={onNavigate}>
        <NavIcon name={PROFILE.icon} />
        <span className="side-nav-label">{t(PROFILE.labelKey)}</span>
      </NavLink>

      <NavLink to={SETTINGS.to} className={leafClassName} onClick={onNavigate}>
        <NavIcon name={SETTINGS.icon} />
        <span className="side-nav-label">{t(SETTINGS.labelKey)}</span>
      </NavLink>
    </nav>
  )
}
