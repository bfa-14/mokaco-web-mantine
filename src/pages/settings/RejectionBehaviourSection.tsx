import { useEffect, useState } from 'react'
import { Loader, SegmentedControl } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { rolesService } from '../../services/securityService'
import type { RoleRejectionBehaviour } from '../../types/security'

const ROLE_MANAGE = 'ROLE_MANAGE'

/** The two positions of the toggle. `ends` maps to RejectionEndsRequest = true. */
const OPTIONS = [
  { value: 'advice', label: 'Is advice' },
  { value: 'ends', label: 'Ends the request' },
]

/**
 * One role's row: its name, the two-way toggle, and the database's plain-language meaning beneath.
 *
 * The toggle writes on change — there is no separate Save, because a single flip is the whole edit
 * and a Save button would only invite someone to leave it half-done. The row disables itself while
 * the write is in flight, and the Meaning it shows is the API's OWN wording returned by the write,
 * never a sentence recomputed here.
 */
function RoleRow({
  role,
  onChanged,
}: {
  role: RoleRejectionBehaviour
  onChanged: (updated: RoleRejectionBehaviour) => void
}) {
  const [saving, setSaving] = useState(false)
  const selected = role.rejectionEndsRequest ? 'ends' : 'advice'

  async function choose(key: string) {
    const next = key === 'ends'
    if (next === role.rejectionEndsRequest || saving) return
    setSaving(true)
    try {
      const updated = await rolesService.setRejectionBehaviour(role.roleId, next)
      onChanged(updated)
      notifications.show({
        message: `${role.name}: a rejection now ${updated.rejectionEndsRequest ? 'ends the request' : 'is advice'}.`,
        color: 'green',
        autoClose: 2500,
      })
    } catch (err) {
      // The refusal names the specific obstacle — show it verbatim. A failed write also never
      // reaches onChanged, so the controlled value below snaps back to what is stored.
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4500 })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="wf-reject-row">
      <div className="wf-reject-role">{role.name}</div>
      <div className="wf-reject-control">
        {/* SegmentedControl is Mantine's ButtonGroup — same two exclusive positions. */}
        <SegmentedControl
          data={OPTIONS}
          value={selected}
          disabled={saving}
          onChange={(v) => void choose(v)}
        />
        {/* The database's own reading of the flag — verbatim, never re-worded here. */}
        <div className="hint" style={{ marginTop: 6 }}>
          {role.meaning}
        </div>
      </div>
    </div>
  )
}

/**
 * "When a role rejects a request" — which roles have a final say and which only advise.
 *
 * SELF-GATING on ROLE_MANAGE: it lives on the Settings page, which is otherwise gated on
 * SETTING_MANAGE, but rejection behaviour is role administration and answers to a DIFFERENT
 * permission. So this section decides its own visibility rather than borrowing the page's — a
 * role administrator without SETTING_MANAGE still sees it, and a settings administrator without
 * ROLE_MANAGE does not (and is never sent a request that would 403).
 */
export function RejectionBehaviourSection() {
  const { hasPermission } = useAuth()
  const canManageRoles = hasPermission(ROLE_MANAGE)

  const [roles, setRoles] = useState<RoleRejectionBehaviour[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canManageRoles) return
    let cancelled = false
    async function load() {
      try {
        const list = await rolesService.getRejectionBehaviour()
        if (!cancelled) {
          setRoles(list)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [canManageRoles])

  // Not this user's to see — render nothing, so the page simply has no such section for them.
  if (!canManageRoles) return null

  return (
    <div style={{ marginBottom: 24 }}>
      <h2 className="tab-section-title">When a role rejects a request</h2>

      <div className="card">
        <p className="hint" style={{ marginTop: 0 }}>
          By default a rejection is a recommendation — the next approver still decides. Turn this on
          for a role whose rejection should stop the request immediately. The final step always ends
          the request regardless.
        </p>

        {error && (
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className="page-loading">
            <Loader size={32} />
          </div>
        ) : roles.length === 0 ? (
          <p className="hint">No approver roles are configured yet.</p>
        ) : (
          <div className="wf-reject-list">
            {roles.map((role) => (
              <RoleRow
                key={role.roleId}
                role={role}
                onChanged={(updated) =>
                  setRoles((current) =>
                    current.map((r) => (r.roleId === updated.roleId ? updated : r)),
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
