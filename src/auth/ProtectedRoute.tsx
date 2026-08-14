import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader } from '@mantine/core'
import { useAuth } from './useAuth'
import { safeNextPath } from './sessionRedirect'

function FullScreenLoader() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
      }}
    >
      <Loader size={44} />
    </div>
  )
}

/**
 * Guards nested routes: shows a loader while the session is being restored, redirects
 * unauthenticated users to /login remembering where they came from, and otherwise renders the
 * matched child route.
 *
 * The return path travels as ?next=, the SAME spelling {@link redirectToLogin} uses from outside
 * React — one spelling, one reader. (Unchanged from the original; only the loader is Mantine now.)
 */
export function ProtectedRoute() {
  const { isAuthenticated, isInitializing } = useAuth()
  const location = useLocation()

  if (isInitializing) {
    return <FullScreenLoader />
  }

  if (!isAuthenticated) {
    const next = safeNextPath(location.pathname + location.search + location.hash)
    const to = next ? `/login?next=${encodeURIComponent(next)}` : '/login'
    return <Navigate to={to} replace />
  }

  return <Outlet />
}
