import { createContext } from 'react'
import type { LoginRequest, User } from '../types/auth'

export interface AuthContextValue {
  user: User | null
  isAuthenticated: boolean
  /** True while the initial "restore session" check is running. */
  isInitializing: boolean
  /**
   * Whether the signed-in user holds a permission code (e.g. 'ATTENDANCE_CORRECT'),
   * from the list GET /api/auth/me returns.
   *
   * Used to gate UI by HIDING it rather than disabling it: a button somebody can never
   * successfully press is noise, and it only invites them to try. The server enforces
   * the same codes either way — this decides what is worth showing, not what is allowed.
   *
   * Returns false when permissions are unknown (the /me call failed and login fell back
   * to a username-only user). Failing CLOSED is deliberate: showing an HR-only action to
   * someone whose rights we could not read is the worse of the two mistakes.
   */
  hasPermission: (permission: string) => boolean
  login: (credentials: LoginRequest) => Promise<void>
  logout: () => Promise<void>
}

/** Kept in its own file so provider and hook can live in separate modules. */
export const AuthContext = createContext<AuthContextValue | undefined>(undefined)
