import { API_BASE_URL } from '../config'
import { tokenStorage } from '../auth/tokenStorage'
import { extractTokens } from '../auth/tokenExtractor'
import { redirectToLogin } from '../auth/sessionRedirect'
import type { AuthTokens } from '../types/auth'
import { GATE_MESSAGE, isGateResponse, mayReloadForGate } from './gateResponse'
import type { GateErrorData } from './gateResponse'
import { refreshWaitMs, retryAfterMs } from './refreshThrottle'
import type { RefreshLimitedData } from './refreshThrottle'
import { notifications } from '@mantine/notifications'
import { t } from '../i18n/t'

/** Error thrown for non-2xx API responses, carrying status and parsed body. */
export class ApiError extends Error {
  readonly status: number
  readonly data: unknown

  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

export interface RequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: HeadersInit
  /** Attach the bearer token (default: true). Set false for public endpoints. */
  auth?: boolean
  /** Skip the automatic 401 -> refresh -> retry flow (used internally). */
  skipRefresh?: boolean
}

function buildRequest(
  path: string,
  auth: boolean,
  extraHeaders: HeadersInit | undefined,
  init: Omit<RequestInit, 'headers'>,
): Promise<Response> {
  const headers = new Headers(extraHeaders)
  // For FormData the browser sets multipart/form-data with the correct boundary,
  // so only default to JSON for other body types.
  if (
    init.body != null &&
    !(init.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json')
  }
  if (auth) {
    const accessToken = tokenStorage.getAccessToken()
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`)
    }
  }
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers })
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.length > 0) {
    return body
  }
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    // Common shapes: { message }, { error }, ASP.NET ProblemDetails { title, detail }.
    for (const key of ['message', 'error', 'detail', 'title']) {
      const value = obj[key]
      if (typeof value === 'string' && value.length > 0) {
        return value
      }
    }
  }
  return fallback
}

async function parseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return null
  }
  if (contentType.includes('json')) {
    return response.json().catch(() => null)
  }
  return response.text().catch(() => null)
}

async function handleResponse<T>(response: Response): Promise<T> {
  const body = await parseBody(response)
  if (!response.ok) {
    const message = extractErrorMessage(
      body,
      response.statusText || `Request failed with status ${response.status}`,
    )
    throw new ApiError(response.status, message, body)
  }
  return body as T
}

/**
 * Is this 401 THE TOKEN BEING REJECTED, or an application saying no?
 *
 * THE BUG THIS EXISTS TO STOP: a signature endpoint answered a wrong password with 401, and every
 * 401 here was taken as "your session is over" — so mistyping your password while approving logged
 * you out of a session that was working perfectly. The two are different events that happened to
 * share a status code.
 *
 * They are told apart by the BODY. A token rejection comes from the JWT middleware before any
 * controller runs: no body, or a non-JSON one, and a `WWW-Authenticate: Bearer` challenge header.
 * An application refusal is a controller's own answer and carries a JSON error message written for
 * a human. Only the first kind is a session ending.
 *
 * Defaults to TRUE on anything it cannot read, so an unrecognised 401 still ends the session — the
 * failure that leaves someone signed in with a dead token is worse than one extra sign-in.
 */
async function isTokenRejection(response: Response): Promise<boolean> {
  // The challenge header is the middleware's own signature and settles it outright.
  if (response.headers.get('www-authenticate')) return true

  const contentType = response.headers.get('content-type') ?? ''
  // Not JSON — nothing a controller wrote. Empty bodies land here too, which is the common case.
  if (!contentType.includes('json')) return true

  try {
    // CLONED: the caller still has to read this response, and a body may only be consumed once.
    const body = await response.clone().json()
    if (!body || typeof body !== 'object') return true
    const obj = body as Record<string, unknown>
    // A message written for a person means a controller answered — an application refusal.
    return !['message', 'error', 'detail', 'title'].some(
      (k) => typeof obj[k] === 'string' && (obj[k] as string).length > 0,
    )
  } catch {
    return true
  }
}

/**
 * THE GOOGLE SIGN-IN GATE CLOSED ON THIS TAB — reload, and the page comes back as the gate.
 *
 * Latched like redirectToLogin: a page that discovers it fires every fetch at once, and one reload
 * is enough. The tokens are KEPT on purpose — the HRMS session is fine, only Google's sign-in has
 * lapsed — so once the gate lets the reload through, the person is back where they were.
 *
 * The time of the reload is kept in sessionStorage too, and a second one inside
 * GATE_RELOAD_GUARD_MS is refused: should the gate ever pass a page and refuse its calls, the page
 * shows the error instead of reloading forever. Storage that throws simply skips the guard.
 *
 * Returns whether the page is now reloading. Also called by the live-updates socket, whose
 * handshake can be the first thing to meet the gate.
 */
const GATE_RELOAD_KEY = 'mokaco_gate_reload_at'
/** Null until the gate is first met; then whether this document is reloading for it. */
let gateReload: boolean | null = null

export function reloadForGate(): boolean {
  if (gateReload !== null) return gateReload
  if (typeof window === 'undefined') return false
  const now = Date.now()
  try {
    const stored = sessionStorage.getItem(GATE_RELOAD_KEY)
    if (!mayReloadForGate(stored == null ? null : Number(stored), now)) return (gateReload = false)
    sessionStorage.setItem(GATE_RELOAD_KEY, String(now))
  } catch {
    /* storage unavailable — reload without the guard */
  }
  window.location.reload()
  return (gateReload = true)
}

/** What apiRequest throws for a gated call — tagged, so restoring a session can tell it apart. */
function gateError(): ApiError {
  const data: GateErrorData = { gate: true, reloading: reloadForGate() }
  return new ApiError(401, GATE_MESSAGE, data)
}

/**
 * What asking for new tokens came to: new tokens; the session over (no refresh token, or the server
 * refused it); or LIMITED — the server rate-limits the refresh (QA3 SEC-6) and said "not now", which
 * says nothing about the session. See src/api/refreshThrottle.ts.
 */
type RefreshOutcome = { kind: 'renewed'; tokens: AuthTokens } | { kind: 'ended' } | { kind: 'limited' }

// A single in-flight refresh shared across concurrent 401s — the waits included, so a page that
// keeps firing while the server says "not now" still sends one refresh, not one per call.
let refreshInFlight: Promise<RefreshOutcome> | null = null

/** Not before this time (epoch ms) is the refresh asked again: the last 429's Retry-After. */
let refreshNotBefore = 0

/** The toast shown while a refresh waits out a 429 — one at a time, by id. */
const REFRESH_WAIT_TOAST = 'session-refresh-wait'

async function performRefresh(): Promise<RefreshOutcome> {
  const refreshToken = tokenStorage.getRefreshToken()
  if (!refreshToken) {
    return { kind: 'ended' }
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (response.status === 429) {
      // Too many refreshes from this address. The tokens stay exactly as they are.
      refreshNotBefore = Date.now() + retryAfterMs(response.headers.get('retry-after'), Date.now())
      return { kind: 'limited' }
    }
    if (!response.ok) {
      return { kind: 'ended' }
    }
    const tokens = extractTokens(await response.json().catch(() => null))
    if (!tokens) {
      return { kind: 'ended' }
    }
    tokenStorage.set(tokens)
    return { kind: 'renewed', tokens }
  } catch {
    return { kind: 'ended' }
  }
}

/**
 * The refresh, asked again after a 429 once the server's Retry-After has passed — within
 * REFRESH_WAIT_CAP_MS for one call. Still limited after that, the outcome is 'limited' and the
 * caller fails with a "try again in a minute" error; the session is kept for that next try.
 */
async function refreshSession(): Promise<RefreshOutcome> {
  let waited = 0
  try {
    for (;;) {
      const wait = refreshWaitMs(refreshNotBefore, Date.now(), waited)
      if (wait === null) return { kind: 'limited' }
      if (wait > 0) {
        notifications.show({
          id: REFRESH_WAIT_TOAST,
          message: t('auth.refreshWaiting'),
          loading: true,
          autoClose: false,
          withCloseButton: false,
        })
        await new Promise((done) => setTimeout(done, wait))
        waited += wait
      }
      const outcome = await performRefresh()
      if (outcome.kind !== 'limited') return outcome
    }
  } finally {
    if (waited > 0) notifications.hide(REFRESH_WAIT_TOAST)
  }
}

/** What a call fails with when the refresh stayed rate-limited: 429, the session untouched. */
function refreshLimitedError(): ApiError {
  const data: RefreshLimitedData = { refreshLimited: true }
  return new ApiError(429, t('auth.refreshLimited'), data)
}

/**
 * Performs a JSON API request against the MokaCo HRMS backend.
 *
 * - Prepends the configured base URL.
 * - Attaches the bearer token unless `auth: false`.
 * - On a 401, transparently refreshes the token once and retries; if the refresh fails — or the
 *   refreshed token is rejected too — the session is over and the tab goes to the login page.
 *   A 429 on the refresh is not a failure: the call waits the server's Retry-After (up to a minute)
 *   and asks again, and if it is still refused fails with a 429 ApiError, the session kept.
 * - Throws {@link ApiError} on non-2xx responses.
 * - A 401 from the Google sign-in gate (header X-Mokaco-Gate) reloads the page instead — on any
 *   call, login included, and before the refresh path. See {@link reloadForGate}.
 *
 * THE REDIRECT IS SCOPED TO AUTHENTICATED CALLS (`auth !== false`). Login is a public call, so a
 * wrong password comes back here as an ordinary 401 ApiError and lands on the form as text — which
 * is the difference between "you mistyped your password" and "your session ended". Redirecting on
 * that one would send the login page to the login page for every typo.
 */
export async function apiRequest<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { auth = true, skipRefresh = false, headers, ...init } = options

  let response = await buildRequest(path, auth, headers, init)

  // The gate first: its 401 says nothing about the token, and the refresh call would be gated too.
  if (isGateResponse(response)) {
    throw gateError()
  }

  /* THE SESSION IS CLEARED ON EXACTLY ONE THING: a 401 that is the TOKEN being rejected, on a call
     that carried a token. Everything else falls through to handleResponse and is thrown as an
     ApiError for the page to render — 400, 403 and 404 never reach this branch at all, and neither
     does a 401 a controller wrote (a wrong signature password), which is what used to sign people
     out mid-approval.

     `hadToken` is the "previously-working session" part: with no access token there was no session
     to end, and the ProtectedRoute already owns that case. */
  const hadToken = auth && tokenStorage.getAccessToken() != null

  if (
    response.status === 401 &&
    hadToken &&
    !skipRefresh &&
    (await isTokenRejection(response))
  ) {
    refreshInFlight ??= refreshSession().finally(() => {
      refreshInFlight = null
    })
    const outcome = await refreshInFlight
    if (outcome.kind === 'renewed') {
      response = await buildRequest(path, auth, headers, init)
      if (isGateResponse(response)) {
        throw gateError()
      }
      // A brand-new token that is STILL refused is not a stale-token problem — the account has been
      // disabled, or the server no longer honours this session. Retrying cannot help.
      if (response.status === 401) {
        redirectToLogin()
      }
    } else if (outcome.kind === 'limited') {
      // "Not now" from the refresh is not the session ending (QA3 SEC-6): the tokens stay, nobody is
      // sent to the login page, and this call fails with a message to try again in a minute.
      throw refreshLimitedError()
    } else {
      // No refresh token, or the server refused it. redirectToLogin() clears storage itself, which
      // is why the explicit tokenStorage.clear() that used to sit here is gone rather than doubled.
      redirectToLogin()
    }
  }

  // Still throws. The navigation above is not instantaneous, and a caller left awaiting a promise
  // that never settles would sit on a spinner for the whole time the document is being replaced.
  return handleResponse<T>(response)
}
