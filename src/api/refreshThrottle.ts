/**
 * A 429 ON THE TOKEN REFRESH MEANS "NOT NOW", NOT "YOUR SESSION IS OVER" (QA3 SEC-6).
 *
 * The API limits /api/auth/refresh per client address (a whole café shares one address behind its
 * router) and answers the excess with 429 and `Retry-After`. Taken as a failed refresh, that signed
 * people out of sessions that were perfectly good. The client now keeps the tokens, waits as long
 * as the server asks — within a cap — and asks again once; still refused, the call fails with a
 * message that says to try again in a minute, and the session is still there for that next try.
 *
 * Pure (no DOM, no import.meta.env), so tests/refreshThrottle.test.ts runs it under plain Node.
 */

/** A 429 without a readable Retry-After waits this long — "a moment". */
export const REFRESH_RETRY_DEFAULT_MS = 10_000

/** Never ask again sooner than this, whatever the header says. */
export const REFRESH_RETRY_MIN_MS = 1_000

/**
 * The longest one call waits for the refresh, in total. The API asks for 60 s; a page that has
 * waited a minute shows the error instead of spinning on, and the next call starts a new wait.
 */
export const REFRESH_WAIT_CAP_MS = 60_000

/**
 * `Retry-After` in milliseconds from `now`: delta-seconds ("60") or an HTTP date. Missing or
 * unreadable is the default; the result is kept between the minimum and the cap.
 */
export function retryAfterMs(header: string | null | undefined, now: number): number {
  const value = header?.trim() ?? ''
  let ms = REFRESH_RETRY_DEFAULT_MS
  if (/^\d+(\.\d+)?$/.test(value)) {
    ms = Number(value) * 1000
  } else if (/[a-z]/i.test(value)) {
    // An HTTP date names its month and zone. Anything without letters is not one: the engine's own
    // parser reads "-5" or "12" as years, which would be a wait of decades held to the cap.
    const at = Date.parse(value)
    if (Number.isFinite(at)) ms = at - now
  }
  return Math.min(REFRESH_WAIT_CAP_MS, Math.max(REFRESH_RETRY_MIN_MS, ms))
}

/**
 * How long to wait before asking for a refresh now: 0 to ask at once, or null when the wait would
 * take this call past {@link REFRESH_WAIT_CAP_MS} (it gives up, keeping the session).
 * `notBefore` is when the server last said to come back (epoch ms; 0 when it never did) and
 * `waitedMs` what this call has already waited. A clock that jumped is held to the cap.
 */
export function refreshWaitMs(notBefore: number, now: number, waitedMs: number): number | null {
  const wait = Math.min(REFRESH_WAIT_CAP_MS, Math.max(0, notBefore - now))
  if (wait === 0) return 0
  return waitedMs + wait > REFRESH_WAIT_CAP_MS ? null : wait
}

/** The `data` of the error a call fails with when the refresh stayed refused (status 429). */
export interface RefreshLimitedData {
  refreshLimited: true
}

/** Was this failure "too many requests" — the session kept, to be tried again later? By shape. */
export function isRateLimited(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false
  return (err as { status?: unknown }).status === 429
}
