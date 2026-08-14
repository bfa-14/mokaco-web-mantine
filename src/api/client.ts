import { API_BASE_URL } from '../config'
import { tokenStorage } from '../auth/tokenStorage'
import { extractTokens } from '../auth/tokenExtractor'
import { redirectToLogin } from '../auth/sessionRedirect'
import type { AuthTokens } from '../types/auth'

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

// A single in-flight refresh shared across concurrent 401s.
let refreshInFlight: Promise<AuthTokens | null> | null = null

async function performRefresh(): Promise<AuthTokens | null> {
  const refreshToken = tokenStorage.getRefreshToken()
  if (!refreshToken) {
    return null
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!response.ok) {
      return null
    }
    const tokens = extractTokens(await response.json().catch(() => null))
    if (tokens) {
      tokenStorage.set(tokens)
    }
    return tokens
  } catch {
    return null
  }
}

/**
 * Performs a JSON API request against the MokaCo HRMS backend.
 *
 * - Prepends the configured base URL.
 * - Attaches the bearer token unless `auth: false`.
 * - On a 401, transparently refreshes the token once and retries; if the refresh fails — or the
 *   refreshed token is rejected too — the session is over and the tab goes to the login page.
 * - Throws {@link ApiError} on non-2xx responses.
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

  if (response.status === 401 && auth && !skipRefresh) {
    refreshInFlight ??= performRefresh().finally(() => {
      refreshInFlight = null
    })
    const tokens = await refreshInFlight
    if (tokens) {
      response = await buildRequest(path, auth, headers, init)
      // A brand-new token that is STILL refused is not a stale-token problem — the account has been
      // disabled, or the server no longer honours this session. Retrying cannot help.
      if (response.status === 401) {
        redirectToLogin()
      }
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
