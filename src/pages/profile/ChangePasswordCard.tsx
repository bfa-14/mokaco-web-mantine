import { useState } from 'react'
import { Button, PasswordInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { getErrorMessage } from '../../api/errorMessage'
import { meService } from '../../services/workflowService'

/**
 * The server's minimum, repeated here so the box can say so BEFORE a round trip. It is a copy, and
 * copies drift — which is why the server checks it too and its refusal is shown verbatim. This
 * number is a courtesy; the one in UserService.MinPasswordLength is the rule.
 */
const MIN_LENGTH = 8

/**
 * One password box with a show/hide toggle.
 *
 * The toggle is Mantine's own: PasswordInput carries a visibility button built in, so the separate
 * sibling button the DevExtreme original needed (its nested-config children were live configuration,
 * re-rendered on every keystroke) has no equivalent to port — same UX, one control.
 */
function PasswordField({
  id,
  label,
  value,
  autoComplete,
  disabled,
  error,
  onChange,
}: {
  id: string
  label: string
  value: string
  /** Tells the password manager which box this is — 'current-password' or 'new-password'. */
  autoComplete: string
  disabled: boolean
  /** A shape problem with THIS field, shown under it. Null while there is nothing to say. */
  error?: string | null
  onChange: (value: string) => void
}) {
  return (
    <div className="form-field">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <PasswordInput
        id={id}
        autoComplete={autoComplete}
        value={value}
        disabled={disabled}
        visibilityToggleButtonProps={{
          'aria-label': `Show or hide ${label.toLowerCase()}`,
        }}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}

/**
 * "Change password" — self-service, needing nothing but the password the user already knows.
 *
 * WHAT IS CHECKED HERE AND WHAT IS NOT. This form checks SHAPE only: that the new password is long
 * enough and that it was typed the same way twice. Whether the CURRENT password is right is a
 * question only the server can answer — the stored value is an Argon2id hash, so there is nothing
 * in the browser to compare against — and its answer is shown exactly as it arrives. Nothing here
 * guesses at the reason for a refusal.
 *
 * The session is left alone on success. Changing a password does not invalidate the token, so there
 * is no logout, no re-login prompt and no token refresh: the user stays exactly where they were,
 * with the fields cleared behind them.
 */
export function ChangePasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Only complain about a field once there is something in it. A form that turns red as soon as it
  // is opened is telling the user off for not having typed yet.
  const tooShort = next.length > 0 && next.length < MIN_LENGTH
  const mismatch = confirm.length > 0 && confirm !== next

  const complete = current.length > 0 && next.length >= MIN_LENGTH && confirm === next
  const canSubmit = complete && !saving

  async function submit() {
    if (!canSubmit) return

    setSaving(true)
    setError(null)
    try {
      await meService.changePassword(current, next)
      notifications.show({ message: 'Password changed.', color: 'green', autoClose: 2500 })
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      // The server's wording, unaltered — it is the only one that knows what was actually wrong.
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <div className="card-title">Change password</div>
      <p className="hint" style={{ marginBottom: 16 }}>
        You will stay signed in on this device. Any other device stays signed in too, until its
        session expires.
      </p>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <PasswordField
        id="pw-current"
        label="Current password"
        value={current}
        autoComplete="current-password"
        disabled={saving}
        onChange={setCurrent}
      />

      <PasswordField
        id="pw-new"
        label="New password"
        value={next}
        autoComplete="new-password"
        disabled={saving}
        error={tooShort ? `Use at least ${MIN_LENGTH} characters.` : null}
        onChange={setNext}
      />

      <PasswordField
        id="pw-confirm"
        label="Confirm new password"
        value={confirm}
        autoComplete="new-password"
        disabled={saving}
        error={mismatch ? 'These two do not match.' : null}
        onChange={setConfirm}
      />

      <div className="form-actions">
        <Button onClick={() => void submit()} disabled={!canSubmit}>
          {saving ? 'Changing…' : 'Change password'}
        </Button>
      </div>
    </div>
  )
}
