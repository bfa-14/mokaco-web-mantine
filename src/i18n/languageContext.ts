import { createContext } from 'react'
import type { Language } from './lang'

export interface LanguageContextValue {
  /** The language the signed-in user reads the app in. */
  language: Language
  /** Which way the page runs — the same value as `document.documentElement.dir`. */
  direction: 'ltr' | 'rtl'
  /**
   * Convenience for the handful of places that genuinely have to branch on direction in
   * JavaScript — a chevron that must point the other way, an offset handed to a DevExtreme widget.
   * LAYOUT SHOULD NOT USE IT: logical CSS properties handle mirroring without any JavaScript, and a
   * component that branches on `isRtl` to pick a margin has re-invented `margin-inline-start`.
   */
  isRtl: boolean
  /** Switch language for the signed-in user. Applies at once and persists per user. */
  setLanguage: (language: Language) => void
}

/** Kept in its own file so provider and hook can live in separate modules. */
export const LanguageContext = createContext<LanguageContextValue | undefined>(
  undefined,
)
