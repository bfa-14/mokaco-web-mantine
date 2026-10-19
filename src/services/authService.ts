import { apiRequest } from '../api/client'
import { tokenStorage } from '../auth/tokenStorage'
import { extractTokens } from '../auth/tokenExtractor'
import type { AuthTokens, LoginRequest, User } from '../types/auth'

/**
 * Logs in against POST /api/auth/login, stores the returned tokens, and
 * returns them. Throws if the response contains no recognizable token.
 */
export async function login(credentials: LoginRequest): Promise<AuthTokens> {
  const payload = await apiRequest<unknown>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
    auth: false,
  })

  const tokens = extractTokens(payload)
  if (!tokens) {
    throw new Error(
      'Login succeeded but no token was found in the response. ' +
        'Update the token field names in src/auth/tokenExtractor.ts.',
    )
  }

  tokenStorage.set(tokens)
  return tokens
}

/** Fetches the current authenticated user from GET /api/auth/me. */
export function fetchCurrentUser(): Promise<User> {
  return apiRequest<User>('/api/auth/me', { method: 'GET' })
}

/**
 * Logs out via POST /api/auth/logout (best effort) and always clears the
 * locally stored tokens.
 *
 * `skipRefresh`: signing out never turns into a token refresh. A 401 here means the server has
 * already ended this session — a password change ends every session of the account, this one
 * included (QA3 SEC-5) — and the refresh path would answer it with a full-page redirect to the
 * login page, before the caller could say why. The refresh would gain nothing anyway: a rotated
 * token is a new live one, and the old one is what this call names.
 */
export async function logout(): Promise<void> {
  const refreshToken = tokenStorage.getRefreshToken()
  try {
    if (refreshToken) {
      await apiRequest('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
        skipRefresh: true,
      })
    }
  } catch {
    // Ignore network/logout errors — clearing local tokens is what matters.
  } finally {
    tokenStorage.clear()
  }
}
