import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Loader } from '@mantine/core'
import { useLanguage } from '../../i18n/useLanguage'
import { loadGoogleIdentity } from './googleIdentity'

/**
 * Google's own "Sign in with Google" button, drawn by Google into a div.
 *
 * Google insists on drawing it (an iframe of theirs), so this component only loads the script,
 * hands it our client ID and a callback, and gets out of the way. Popup mode: a redirect would take
 * the person off the Settings page and back to the gate's own address.
 *
 * `onCredential` receives the ID token; what to do with it — and what to say about the answer — is
 * the caller's.
 */
export function GoogleSignInButton({
  clientId,
  onCredential,
  disabled,
}: {
  clientId: string
  onCredential: (credential: string) => void
  /** While the caller is checking a credential: the button stays drawn but is covered. */
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const holder = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)

  // The callback changes with every render of the caller; Google keeps the one it was given at
  // initialize, so it calls through this ref and always reaches the current one.
  const callback = useRef(onCredential)
  useEffect(() => {
    callback.current = onCredential
  }, [onCredential])

  useEffect(() => {
    let cancelled = false
    loadGoogleIdentity()
      .then((id) => {
        if (cancelled || !host.current) return
        id.initialize({
          client_id: clientId,
          callback: (response) => callback.current(response.credential),
          ux_mode: 'popup',
        })
        host.current.replaceChildren()
        id.renderButton(host.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
          logo_alignment: 'left',
          // Google's limits are 200–400 px; the dialog body is narrower than that on a phone. The
          // holder is measured, not the host — the host is still hidden at this point.
          width: Math.max(200, Math.min(320, holder.current?.clientWidth || 320)),
          locale: language,
        })
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('failed')
      })
    return () => {
      cancelled = true
    }
  }, [clientId, language, attempt])

  return (
    <div ref={holder} className="gsi-holder" aria-busy={state === 'loading' || disabled ? true : undefined}>
      {state === 'loading' && (
        <div className="gsi-status">
          <Loader size="sm" />
          <span>{t('googleGate.test.loading')}</span>
        </div>
      )}
      {state === 'failed' && (
        <div className="alert alert--error" role="alert">
          {t('googleGate.test.loadFailed')}
          <div style={{ marginTop: 8 }}>
            <Button
              size="xs"
              variant="default"
              onClick={() => {
                setState('loading')
                setAttempt((n) => n + 1)
              }}
            >
              {t('googleGate.test.retry')}
            </Button>
          </div>
        </div>
      )}
      {/* Always mounted, so Google has somewhere to draw; hidden until it has. */}
      <div
        ref={host}
        className="gsi-button"
        hidden={state !== 'ready'}
        style={disabled ? { pointerEvents: 'none', opacity: 0.5 } : undefined}
      />
    </div>
  )
}
