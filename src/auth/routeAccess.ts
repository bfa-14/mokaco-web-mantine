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
  /* ROOM BOOKING, split the same way everything else here is: a read trust and a write trust.
     BOOKING_VIEW opens the calendar, the list, a receipt and the report; BOOKING_MANAGE takes and
     decides bookings, collects payments, blocks rooms and edits the catalogue. The split is what
     lets a receptionist see today without being able to cancel it. */
  BOOKING_VIEW: 'BOOKING_VIEW',
  BOOKING_MANAGE: 'BOOKING_MANAGE',
  /* The two attendance WRITE trusts. Neither opens a page of its own — they gate the affordances
     inside pages ATTENDANCE_VIEW already opened, which is what lets a viewer read a roster they may
     not edit instead of being turned away from it. */
  ATTENDANCE_MANAGE: 'ATTENDANCE_MANAGE',
  ATTENDANCE_CORRECT: 'ATTENDANCE_CORRECT',
  ATTENDANCE_IMPORT: 'ATTENDANCE_IMPORT',
  DEVICE_MANAGE: 'DEVICE_MANAGE',
  EMP_VIEW: 'EMP_VIEW',
  /** BUG-04: without it, the employee, attendance and roster lists are scoped BY THE SERVER to the caller's own rows and the branches they manage. Not a route gate — nothing here depends on it. */
  EMP_VIEW_ALL: 'EMP_VIEW_ALL',
  EMP_EDIT: 'EMP_EDIT',
  /* THE CONFIGURATION TRUSTS, split out of EMP_EDIT.
     Editing an employee and rewriting the branch list were the same permission until now, which
     meant anyone who could correct a phone number could also delete a department. These four are
     the setup tables — each one is read by half the app's dropdowns and written by almost nobody. */
  ORG_MANAGE: 'ORG_MANAGE',
  LEAVE_POLICY_MANAGE: 'LEAVE_POLICY_MANAGE',
  COMPONENT_MANAGE: 'COMPONENT_MANAGE',
  CORE_MANAGE: 'CORE_MANAGE',
  SETTING_MANAGE: 'SETTING_MANAGE',
  /* PAYROLL, SPLIT THREE WAYS. Reading a run and generating one used to be the same code, which put
     every payslip behind the trust to create payroll. PAYROLL_VIEW now opens the pages; PAYROLL_RUN
     generates; PAYROLL_APPROVE signs and locks. The last two gate buttons, not routes. */
  PAYROLL_VIEW: 'PAYROLL_VIEW',
  PAYROLL_RUN: 'PAYROLL_RUN',
  PAYROLL_APPROVE: 'PAYROLL_APPROVE',
  /** The reports are their own read trust now — they were riding on ATTENDANCE_VIEW. */
  REPORT_VIEW: 'REPORT_VIEW',
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
 * oversight — the dashboard, the requests hub, raising a request and one's own profile all have to
 * reach everybody.
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
  /* THE THREE HR QUEUES — ATTENDANCE_CORRECT, not ATTENDANCE_VIEW.
     Each is a worklist rather than a view: an anomaly, an over-run exit and a correction request all
     exist to be DECIDED, and every action on all three is ATTENDANCE_CORRECT server-side. Gated on
     VIEW they showed an attendance clerk three queues of other people's work with nothing on them
     they could press. The pages keep their own can-correct checks — see the note below. */
  { path: '/attendance/anomalies', anyOf: [PERMISSION.ATTENDANCE_CORRECT] },
  { path: '/attendance/exit-variances', anyOf: [PERMISSION.ATTENDANCE_CORRECT] },
  { path: '/attendance/corrections', anyOf: [PERMISSION.ATTENDANCE_CORRECT] },
  { path: '/attendance/shifts', anyOf: [PERMISSION.ATTENDANCE_VIEW] },
  /* DEVICE_MANAGE, not ATTENDANCE_VIEW. The machine list is an administration page: every action on
     it (Test, Pull now, Clear log, add an enrollment, issue an API key) is DEVICE_MANAGE, and with
     those gone the page is a table of IP addresses. It follows its writes, like the setup tables. */
  { path: '/attendance/devices', anyOf: [PERMISSION.DEVICE_MANAGE] },

  /* ── Payroll ───────────────────────────────────────────────────────────────────────────────────
     THE READS ARE PAYROLL_VIEW NOW. PayrollController's class-level [HasPermission("PAYROLL_RUN")]
     has been moved to the methods, so every GET under it answers to PAYROLL_VIEW while generating
     stays PAYROLL_RUN and approving stays PAYROLL_APPROVE. That split is the whole point: reading a
     payslip and creating a payroll run were one trust, so anybody who needed to look had to be
     allowed to run. The two write codes gate BUTTONS inside these pages — see PayrollRunsPage. */
  { path: '/payroll/runs', anyOf: [PERMISSION.PAYROLL_VIEW] },
  { path: '/payroll/runs/:id', anyOf: [PERMISSION.PAYROLL_VIEW] },
  { path: '/payroll/payslips/:id', anyOf: [PERMISSION.PAYROLL_VIEW] },
  { path: '/payroll/advances', anyOf: [PERMISSION.PAYROLL_VIEW] },
  { path: '/payroll/adjustments', anyOf: [PERMISSION.PAYROLL_VIEW] },
  /* The one payroll page that is NOT a read: the tiers and ceilings dictionary exists only to be
     edited, so it follows the write trust exactly as the HR setup tables do. */
  { path: '/payroll/tiers', anyOf: [PERMISSION.PAYROLL_RUN] },

  // ── HR ────────────────────────────────────────────────────────────────────────────────────────
  { path: '/hr/employees', anyOf: [PERMISSION.EMP_VIEW] },
  { path: '/hr/employees/:id', anyOf: [PERMISSION.EMP_VIEW] },
  { path: '/hr/org-chart', anyOf: [PERMISSION.EMP_VIEW] },
  // Linking a person to a login is user administration, not employee data.
  { path: '/hr/employee-accounts', anyOf: [PERMISSION.USER_MANAGE] },
  /* THE SETUP TABLES ARE GATED ON THEIR WRITE TRUST, NOT ON EMP_VIEW.
     Their GETs are still EMP_VIEW — deliberately, because a branch list and a currency list feed
     dropdowns on half the pages in the app and must keep loading for everyone. What is gated here
     is the ADMIN PAGE for each table: a page whose only purpose is to edit, shown to somebody who
     cannot edit, is a grid of buttons that all 403. So the page follows the write. */
  { path: '/hr/branches', anyOf: [PERMISSION.ORG_MANAGE] },
  { path: '/hr/departments', anyOf: [PERMISSION.ORG_MANAGE] },
  { path: '/hr/positions', anyOf: [PERMISSION.ORG_MANAGE] },
  { path: '/hr/component-types', anyOf: [PERMISSION.COMPONENT_MANAGE] },
  { path: '/hr/leave-types', anyOf: [PERMISSION.LEAVE_POLICY_MANAGE] },
  { path: '/hr/leave-policy', anyOf: [PERMISSION.LEAVE_POLICY_MANAGE] },
  /* EMP_EDIT, NOT EMP_VIEW — the one HR route gated on the write trust. Reading a tier NAME needs
     no permission at all (the API leaves that endpoint open, because the name is printed on screens
     most of the company sees); this page exists only to CHANGE the dictionary, so seeing it is the
     same trust as editing it. Gating it on EMP_VIEW would have shown a grid whose every button
     403s. */
  { path: '/hr/tiers', anyOf: [PERMISSION.EMP_EDIT] },

  // ── Core lookups ──────────────────────────────────────────────────────────────────────────────
  /* Same split as the HR setup tables: the GETs stay EMP_VIEW so every currency dropdown in
     payroll keeps working, while these two ADMIN pages follow CORE_MANAGE. */
  { path: '/core/currencies', anyOf: [PERMISSION.CORE_MANAGE] },
  { path: '/core/exchange-rates', anyOf: [PERMISSION.CORE_MANAGE] },
  // Holidays are WRITTEN with CORE_MANAGE; the page is the place they are managed, so it takes the same right.
  // (Reading them is open to everybody through the API: the leave form and the roster use it.)
  { path: '/core/holidays', anyOf: [PERMISSION.CORE_MANAGE] },

  /* ── Reports ───────────────────────────────────────────────────────────────────────────────────
     REPORT_VIEW, not ATTENDANCE_VIEW. ReportsController's endpoints have moved off the attendance
     code, and the reason is that the leave-balance report is not an attendance screen at all —
     gating it on ATTENDANCE_VIEW meant a manager who needed one number had to be given the raw
     punch data to get it. */
  { path: '/reports/monthly-attendance', anyOf: [PERMISSION.REPORT_VIEW] },
  { path: '/reports/daily-attendance', anyOf: [PERMISSION.REPORT_VIEW] },
  { path: '/reports/leave-balance', anyOf: [PERMISSION.REPORT_VIEW] },

  /* ── Bookings ─────────────────────────────────────────────────────────────────────────────────
     The calendar, the list and the report are BOOKING_VIEW: all three read endpoints the API gates
     on that code, and each is useful to somebody who may not change anything — a receptionist
     answering "is Mokha free on Thursday" needs the calendar, not the right to cancel a booking.

     ROOMS FOLLOWS ITS WRITES, exactly as the HR setup tables do. The page exists only to edit the
     catalogue: gated on BOOKING_VIEW it would be a wall of cards whose every button 403s. Its GET
     is deliberately still BOOKING_VIEW server-side, because the calendar has to draw a column per
     room — it is the PAGE that is restricted here, not the data. */
  { path: '/bookings/calendar', anyOf: [PERMISSION.BOOKING_VIEW] },
  { path: '/bookings/list', anyOf: [PERMISSION.BOOKING_VIEW] },
  { path: '/bookings/rooms', anyOf: [PERMISSION.BOOKING_MANAGE] },
  { path: '/bookings/report', anyOf: [PERMISSION.BOOKING_VIEW] },

  // ── Security ──────────────────────────────────────────────────────────────────────────────────
  { path: '/security/users', anyOf: [PERMISSION.USER_MANAGE] },
  { path: '/security/roles', anyOf: [PERMISSION.ROLE_MANAGE] },
  { path: '/security/role-permissions', anyOf: [PERMISSION.ROLE_MANAGE] },

  /* ── Settings ─────────────────────────────────────────────────────────────────────────────────
     DELIBERATELY ABSENT, so the route stays open to every signed-in user.
     The page holds two unrelated things: the system settings, which need SETTING_MANAGE, and each
     person's own Language and Live-updates choices, which need no permission at all. Gating the
     route would take the second away with the first, and the language switch is the only route to
     reading this application in Arabic. So the page gates ITSELF — SettingsPage hides the
     SETTING_MANAGE tabs and never fetches the list without the code — and neither App.tsx nor the
     side nav consults this table for it. An entry here was a lie both readers had to ignore.
     It is listed in OPEN_ROUTES below instead, so the route-table test knows it is open by
     decision rather than by omission — and SettingsPage renders the No access panel for a system
     tab that somebody without the code asks for by URL. */
]

/**
 * THE ROUTES THAT ARE OPEN ON PURPOSE — every signed-in user may reach them.
 *
 * App.tsx's route table is checked against this file by tests/routeTable.test.ts: every path in
 * ROUTE_ACCESS must be wrapped in guard(), and every path App.tsx renders WITHOUT a guard must be
 * named here. A route that is in neither list fails the test, which is the point — a new page
 * cannot be added to the router without somebody deciding, in writing, whether it is gated.
 *
 * Section landings (`/hr`, `/payroll`, …) are plain <Navigate> redirects and are recognised by the
 * test as such; they render no page and need no entry.
 */
export const OPEN_ROUTES: readonly string[] = [
  // The dashboard, which is every role's landing page.
  '/',
  // The requests hub, raising a request and reading one's own: the workflow's operations side.
  '/requests',
  '/requests/new',
  '/requests/:id',
  // One's own profile.
  '/profile',
  // Settings — see the note at the end of ROUTE_ACCESS: the page gates its system tabs itself so
  // that the Preferences tab (the language switch) reaches everybody.
  '/settings',
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
