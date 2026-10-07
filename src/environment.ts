import { tokenStorage } from './auth/tokenStorage'
import { environmentFromCookie, switchPath, type AppEnvironment } from './environmentCookie'

function readCookie(): AppEnvironment {
  try {
    return environmentFromCookie(document.cookie)
  } catch {
    return 'production'
  }
}

/**
 * The environment this PAGE was loaded against, fixed for the life of the page: switching is
 * always a full navigation, so nothing on screen changes environment under the user's feet.
 *
 * Applied at import time (main.tsx imports this module before anything renders), so the test
 * colours are on the very first paint: <html data-env="test"> turns the header red, and the tab
 * title says TEST.
 */
export const pageEnvironment: AppEnvironment = readCookie()

document.documentElement.dataset.env = pageEnvironment
if (pageEnvironment === 'test') {
  document.title = `TEST · ${document.title}`
}

/**
 * Points this browser at the other back end. This tab's session is dropped first: a session
 * belongs to the database it was opened on, and a production token must never ride into test, or
 * the other way round. A full page load on purpose — nginx sets the cookie on /env/test or
 * /env/prod and redirects to /login, and every piece of in-memory state starts again.
 */
export function switchEnvironment(target: AppEnvironment): void {
  if (target === pageEnvironment) return
  tokenStorage.clear()
  window.location.assign(switchPath(target))
}

/**
 * THE COOKIE IS SHARED BY EVERY TAB; THE PAGE IS NOT. A switch made in one tab re-routes the API
 * calls of every other open tab while it still shows the old environment's colours and user. When
 * such a tab comes back into view it is signed out and sent to the login page, which then shows
 * the environment it is really on.
 */
function leaveIfSwitchedElsewhere(): void {
  if (readCookie() === pageEnvironment) return
  tokenStorage.clear()
  window.location.assign('/login')
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') leaveIfSwitchedElsewhere()
})
window.addEventListener('focus', leaveIfSwitchedElsewhere)
