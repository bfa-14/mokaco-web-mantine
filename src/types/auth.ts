/** Payload sent to POST /api/auth/login. */
export interface LoginRequest {
  username: string
  password: string
}

/** Tokens extracted from an auth response and persisted locally. */
export interface AuthTokens {
  accessToken: string
  refreshToken: string | null
}

/**
 * Authenticated user returned by GET /api/auth/me.
 *
 * Mirrors the backend `CurrentUser` DTO (serialized camelCase). Fields are
 * optional so the local login fallback can supply a partial user; the index
 * signature tolerates any extra fields the backend may add.
 */
export interface User {
  userId?: number
  username?: string
  roles?: string[]
  permissions?: string[]
  [key: string]: unknown
}
