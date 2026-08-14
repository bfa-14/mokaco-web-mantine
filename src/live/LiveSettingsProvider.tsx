import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/useAuth'
import { liveClient } from './liveClient'
import { LiveSettingsContext } from './liveContext'
import type { LiveSettingsValue } from './liveContext'
import { LIVE_FEATURES, livePrefs } from './livePrefs'
import type { LiveFeature } from './livePrefs'

function readAll(userId: number | null | undefined) {
  return {
    master: livePrefs.masterEnabled(userId),
    features: Object.fromEntries(
      LIVE_FEATURES.map((f) => [f, livePrefs.rawFeature(userId, f)]),
    ) as Record<LiveFeature, boolean>,
  }
}

/**
 * Holds the live-update preferences in state so a toggle takes effect immediately.
 *
 * Storage alone would not do it: a page reads `enabled` during render, and writing to localStorage
 * does not re-render anything. Keeping the same values in context means flipping a checkbox in
 * Settings re-renders every page using useLiveEnabled, whose useLive effect then subscribes or
 * unsubscribes on the spot.
 *
 * THE PREFERENCES ARE RE-READ WHEN THE USER CHANGES, because they are per user id — signing out and
 * in as somebody else on a shared machine must pick up that person's choices, not inherit the
 * previous one's.
 */
export function LiveSettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = typeof user?.userId === 'number' ? user.userId : null

  /**
   * The preferences, tagged with the user they were read for.
   *
   * Re-read DURING RENDER when the user changes, not in an effect. React sanctions this "adjust
   * state when a prop changes" shape and re-renders immediately without committing the stale pass,
   * so nobody ever sees one user's toggles under another's name — which an effect, running after
   * the commit, would allow for exactly one frame.
   */
  const [state, setState] = useState(() => ({ userId, ...readAll(userId) }))
  if (state.userId !== userId) {
    setState({ userId, ...readAll(userId) })
  }

  /**
   * The master switch owns the socket itself.
   *
   * Off means stop() — not merely "no page is subscribed". A connection nobody listens to still
   * holds a socket open and still reconnects when the server restarts, which is exactly what
   * somebody switching live updates off is asking not to happen.
   */
  useEffect(() => {
    if (!state.master) void liveClient.stop()
  }, [state.master])

  // Signing out must not leave the previous user's socket open, authenticated as them.
  useEffect(() => {
    if (userId === null) void liveClient.stop()
  }, [userId])

  const setMaster = useCallback(
    (on: boolean) => {
      livePrefs.setMaster(userId, on)
      setState((prev) => ({ ...prev, master: on }))
    },
    [userId],
  )

  const setFeature = useCallback(
    (feature: LiveFeature, on: boolean) => {
      livePrefs.setFeature(userId, feature, on)
      setState((prev) => ({ ...prev, features: { ...prev.features, [feature]: on } }))
    },
    [userId],
  )

  const value = useMemo<LiveSettingsValue>(
    () => ({
      master: state.master,
      features: state.features,
      isEnabled: (feature: LiveFeature) => state.master && state.features[feature] !== false,
      setMaster,
      setFeature,
    }),
    [state, setMaster, setFeature],
  )

  return <LiveSettingsContext.Provider value={value}>{children}</LiveSettingsContext.Provider>
}
