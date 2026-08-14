import { STORAGE_KEYS } from '../config'
import type { AuthTokens } from '../types/auth'

/**
 * Auth tokens, held PER TAB in sessionStorage.
 *
 * WHY NOT localStorage, WHICH THIS USED TO USE.
 *
 * localStorage is shared by every tab on the origin, and {@link ../api/client} reads the token
 * afresh on every call. So two tabs were never two sessions: signing in as a second user in tab B
 * overwrote the one key both tabs read, and tab A — still showing the first user's name, menus and
 * data — silently began sending the second user's token. Nothing looked wrong. The next thing tab A
 * did was attributed to whoever logged in last, and on this system that means a request raised
 * under the wrong name, or an approval signed by the wrong person.
 *
 * sessionStorage is scoped to the tab, so each tab carries its own identity and neither can reach
 * the other's. There is no cross-tab sync here and there must not be one: a 'storage' listener or a
 * BroadcastChannel on these keys would rebuild exactly the bleed this removes.
 *
 * THE TRADE, ACCEPTED DELIBERATELY: a brand-new tab starts logged out, because sessionStorage does
 * not follow into new tabs (nor duplicated ones, in most browsers). Refreshing or navigating within
 * an existing tab keeps its session, which is what "sessions survive page reloads" actually needed
 * to mean. One tab, one identity, is worth one extra login.
 *
 * This module stays the single choke point for auth persistence — every read and write in the app
 * goes through it, which is why the whole fix is these six functions. Nothing auth-related may be
 * written to localStorage anywhere else.
 */
/**
 * One-time eviction of tokens written by the pre-sessionStorage build.
 *
 * Runs on import, before anything can read them. Without it, every browser that used the old build
 * keeps a live bearer token sitting in a browser-wide store that nothing reads and nothing clears —
 * the exact object this change exists to get rid of. Wrapped because storage access throws outright
 * in some privacy modes, and failing to tidy up must never stop the app from loading.
 */
try {
  localStorage.removeItem(STORAGE_KEYS.accessToken)
  localStorage.removeItem(STORAGE_KEYS.refreshToken)
} catch {
  /* storage unavailable — nothing to evict */
}

export const tokenStorage = {
  get(): AuthTokens | null {
    const accessToken = sessionStorage.getItem(STORAGE_KEYS.accessToken)
    if (!accessToken) {
      return null
    }
    return {
      accessToken,
      refreshToken: sessionStorage.getItem(STORAGE_KEYS.refreshToken),
    }
  },

  set(tokens: AuthTokens): void {
    sessionStorage.setItem(STORAGE_KEYS.accessToken, tokens.accessToken)
    if (tokens.refreshToken) {
      sessionStorage.setItem(STORAGE_KEYS.refreshToken, tokens.refreshToken)
    } else {
      sessionStorage.removeItem(STORAGE_KEYS.refreshToken)
    }
  },

  /** Clears THIS TAB's session. Other tabs keep theirs — that is the point. */
  clear(): void {
    sessionStorage.removeItem(STORAGE_KEYS.accessToken)
    sessionStorage.removeItem(STORAGE_KEYS.refreshToken)
    // Evict tokens left by the pre-sessionStorage build. Without this, a browser that still holds
    // the old localStorage keys would keep them for ever: nothing reads them any more, so nothing
    // would ever clear them, and they would sit there as a stale bearer token in a shared store.
    localStorage.removeItem(STORAGE_KEYS.accessToken)
    localStorage.removeItem(STORAGE_KEYS.refreshToken)
  },

  getAccessToken(): string | null {
    return sessionStorage.getItem(STORAGE_KEYS.accessToken)
  },

  getRefreshToken(): string | null {
    return sessionStorage.getItem(STORAGE_KEYS.refreshToken)
  },
}
