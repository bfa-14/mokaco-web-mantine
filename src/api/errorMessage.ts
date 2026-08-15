import { ApiError } from './client'

/**
 * The one sentence a refused action gets, wherever it is refused.
 *
 * Not translated here, and deliberately: this module is imported by plain functions and service
 * layers that have no hook and no component, so a t() call would need a TFunction threaded through
 * every caller in the app. The string is the same in both languages' terms — a page that wants the
 * translated form renders {@link AccessDenied}, which does have the hook.
 */
export const FORBIDDEN_MESSAGE = "You don't have permission for this action"

/** Is this the API refusing on permission grounds, rather than any other failure? */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403
}

/**
 * Extracts a user-facing message from any thrown error.
 *
 * A 403 IS COLLAPSED TO ONE SENTENCE, whatever the server said. The API's own 403 bodies vary — a
 * bare "Forbidden", an empty body that falls through to "Request failed with status 403", sometimes
 * an ASP.NET ProblemDetails title — and none of those tell the reader anything except that the app
 * looks broken. One consistent sentence is both truer and more useful, and it means every page that
 * already renders getErrorMessage() into its error or empty state gained coherent 403 handling
 * without changing a line.
 *
 * Every other status keeps the server's message verbatim, which matters: the RAISERROR text from a
 * stored procedure ("Tier must be 1, 2 or 3", "System reset is not armed") is the whole value of a
 * 400, and flattening those would be a real loss.
 */
export function getErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return FORBIDDEN_MESSAGE
    return error.message || fallback
  }
  if (error instanceof Error) {
    return error.message || fallback
  }
  return fallback
}
