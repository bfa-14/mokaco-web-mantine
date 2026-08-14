import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Modal } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconTrash, IconUpload } from '@tabler/icons-react'
import { signaturesService } from '../../services/securityService'
import { getErrorMessage } from '../../api/errorMessage'
import type { UserSignatureInfo } from '../../types/security'
import { SignatureThumb } from './SignatureThumb'

/**
 * notify(msg, type, ms) → Mantine notifications, adapted once so every call site below
 * stays byte-identical to the original.
 */
function notify(message: string, type: 'success' | 'error', ms: number) {
  notifications.show({ message, color: type === 'success' ? 'green' : 'red', autoClose: ms })
}

/**
 * DevExtreme's `confirm(message, title)` dialog, rebuilt as a promise-backed Mantine Modal
 * so the call site keeps its original `const ok = await …; if (!ok) return` shape.
 * Closing the dialog any other way answers "no".
 */
interface ConfirmState {
  title: string
  message: React.ReactNode
  resolve: (proceed: boolean) => void
}

/** Client-side mirror of the server's rules, so a bad file is caught before the round trip. */
const ALLOWED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_BYTES = 1024 * 1024

/**
 * Upload, replace or remove one user's signature.
 *
 * The preview shows the CHOSEN file before anything is saved, so somebody can see they picked the
 * right image — and it is validated here first, so an obviously-wrong file (a PDF, a 5 MB photo) is
 * refused without a round trip. The server validates again from the bytes; this is the courteous
 * first line, not the security one.
 */
export function SignatureDialog({
  user,
  existing,
  onClose,
  onChanged,
}: {
  user: { userId: number; username: string }
  /** The current signature's metadata, if any — decides whether "Remove" is offered. */
  existing: UserSignatureInfo | undefined
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [clientError, setClientError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  /** The confirm dialog currently on screen, if any — see ConfirmState. */
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  const askConfirm = useCallback(
    (message: React.ReactNode, title: string): Promise<boolean> =>
      new Promise<boolean>((resolve) => setConfirmState({ title, message, resolve })),
    [],
  )

  function settleConfirm(proceed: boolean) {
    confirmState?.resolve(proceed)
    setConfirmState(null)
  }

  // Derived, not stored: the preview is just an object URL over the chosen file, so it is computed
  // rather than held in state (state here would only invite it to drift from `file`).
  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  )

  // The object URL must be revoked when it is replaced or the dialog closes, or it leaks. This
  // effect only cleans up — it sets no state.
  useEffect(() => {
    if (!previewUrl) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  function choose(selected: File | null) {
    if (!selected) return

    if (!ALLOWED.includes(selected.type)) {
      setClientError(
        'That is not a PNG, JPEG, GIF or WEBP image. Save the signature as one of those and try again.',
      )
      setFile(null)
      return
    }
    if (selected.size > MAX_BYTES) {
      setClientError(
        `That image is ${Math.round(selected.size / 1024)} KB. A signature must be 1 MB or smaller.`,
      )
      setFile(null)
      return
    }
    setClientError(null)
    setFile(selected)
  }

  async function save() {
    if (!file) return
    setBusy(true)
    try {
      await signaturesService.upload(user.userId, file)
      notify(`Signature saved for ${user.username}.`, 'success', 2500)
      await onChanged()
      onClose()
    } catch (err) {
      // The server's validation message (wrong type / too large) comes through here verbatim.
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const ok = await askConfirm(
      `Remove ${user.username}'s signature? Approvals already signed keep the copy that was frozen onto them — only future ones are affected.`,
      'Remove signature',
    )
    if (!ok) return

    setBusy(true)
    try {
      await signaturesService.remove(user.userId)
      notify(`Signature removed for ${user.username}.`, 'success', 2500)
      await onChanged()
      onClose()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      opened
      onClose={onClose}
      title={`Signature — ${user.username}`}
      size={460}
      centered
    >
      <p className="hint" style={{ marginTop: 0 }}>
        This image is stamped onto a request at the moment it is approved, so a printed
        approval always shows the signature that was actually used that day. A{' '}
        <strong>transparent-background PNG</strong> prints best — it sits cleanly over a
        signature line.
      </p>

      {/* The current signature, so it is clear what a new upload would replace. */}
      {existing?.hasSignature && !file && (
        <div className="form-field">
          <span className="form-label">Current</span>
          <SignatureThumb
            userId={user.userId}
            version={existing.updatedAt}
            height={54}
          />
        </div>
      )}

      {/* The chosen file, previewed before it is saved. */}
      {previewUrl && (
        <div className="form-field">
          <span className="form-label">New (not saved yet)</span>
          <img
            src={previewUrl}
            alt="Preview"
            style={{
              height: 54,
              maxWidth: 220,
              objectFit: 'contain',
              background:
                'repeating-conic-gradient(#f0eee9 0% 25%, #fff 0% 50%) 50% / 12px 12px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: 3,
            }}
          />
        </div>
      )}

      {clientError && (
        <div className="alert alert--error" role="alert">
          {clientError}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => choose(e.target.files?.[0] ?? null)}
      />

      <div className="form-actions" style={{ justifyContent: 'space-between' }}>
        <div>
          {existing?.hasSignature && (
            <Button
              variant="subtle"
              color="red"
              leftSection={<IconTrash size={16} />}
              onClick={() => void remove()}
              disabled={busy}
            >
              Remove
            </Button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="default"
            leftSection={<IconUpload size={16} />}
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {file ? 'Choose a different file' : 'Choose file…'}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !file}>
            {busy ? 'Saving…' : 'Save signature'}
          </Button>
        </div>
      </div>

      {/* The confirm dialog — devextreme/ui/dialog's confirm(), as a Mantine Modal. */}
      {confirmState && (
        <Modal
          opened
          onClose={() => settleConfirm(false)}
          title={confirmState.title}
          size={480}
          centered
        >
          <div>{confirmState.message}</div>
          <div className="form-actions">
            <Button variant="default" onClick={() => settleConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={() => settleConfirm(true)}>OK</Button>
          </div>
        </Modal>
      )}
    </Modal>
  )
}
