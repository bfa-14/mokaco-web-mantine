import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox, Switch } from '@mantine/core'
import { getErrorMessage } from '../../api/errorMessage'
import { rolesService } from '../../services/securityService'
import type { RoleRejectionBehaviour, RoleSignatureRequirement } from '../../types/security'

/** The default reading of an absent rejection row — the API returns one only for approver roles. */
const DEFAULT_MEANING = 'A rejection by this role is advice; the next approver still decides.'

/** A transient "Saved" that a control shows after its own PUT, instead of a toast per toggle. */
function Saved() {
  return <span className="wf-rb-saved">Saved</span>
}

/**
 * The three workflow-behaviour settings for one role, shown together in its detail panel: whether it
 * may approve at all, whether its decisions are password-signed, and what its rejection does. Each
 * control saves ON CHANGE through its own PUT — there is no section-level save, because a single
 * toggle is the whole edit.
 *
 * The parent owns the data; this panel calls back with each fresh row so the grid's maps stay in
 * step (the API returns the updated standing, so nothing is recomputed here).
 *
 * Mantine's onChange fires only on real user interaction, so the original's `e.event` guard against
 * programmatic value syncs is not needed. On a refused save nothing is called back, so the
 * controlled control simply reverts to the standing value — same behaviour as before.
 */
export function RoleWorkflowBehaviour({
  sig,
  rejection,
  onSigChanged,
  onRejectionChanged,
}: {
  sig: RoleSignatureRequirement
  /** The role's rejection standing, or undefined when it is not an approver role (absent = default). */
  rejection: RoleRejectionBehaviour | undefined
  onSigChanged: (updated: RoleSignatureRequirement) => void
  onRejectionChanged: (updated: RoleRejectionBehaviour) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<null | 'approver' | 'signature' | 'rejection'>(null)
  const [saved, setSaved] = useState<null | 'approver' | 'signature' | 'rejection'>(null)
  const [error, setError] = useState<string | null>(null)

  function flashSaved(which: 'approver' | 'signature' | 'rejection') {
    setSaved(which)
    // A brief acknowledgement; it clears itself so the panel does not accumulate "Saved" labels.
    window.setTimeout(() => setSaved((cur) => (cur === which ? null : cur)), 2200)
  }

  async function toggleApprover(next: boolean) {
    setBusy('approver')
    setError(null)
    try {
      const updated = await rolesService.setApproverUsage(sig.roleId, next)
      onSigChanged(updated)
      flashSaved('approver')
    } catch (err) {
      // Switching OFF a role a published chain still uses is refused — the message says what to do
      // first, so it is shown verbatim. The checkbox reverts, because nothing was saved.
      setError(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function toggleSignature(next: boolean) {
    setBusy('signature')
    setError(null)
    try {
      const updated = await rolesService.setSignatureRequirement(sig.roleId, next)
      onSigChanged(updated)
      flashSaved('signature')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function chooseRejection(next: boolean) {
    const current = rejection?.rejectionEndsRequest ?? false
    if (next === current) return
    setBusy('rejection')
    setError(null)
    try {
      const updated = await rolesService.setRejectionBehaviour(sig.roleId, next)
      onRejectionChanged(updated)
      flashSaved('rejection')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const rejectionEnds = rejection?.rejectionEndsRequest ?? false
  const meaning = rejection?.meaning ?? DEFAULT_MEANING

  return (
    <div className="wf-role-behaviour">
      <div className="wf-rb-title">Workflow behaviour</div>
      {/* Said once, not per toggle: what these settings reach, and that the rule is read live. */}
      <p className="hint" style={{ marginTop: 0 }}>
        These settings apply everywhere this role appears in any approval chain. The final step of a
        chain always ends the request on rejection, whatever is set here. Nothing is copied at
        submit — changes take effect on decisions made from now on.
      </p>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <div className="wf-rb-row">
        <Checkbox
          checked={sig.usableAsApprover}
          label="Can be chosen as an approver in chains"
          disabled={busy !== null}
          onChange={(e) => void toggleApprover(e.currentTarget.checked)}
        />
        {saved === 'approver' && <Saved />}
        <div className="hint wf-rb-help">
          Off: this role never appears in the chain builder. The Employee role should stay off —
          turning it on would let every employee sign a step.
        </div>
      </div>

      <div className="wf-rb-row">
        <Checkbox
          checked={sig.requiresSignaturePassword}
          label="Decisions must be signed with a password"
          disabled={busy !== null}
          onChange={(e) => void toggleSignature(e.currentTarget.checked)}
        />
        {saved === 'signature' && <Saved />}
        <div className="hint wf-rb-help">
          People in this role re-enter their password to approve or reject. It confirms the person at
          the keyboard; it does not change who may approve.
        </div>
      </div>

      <div className="wf-rb-row">
        <div className="wf-rb-label">
          When this role rejects a request:
          {saved === 'rejection' && <Saved />}
        </div>
        {sig.usableAsApprover ? (
          <>
            {/* A SWITCH, because this is one behaviour being turned on and off rather than a choice
                between two peers — and the hint carries what the OFF position means, which is the
                half a switch cannot show on its own face. */}
            <Switch
              checked={rejectionEnds}
              label={t('security.roles.rejectionEnds')}
              disabled={busy !== null}
              onChange={(e) => void chooseRejection(e.currentTarget.checked)}
            />
            <div className="hint wf-rb-help">{t('security.roles.rejectionEndsHint')}</div>
            {/* The database's own reading of the flag, verbatim and kept BELOW the fixed hint: it
                states what is true for this role right now, where the line above states what the
                control does. */}
            <div className="hint wf-rb-help">{meaning}</div>
          </>
        ) : (
          // Only meaningful for roles that appear in chains — greyed, with the reason, when it cannot.
          <div className="wf-rb-disabled">Not used — this role does not approve requests.</div>
        )}
      </div>
    </div>
  )
}
