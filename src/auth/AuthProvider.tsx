import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from './authContext'
import type { AuthContextValue } from './authContext'
import { tokenStorage } from './tokenStorage'
import * as authService from '../services/authService'
import type { LoginRequest, User } from '../types/auth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)

  /**
   * "Initialising" means THERE IS A TOKEN AND WE ARE ASKING WHO IT BELONGS TO. With no token there
   * is nothing to ask and nothing to wait for, so this starts false and the very first paint is the
   * redirect to /login — no spinner, no flash of a shell that is about to be replaced.
   *
   * It was unconditionally true, which meant a fresh tab always painted the full-screen loader for
   * one frame before discovering there was nothing to restore. Computed lazily so sessionStorage is
   * read once, at mount, and never again on re-render.
   */
  const [isInitializing, setIsInitializing] = useState(
    () => tokenStorage.getAccessToken() !== null,
  )

  // On mount, restore the session if a token is already stored.
  useEffect(() => {
    let cancelled = false

    async function restoreSession() {
      // No token: return WITHOUT calling the API. This is the "fresh tab" path, and it must not
      // produce a single request — a 401 here is exactly the console noise this change removes.
      if (!tokenStorage.getAccessToken()) {
        setIsInitializing(false)
        return
      }
      try {
        const current = await authService.fetchCurrentUser()
        if (!cancelled) {
          setUser(current)
        }
      } catch {
        tokenStorage.clear()
      } finally {
        if (!cancelled) {
          setIsInitializing(false)
        }
      }
    }

    void restoreSession()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (credentials: LoginRequest) => {
    await authService.login(credentials)
    try {
      setUser(await authService.fetchCurrentUser())
    } catch {
      // Session is valid (tokens stored) even if /me is unavailable;
      // fall back to a minimal user derived from the submitted username.
      setUser({ username: credentials.username })
    }
  }, [])

  const logout = useCallback(async () => {
    await authService.logout()
    setUser(null)
  }, [])

  // A Set, so pages can ask this on every render without a linear scan each time.
  // An absent permissions array (the /me fallback path in login) yields an empty set,
  // which makes hasPermission fail closed — see AuthContextValue.hasPermission.
  const permissions = useMemo(
    () => new Set(user?.permissions ?? []),
    [user],
  )

  const hasPermission = useCallback(
    (permission: string) => permissions.has(permission),
    [permissions],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isInitializing,
      hasPermission,
      login,
      logout,
    }),
    [user, isInitializing, hasPermission, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
