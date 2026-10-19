/**
 * The Google sign-in gate — an optional front door in front of the whole HRMS
 * (docs/GOOGLE_SIGNIN_GATE.md in MokaCo.HRMS).
 *
 * Two families: what the gate page and the test button use (api/gate, anonymous), and the
 * Settings → Google sign-in tab (api/access, ACCESS_MANAGE). Times are UTC without a suffix, like
 * every other audit time the API returns.
 */

/** May turn the gate on or off and manage who can open the HRMS. Admin and Owner. */
export const ACCESS_MANAGE_PERMISSION = 'ACCESS_MANAGE'

/** GET /api/gate/config — what the gate page needs before it draws Google's button. */
export interface GateConfig {
  required: boolean
  /** Null while nobody has set it: the page then says sign-in is not set up yet. */
  clientId: string | null
  days: number
  /** This browser holds a gate cookie that is valid now, of a person who is allowed now. */
  signedIn: boolean
  email: string | null
  name: string | null
}

/** POST /api/gate/google — the answer to a sign-in Google confirmed and the HRMS allowed. */
export interface GateSignInResult {
  email: string
  name: string | null
  days: number
}

/** GET /api/access → settings. ModifiedAt is when the switch last changed. */
export interface AccessSettings {
  required: boolean
  clientId: string
  days: number
  epoch: number
  modifiedAt: string | null
}

/** Who THIS browser is signed in as with Google, judged against the settings as they are now. */
export interface AccessCaller {
  verified: boolean
  email: string | null
  name: string | null
}

/**
 * What the gate makes of one employee. Left wins over everything, then no Gmail, no login, a
 * disabled login, and the per-person switch.
 */
export type GatePersonStatus = 'Allowed' | 'Blocked' | 'NoEmail' | 'NoUser' | 'UserDisabled' | 'Left'

/** GET /api/access → people: every employee that is not deleted. */
export interface GatePerson {
  employeeId: number
  fullName: string
  branchName: string | null
  email: string | null
  userId: number | null
  username: string | null
  userIsActive: boolean | null
  terminationDate: string | null
  isBlocked: boolean
  status: GatePersonStatus
  lastSignInAt: string | null
}

/** GET /api/access → extras: an address that is not an employee's (owner, accountant). */
export interface GateExtraEmail {
  gateExtraEmailId: number
  email: string
  note: string | null
  isActive: boolean
  createdAt: string
  lastSignInAt: string | null
}

/** The result of one sign-in attempt, as security.GATE_SIGNIN_LOG stores it. */
export type GateSignInOutcome = 'Allowed' | 'NotFound' | 'Blocked' | 'NoUser' | 'Left'

/** GET /api/access → recent: the last 100 attempts, newest first. Email is as Google gave it. */
export interface GateSignInAttempt {
  gateSignInLogId: number
  attemptedAt: string
  email: string
  outcome: GateSignInOutcome
  employeeId: number | null
  fullName: string | null
  ip: string | null
}

/** GET /api/access — the whole Settings → Google sign-in tab in one answer. */
export interface AccessView {
  settings: AccessSettings
  caller: AccessCaller
  people: GatePerson[]
  extras: GateExtraEmail[]
  recent: GateSignInAttempt[]
}

/** PUT /api/access/settings — all three, every time. */
export interface AccessSettingsRequest {
  required: boolean
  clientId: string
  days: number
}

/** POST /api/access/extras (isActive ignored, a new address is active) and PUT /api/access/extras/{id}. */
export interface GateExtraEmailRequest {
  email: string
  note: string | null
  isActive: boolean
}
