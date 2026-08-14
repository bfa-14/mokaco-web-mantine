import { tokenStorage } from './tokenStorage'

/**
 * "This session is over — go to the login page." ONE function, called from everywhere that can
 * discover it: the API client on a 401, and the live socket when its negotiate is refused.
 *
 * WHY THIS IS A MODULE-LEVEL LATCH AND NOT A PLAIN NAVIGATION.
 *
 * A page that has gone stale does not discover it once. Open the Requests hub with an expired token
 * and it fires the rows fetch, the counts fetch, the request-types fetch and a signature check at
 * the same instant; every one of them comes back 401, and every one of them wants to send the user
 * to the login page. Without the latch that is four navigations racing — the browser cancels
 * in-flight ones, the URL flickers, and whichever wins decides which `next` is preserved. With it,
 * the first caller wins and the rest are no-ops.
 *
 * The latch is deliberately NEVER reset. Once this has been called the document is on its way out;
 * there is no state in it worth keeping consistent, and a reset would only re-open the storm.
 *
 * A FULL PAGE LOAD, NOT A ROUTER NAVIGATION. This is reachable from modules that know nothing about
 * React — there is no router in scope, and a stale tab is exactly the case where tearing down every
 * timer, socket and half-finished render is the point rather than a cost. ProtectedRoute still
 * handles the ordinary in-app case with a client-side <Navigate>, and both spell the return path the
 * same way, so the login page has one thing to read.
 */
let redirecting = false

/** Where the user was, in the form the login page expects back. Null on the login page itself. */
function currentPath(): string | null {
  const here = window.location.pathname + window.location.search + window.location.hash
  return here.startsWith('/login') ? null : here
}

export function redirectToLogin(): void {
  if (redirecting || typeof window === 'undefined') return
  redirecting = true

  // Clear FIRST. If the navigation is slow, or something re-renders in the meantime, nothing must
  // still be holding a token the server has already rejected.
  tokenStorage.clear()

  const next = currentPath()
  window.location.assign(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
}

/** Test seam only — the latch is one-way in the app itself. */
export function __resetRedirectLatchForTests(): void {
  redirecting = false
}

/**
 * The return path, validated. Anything that is not a plain in-app path is dropped.
 *
 * `next` arrives in a URL, so it is attacker-supplied by definition: a link to
 * /login?next=https://elsewhere.example or the protocol-relative //elsewhere.example would otherwise
 * make our own login page bounce the user off-site with their session freshly established. Only a
 * single leading slash is accepted, and never back to /login — which is what stops a bookmarked
 * /login?next=/login from looping.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  if (raw.startsWith('/login')) return null
  // The dashboard is where login goes anyway, so remembering it says nothing and only puts
  // ?next=%2F in front of every fresh tab — the most common arrival of all.
  if (raw === '/') return null
  return raw
}
