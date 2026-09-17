import { useCallback, useEffect, useMemo, useState } from 'react'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Badge, Button, Group, Loader, MultiSelect, Pagination, PasswordInput, Select, Switch, Table, TextInput } from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { notifications } from '@mantine/notifications'
import { IconPencil, IconPlus, IconRefresh, IconSearch, IconShield } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { rolesService, signaturesService, usersService } from '../../services/securityService'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { roleIdsOf, roleNamesOf } from '../../types/security'
import type {
  Role,
  UserListItem,
  UserSignatureInfo,
} from '../../types/security'
import { SignatureThumb } from './SignatureThumb'
import { SignatureDialog } from './SignatureDialog'

interface CreateFormState {
  username: string
  password: string
  isActive: boolean
  roleIds: number[]
}

const EMPTY_FORM: CreateFormState = {
  username: '',
  password: '',
  isActive: true,
  roleIds: [],
}

/** The two words the Active cell prints — also the closed set its filter dropdown offers. */
const ACTIVE_LABELS = ['Active', 'Inactive']
const activeText = (isActive: boolean) => (isActive ? 'Active' : 'Inactive')

/** The Roles cell's text — what the filter row and the funnel match against. */
const rolesText = (user: UserListItem) => roleNamesOf(user).join(', ')

/** The employee cell's text: the linked employee's name, blank when unlinked or not yet carried. */
const employeeText = (user: UserListItem) => user.employeeName ?? ''

/**
 * The roles as chips. Nothing at all — not "None" — when the list carries no roles field, because
 * that is the API not saying, which is different from the user holding none.
 */
function RolesCell({ user }: { user: UserListItem }) {
  const names = roleNamesOf(user)
  if (user.roles == null) return <span className="hint" style={{ margin: 0 }}>—</span>
  if (names.length === 0) return <span className="badge badge--muted">None</span>
  return (
    <Group gap={4} wrap="wrap">
      {names.map((name) => (
        <Badge key={name} variant="light" size="sm" radius="sm" tt="none">
          {name}
        </Badge>
      ))}
    </Group>
  )
}

function StatusCell({ isActive }: { isActive: boolean }) {
  return (
    <span className={isActive ? 'badge badge--on' : 'badge badge--off'}>
      {activeText(isActive)}
    </span>
  )
}

/**
 * notify(msg, type, ms) → Mantine notifications, adapted once so every call site below
 * stays byte-identical to the original.
 */
function notify(message: string, type: 'success' | 'error', ms: number) {
  notifications.show({ message, color: type === 'success' ? 'green' : 'red', autoClose: ms })
}

/** DevExtreme's dataType="datetime" rendering, by hand: locale string, blank for null. */
function dateTimeCell(value: string | null): string {
  return value ? new Date(value).toLocaleString() : ''
}

/* PORT NOTE: the grid's SearchPanel, FilterRow and HeaderFilter are all present — search box,
   filter strip and header funnel; Sorting mode="multiple" and the 10/25/50 pager carry over.
   alignment={alignStart()} on the ID column is dropped — Mantine cells already start-align. */

const columnHelper = createColumnHelper<UserListItem>()

/** The page sizes the original pager offered. */
const PAGE_SIZES = ['10', '25', '50']

