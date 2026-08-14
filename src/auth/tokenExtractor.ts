import type { AuthTokens } from '../types/auth'

/**
 * The MokaCo HRMS OpenAPI spec documents auth request bodies but not the
 * response bodies, so we can't know the exact token field names up front.
 * This extractor tolerantly pulls tokens out of the common shapes.
 *
 * ── If login succeeds but no token is found, update the candidate lists below
 *    to match your real response field names (this is the single place to change).
 */
const ACCESS_TOKEN_KEYS = [
  'accessToken',
  'token',
  'access_token',
  'jwt',
  'accessTokenValue',
]

const REFRESH_TOKEN_KEYS = ['refreshToken', 'refresh_token']

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return null
}

/**
 * Extracts access/refresh tokens from an auth response payload.
 * Handles both a flat object and a `{ data: { ... } }` envelope.
 * Returns null if no access token can be found.
 */
export function extractTokens(payload: unknown): AuthTokens | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const root = payload as Record<string, unknown>
  const source =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root

  const accessToken = pickString(source, ACCESS_TOKEN_KEYS)
  if (!accessToken) {
    return null
  }

  return {
    accessToken,
    refreshToken: pickString(source, REFRESH_TOKEN_KEYS),
  }
}
