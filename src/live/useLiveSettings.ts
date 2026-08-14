import { useContext } from 'react'
import { LiveSettingsContext } from './liveContext'
import type { LiveFeature } from './livePrefs'

/** The live-update settings. Must be used within a <LiveSettingsProvider>. */
export function useLiveSettings() {
  const ctx = useContext(LiveSettingsContext)
  if (ctx === undefined) {
    throw new Error('useLiveSettings must be used within a LiveSettingsProvider')
  }
  return ctx
}

/**
 * Whether a page should be live right now.
 *
 * Read through the context rather than from storage directly, so flipping a switch in Settings
 * re-renders every subscribed page and its useLive `enabled` flag changes immediately — no reload,
 * which is the whole point of the toggle being a preference rather than a build flag.
 */
export function useLiveEnabled(feature: LiveFeature): boolean {
  return useLiveSettings().isEnabled(feature)
}
