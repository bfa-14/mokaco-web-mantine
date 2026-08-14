import { createContext } from 'react'
import type { LiveFeature } from './livePrefs'

export interface LiveSettingsValue {
  /** The master switch. False stops the socket entirely. */
  master: boolean
  /** Per-feature switches as STORED — the settings checkboxes bind to these. */
  features: Record<LiveFeature, boolean>
  /** master && features[f] — what a page's `enabled` flag should use. */
  isEnabled: (feature: LiveFeature) => boolean
  setMaster: (on: boolean) => void
  setFeature: (feature: LiveFeature, on: boolean) => void
}

/** Kept in its own module so the provider and the hook can live in separate files. */
export const LiveSettingsContext = createContext<LiveSettingsValue | undefined>(undefined)
