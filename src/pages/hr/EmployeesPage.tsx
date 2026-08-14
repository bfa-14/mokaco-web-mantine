import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Loader, Modal, Pagination, Select, Switch, Table, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconPlus, IconRefresh, IconSearch, IconTrash } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { employeesService } from '../../services/hrService'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { EmployeeFormPopup } from './EmployeeFormPopup'
import type { EmployeeListItem, EmployeeLoginStatus } from '../../types/hr'
import { approvalTierLabel } from '../../types/hr'
import { alignStart } from '../../i18n/physical'

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
  message: ReactNode
  resolve: (proceed: boolean) => void
}

/** The login-state indicator for one employee, from the merged login-status map. */
function LoginStateCell({ status }: { status: EmployeeLoginStatus | undefined }) {
  if (!status || !status.hasLogin) {
    return <span className="badge badge--muted">no login</span>
  }
  if (status.userIsActive === false) {
    return <span style={{ color: '#b7791f', fontWeight: 600 }}>account disabled</span>
  }
  return (
    <span style={{ color: '#2f855a', fontWeight: 600 }}>
      <IconCheck
        size={14}
        aria-hidden="true"
        style={{ marginInlineEnd: 4, verticalAlign: 'text-bottom' }}
      />
      {status.username}
    </span>
  )
}

/* PORT NOTE: the DevExtreme SearchPanel, FilterRow and HeaderFilter are all present — search box,
   filter strip and header funnel; Sorting mode="multiple" and the 15/30/50 pager carry over. */

const columnHelper = createColumnHelper<EmployeeListItem>()

/** The pixel widths the original grid pinned; unlisted columns auto-size, as columnAutoWidth did. */
const WIDTHS: Record<string, number | undefined> = {
  employeeId: 70,
  hireDate: 120,
  approvalTier: 120,
  terminationDate: 110,
  login: 180,
  actions: 150,
}

/** The page sizes the original pager offered. */
const PAGE_SIZES = ['15', '30', '50']

