/**
 * Central runtime configuration for the app.
 */

/**
 * Base URL for API requests. Empty string means "same origin", which in
 * development routes through the Vite proxy defined in vite.config.ts.
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? ''

/**
 * Keys used to persist authentication tokens — in sessionStorage, so each TAB holds its own
 * session. See auth/tokenStorage.ts for why they must never go back into localStorage.
 */
export const STORAGE_KEYS = {
  accessToken: 'mokaco.accessToken',
  refreshToken: 'mokaco.refreshToken',
} as const
