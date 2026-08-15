import type { ReactNode } from 'react'
import { useAuth } from './useAuth'
import { AccessDenied } from '../pages/AccessDenied'
import type { PermissionCode } from './routeAccess'

/**
 * The route guard. Wraps a route's element and renders the page only if the user holds at least one
 * of `anyOf`; otherwise the No access panel.
 *
 * THE CHILD IS NOT RENDERED WHEN ACCESS IS REFUSED, and that is the entire point rather than a
 * detail of the implementation. React runs effects on mount, and every page in this app loads its
 * data from one — so rendering the page behind an overlay, or rendering it and hiding it with CSS,
 * would still fire the whole page's requests and collect a fistful of 403s in the console before
 * showing a panel that says the page was never available. Returning a different element means the
 * page's effects never exist.
 *
 * `anyOf` is a plain prop rather than something looked up from the route path, so App.tsx reads as
 * a table of what each route needs. The values still come from routeAccess.ts — App passes
 * `accessFor(path)?.anyOf` — so the map remains the only place a requirement is written down.
 */
export function RequirePermission({
  anyOf,
  children,
}: {
  anyOf: PermissionCode[]
  children: ReactNode
}) {
  const { hasPermission } = useAuth()

  if (!anyOf.some((code) => hasPermission(code))) {
    return <AccessDenied />
  }

  return <>{children}</>
}
