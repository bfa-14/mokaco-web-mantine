import { apiRequest } from '../api/client'
import type {
  AccessSettingsRequest,
  AccessView,
  GateConfig,
  GateExtraEmailRequest,
  GateSignInResult,
} from '../types/access'

/**
 * Settings → Google sign-in — api/access, docs/GOOGLE_SIGNIN_GATE.md §3. Every call: ACCESS_MANAGE.
 *
 * The browser's gate cookie travels with these (same host, Path=/), which is how the API knows
 * whether THIS browser has passed Google ("Verified in this browser as …") and why turning the gate
 * on is refused with a 409 until it has — so nobody can lock themself out.
 *
 * Refusals come back as { error } with the database's own sentence and are shown as they are.
 */
export const accessService = {
  get: () => apiRequest<AccessView>('/api/access'),

  saveSettings: (request: AccessSettingsRequest) =>
    apiRequest<void>('/api/access/settings', {
      method: 'PUT',
      body: JSON.stringify(request),
    }),

  /** Switches Google sign-in off (blocked) or back on for one employee. */
  setBlocked: (employeeId: number, blocked: boolean) =>
    apiRequest<void>(`/api/access/people/${employeeId}/blocked`, {
      method: 'PUT',
      body: JSON.stringify({ blocked }),
    }),

  addExtra: (request: Omit<GateExtraEmailRequest, 'isActive'>) =>
    apiRequest<{ gateExtraEmailId: number }>('/api/access/extras', {
      method: 'POST',
      body: JSON.stringify(request),
    }),

  updateExtra: (id: number, request: GateExtraEmailRequest) =>
    apiRequest<void>(`/api/access/extras/${id}`, {
      method: 'PUT',
      body: JSON.stringify(request),
    }),

  removeExtra: (id: number) =>
    apiRequest<void>(`/api/access/extras/${id}`, { method: 'DELETE' }),

  /** Ends every gate cookie. The caller's own comes back with the new epoch, so they stay in. */
  signOutEveryone: () =>
    apiRequest<{ epoch: number }>('/api/access/signout-everyone', { method: 'POST' }),
}

/**
 * The gate's own endpoints — api/gate, anonymous, so no bearer token is sent. The settings tab uses
 * them for "Test Google sign-in" and "Sign this browser out of Google"; the gate page itself
 * (public/gate) calls the same two with plain fetch.
 *
 * A REFUSED SIGN-IN IS A 403 WHOSE SENTENCE MATTERS ("x@gmail.com is not on the HRMS list …"), so
 * callers read ApiError.message directly — getErrorMessage would collapse it to "no permission".
 */
export const gateService = {
  config: () => apiRequest<GateConfig>('/api/gate/config', { auth: false }),

  /** The ID token from Google's button. Sets the gate cookie on success. */
  signIn: (credential: string) =>
    apiRequest<GateSignInResult>('/api/gate/google', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ credential }),
    }),

  /** Forgets this browser's gate cookie. */
  signOut: () => apiRequest<void>('/api/gate/signout', { method: 'POST', auth: false }),
}
