/**
 * core.SETTING — the system's global key/value configuration.
 *
 * NOT an attendance concern. Attendance was simply the first feature that needed configuration;
 * payroll and workflow will add their own keys to the same table.
 */

/** GET /api/settings — the full list. Requires SETTING_MANAGE. */
export interface Setting {
  settingKey: string
  settingValue: string
  /** bool | int | decimal | string — decides which control the Settings page renders for it. */
  dataType: string
  /** What this setting controls, in words. This IS the label the user reads. */
  description: string | null
  /**
   * Which band of the page this belongs to — "Attendance", "Payroll", "Notifications".
   *
   * THE GROUPING IS DATA, not a map in this codebase: a feature that adds keys with a Section gets
   * its own heading with no frontend change. Null for an unfiled key, which then renders in the
   * ungrouped remainder rather than vanishing.
   */
  section: string | null
  /** Reading order within the section. The API already returns rows in it, so it rarely needs sorting again. */
  sortOrder: number | null
  modifiedAt: string | null
  modifiedBy: number | null
}

/** PUT /api/settings/{key}. */
export interface SettingUpsertRequest {
  settingValue: string
  dataType: string
  description?: string | null
}

/**
 * GET /api/settings/ui — the settings that change how the UI behaves, readable by ANY signed-in
 * user.
 *
 * It exists because the full list is gated on SETTING_MANAGE, which HR deliberately does not have
 * — yet every user's screen needs to know whether the help panels are on.
 */
export interface UiSettings {
  showPageHelp: boolean
}

/** The key the help toggle is stored under, so the Settings page and the provider cannot drift apart. */
export const SHOW_PAGE_HELP_KEY = 'ShowPageHelp'

/**
 * The key that ARMS the system reset. Owned by the Danger zone and hidden from the ordinary
 * settings list — it is not a preference, and it must not sit among the pay-affecting values where
 * someone could flip it while looking for something else.
 */
export const ALLOW_SYSTEM_RESET_KEY = 'AllowSystemReset'

/** The permission that may reset the system. Admin and Owner only. */
export const SYSTEM_RESET_PERMISSION = 'SYSTEM_RESET'

/**
 * The machine-pull schedule. These three are pulled OUT of the generic settings list for the
 * same reason the reset flag is: they belong WITH the list of machines they govern. A bare
 * "MachinePullMinutes" card among the pay-affecting values tells nobody which machines it polls,
 * or whether any of them are configured at all.
 *
 * The machine's ADDRESS is not here — that lives on the device record, because it is a fact about
 * one piece of hardware. These three are the schedule, which is global.
 */
export const MACHINE_PULL_ENABLED_KEY = 'MachinePullEnabled'
export const MACHINE_PULL_MINUTES_KEY = 'MachinePullMinutes'
export const MACHINE_PULL_AUTO_PROCESS_KEY = 'MachinePullAutoProcess'

/** All three, for the one place that needs to exclude them from the generic list. */
export const MACHINE_PULL_KEYS: readonly string[] = [
  MACHINE_PULL_ENABLED_KEY,
  MACHINE_PULL_MINUTES_KEY,
  MACHINE_PULL_AUTO_PROCESS_KEY,
]

/**
 * How a punch's DIRECTION is decided.
 *
 * 'Device' trusts the In/Out state key on the terminal. 'Alternate' ignores it and infers the
 * direction from the order of the day's punches — first is in, next is out, and so on. Alternate
 * exists because people do not reliably press the state key, and a day of punches that all claim
 * to be check-ins is not something the processor can pair.
 *
 * Pulled out of the generic settings list for the same reason as the machine-pull keys: the mode
 * and its debounce window are one decision, and a lone "PunchDebounceMinutes" card among the
 * pay-affecting values tells nobody what it debounces.
 */
export const PUNCH_DIRECTION_MODE_KEY = 'PunchDirectionMode'
export const PUNCH_DEBOUNCE_MINUTES_KEY = 'PunchDebounceMinutes'

export const PUNCH_DIRECTION_KEYS: readonly string[] = [
  PUNCH_DIRECTION_MODE_KEY,
  PUNCH_DEBOUNCE_MINUTES_KEY,
]

/** The confirmation phrase, exactly as core.usp_System_ResetTestData compares it. */
export const RESET_CONFIRM_PHRASE = 'DELETE ALL DATA'

/**
 * One line of the "what survived" summary a reset returns — "Users: 9", "Published chains: 4".
 * The point of the feature, not a receipt: it answers "what else did that take with it".
 */
export interface SystemResetSummaryRow {
  /** What was kept. The procedure's column is Item; older versions aliased it Kept. */
  item?: string
  /** Older shape, tolerated so a summary never renders as anonymous numbers. */
  kept?: string
  rows: number
}
