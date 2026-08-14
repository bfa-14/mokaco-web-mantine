/**
 * Which live features a user wants, per user, on this browser.
 *
 * A PLAIN PREFERENCE, NOT AUTH DATA — so localStorage is the right home and the tokenStorage rule
 * ("nothing auth-related in localStorage") is untouched. It also SHOULD outlive the tab: somebody
 * who turned payroll's live updates off did not mean "until I close this tab".
 *
 * Keyed per user id, because two people share browsers on a shop floor and one turning live updates
 * off must not silently change them for the next person to sign in on that machine.
 *
 * DEFAULT ON, and the default is what an ABSENT key means — so a new user, a new feature, or a
 * cleared browser all behave the same way, and only an explicit "false" turns anything off.
 */

export const LIVE_FEATURES = ['dashboard', 'workflow', 'payroll', 'attendance'] as const
export type LiveFeature = (typeof LIVE_FEATURES)[number]

/** Human labels for the settings panel. */
export const LIVE_FEATURE_LABELS: Record<LiveFeature, string> = {
  dashboard: 'Dashboard',
  workflow: 'Requests',
  payroll: 'Payroll',
  attendance: 'Attendance',
}

const MASTER = 'master'

function key(userId: number | null | undefined, feature: string): string {
  return `live:${userId ?? 'anon'}:${feature}`
}

function readFlag(userId: number | null | undefined, feature: string): boolean {
  try {
    // Absent means ON. Only the exact string 'false' disables, so a corrupted value fails towards
    // the feature working rather than towards a page that mysteriously stops updating.
    return localStorage.getItem(key(userId, feature)) !== 'false'
  } catch {
    return true
  }
}

function writeFlag(userId: number | null | undefined, feature: string, on: boolean): void {
  try {
    localStorage.setItem(key(userId, feature), on ? 'true' : 'false')
  } catch {
    /* storage unavailable — the preference simply does not persist */
  }
}

export const livePrefs = {
  /** The master switch. Off means no socket at all. */
  masterEnabled: (userId: number | null | undefined): boolean => readFlag(userId, MASTER),
  setMaster: (userId: number | null | undefined, on: boolean): void => writeFlag(userId, MASTER, on),

  /** One feature. Always AND-ed with the master, so the master genuinely governs everything. */
  featureEnabled: (userId: number | null | undefined, feature: LiveFeature): boolean =>
    readFlag(userId, MASTER) && readFlag(userId, feature),

  setFeature: (userId: number | null | undefined, feature: LiveFeature, on: boolean): void =>
    writeFlag(userId, feature, on),

  /** The raw per-feature value, ignoring the master — what the settings checkbox itself shows. */
  rawFeature: (userId: number | null | undefined, feature: LiveFeature): boolean =>
    readFlag(userId, feature),
}
