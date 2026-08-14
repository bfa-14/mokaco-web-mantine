import { useContext } from 'react'
import { SettingsContext } from './settingsContext'

/** Access the system settings context. Must be used within a <SettingsProvider>. */
export function useSettings() {
  const context = useContext(SettingsContext)
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
