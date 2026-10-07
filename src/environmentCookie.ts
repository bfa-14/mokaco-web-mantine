/**
 * Which back end this browser is pointed at: production, or the test copy.
 *
 * The app never chooses an API itself. The switch on the login page sends the browser to
 * /env/test or /env/prod; nginx answers those two paths by setting or clearing the mokaco_env
 * cookie and redirecting to /login, and from then on routes /api and /hubs by that cookie — to the
 * test API on MokaCo_HRMS_Test, or to production (MokaCo.HRMS deploy/test-env). The app only READS
 * the cookie, to say which one it is talking to. A server without that nginx config never sets the
 * cookie, so the app correctly reads "production" there.
 *
 * Pure (no DOM), so tests/environment.test.ts runs it under plain Node.
 */
export type AppEnvironment = 'production' | 'test'

export const ENV_COOKIE = 'mokaco_env'

/** Reads a Cookie header / document.cookie. Anything but exactly "test" is production. */
export function environmentFromCookie(cookies: string): AppEnvironment {
  for (const part of cookies.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() === ENV_COOKIE) {
      return part.slice(separator + 1).trim() === 'test' ? 'test' : 'production'
    }
  }
  return 'production'
}

/** The path nginx answers for each side of the switch. */
export function switchPath(target: AppEnvironment): string {
  return target === 'test' ? '/env/test' : '/env/prod'
}
