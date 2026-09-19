import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router-dom'
import { RouteErrorBoundary } from './RouteErrorBoundary'
import { ActionIcon, Burger, Button } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconLogout } from '@tabler/icons-react'
import { useAuth } from '../auth/useAuth'
import { SideNav } from './SideNav'
import { BrandWordmark } from '../components/Brand'
import { BookingLiveToasts } from '../pages/bookings/BookingLiveToasts'
import './AppLayout.css'

/**
 * The width below which the nav stops sharing the row with the content and becomes an overlay.
 * Kept in step with the `@media (max-width: 1000px)` block in AppLayout.css: CSS owns how the
 * drawer LOOKS, this owns when it is open — and a disagreement between the two would strand an
 * open-but-invisible drawer.
 */
const NARROW = '(max-width: 1000px)'
/** Below this the header sheds its optional text: the username and the brand tag. */
const COMPACT = '(max-width: 560px)'

/**
 * The application chrome — dark graphite header, collapsible nav, content pane.
 *
 * PORT NOTE: the original wrapped the body in DevExtreme's Drawer with openedStateMode="shrink"
 * and position="before" (start-side in RTL). The same behaviour here is plain flex: the nav sits
 * FIRST in a flex row (so `dir` decides which side it appears on, exactly what 'before' meant),
 * and closing it removes it from the row, which is what "shrink" did.
 *
 * NEW IN THIS BUILD, deliberately not mirrored back: below 1000px the nav stops shrinking the
 * content and overlays it instead. Shrinking is fine when there is room to give; on a laptop
 * screen showing the roster it left neither the nav nor the grid usable.
 */
export function AppLayout() {
  const { t } = useTranslation()
  // Only for the route error boundary's reset key — navigating away clears a caught crash.
  const location = useLocation()
  const { user, logout } = useAuth()

  // getInitialValueInEffect off: this is a client-only app, so the true width is knowable on the
  // first render and the nav should not flash open before an effect corrects it.
  const isNarrow = useMediaQuery(NARROW, false, { getInitialValueInEffect: false })
  const isCompact = useMediaQuery(COMPACT, false, { getInitialValueInEffect: false })

  const [navOpened, setNavOpened] = useState(!isNarrow)
  const [loggingOut, setLoggingOut] = useState(false)

  /**
   * Crossing the breakpoint resets the nav to that side's default — open on desktop, closed when
   * narrow. Without this, shrinking a window with the nav open leaves an overlay covering the
   * page that the user never asked for, and widening one with it closed hides the nav entirely.
   */
  useEffect(() => {
    setNavOpened(!isNarrow)
  }, [isNarrow])

  /** Escape closes the overlay — the same act as clicking the backdrop. Desktop has no overlay
   *  to dismiss, so the listener is only attached where it means something. */
  useEffect(() => {
    if (!isNarrow || !navOpened) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setNavOpened(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isNarrow, navOpened])

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      setLoggingOut(false)
    }
  }

  const signOutLabel = loggingOut ? t('layout.signingOut') : t('layout.signOut')

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-side">
          <Burger
            opened={navOpened}
            onClick={() => setNavOpened((open) => !open)}
            aria-label={t('layout.toggleNavigation')}
            color="var(--brand-offwhite)"
            size="sm"
          />
          <span className="app-brand">
            <BrandWordmark className="app-brand-mark" />
            <span className="app-brand-tag">HRMS</span>
          </span>
        </div>
        <div className="app-header-side">
          <span className="app-user">{user?.username ?? ''}</span>
          {/* Same act, same absence of confirmation, two shapes: a labelled button where there is
              room for the word, the glyph alone where there is not. */}
          {isCompact ? (
            <ActionIcon
              variant="subtle"
              color="gray.0"
              size="lg"
              aria-label={signOutLabel}
              title={signOutLabel}
              onClick={() => void handleLogout()}
              disabled={loggingOut}
            >
              <IconLogout size={18} />
            </ActionIcon>
          ) : (
            <Button
              variant="subtle"
              color="gray.0"
              leftSection={<IconLogout size={16} />}
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              styles={{ label: { color: 'var(--brand-offwhite)' } }}
            >
              {signOutLabel}
            </Button>
          )}
        </div>
      </header>

      <div className="app-body">
        {/* When narrow the nav stays MOUNTED whatever its state, because it slides rather than
            appears — an unmounted element cannot animate out. On desktop it is removed from the
            row when closed, which is what DevExtreme's "shrink" mode did. */}
        {(navOpened || isNarrow) && (
          <SideNav
            className={navOpened ? 'side-nav side-nav--open' : 'side-nav'}
            onNavigate={isNarrow ? () => setNavOpened(false) : undefined}
          />
        )}

        {isNarrow && navOpened && (
          <div
            className="app-nav-backdrop"
            onClick={() => setNavOpened(false)}
            aria-hidden="true"
          />
        )}

        {/* Wrapping the OUTLET, not the whole layout, is the point: a page that throws is replaced
            in place while the nav and header around it keep working, so the reader can navigate
            away rather than reload into the same crash. Keyed on the pathname so moving to another
            page clears a caught error. */}
        <main className="app-content">
          <RouteErrorBoundary resetKey={location.pathname}>
            {/* Renders nothing: listens on /hubs/booking and toasts a new website booking on any page. */}
            <BookingLiveToasts />
            <Outlet />
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  )
}
