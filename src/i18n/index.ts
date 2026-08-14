import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import ar from './ar.json'
import { DEFAULT_LANGUAGE, DX_LOCALE, LANGUAGE_DIRECTION, langPrefs } from './lang'
import type { Language } from './lang'

/**
 * The translation framework, wired once for the whole app.
 *
 * PORT NOTE (Mantine build): the original carried TWO dictionaries — ours through i18next, and
 * DevExtreme's widget strings through loadMessages/locale(). DevExtreme is gone, so only ours
 * remains; Mantine components take their labels from props, which are already translated at the
 * call site. `applyLanguage` below stays the single place that moves the language AND the document
 * direction, so no caller can move one and leave the other behind.
 */

const initialLanguage = langPrefs.read(null)

/** The language currently applied to i18next and the document — see the original's rationale. */
let applied: Language | null = null

/**
 * The direction in force right now, readable WITHOUT a hook.
 * Safe outside React because LanguageProvider remounts the routed tree on a switch.
 */
export function currentDirection(): 'ltr' | 'rtl' {
  return LANGUAGE_DIRECTION[applied ?? DEFAULT_LANGUAGE]
}

/**
 * The locale for every `Intl` and `toLocale*` call the app makes.
 * USE THIS INSTEAD OF `undefined` OR `'en-US'` — the app's language is the user's pick here, not
 * the browser's. Arabic is `ar-u-nu-latn`: Arabic month names, Western digits (see lang.ts).
 */
export function currentLocale(): string {
  return DX_LOCALE[applied ?? DEFAULT_LANGUAGE]
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: initialLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  // A key Arabic has not been given yet falls through to the English string rather than rendering
  // the raw key. A missing translation should look unpolished, not broken.
  returnEmptyString: false,
  interpolation: {
    // React escapes for us; letting i18next escape as well turns an apostrophe into `&#39;`.
    escapeValue: false,
  },
})

/**
 * Switch the whole app to a language: our strings and the page direction. IDEMPOTENT — calling it
 * again with the language already in force does nothing, so StrictMode's double-invoked effects
 * cost nothing.
 */
export function applyLanguage(language: Language): void {
  if (applied === language) return

  const direction = LANGUAGE_DIRECTION[language]
  applied = language

  void i18n.changeLanguage(language)

  // `dir` drives every logical CSS property in the stylesheets (Mantine included — its styles key
  // off [dir="rtl"]); `lang` drives font selection, hyphenation and what a screen reader sounds
  // like. Both, always, or the page half-turns.
  document.documentElement.dir = direction
  document.documentElement.lang = language
}

// Apply immediately so the very first paint — the login screen — is already in the right language
// and the right direction, rather than flipping once React mounts.
applyLanguage(initialLanguage)

export default i18n
