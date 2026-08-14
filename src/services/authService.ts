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
 */
export async function logout(): Promise<void> {
  const refreshToken = tokenStorage.getRefreshToken()
  try {
    if (refreshToken) {
      await apiRequest('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      })
    }
  } catch {
    // Ignore network/logout errors — clearing local tokens is what matters.
  } finally {
    tokenStorage.clear()
  }
}
