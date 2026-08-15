/**
 * WHO MAY OPEN WHICH PAGE — one table, read by BOTH the side nav and the route guards.
 *
 * Before this file the two disagreed by construction: the nav hid a handful of links, the router
 * hid nothing, and a typed URL rendered a page that then fired 403s at every endpoint it touched.
 * A hidden link is a courtesy; it is not access control, and it never was.
 *
 * EVERY CODE HERE WAS READ OFF THE ENDPOINT, NOT GUESSED. For each page the PRIMARY list/read call
 * was traced to its controller action and that action's [HasPermission] attribute copied here. Where
 * a page's own writes need more (DEVICE_MANAGE to test a machine, ATTENDANCE_CORRECT to approve a
 * correction) that stays IN the page, gating the button — being able to open a page and being able
 * to change what is on it are different questions, and collapsing them would hide read-only pages
 * from people who are supposed to read them.
 *
 * THE API IS STILL THE GATE. Everything here is the courtesy layer: it stops a page from mounting
 * and firing requests that were always going to be refused. Nothing in the browser is a security
 * boundary, and no check here replaces the server's.
 */

/**
 * The permission codes this app knows about, as the database spells them.
 *
 * EMP_VIEW and EMP_EDIT were absent from the frontend entirely until this file — no page, service
 * or type mentioned either — while EMP_VIEW is in fact the most load-bearing code in the system: it
 * gates all of HR *and* the two Core lookups. That gap is exactly how the nav and the API drifted.
 */
export const PERMISSION = {
  ATTENDANCE_VIEW: 'ATTENDANCE_VIEW',
  ATTENDANCE_IMPORT: 'ATTENDANCE_IMPORT',
  EMP_VIEW: 'EMP_VIEW',
  PAYROLL_RUN: 'PAYROLL_RUN',
  REQUEST_VIEW_ALL: 'REQUEST_VIEW_ALL',
  ROLE_MANAGE: 'ROLE_MANAGE',
  USER_MANAGE: 'USER_MANAGE',
  WORKFLOW_CONFIGURE: 'WORKFLOW_CONFIGURE',
  WORKFLOW_VERSION_MOVE: 'WORKFLOW_VERSION_MOVE',
} as const

export type PermissionCode = (typeof PERMISSION)[keyof typeof PERMISSION]

/**
 * One route's requirement: hold AT LEAST ONE of these codes.
 *
 * `anyOf` rather than `allOf` throughout, because that is how the endpoints actually behave — a
 * single [HasPermission] per action, and where a page has two ways in (the chain builder answers to
 * either workflow trust) either one is enough.
 */
export interface RouteRule {
  /** The route path as App.tsx spells it, parameters and all. */
  path: string
  anyOf: PermissionCode[]
}

/**
 * THE MAP. Ordered as the nav is, so the two can be read side by side.
 *
 * A route that is NOT here is open to every signed-in user, and that is deliberate rather than an
 * oversight — the dashboard, the requests hub, raising a request, one's own profile and the settings
 * page all have to reach everybody. Settings in particular: its own sections gate themselves, and
 * the language switch inside it is the only route to reading this application in Arabic.
 */
