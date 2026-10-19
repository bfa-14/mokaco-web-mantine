/**
 * Where the Google sign-in gate sends someone once Google has said yes.
 *
 * Only used when the gate page sits at its OWN address (/gate/?next=/employees). Shown in place of
 * the page somebody asked for, the gate simply reloads that page instead.
 *
 * `next` arrives in a URL, so it is attacker-supplied by definition: /gate/?next=https://elsewhere
 * or the protocol-relative //elsewhere would otherwise make our own gate bounce a freshly signed-in
 * phone off-site. The rule is the app's safeNextPath (src/auth/sessionRedirect.ts): one leading
 * slash and nothing else is accepted. Three extras, because this value goes straight into
 * location.replace with no router in between:
 *   - no backslash anywhere — browsers read "/\elsewhere" as "//elsewhere";
 *   - no control characters — the URL parser DELETES tabs and newlines, so "/\t/elsewhere" would
 *     arrive as "//elsewhere";
 *   - never the gate itself, which would only show the same page again.
 * Anything refused becomes '/', the dashboard — the place login goes anyway.
 *
 * Pure (no DOM), so tests/gateNext.test.ts runs it under plain Node.
 */

/** Where a refused or missing `next` lands. */
export const DEFAULT_NEXT = '/'

/** The gate page's own paths: /gate, /gate/, /gate/index.html, /gate?…, /gate#…. */
export function isGatePath(path) {
  return (
    path === '/gate' ||
    path.startsWith('/gate/') ||
    path.startsWith('/gate?') ||
    path.startsWith('/gate#')
  )
}

/**
 * The return path, validated. Always a string: the safe `next`, or '/'.
 * @param {string | null | undefined} raw
 * @returns {string}
 */
export function safeNextPath(raw) {
  if (typeof raw !== 'string' || raw === '') return DEFAULT_NEXT
  if (!raw.startsWith('/') || raw.startsWith('//')) return DEFAULT_NEXT
  if (raw.includes('\\')) return DEFAULT_NEXT
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_NEXT
  if (isGatePath(raw)) return DEFAULT_NEXT

  // Belt and braces: resolve it the way the browser will, and insist it stays on this site and off
  // the gate ("/./gate/" only becomes "/gate/" once resolved).
  const base = 'https://gate.invalid'
  try {
    const url = new URL(raw, base)
    if (url.origin !== base || isGatePath(url.pathname)) return DEFAULT_NEXT
  } catch {
    return DEFAULT_NEXT
  }
  return raw
}
