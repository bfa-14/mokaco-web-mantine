import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Loader, Modal, Pagination, Select, Switch, Table, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconKey, IconRefresh, IconSearch, IconUser } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { employeesService } from '../../services/hrService'
import { usersService } from '../../services/securityService'
import { useAuth } from '../../auth/useAuth'
import type { EmployeeLoginStatus } from '../../types/hr'
import type { UnlinkedUser } from '../../types/security'

/**
 * Employee accounts — links a person to the login they sign in with.
 *
 * This is an HR action, kept deliberately apart from CREATING a login (that stays on the Users
 * page, a security action). The workflow resolves approvers by ACCOUNT, so the states here are not
 * cosmetic: an employee with no login cannot raise a request, and a BRANCH MANAGER with no usable
 * login silently disables every branch-manager approval step for their branch. That last case is
 * the single most common reason someone reports "the workflow does not work", so it is made loud —
 * a red row, the API's own warning inline, and a banner that cannot be missed.
 */

/**
 * notify(msg, type, ms) → Mantine notifications, adapted once so every call site below
 * stays byte-identical to the original.
 */
function notify(message: string, type: 'success' | 'error' | 'warning', ms: number) {
  notifications.show({
    message,
    color: type === 'success' ? 'green' : type === 'warning' ? 'orange' : 'red',
    autoClose: ms,
  })
}

/* PORT NOTE: the DevExtreme SearchPanel is the global search box, the FilterRow the strip under
   the header, and the HeaderFilter the funnel in each header cell; the 15/30/50 pager carries
   over. The source declared no <Sorting>, so single-column sort. */

const columnHelper = createColumnHelper<EmployeeLoginStatus>()

/** The pixel widths the original grid pinned; unlisted columns auto-size, as columnAutoWidth did. */
const WIDTHS: Record<string, number | undefined> = {
  branchName: 150,
  positionName: 160,
  actions: 200,
}

/** The page sizes the original pager offered. */
const PAGE_SIZES = ['15', '30', '50']

