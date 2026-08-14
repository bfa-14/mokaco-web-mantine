import { apiRequest } from '../api/client'
import type {
  Setting,
  SettingUpsertRequest,
  SystemResetSummaryRow,
  UiSettings,
} from '../types/settings'

/**
 * System-wide configuration (core.SETTING).
 *
 * Reading the FULL list requires SETTING_MANAGE, because it includes the values that decide what a
 * working day IS and therefore what people are paid. Writing always does.
 *
 * `getUi` is the exception: any signed-in user may read it, because their own screen needs to know
 * whether the help panels are switched on, and HR does not have SETTING_MANAGE.
 */
export const settingsService = {
  getAll: () => apiRequest<Setting[]>('/api/settings'),

  /** Readable by anyone signed in. Presentation-affecting keys only — never payroll policy. */
  getUi: () => apiRequest<UiSettings>('/api/settings/ui'),

  update: (key: string, request: SettingUpsertRequest) =>
    apiRequest<void>(`/api/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify(request),
    }),
}

/**
 * System-wide operations. One call, and it is the most destructive thing the application can do.
 *
 * The phrase is sent UNCHECKED — the procedure compares it, so "exact" has one definition and the
 * client's own check is a courtesy, not the lock. Refusals (not armed, wrong phrase) come back as
 * 400s with the database's own wording and leave every row untouched.
 */
export const systemService = {
  /** Returns the "what survived" summary — the counts of everything the reset kept. */
  reset: (confirm: string) =>
    apiRequest<SystemResetSummaryRow[]>('/api/system/reset', {
      method: 'POST',
      body: JSON.stringify({ confirm }),
    }),
}