export default function EmployeesPage() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  // The login column and its filter are account administration — shown only to those who can manage it.
  const canManageAccounts = hasPermission('USER_MANAGE')

  const [rows, setRows] = useState<EmployeeListItem[]>([])
  const [logins, setLogins] = useState<Map<number, EmployeeLoginStatus>>(new Map())
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createVisible, setCreateVisible] = useState(false)

  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = useState('')

  /** The confirm dialog currently on screen, if any — see ConfirmState. */
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  const askConfirm = useCallback(
    (message: ReactNode, title: string): Promise<boolean> =>
      new Promise<boolean>((resolve) => setConfirmState({ title, message, resolve })),
    [],
  )

  function settleConfirm(proceed: boolean) {
    confirmState?.resolve(proceed)
    setConfirmState(null)
  }

  async function reload() {
    try {
      const [data, loginList] = await Promise.all([
        employeesService.getAll(),
        canManageAccounts
          ? employeesService.getLoginStatus().catch(() => [] as EmployeeLoginStatus[])
          : Promise.resolve([] as EmployeeLoginStatus[]),
      ])
      setRows(data)
      setLogins(new Map(loginList.map((s) => [s.employeeId, s])))
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      try {
        const [data, loginList] = await Promise.all([
          employeesService.getAll(),
          canManageAccounts
            ? employeesService.getLoginStatus().catch(() => [] as EmployeeLoginStatus[])
            : Promise.resolve([] as EmployeeLoginStatus[]),
        ])
        if (!cancelled) {
          setRows(data)
          setLogins(new Map(loginList.map((s) => [s.employeeId, s])))
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
  }, [canManageAccounts])

  function refresh() {
    setLoading(true)
    void reload()
  }

  async function handleDelete(employee: EmployeeListItem) {
    const ok = await askConfirm(
      <>
        Remove <b>{employee.fullName}</b>? This soft-deletes the employee (the record is kept, but
        hidden from the list).
      </>,
      'Confirm removal',
    )
    if (!ok) return
    try {
      await employeesService.remove(employee.employeeId)
      notify(`${employee.fullName} removed.`, 'success', 2200)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    }
  }

  // "Show only employees without a login" filters client-side from the merged map.
  // (Memoised because the table's data is this array — stable identity per change.)
  const displayed = useMemo(
    () =>
      onlyMissing && canManageAccounts
        ? rows.filter((r) => !logins.get(r.employeeId)?.hasLogin)
        : rows,
    [onlyMissing, canManageAccounts, rows, logins],
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor('employeeId', { header: 'ID' }),
      columnHelper.accessor('fullName', {
        header: 'Full Name',
        cell: (info) => {
          const emp = info.row.original
          return (
            <a className="grid-link" onClick={() => navigate(`/hr/employees/${emp.employeeId}`)}>
              {emp.fullName}
            </a>
          )
        },
      }),
      // Position / department / branch are the three org axes people slice this list by, and each
      // is a closed set — dropdowns of what is actually present, so no option comes back empty.
      columnHelper.accessor('position', {
        header: 'Position',
        meta: { filterOptions: optionsFrom(rows, (r) => r.position) },
      }),
      columnHelper.accessor('department', {
        header: 'Department',
        meta: { filterOptions: optionsFrom(rows, (r) => r.department) },
      }),
      columnHelper.accessor('branch', {
        header: 'Branch',
        meta: { filterOptions: optionsFrom(rows, (r) => r.branch) },
      }),
      columnHelper.accessor('hireDate', {
        header: 'Hired',
        cell: (info) => (info.getValue() ? new Date(info.getValue()).toLocaleDateString() : ''),
        // Sorts by the timestamp, matches on the locale date the cell prints.
        meta: { filterText: (v) =>
          v ? new Date(v).toLocaleDateString() : '' },
      }),
      /* Approval tier — tagged only for tier > 1; staff (the default) shows nothing, so the
         column stays quiet unless someone is actually elevated. */
      columnHelper.accessor('approvalTier', {
        header: 'Tier',
        enableGlobalFilter: false,
        cell: (info) => {
          const tier = info.row.original.approvalTier
          if (tier <= 1) return null
          return <span className="badge badge--muted">{approvalTierLabel(tier)}</span>
        },
        // Tier 1 shows an EMPTY cell, so its filter value is the empty string and it is simply
        // absent from the dropdown — picking a tier means picking an elevated one.
        meta: { filterText: (v) =>
          v <= 1 ? '' : approvalTierLabel(v), filterOptions: optionsFrom(rows, (r) =>
            r.approvalTier <= 1 ? '' : approvalTierLabel(r.approvalTier),
          ) },
      }),
      // The accessor is the termination DATE (so the sort groups leavers by when they left); the
      // cell shows one of two words, and the filter matches those.
      columnHelper.accessor((r) => r.terminationDate ?? '', {
        id: 'terminationDate',
        header: 'Status',
        enableGlobalFilter: false,
        cell: (info) =>
          info.row.original.terminationDate ? (
            <span className="badge badge--off">Terminated</span>
          ) : (
            <span className="badge badge--on">Active</span>
          ),
        meta: { filterText: (v) =>
          v ? 'Terminated' : 'Active', filterOptions: ['Active', 'Terminated'] },
      }),
      ...(canManageAccounts
        ? [
            columnHelper.display({
              id: 'login',
              header: 'Login',
              cell: (info) => (
                <LoginStateCell status={logins.get(info.row.original.employeeId)} />
              ),
            }),
          ]
        : []),
      columnHelper.display({
        id: 'actions',
        header: 'Actions',
        cell: (info) => {
          const emp = info.row.original
          return (
            <div className="grid-actions">
              <ActionIcon
                variant="subtle"
                title="Open profile"
                aria-label="Open profile"
                onClick={() => navigate(`/hr/employees/${emp.employeeId}`)}
              >
                <IconSearch size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="red"
                title="Remove"
                aria-label="Remove"
                onClick={() => void handleDelete(emp)}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </div>
          )
        },
      }),
    ],
    // `rows` (the unfiltered load) feeds the three dropdowns' option lists — deliberately not
    // `displayed`, so narrowing one column does not empty the choices in the others.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManageAccounts, logins, navigate, rows],
  )

  const table = useReactTable({
    data: displayed,
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
    initialState: { pagination: { pageSize: 15 } },
    getRowId: (r) => String(r.employeeId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Employees</h1>
          <p className="page-subtitle">The people records for Moka &amp; Co.</p>
        </div>
        <div className="page-head-actions">
          {canManageAccounts && (
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
          )}
          <ActionIcon
            variant="default"
            size="lg"
            title="Refresh"
            aria-label="Refresh"
            onClick={refresh}
          >
            <IconRefresh size={16} />
          </ActionIcon>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateVisible(true)}>
            New Employee
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

          <Table striped highlightOnHover withTableBorder verticalSpacing="xs" fz="sm">
            <Table.Thead>
              {table.getHeaderGroups().map((hg) => (
                <Table.Tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <Table.Th
                      key={header.id}
                      style={{
                        width: WIDTHS[header.column.id],
                        // The original pinned the ID column with alignment={alignStart()} so it
                        // survives RTL; the rest keep the table's natural start alignment.
                        textAlign: header.column.id === 'employeeId' ? alignStart() : undefined,
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
                      {onlyMissing ? 'Every employee has a login.' : 'No employees found.'}
                    </div>
                  </Table.Td>
                </Table.Tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <Table.Tr
                    key={row.id}
                    onDoubleClick={() => navigate(`/hr/employees/${row.original.employeeId}`)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <Table.Td
                        key={cell.id}
                        style={
                          cell.column.id === 'employeeId'
                            ? { textAlign: alignStart() }
                            : undefined
                        }
                      >
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

      <EmployeeFormPopup
        visible={createVisible}
        employee={null}
        onClose={() => setCreateVisible(false)}
        onSaved={() => void reload()}
      />

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
    </div>
  )
}
