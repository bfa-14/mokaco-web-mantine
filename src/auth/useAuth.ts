import { useContext } from 'react'
import { AuthContext } from './authContext'

/** Access the auth context. Must be used within an <AuthProvider>. */
export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
