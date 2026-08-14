import { createContext } from 'react'

export interface SettingsContextValue {
  /**
   * Whether the "What is this page for?" panel renders at the top of each page.
   *
   * SYSTEM-WIDE, not per-user — there is no per-user preference store, and localStorage is ruled
   * out. So switching it off switches it off for everybody, including the next person who joins
   * and has never seen these screens before.
   *
   * Defaults to TRUE and stays true if the settings call fails. Failing OPEN is deliberate: the
   * cost of showing help nobody needed is a collapsed panel, and the cost of hiding it from
   * somebody who needed it is that they get somebody's pay wrong.
   */
  showPageHelp: boolean

  /** Lets the Settings page apply the toggle immediately, instead of making the user reload. */
  refresh: () => Promise<void>
}

/** Kept in its own file so the provider and the hook can live in separate modules. */
export const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined,
)