export const ROUTE_ACCESS: RouteRule[] = [
  // ── Workflow setup ────────────────────────────────────────────────────────────────────────────
  // Oversight reads /api/requests/for-me across everybody, which is the whole point of the page.
  { path: '/requests/oversight', anyOf: [PERMISSION.REQUEST_VIEW_ALL] },
  { path: '/workflow/chains', anyOf: [PERMISSION.WORKFLOW_CONFIGURE] },
  { path: '/workflow/chains/:definitionId', anyOf: [PERMISSION.WORKFLOW_CONFIGURE] },
  // The one leaf on a DIFFERENT trust — moving a request between published versions is its own act.
  { path: '/workflow/old-versions', anyOf: [PERMISSION.WORKFLOW_VERSION_MOVE] },
  { path: '/workflow/branch-managers', anyOf: [PERMISSION.WORKFLOW_CONFIGURE] },
  /* SIGNATURES ANSWERS TO USER_MANAGE, NOT TO A WORKFLOW CODE. It sits under Workflow setup and
     always has, but it reads /api/users/signatures, which enforces USER_MANAGE. Gating it on the
     group's workflow codes — as the nav effectively did — showed the link to a chain administrator
     and then refused them at the door. Gated on what it actually calls. */
  { path: '/workflow/signatures', anyOf: [PERMISSION.USER_MANAGE] },

  // ── Attendance ────────────────────────────────────────────────────────────────────────────────
  { path: '/attendance', anyOf: [PERMISSION.ATTENDANCE_VIEW] },
  { path: '/attendance/daily', anyOf: [PERMISSION.ATTENDANCE_VIEW] },
  { path: '/attendance/roster', anyOf: [PERMISSION.ATTENDANCE_VIEW] },
  /* IMPORT AND UNRESOLVED PINS ARE ATTENDANCE_IMPORT, not ATTENDANCE_VIEW. Both live on the
     ingestion controller rather than the attendance one — the unresolved list especially, which
     reads GET /api/attendance/unresolved under [HasPermission("ATTENDANCE_IMPORT")]. Gated on VIEW
     they would have been the two leaves that still 403'd inside an otherwise working group. */
  { path: '/attendance/import', anyOf: [PERMISSION.ATTENDANCE_IMPORT] },
  { path: '/attendance/unresolved', anyOf: [PERMISSION.ATTENDANCE_IMPORT] },
  { path: '/attendance/anomalies', anyOf: [PERMISSION.ATTENDANCE_VIEW] },
  { path: '/attendance/exit-variances', anyOf: [PERMISSION.ATTENDANCE_VIEW] },
  // The GET is VIEW; ATTENDANCE_CORRECT gates approving and rejecting, inside the page.
  { path: '/attendance/corrections', anyOf: [PERMISSION.ATTENDANCE_VIEW] },
  { path: '/attendance/shifts', anyOf: [PERMISSION.ATTENDANCE_VIEW] },
  // Reading the machine list is VIEW; every button on it (Test, Pull now, Clear log) is DEVICE_MANAGE
  // and gates itself in the page, so an attendance clerk can still see whether a terminal is alive.
  { path: '/attendance/devices', anyOf: [PERMISSION.ATTENDANCE_VIEW] },

  // ── Payroll ───────────────────────────────────────────────────────────────────────────────────
  // PayrollController carries a CLASS-level [HasPermission("PAYROLL_RUN")], so every read under it
  // needs the same code — including the payslip and run-detail deep links.
  { path: '/payroll/runs', anyOf: [PERMISSION.PAYROLL_RUN] },
  { path: '/payroll/runs/:id', anyOf: [PERMISSION.PAYROLL_RUN] },
  { path: '/payroll/payslips/:id', anyOf: [PERMISSION.PAYROLL_RUN] },
  { path: '/payroll/advances', anyOf: [PERMISSION.PAYROLL_RUN] },
  { path: '/payroll/adjustments', anyOf: [PERMISSION.PAYROLL_RUN] },
  { path: '/payroll/tiers', anyOf: [PERMISSION.PAYROLL_RUN] },

  // ── HR ────────────────────────────────────────────────────────────────────────────────────────
  { path: '/hr/employees', anyOf: [PERMISSION.EMP_VIEW] },
  { path: '/hr/employees/:id', anyOf: [PERMISSION.EMP_VIEW] },
  { path: '/hr/org-chart', anyOf: [PERMISSION.EMP_VIEW] },
  // Linking a person to a login is user administration, not employee data.
  { path: '/hr/employee-accounts', anyOf: [PERMISSION.USER_MANAGE] },
  { path: '/hr/branches', anyOf: [PERMISSION.EMP_VIEW] },
  { path: '/hr/departments', anyOf: [PERMISSION.EMP_VIEW] },
  { path: '/hr/positions', anyOf: [PERMISSION.EMP_VIEW] },
  { path: '/hr/component-types', anyOf: [PERMISSION.EMP_VIEW] },
  { path: '/hr/leave-types', anyOf: [PERMISSION.EMP_VIEW] },
  { path: '/hr/leave-policy', anyOf: [PERMISSION.EMP_VIEW] },

  // ── Core lookups ──────────────────────────────────────────────────────────────────────────────
  /* NOT ungated. Both enforce EMP_VIEW on their GET — the same code as the HR lookups, which is
     consistent once you notice a currency list is only ever read next to a salary. */
  { path: '/core/currencies', anyOf: [PERMISSION.EMP_VIEW] },
  { path: '/core/exchange-rates', anyOf: [PERMISSION.EMP_VIEW] },

  // ── Reports ───────────────────────────────────────────────────────────────────────────────────
  { path: '/reports/monthly-attendance', anyOf: [PERMISSION.ATTENDANCE_VIEW] },
  { path: '/reports/daily-attendance', anyOf: [PERMISSION.ATTENDANCE_VIEW] },
  { path: '/reports/leave-balance', anyOf: [PERMISSION.ATTENDANCE_VIEW] },

  // ── Security ──────────────────────────────────────────────────────────────────────────────────
  { path: '/security/users', anyOf: [PERMISSION.USER_MANAGE] },
  { path: '/security/roles', anyOf: [PERMISSION.ROLE_MANAGE] },
  { path: '/security/role-permissions', anyOf: [PERMISSION.ROLE_MANAGE] },
]

/** Indexed once at module load — the nav asks this for every leaf on every render. */
const BY_PATH = new Map(ROUTE_ACCESS.map((rule) => [rule.path, rule]))

/** What a given route requires, or undefined when it is open to every signed-in user. */
export function accessFor(path: string): RouteRule | undefined {
  return BY_PATH.get(path)
}

/**
 * May this user open this route?
 *
 * The single question the nav and the guard both ask, so a link is visible exactly when the page
 * behind it will open. An unlisted route is open — see the note on ROUTE_ACCESS.
 */
export function canOpen(
  path: string,
  hasPermission: (code: string) => boolean,
): boolean {
  const rule = BY_PATH.get(path)
  if (!rule) return true
  return rule.anyOf.some((code) => hasPermission(code))
}