export default function EmployeeAccountsPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('USER_MANAGE')
  const navigate = useNavigate()

  const [all, setAll] = useState<EmployeeLoginStatus[]>([])
  const [unlinked, setUnlinked] = useState<UnlinkedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // The toggle filters client-side from the full list, on purpose: the branch-manager banner must
  // count EVERY broken manager (including disabled-but-linked ones the server's onlyMissing filter
  // would drop), so the page always holds the complete picture and hides rows in the view only.
  const [onlyMissing, setOnlyMissing] = useState(false)

  const [linkTarget, setLinkTarget] = useState<EmployeeLoginStatus | null>(null)
  const [pickedUserId, setPickedUserId] = useState<number | null>(null)
  const [unlinkTarget, setUnlinkTarget] = useState<EmployeeLoginStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const load = useCallback(async () => {
    try {
      const [status, unlinkedList] = await Promise.all([
        employeesService.getLoginStatus(false),
        usersService.unlinked().catch(() => [] as UnlinkedUser[]),
      ])
      setAll(status)
      setUnlinked(unlinkedList)
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Mount-time fetch. load() sets state only after its awaits resolve.
    void load()
  }, [load])

  // Managers whose approvals will be skipped: the proc sets Warning for exactly the two broken
  // cases (no login, or a disabled account), so a non-null warning IS the broken-manager signal.
  const brokenManagers = useMemo(() => all.filter((r) => r.warning != null), [all])
  const missingLoginCount = useMemo(() => all.filter((r) => !r.hasLogin).length, [all])

  const rows = useMemo(
    () => (onlyMissing ? all.filter((r) => !r.hasLogin) : all),
    [onlyMissing, all],
  )

  function refresh() {
    setLoading(true)
    void load()
  }

  async function submitLink() {
    if (!linkTarget || pickedUserId == null) return
    setBusy(true)
    try {
      const result = await employeesService.linkUser(linkTarget.employeeId, pickedUserId)
      // The account may be disabled — the proc says so in Warning; never swallow it.
      if (result.warning) notify(result.warning, 'warning', 6000)
      else notify(`${result.fullName} now signs in as ${result.username}.`, 'success', 3000)
      setLinkTarget(null)
      setPickedUserId(null)
      await load()
    } catch (err) {
      // A 400 here names the other employee the account belongs to — show it exactly.
      notify(getErrorMessage(err), 'error', 6000)
    } finally {
      setBusy(false)
    }
  }

  async function submitUnlink() {
    if (!unlinkTarget) return
    setBusy(true)
    try {
      const result = await employeesService.unlinkUser(unlinkTarget.employeeId)
      if (result.requestsLeftWaiting > 0) {
        notify(
          `${result.requestsLeftWaiting} request${result.requestsLeftWaiting === 1 ? ' was' : 's were'} waiting on this person and can no longer be signed by them.`,
          'warning',
          6000,
        )
      } else if (result.warning) {
        notify(result.warning, 'warning', 6000)
      } else {
        notify(`${unlinkTarget.fullName} is no longer linked to a login.`, 'success', 3000)
      }
      setUnlinkTarget(null)
      await load()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 5000)
    } finally {
      setBusy(false)
    }
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor('fullName', { header: 'Employee' }),
      columnHelper.accessor('branchName', { header: 'Branch' }),
      columnHelper.accessor((r) => r.positionName ?? '', {
        id: 'positionName',
        header: 'Position',
        cell: (info) => {
          const r = info.row.original
          return r.positionName ?? <span className="badge badge--muted">—</span>
        },
        // Unposted employees show a dash, so the dash is filterable too.
        meta: { filterText: (v) => v || '—' },
      }),
      // A display column, so the strip leaves its cell empty — the "Only employees with no login"
      // tick-box above the grid is this column's filter, and it is a page-level control.
      columnHelper.display({
        id: 'login',
        header: 'Login',
        cell: (info) => <LoginStateCell row={info.row.original} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: 'Actions',
        cell: (info) => {
          const r = info.row.original
          if (!canManage) return <span className="badge badge--muted">View only</span>
          return (
            <div className="grid-actions">
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={<IconKey size={14} />}
                onClick={() => {
                  setLinkTarget(r)
                  setPickedUserId(null)
                }}
              >
                {r.hasLogin ? 'Change account' : 'Link account'}
              </Button>
              {r.hasLogin && (
                <Button
                  variant="subtle"
                  color="red"
                  size="compact-sm"
                  onClick={() => setUnlinkTarget(r)}
                >
                  Unlink
                </Button>
              )}
            </div>
          )
        },
      }),
    ],
    [canManage],
  )

  const table = useReactTable({
    data: rows,
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
    // The source declared no <Sorting> element — DevExtreme's default is single-column sort.
    enableMultiSort: false,
    initialState: { pagination: { pageSize: 15 } },
    getRowId: (r) => String(r.employeeId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  /**
   * Colour the whole row by its worst problem. Red is reserved for the case that breaks
   * approvals — a branch manager who cannot sign — so it stays exceptional. A plain
   * disabled account (not a manager) is amber. (The original painted cells in onCellPrepared;
   * here the row element carries the wash.)
   */
  function rowBackground(r: EmployeeLoginStatus): string | undefined {
    if (r.warning != null) return '#fef2f2'
    if (r.hasLogin && r.userIsActive === false) return '#fffaf0'
    return undefined
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Employee accounts</h1>
          <p className="page-subtitle">Which login each employee signs in with.</p>
        </div>
        <div className="page-head-actions">
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: 'var(--ink-muted)',
            }}
          >
            <Switch
              checked={onlyMissing}
              onChange={(e) => setOnlyMissing(e.currentTarget.checked)}
            />
            Show only employees without a login
          </span>
          <ActionIcon
            variant="default"
            size="lg"
            title="Refresh"
            aria-label="Refresh"
            onClick={refresh}
          >
            <IconRefresh size={16} />
          </ActionIcon>
        </div>
      </div>

      <PageHelp>
        The workflow resolves approvers by their login. An employee with no account cannot raise a
        request, and a branch manager with no active account cannot approve — so every branch-manager
        step for their branch is skipped. Linking an existing account fixes that. To CREATE an
        account, use the Users page; this screen only connects existing ones to people.
      </PageHelp>

      {/* The loudest thing on the page: managers whose approvals are silently skipping. */}
      {brokenManagers.length > 0 && (
        <div className="alert alert--error" role="alert" style={{ fontWeight: 600 }}>
          {brokenManagers.length} branch manager
          {brokenManagers.length === 1 ? '' : 's'} have no usable login. Approvals needing a branch
          manager will be skipped for their branch{brokenManagers.length === 1 ? '' : 'es'} until you
          link an active account or set a different manager.
        </div>
      )}

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
                        width: WIDTHS[header.column.id],
                        minWidth: header.column.id === 'login' ? 260 : undefined,
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
                      {onlyMissing ? 'Every employee has a login.' : 'No active employees.'}
                    </div>
                  </Table.Td>
                </Table.Tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <Table.Tr
                    key={row.id}
                    style={{ backgroundColor: rowBackground(row.original) }}
                  >
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

      {!loading && !onlyMissing && missingLoginCount > 0 && (
        <p className="hint" style={{ marginTop: 12 }}>
          {missingLoginCount} employee{missingLoginCount === 1 ? '' : 's'} still{' '}
          {missingLoginCount === 1 ? 'has' : 'have'} no login and cannot raise requests.
        </p>
      )}

      {/* Link / change dialog — mounted only when a target exists, exactly as the original was.
          (Under DevExtreme that kept the Popup's children present on first render; the shape is
          kept so the dialog always opens with its content complete.) */}
      {linkTarget && (
        <Modal
          opened
          onClose={() => {
            setLinkTarget(null)
            setPickedUserId(null)
          }}
          title={
            linkTarget.hasLogin
              ? `Change account · ${linkTarget.fullName}`
              : `Link account · ${linkTarget.fullName}`
          }
          size={460}
          centered
        >
          {linkTarget.hasLogin && (
            <p className="hint" style={{ marginTop: 0 }}>
              This changes which login {linkTarget.fullName} signs in with. Requests they raised in
              the past are not affected.
            </p>
          )}

          {unlinked.length === 0 ? (
            <div className="empty-hint">
              <div className="empty-hint-main">No unlinked accounts.</div>
              Every account is already linked to someone. Create one first.
              <div style={{ marginTop: 12 }}>
                <Button
                  leftSection={<IconUser size={16} />}
                  onClick={() => navigate('/security/users')}
                >
                  Go to Users
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="form-field">
                <label className="form-label">Account</label>
                <Select
                  data={unlinked.map((u) => ({
                    value: String(u.userId),
                    label: `${u.username}${u.isActive ? '' : ' — disabled'}`,
                  }))}
                  value={pickedUserId != null ? String(pickedUserId) : null}
                  searchable
                  placeholder="Search accounts…"
                  disabled={busy}
                  onChange={(v) => setPickedUserId(v != null ? Number(v) : null)}
                />
                <div className="hint">
                  Only accounts not yet linked to anyone are listed, so you cannot pick one that is
                  already taken.
                </div>
              </div>
              <div className="form-actions">
                <Button
                  variant="default"
                  onClick={() => {
                    setLinkTarget(null)
                    setPickedUserId(null)
                  }}
                  disabled={busy}
                >
                  Back
                </Button>
                <Button
                  onClick={() => void submitLink()}
                  disabled={busy || pickedUserId == null}
                >
                  {busy ? 'Saving…' : linkTarget.hasLogin ? 'Change account' : 'Link account'}
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* Unlink dialog — states the cost BEFORE the click, not after. */}
      {unlinkTarget && (
        <Modal
          opened
          onClose={() => setUnlinkTarget(null)}
          title={`Unlink account · ${unlinkTarget.fullName}`}
          size={460}
          centered
        >
          <p style={{ marginTop: 0 }}>
            <strong>{unlinkTarget.fullName}</strong> will no longer be able to sign in or raise
            requests. Requests they already raised are not affected.
          </p>
          {unlinkTarget.isBranchManager && (
            <p style={{ color: '#c53030', fontWeight: 600 }}>
              They manage {unlinkTarget.branchName}. Branch-manager approvals for that branch will be
              skipped until you link them again or set a different manager.
            </p>
          )}
          <div className="form-actions">
            <Button variant="default" onClick={() => setUnlinkTarget(null)} disabled={busy}>
              Back
            </Button>
            <Button color="red" onClick={() => void submitUnlink()} disabled={busy}>
              {busy ? 'Unlinking…' : 'Unlink account'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/** The three login states, visually distinct. A broken branch manager shows the API's warning in red. */
function LoginStateCell({ row }: { row: EmployeeLoginStatus }) {
  if (row.warning != null) {
    // Branch manager with no usable login — the loud case. Show the proc's exact words.
    return <span style={{ color: '#c53030', fontWeight: 600 }}>{row.warning}</span>
  }
  if (!row.hasLogin) {
    return <span className="badge badge--muted">Not linked</span>
  }
  if (row.userIsActive === false) {
    return (
      <span style={{ color: '#b7791f', fontWeight: 600 }}>
        {row.username} — account disabled
      </span>
    )
  }
  return (
    <span style={{ color: '#2f855a', fontWeight: 600 }}>
      <IconCheck
        size={14}
        aria-hidden="true"
        style={{ marginInlineEnd: 4, verticalAlign: 'text-bottom' }}
      />
      {row.username}
    </span>
  )
}
