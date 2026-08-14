/**
 * How the Requests hub is drawn — cards or a grid.
 *
 * A DISPLAY PREFERENCE, not auth data, so localStorage is the right home (the tokenStorage rule is
 * about credentials) and it deliberately survives across tabs and restarts: somebody who prefers
 * the grid prefers it tomorrow too.
 *
 * Keyed per user, because a shared shop-floor machine must not hand one person's layout to the
 * next. An absent key means "no choice yet" — see {@link DEFAULT_HUB_VIEW}.
 */

export type HubView = 'card' | 'grid'

function key(userId: number | null | undefined): string {
  return `view:${userId ?? 'anon'}:requestsHub`
}

/**
 * The view EVERY tab opens in before the user has expressed a preference.
 *
 * One value, not one per tab. "To handle" used to open as a grid on the theory that a work queue is
 * triaged in columns — but it meant the hub changed shape as you moved between its own tabs, so the
 * first thing a new user learned about the page was that it was inconsistent with itself. Cards are
 * the form the hub is designed around; the grid is there for whoever wants it, one click away and
 * remembered for good once chosen.
 *
 * A constant rather than a function of the tab, so "the same everywhere" is a fact about the code
 * and not a rule three call sites have to keep agreeing on.
 */
export const DEFAULT_HUB_VIEW: HubView = 'card'

export const hubViewPref = {
  /** The stored choice, or null when the user has never chosen. */
  get(userId: number | null | undefined): HubView | null {
    try {
      const v = localStorage.getItem(key(userId))
      return v === 'card' || v === 'grid' ? v : null
    } catch {
      return null
    }
  },

  set(userId: number | null | undefined, view: HubView): void {
    try {
      localStorage.setItem(key(userId), view)
    } catch {
      /* storage unavailable — the choice simply does not persist */
    }
  },
}
