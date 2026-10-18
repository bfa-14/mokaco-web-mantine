/**
 * Google Identity Services — the "Sign in with Google" button, loaded on demand.
 *
 * Only the Settings → Google sign-in tab needs it (Test Google sign-in), so it is not in
 * index.html: the script is fetched from Google the first time the test dialog opens, ONCE per
 * page, and every later caller gets the same promise. A failed load is forgotten so that Try again
 * really tries again.
 *
 * The declarations below are the few members this app calls, not Google's whole API. The button
 * hands back an ID token (`credential`); the API checks it against Google's keys and our client ID
 * (docs/GOOGLE_SIGNIN_GATE.md G2). Nothing here reads the token.
 */

export const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client'

/** How long the script may take before the dialog says it could not load. */
const LOAD_TIMEOUT_MS = 15_000

export interface GoogleCredentialResponse {
  /** The ID token (a JWT). */
  credential: string
  select_by?: string
}

export interface GoogleIdConfiguration {
  client_id: string
  callback: (response: GoogleCredentialResponse) => void
  ux_mode?: 'popup' | 'redirect'
  auto_select?: boolean
  cancel_on_tap_outside?: boolean
  context?: 'signin' | 'signup' | 'use'
}

export interface GoogleButtonConfiguration {
  type?: 'standard' | 'icon'
  theme?: 'outline' | 'filled_blue' | 'filled_black'
  size?: 'large' | 'medium' | 'small'
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
  shape?: 'rectangular' | 'pill' | 'circle' | 'square'
  logo_alignment?: 'left' | 'center'
  /** Pixels, 200–400. */
  width?: number
  /** 'en', 'ar', … — the button's own language. */
  locale?: string
}

export interface GoogleAccountsId {
  initialize(config: GoogleIdConfiguration): void
  renderButton(parent: HTMLElement, options: GoogleButtonConfiguration): void
  disableAutoSelect(): void
  cancel(): void
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } }
  }
}

let loading: Promise<GoogleAccountsId> | null = null

/** The `google.accounts.id` object, once Google's script has loaded. */
export function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  const ready = window.google?.accounts?.id
  if (ready) return Promise.resolve(ready)

  loading ??= new Promise<GoogleAccountsId>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GOOGLE_IDENTITY_SCRIPT
    script.async = true
    script.defer = true

    const fail = (reason: string) => {
      window.clearTimeout(timer)
      script.remove()
      loading = null
      reject(new Error(reason))
    }
    const timer = window.setTimeout(() => fail('Google sign-in did not load in time.'), LOAD_TIMEOUT_MS)

    script.onload = () => {
      window.clearTimeout(timer)
      const id = window.google?.accounts?.id
      if (id) resolve(id)
      else fail('Google sign-in loaded without its button.')
    }
    script.onerror = () => fail('Google sign-in could not be loaded.')
    document.head.appendChild(script)
  })
  return loading
}
