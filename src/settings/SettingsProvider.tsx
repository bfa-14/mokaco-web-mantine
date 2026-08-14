import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { SettingsContext } from './settingsContext'
import type { SettingsContextValue } from './settingsContext'
import { useAuth } from '../auth/useAuth'
import { settingsService } from '../services/settingsService'

/**
 * Loads the UI-affecting settings once the user is signed in, and hands them to the whole app.
 *
 * It sits INSIDE the auth provider and waits for authentication, because /api/settings/ui requires
 * a token — fetching it before login would just 401 on every page load.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()

  // Default TRUE: if the call fails, or has not returned yet, the help SHOWS. See the note on
  // SettingsContextValue.showPageHelp — this fails open on purpose.
  const [showPageHelp, setShowPageHelp] = useState(true)

  useEffect(() => {
    if (!isAuthenticated) return

    let cancelled = false

    async function loadUiSettings() {
      try {
        const ui = await settingsService.getUi()
        if (!cancelled) setShowPageHelp(ui.showPageHelp)
      } catch {
        // A settings outage must not blank the app. Leave the help on and carry on.
        if (!cancelled) setShowPageHelp(true)
      }
    }

    void loadUiSettings()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  /** Lets the Settings page apply the toggle at once, rather than making everyone reload. */
  const refresh = useCallback(async () => {
    if (!isAuthenticated) return

    try {
      const ui = await settingsService.getUi()
      setShowPageHelp(ui.showPageHelp)
    } catch {
      setShowPageHelp(true)
    }
  }, [isAuthenticated])

  const value = useMemo<SettingsContextValue>(
    () => ({ showPageHelp, refresh }),
    [showPageHelp, refresh],
  )

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  )
}
