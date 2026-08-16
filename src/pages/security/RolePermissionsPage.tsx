import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Loader, Select } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconDeviceFloppy } from '@tabler/icons-react'
import { rolesService } from '../../services/securityService'
import { getErrorMessage } from '../../api/errorMessage'
import type { Permission, Role } from '../../types/security'

/**
 * notify(msg, type, ms) → Mantine notifications, adapted once so every call site below
 * stays byte-identical to the original.
 */
function notify(message: string, type: 'success' | 'error', ms: number) {
  notifications.show({ message, color: type === 'success' ? 'green' : 'red', autoClose: ms })
}

function sameSet(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) {
    if (!b.has(value)) return false
  }
  return true
}

export default function RolePermissionsPage() {
  const { t } = useTranslation()
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null)

  const [assigned, setAssigned] = useState<Set<number>>(new Set())
  const [original, setOriginal] = useState<Set<number>>(new Set())

  const [loadingBase, setLoadingBase] = useState(true)
  const [loadingRole, setLoadingRole] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load roles + all permissions once.
  useEffect(() => {
    let cancelled = false
    async function loadBase() {
      setLoadingBase(true)
      setError(null)
      try {
        const [roleList, permissionList] = await Promise.all([
          rolesService.getRoles(),
          rolesService.getPermissions(),
        ])
        if (!cancelled) {
          setRoles(roleList)
          setPermissions(permissionList)
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err))
      } finally {
        if (!cancelled) setLoadingBase(false)
      }
    }
    void loadBase()
    return () => {
      cancelled = true
    }
  }, [])

  const loadRolePermissions = useCallback(async (roleId: number) => {
    setLoadingRole(true)
    setError(null)
    try {
      const ids = await rolesService.getRolePermissionIds(roleId)
      const set = new Set(ids)
      setAssigned(new Set(set))
      setOriginal(set)
    } catch (err) {
      setError(getErrorMessage(err))
      setAssigned(new Set())
      setOriginal(new Set())
    } finally {
      setLoadingRole(false)
    }
  }, [])

  function onRoleChange(roleId: number | null) {
    setSelectedRoleId(roleId)
    if (roleId != null) {
      void loadRolePermissions(roleId)
    } else {
      setAssigned(new Set())
      setOriginal(new Set())
    }
  }

  // Group permissions by module for display.
  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>()
    for (const permission of permissions) {
      const key = permission.module || 'Other'
      const list = map.get(key)
      if (list) {
        list.push(permission)
      } else {
        map.set(key, [permission])
      }
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [permissions])

  const dirty = useMemo(
    () => !sameSet(assigned, original),
    [assigned, original],
  )

  function togglePermission(permissionId: number, checked: boolean) {
    setAssigned((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(permissionId)
      } else {
        next.delete(permissionId)
      }
      return next
    })
  }

  function toggleModule(modulePermissions: Permission[], checked: boolean) {
    setAssigned((prev) => {
      const next = new Set(prev)
      for (const permission of modulePermissions) {
        if (checked) {
          next.add(permission.permissionId)
        } else {
          next.delete(permission.permissionId)
        }
      }
      return next
    })
  }

  async function save() {
    if (selectedRoleId == null) return
    setSaving(true)
    try {
      await rolesService.setRolePermissions(selectedRoleId, [...assigned])
      setOriginal(new Set(assigned))
      notify('Permissions saved.', 'success', 2500)
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4500)
    } finally {
      setSaving(false)
    }
  }

  const selectedRole = roles.find((r) => r.roleId === selectedRoleId) ?? null

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Role Permissions</h1>
          <p className="page-subtitle">
            Choose a role, then assign which permissions it grants.
          </p>
        </div>
        <div className="page-head-actions">
          <Button
            leftSection={<IconDeviceFloppy size={16} />}
            disabled={selectedRoleId == null || !dirty || saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {loadingBase ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <label className="form-label" htmlFor="role-select">
              Role
            </label>
            <Select
              id="role-select"
              data={roles.map((r) => ({ value: String(r.roleId), label: r.name }))}
              value={selectedRoleId != null ? String(selectedRoleId) : null}
              placeholder="Select a role…"
              w={320}
              onChange={(v) => onRoleChange(v != null ? Number(v) : null)}
            />
            {selectedRole?.isSystem && (
              <p className="hint" style={{ marginTop: 8 }}>
                This is a system role — edit its permissions with care.
              </p>
            )}
          </div>

          {selectedRoleId == null ? (
            <div className="card empty-state">
              Select a role above to view and edit its permissions.
            </div>
          ) : loadingRole ? (
            <div className="page-loading">
              <Loader size={40} />
            </div>
          ) : (
            <div className="perm-modules">
              {grouped.map(([module, modulePermissions]) => {
                const checkedCount = modulePermissions.filter((p) =>
                  assigned.has(p.permissionId),
                ).length
                const allChecked = checkedCount === modulePermissions.length

                return (
                  <div key={module} className="perm-module card">
                    <div className="perm-module-head">
                      {/* The original's three-state CheckBox: checked / unchecked / indeterminate.
                          Mantine's onChange only fires on real user clicks, so the e.event guard
                          against the programmatic value sync is not needed here. */}
                      <Checkbox
                        checked={allChecked}
                        indeterminate={checkedCount > 0 && !allChecked}
                        onChange={(e) =>
                          toggleModule(modulePermissions, e.currentTarget.checked)
                        }
                      />
                      <span className="perm-module-title">{module}</span>
                      <span className="perm-module-count">
                        {checkedCount}/{modulePermissions.length}
                      </span>
                    </div>
                    <div className="perm-list">
                      {modulePermissions.map((permission) => (
                        <div key={permission.permissionId} className="perm-item">
                          <Checkbox
                            checked={assigned.has(permission.permissionId)}
                            /* The database's own Name is the default, so a permission added to
                               security.PERMISSION shows up here with its wording and no frontend
                               change. A translation is an OVERRIDE for the codes we have wording
                               for — which is what makes this list readable in Arabic at all, since
                               the Name column is English only. */
                            label={t(`security.permissions.${permission.code}`, {
                              defaultValue: permission.name || permission.code,
                            })}
                            onChange={(e) =>
                              togglePermission(
                                permission.permissionId,
                                e.currentTarget.checked,
                              )
                            }
                          />
                          <span className="perm-item-code">
                            {permission.code}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