export default function UsersPage() {
  const { hasPermission } = useAuth()
  // A signature is stamped onto an audit trail, so only Admin/Owner may upload one. The whole
  // signature UI is hidden — not disabled — for anyone else.
  const canManageSignatures = hasPermission('SIGNATURE_MANAGE')

  const [users, setUsers] = useState<UserListItem[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /** Who has a signature, keyed by userId. Drives the grid column WITHOUT any bytes in the list. */
  const [signatures, setSignatures] = useState<Map<number, UserSignatureInfo>>(
    new Map(),
  )

  const [popupVisible, setPopupVisible] = useState(false)
  const [form, setForm] = useState<CreateFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  /** The RequiredRules' replacement: the first missing field's message, shown in the dialog. */
  const [formError, setFormError] = useState<string | null>(null)

  /** The user whose signature dialog is open, or null. */
  const [sigTarget, setSigTarget] = useState<UserListItem | null>(null)

  /** The user whose roles are being edited, or null; and the draft selection for them. */
  const [rolesTarget, setRolesTarget] = useState<UserListItem | null>(null)
  const [rolesDraft, setRolesDraft] = useState<number[]>([])
  const [rolesSaving, setRolesSaving] = useState(false)
  const [rolesError, setRolesError] = useState<string | null>(null)

  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  /** The signature metadata as a userId→info map. Called on load and after any signature change. */
  const loadSignatures = useCallback(async () => {
    try {
      const list = await signaturesService.getAll()
      setSignatures(new Map(list.map((s) => [s.userId, s])))
    } catch {
      // The signature column is an enhancement — its failure must not break the Users grid, so it
      // degrades to no signatures rather than erroring the page.
      setSignatures(new Map())
    }
  }, [])

  const loadUsers = useCallback(async () => {
    try {
      const data = await usersService.getAll()
      setUsers(data)
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  function refresh() {
    setLoading(true)
    void loadUsers()
  }

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      try {
        // Roles feed the create form; signatures feed the grid column — load all three together.
        const [userList, roleList, sigList] = await Promise.all([
          usersService.getAll(),
          rolesService.getRoles().catch(() => [] as Role[]),
          signaturesService.getAll().catch(() => [] as UserSignatureInfo[]),
        ])
        if (!cancelled) {
          setUsers(userList)
          setRoles(roleList)
          setSignatures(new Map(sigList.map((s) => [s.userId, s])))
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void initialLoad()
    return () => {
      cancelled = true
    }
  }, [])

  function openCreate() {
    setForm(EMPTY_FORM)
    setFormError(null)
    setPopupVisible(true)
  }

  const toggleActive = useCallback(
    async (user: UserListItem) => {
      try {
        await usersService.setActive(user.userId, !user.isActive)
        notify(
          `${user.username} ${user.isActive ? 'deactivated' : 'activated'}.`,
          'success',
          2000,
        )
        await loadUsers()
      } catch (err) {
        notify(getErrorMessage(err), 'error', 3500)
      }
    },
    [loadUsers],
  )

  async function submitCreate() {
    // The RequiredRules' work, done by hand now the Validators are gone: name the first
    // missing field with the same message the rule showed.
    if (!form.username.trim()) {
      setFormError('Username is required')
      return
    }
    if (!form.password.trim()) {
      setFormError('Password is required')
      return
    }
    setFormError(null)
    setSaving(true)
    try {
      await usersService.create({
        username: form.username.trim(),
        password: form.password,
        isActive: form.isActive,
        roleIds: form.roleIds,
      })
      notify(`User "${form.username.trim()}" created.`, 'success', 2500)
      setPopupVisible(false)
      await loadUsers()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setSaving(false)
    }
  }

  function openRoles(user: UserListItem) {
    setRolesTarget(user)
    setRolesDraft(roleIdsOf(user, roles))
    setRolesError(null)
  }

  async function submitRoles() {
    if (!rolesTarget) return
    setRolesSaving(true)
    setRolesError(null)
    try {
      await usersService.setRoles(rolesTarget.userId, rolesDraft)
      notify(`Roles for "${rolesTarget.username}" saved.`, 'success', 2500)
      setRolesTarget(null)
      await loadUsers()
    } catch (err) {
      // In the dialog, verbatim: the refusal names the reason and the reader still has the picker.
      setRolesError(getErrorMessage(err))
    } finally {
      setRolesSaving(false)
    }
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor('userId', { header: 'ID' }),
      columnHelper.accessor('username', { header: 'Username' }),
      // The linked employee and the roles: both read through helpers that tolerate an API that
      // does not send them yet (see UserListItem), so the grid degrades to blank cells, not a crash.
      columnHelper.accessor((u) => employeeText(u), {
        id: 'employee',
        header: 'Employee',
        cell: (info) => info.getValue() || <span className="hint" style={{ margin: 0 }}>—</span>,
      }),
      columnHelper.accessor((u) => rolesText(u), {
        id: 'roles',
        header: 'Roles',
        cell: (info) => <RolesCell user={info.row.original} />,
      }),
      columnHelper.accessor('isActive', {
        header: 'Active',
        cell: (info) => <StatusCell isActive={info.row.original.isActive} />,
        meta: { filterText: activeText, filterOptions: ACTIVE_LABELS },
      }),
      // A never-signed-in account prints an empty cell; sorting stays on the raw timestamp.
      columnHelper.accessor('lastLoginAt', {
        header: 'Last Login',
        cell: (info) => dateTimeCell(info.getValue()),
        meta: { filterText: dateTimeCell },
      }),
      columnHelper.display({
        id: 'signature',
        header: 'Signature',
        cell: (info) => {
          const user = info.row.original
          const sig = signatures.get(user.userId)
          // HasSignature drives the column; the thumbnail loads from its own URL. When there is
          // none, a muted word — not an empty cell that reads as "loading forever".
          return sig?.hasSignature ? (
            <SignatureThumb userId={user.userId} version={sig.updatedAt} />
          ) : (
            <span className="badge badge--muted">None</span>
          )
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: 'Actions',
        cell: (info) => {
          const user = info.row.original
          return (
            <div className="grid-actions">
              <Button
                variant="subtle"
                size="compact-sm"
                color={user.isActive ? 'red' : 'green'}
                onClick={() => void toggleActive(user)}
              >
                {user.isActive ? 'Deactivate' : 'Activate'}
              </Button>
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={<IconShield size={14} />}
                title="Change which roles this user holds."
                onClick={() => openRoles(user)}
              >
                Roles
              </Button>
              {/* SIGNATURE_MANAGE only — hidden, never disabled. */}
              {canManageSignatures && (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  leftSection={<IconPencil size={14} />}
                  title="Upload or change this user's signature image."
                  onClick={() => setSigTarget(user)}
                >
                  Signature
                </Button>
              )}
            </div>
          )
        },
      }),
    ],
    // `roles` prefills the roles editor from a row's names.
    [signatures, canManageSignatures, toggleActive, roles],
  )

  /** The pixel widths the original grid pinned; unlisted columns auto-size, as columnAutoWidth did. */
  const columnWidths: Record<string, number | undefined> = {
    userId: 80,
    isActive: 130,
    lastLoginAt: 180,
    signature: 190,
    actions: canManageSignatures ? 330 : 220,
  }

  const table = useReactTable({
    data: users,
    columns,
    state: { sorting, globalFilter, columnFilters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    // The one shared filter function: the funnel's ticked values AND the filter row's text,
    // both tested against the same displayed string. Per-column formatting lives in meta.filterText.
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // The original's Sorting mode="multiple" — shift-click adds a column.
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 10 } },
    getRowId: (u) => String(u.userId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">Manage HRMS user accounts.</p>
        </div>
        <div className="page-head-actions">
          <ActionIcon
            variant="default"
            size="lg"
            title="Refresh"
            aria-label="Refresh"
            onClick={refresh}
          >
            <IconRefresh size={18} />
          </ActionIcon>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            New User
          </Button>
        </div>
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : (
        <div>
          <Group justify="flex-end" mb="xs">
            <TextInput
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.currentTarget.value)}
              placeholder="Search"
              leftSection={<IconSearch size={14} />}
              w={240}
              size="xs"
            />
          </Group>

          <Table striped withTableBorder verticalSpacing="xs" fz="sm">
            <Table.Thead>
              {table.getHeaderGroups().map((hg) => (
                <Table.Tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <Table.Th
                      key={header.id}
                      style={{
                        width: columnWidths[header.column.id],
                        cursor: header.column.getCanSort() ? 'pointer' : undefined,
                        whiteSpace: 'nowrap',
                        userSelect: 'none',
                      }}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <GridHeaderContent header={header} table={table} />
                    </Table.Th>
                  ))}
                </Table.Tr>
              ))}
              <GridFilterRow table={table} />
            </Table.Thead>
            <Table.Tbody>
              {table.getRowModel().rows.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={columns.length}>
                    <div className="empty-hint" style={{ padding: 16 }}>
                      No users found.
                    </div>
                  </Table.Td>
                </Table.Tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <Table.Tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <Table.Td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>

          <Group justify="space-between" mt="xs">
            <span className="hint" style={{ margin: 0 }}>
              {total === 0 ? 0 : pageIndex * pageSize + 1}–
              {Math.min((pageIndex + 1) * pageSize, total)} of {total}
            </span>
            <Group gap="xs">
              <Select
                data={PAGE_SIZES}
                value={String(pageSize)}
                onChange={(v) => v && table.setPageSize(Number(v))}
                w={80}
                size="xs"
              />
              <Pagination
                value={pageIndex + 1}
                onChange={(p) => table.setPageIndex(p - 1)}
                total={Math.max(pageCount, 1)}
                size="sm"
              />
            </Group>
          </Group>
        </div>
      )}

      <Modal
        opened={popupVisible}
        onClose={() => setPopupVisible(false)}
        title="New User"
        size={440}
        centered
      >
        <div className="form-field">
          <label className="form-label" htmlFor="new-user-username">
            Username
          </label>
          <TextInput
            id="new-user-username"
            value={form.username}
            onChange={(e) => {
              const value = e.currentTarget.value
              setForm((f) => ({ ...f, username: value }))
            }}
            disabled={saving}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="new-user-password">
            Password
          </label>
          <PasswordInput
            id="new-user-password"
            value={form.password}
            onChange={(e) => {
              const value = e.currentTarget.value
              setForm((f) => ({ ...f, password: value }))
            }}
            disabled={saving}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="new-user-roles">
            Roles
          </label>
          <MultiSelect
            id="new-user-roles"
            data={roles.map((r) => ({ value: String(r.roleId), label: r.name }))}
            value={form.roleIds.map(String)}
            onChange={(values) =>
              setForm((f) => ({ ...f, roleIds: values.map(Number) }))
            }
            placeholder="Select roles…"
            disabled={saving}
          />
        </div>

        <div className="form-field form-field--row">
          <label className="form-label" htmlFor="new-user-active">
            Active
          </label>
          <Switch
            id="new-user-active"
            checked={form.isActive}
            onChange={(e) => {
              const checked = e.currentTarget.checked
              setForm((f) => ({ ...f, isActive: checked }))
            }}
            disabled={saving}
          />
        </div>

        {formError && (
          <div className="alert alert--error" role="alert">
            {formError}
          </div>
        )}

        <div className="form-actions">
          <Button
            variant="default"
            onClick={() => setPopupVisible(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={() => void submitCreate()} disabled={saving}>
            {saving ? 'Saving…' : 'Create User'}
          </Button>
        </div>
      </Modal>

      {/* THE ROLES EDITOR. The same MultiSelect the create form uses, prefilled with what the row
          carries and saved as the FULL set — the endpoint replaces, so an unticked role is removed. */}
      <Modal
        opened={rolesTarget !== null}
        onClose={() => setRolesTarget(null)}
        title={rolesTarget ? `Roles — ${rolesTarget.username}` : 'Roles'}
        size={440}
        centered
      >
        <div className="form-field">
          <label className="form-label" htmlFor="edit-user-roles">
            Roles
          </label>
          <MultiSelect
            id="edit-user-roles"
            data={roles.map((r) => ({ value: String(r.roleId), label: r.name }))}
            value={rolesDraft.map(String)}
            onChange={(values) => setRolesDraft(values.map(Number))}
            placeholder="Select roles…"
            searchable
            disabled={rolesSaving}
          />
          {rolesTarget && rolesTarget.roles == null && (
            <p className="hint" style={{ marginTop: 6 }}>
              The list did not carry this user's current roles, so the picker starts empty; what
              you save here becomes the full set.
            </p>
          )}
        </div>

        {rolesError && (
          <div className="alert alert--error" role="alert">
            {rolesError}
          </div>
        )}

        <div className="form-actions">
          <Button variant="default" onClick={() => setRolesTarget(null)} disabled={rolesSaving}>
            Cancel
          </Button>
          <Button onClick={() => void submitRoles()} disabled={rolesSaving}>
            {rolesSaving ? 'Saving…' : 'Save roles'}
          </Button>
        </div>
      </Modal>

      {/* The signature dialog — mounted only when a target exists, so each opening starts from a
          clean state for that user (and nothing renders at all for no target). */}
      {sigTarget && (
        <SignatureDialog
          user={sigTarget}
          existing={signatures.get(sigTarget.userId)}
          onClose={() => setSigTarget(null)}
          onChanged={loadSignatures}
        />
      )}
    </div>
  )
}
