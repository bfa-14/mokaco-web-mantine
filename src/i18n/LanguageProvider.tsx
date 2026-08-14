import { Fragment, useCallback, useLayoutEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/useAuth'
import { applyLanguage } from './index'
import { LANGUAGE_DIRECTION, langPrefs } from './lang'
import type { Language } from './lang'
import { LanguageContext } from './languageContext'
import type { LanguageContextValue } from './languageContext'

/**
 * Pushes the chosen language into the three imperative systems that live outside React: i18next,
 * DevExtreme, and the document element.
 *
 * A COMPONENT RATHER THAN AN EFFECT IN THE PROVIDER, and it renders BEFORE the children, because
 * the order matters. React flushes layout effects in tree order, so this one runs before the layout
 * effects of everything below — and devextreme-react creates each widget in ITS layout effect,
 * reading `config().rtlEnabled` as it goes. Put this sync in the provider instead and it would run
 * last, after the widgets it was supposed to configure had already been built the old way round.
 */
function LanguageSync({ language }: { language: Language }) {
  useLayoutEffect(() => {
    applyLanguage(language)
  }, [language])

  return null
}

/**
 * Holds the chosen language in state, keeps the rest of the app in step with it, and re-reads it
 * when the user changes.
 *
 * THE PREFERENCE IS RE-READ WHEN THE USER CHANGES, because it is per user id — signing out and in as
 * somebody else on a shared machine must pick up that person's language, not inherit the previous
 * one's. Same reasoning, and the same shape, as LiveSettingsProvider.
 *
 * WHY IT REMOUNTS THE TREE BELOW IT. A DevExtreme widget reads `config().rtlEnabled` when it is
 * CREATED and never looks again, so a grid already on screen keeps the direction it was born with.
 * Flipping the config alone would leave every open widget laid out the wrong way round until the
 * next full reload — and the whole point of the switch is that it applies instantly. Keying the
 * routed tree on the language rebuilds those widgets against the new config.
 *
 * What sits ABOVE this provider matters too: auth and the live socket do, so a language switch does
 * not sign anybody out or churn the SignalR connection. Everything below is cheap to rebuild — the
 * cost is unsaved page state, which is a fair price for a deliberate, rare action taken from the
 * Settings page.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = typeof user?.userId === 'number' ? user.userId : null

  /**
   * The chosen language, tagged with the user it was read for.
   *
   * Re-read DURING RENDER when the user changes, not in an effect. React sanctions this "adjust
   * state when a prop changes" shape and re-renders immediately without committing the stale pass,
   * so nobody ever sees one user's language under another's name.
   */
  const [state, setState] = useState(() => ({
    userId,
    language: langPrefs.read(userId),
  }))
  if (state.userId !== userId) {
    setState({ userId, language: langPrefs.read(userId) })
  }

  const setLanguage = useCallback(
    (language: Language) => {
      langPrefs.write(userId, language)
      setState({ userId, language })
    },
    [userId],
  )

  const value = useMemo<LanguageContextValue>(() => {
    const direction = LANGUAGE_DIRECTION[state.language]
    return {
      language: state.language,
      direction,
      isRtl: direction === 'rtl',
      setLanguage,
    }
  }, [state.language, setLanguage])

  return (
    <LanguageContext.Provider value={value}>
      <LanguageSync language={state.language} />
      <Fragment key={state.language}>{children}</Fragment>
    </LanguageContext.Provider>
  )
}
