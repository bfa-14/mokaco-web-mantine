/**
 * Which language a user reads the app in, per user, on this browser.
 *
 * A PLAIN PREFERENCE, NOT AUTH DATA — so localStorage is the right home and the tokenStorage rule
 * ("nothing auth-related in localStorage") is untouched. It also SHOULD outlive the tab: somebody
 * who switched to Arabic did not mean "until I close this tab".
 *
 * Keyed per user id, exactly like live/livePrefs — two people share browsers on a shop floor, and
 * one switching to Arabic must not leave the next person to sign in facing a language they cannot
 * read. Signed out, the key is `lang:anon`, which is why the login screen speaks English until
 * somebody signs in: at that point there is no user whose preference we could honour.
 *
 * DEFAULT 'en', and the default is what an ABSENT or unrecognised value means — a new user, a
 * cleared browser and a corrupted entry all behave the same way.
 */

export const LANGUAGES = ['en', 'ar'] as const
export type Language = (typeof LANGUAGES)[number]

export const DEFAULT_LANGUAGE: Language = 'en'

/** Each language named in ITSELF — nobody looking for Arabic is helped by the word "Arabic". */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  ar: 'العربية',
}

/** Which way each language runs. The only place this mapping is written down. */
export const LANGUAGE_DIRECTION: Record<Language, 'ltr' | 'rtl'> = {
  en: 'ltr',
  ar: 'rtl',
}

/**
 * The locale handed to DevExtreme — and through it, straight to `Intl`.
 *
 * Arabic is `ar-u-nu-latn`, NOT `ar`, on purpose: the business wants Western digits (1234, not
 * ١٢٣٤) while keeping Arabic month names and Arabic widget text. The `-u-nu-latn` Unicode extension
 * pins the numbering system to Latin without touching anything else, and it does so in the browser
 * rather than relying on whichever numbering system a given ICU build happens to default `ar` to.
 *
 * DevExtreme still finds its Arabic dictionary: `getValueByClosestLocale` walks the locale up by
 * dropping trailing segments — ar-u-nu-latn → ar-u-nu → ar-u → ar — and `ar` is the key we load
 * the messages under.
 */
export const DX_LOCALE: Record<Language, string> = {
  en: 'en',
  ar: 'ar-u-nu-latn',
}

function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language)
}

function key(userId: number | null | undefined): string {
  return `lang:${userId ?? 'anon'}`
}

export const langPrefs = {
  read(userId: number | null | undefined): Language {
    try {
      const stored = localStorage.getItem(key(userId))
      return isLanguage(stored) ? stored : DEFAULT_LANGUAGE
    } catch {
      // Storage unavailable (private mode, blocked cookies) — English rather than a blank app.
      return DEFAULT_LANGUAGE
    }
  },

  write(userId: number | null | undefined, language: Language): void {
    try {
      localStorage.setItem(key(userId), language)
    } catch {
      /* storage unavailable — the preference simply does not persist */
    }
  },
}
