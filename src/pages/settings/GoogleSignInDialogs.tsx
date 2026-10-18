import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Button } from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { ApiError } from '../../api/client'
import { getErrorMessage } from '../../api/errorMessage'
import { gateService } from '../../services/accessService'
import { GoogleSignInButton } from './GoogleSignInButton'

/**
 * Who someone is, for a sentence: "Rami Haddad (rami@gmail.com)", or the address alone.
 *
 * Wrapped in Unicode isolates (FSI … PDI) because it is English inside what may be an Arabic
 * sentence — without them the bidi algorithm moves the closing parenthesis to the wrong end.
 */
export function whoText(email: string | null | undefined, name: string | null | undefined): string {
  const address = email ?? ''
  const who = name && name.trim() && name.trim() !== address ? `${name.trim()} (${address})` : address
  return `⁨${who}⁩`
}

/**
 * A message that may be the API's own sentence, which is English. On the Arabic tab it would take
 * the page's right-to-left direction, and its full stop would land at the wrong end ("…lock
 * you out" with the stop before "you"). `dir="auto"` takes the direction from the text itself, so a
 * translated message still reads right to left.
 */
export function ServerText({ text }: { text: string }) {
  return <span dir="auto">{text}</span>
}

/**
 * The sentence for a refused Google sign-in.
 *
 * NOT getErrorMessage: that collapses every 403 to "no permission", and here the 403 IS the answer —
 * "x@gmail.com is not on the HRMS list. Ask the administrator…" — written by the API for a person.
 * Too many tries (429) may arrive without a body, so it gets its own sentence.
 */
export function gateErrorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return t('googleGate.test.tooMany')
    if (err.message) return err.message
  }
  return getErrorMessage(err)
}

/**
 * One confirmation, shaped like the rest of the app's: what happens, then Cancel and the act.
 * A refusal is shown INSIDE the dialog, which stays open — the person reads it where they acted.
 */
export function ConfirmDialog({
  opened,
  title,
  children,
  confirmLabel,
  danger,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  opened: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  /** Red for the acts that take something away. */
  danger?: boolean
  busy: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal opened={opened} onClose={busy ? () => {} : onClose} title={title} size={460} centered>
      <div className="gate-dialog-body">{children}</div>
      {error && (
        <div className="alert alert--error" role="alert" style={{ marginTop: 12 }}>
          <ServerText text={error} />
        </div>
      )}
      <div className="form-actions">
        <Button variant="default" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button color={danger ? 'red' : undefined} onClick={onConfirm} loading={busy} data-autofocus>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

/**
 * TEST GOOGLE SIGN-IN — the step that makes turning the gate on safe.
 *
 * Google's button signs in, the API checks the token and the list exactly as the gate page would
 * (POST /api/gate/google works whether the gate is on or off) and, when the person is allowed,
 * gives THIS browser the gate cookie. That cookie is what the switch's no-lock-out guard looks for.
 *
 * Uses the SAVED client ID: the API checks the token against the one it stores, so testing an
 * unsaved one would prove nothing.
 */
export function TestSignInDialog({
  opened,
  clientId,
  onClose,
  onVerified,
}: {
  opened: boolean
  clientId: string
  onClose: () => void
  /** The cookie is set — reload the tab so "Verified in this browser as …" shows. */
  onVerified: () => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function check(credential: string) {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await gateService.signIn(credential)
      setSuccess(t('googleGate.test.success', { who: whoText(result.email, result.name) }))
      onVerified()
    } catch (err) {
      // The button stays: a refused account can be swapped for another one right here.
      setError(gateErrorMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  function close() {
    setSuccess(null)
    setError(null)
    onClose()
  }

  return (
    <Modal opened={opened} onClose={close} title={t('googleGate.test.title')} size={440} centered>
      <p className="gate-dialog-body" style={{ marginTop: 0 }}>
        {t('googleGate.test.intro')}
      </p>

      {clientId ? (
        <>
          <GoogleSignInButton clientId={clientId} onCredential={(c) => void check(c)} disabled={busy} />
          <p className="hint" style={{ marginTop: 8 }}>
            {t('googleGate.test.help')}
          </p>
        </>
      ) : (
        <div className="alert alert--warning" role="note">
          {t('googleGate.test.noClientId')}
        </div>
      )}

      <div role="status" aria-live="polite">
        {busy && <p className="hint">{t('googleGate.test.checking')}</p>}
        {success && (
          <div className="alert alert--success" style={{ marginTop: 12, marginBottom: 0 }}>
            {success}
          </div>
        )}
      </div>
      {error && (
        <div className="alert alert--error" role="alert" style={{ marginTop: 12, marginBottom: 0 }}>
          <ServerText text={error} />
        </div>
      )}

      <div className="form-actions" style={{ marginTop: 16 }}>
        <Button variant="default" onClick={close}>
          {t('common.close')}
        </Button>
      </div>
    </Modal>
  )
}
