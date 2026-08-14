import { useContext } from 'react'
import { LanguageContext } from './languageContext'

/** The current language and the switch for it. Must be used within a <LanguageProvider>. */
export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (ctx === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return ctx
}
