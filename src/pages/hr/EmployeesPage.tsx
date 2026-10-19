import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Loader, Pagination, Select, Switch, Table, TextInput } from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconPlus, IconRefresh, IconSearch, IconTrash } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { employeesService } from '../../services/hrService'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import { EmployeeFormPopup } from './EmployeeFormPopup'
import type { EmployeeListItem, EmployeeLoginStatus } from '../../types/hr'
import { useApprovalTiers } from '../../hr/useApprovalTiers'
import { alignStart } from '../../i18n/physical'
import { currentLocale } from '../../i18n'

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
  const { t } = useTranslation()
  if (!status || !status.hasLogin) {
    return <span className="badge badge--muted">{t('hr.employees.noLogin')}</span>
  }
  if (status.userIsActive === false) {
    return <span style={{ color: '#b7791f', fontWeight: 600 }}>{t('hr.employees.accountDisabled')}</span>
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
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  // The login column and its filter are account administration — shown only to those who can manage it.
  const canManageAccounts = hasPermission('USER_MANAGE')
  /* EMP_VIEW opened this page; changing the register is EMP_EDIT. Without it the grid is fully
     readable and every profile still opens — only creating and removing people go. */
  const canEdit = hasPermission(PERMISSION.EMP_EDIT)
  // The tier column's words. Shared cache, so renaming a tier re-tags this grid at once.
  const { tierName } = useApprovalTiers()

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

  /* REMOVING IS FOR SOMEBODY WHO HAS LEFT AND BEEN PAID (QA3 REL-5). A removed employee is invisible
     to payroll from then on, so the API refuses anybody still employed, and a leaver with a month no
     locked payroll run has paid or an adjustment or advance still open. Its sentence names what is
     still open — a month, an adjustment — so it stays on screen long enough to be read. */
  async function handleDelete(employee: EmployeeListItem) {
    const ok = await askConfirm(
      <Trans
        i18nKey="hr.employees.removeBody"
        values={{ name: employee.fullName }}
        components={{ name: <b /> }}
      />,
      t('hr.employees.removeTitle'),
    )
    if (!ok) return
    try {
      await employeesService.remove(employee.employeeId)
      notify(t('hr.employees.removed', { name: employee.fullName }), 'success', 2200)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 9000)
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
      columnHelper.accessor('employeeId', { header: t('hr.employees.cols.id') }),
      columnHelper.accessor('fullName', {
        header: t('hr.employees.cols.fullName'),
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
        header: t('common.position'),
        meta: { filterOptions: optionsFrom(rows, (r) => r.position) },
      }),
      columnHelper.accessor('department', {
        header: t('common.department'),
        meta: { filterOptions: optionsFrom(rows, (r) => r.department) },
      }),
      columnHelper.accessor('branch', {
        header: t('common.branch'),
        meta: { filterOptions: optionsFrom(rows, (r) => r.branch) },
      }),
      columnHelper.accessor('hireDate', {
        header: t('hr.employees.cols.hired'),
        cell: (info) => (info.getValue() ? new Date(info.getValue()).toLocaleDateString(currentLocale()) : ''),
        // Sorts by the timestamp, matches on the locale date the cell prints.
        meta: { filterText: (v) =>
          v ? new Date(v).toLocaleDateString(currentLocale()) : '' },
      }),
      /* Approval tier — EVERY tier is tagged, including tier 1.
         It used to hide tier 1 as "the unremarkable default", which was a rank test: it assumed 1
         meant staff and that anything above it was the exception worth showing. Tier 1 is the HEAD
         of the organisation now, so hiding it hid exactly the people most worth seeing — and with
         an editable dictionary there is no default tier to be quiet about. It is a label. */
      columnHelper.accessor('approvalTier', {
        header: t('hr.employees.cols.tier'),
        enableGlobalFilter: false,
        cell: (info) => (
          <span className="badge badge--muted">{tierName(info.row.original.approvalTier)}</span>
        ),
        meta: {
          filterText: (v) => tierName(v),
          filterOptions: optionsFrom(rows, (r) => tierName(r.approvalTier)),
        },
      }),
      // The accessor is the termination DATE (so the sort groups leavers by when they left); the
      // cell shows one of two words, and the filter matches those.
      columnHelper.accessor((r) => r.terminationDate ?? '', {
        id: 'terminationDate',
        header: t('hr.employees.cols.status'),
        enableGlobalFilter: false,
        cell: (info) =>
          info.row.original.terminationDate ? (
            <span className="badge badge--off">{t('hr.employees.terminated')}</span>
          ) : (
            <span className="badge badge--on">{t('hr.employees.active')}</span>
          ),
        meta: { filterText: (v) =>
          v ? t('hr.employees.terminated') : t('hr.employees.active'),
          filterOptions: [t('hr.employees.active'), t('hr.employees.terminated')] },
      }),
      ...(canManageAccounts
        ? [
            columnHelper.display({
              id: 'login',
              header: t('hr.employees.cols.login'),
              cell: (info) => (
                <LoginStateCell status={logins.get(info.row.original.employeeId)} />
              ),
            }),
          ]
        : []),
      columnHelper.display({
        id: 'actions',
        header: t('hr.employees.cols.actions'),
        cell: (info) => {
          const emp = info.row.original
          return (
            <div className="grid-actions">
              <ActionIcon
                variant="subtle"
                title={t('hr.employees.openProfile')}
                aria-label={t('hr.employees.openProfile')}
                onClick={() => navigate(`/hr/employees/${emp.employeeId}`)}
              >
                <IconSearch size={16} />
              </ActionIcon>
              {/* Opening a profile is a read and stays; removing somebody is not. */}
              {canEdit && (
                <ActionIcon
                  variant="subtle"
                  color="red"
                  title={t('hr.employees.remove')}
                  aria-label={t('hr.employees.remove')}
                  onClick={() => void handleDelete(emp)}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              )}
            </div>
          )
        },
      }),
    ],
    // `rows` (the unfiltered load) feeds the three dropdowns' option lists — deliberately not
    // `displayed`, so narrowing one column does not empty the choices in the others.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManageAccounts, canEdit, logins, navigate, rows, tierName, t],
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
          <h1 className="page-title">{t('hr.employees.title')}</h1>
          <p className="page-subtitle">{t('hr.employees.subtitle')}</p>
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
              {t('hr.employees.onlyMissing')}
            </span>
          )}
          <ActionIcon
            variant="default"
            size="lg"
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            onClick={refresh}
          >
            <IconRefresh size={16} />
          </ActionIcon>
          {canEdit && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateVisible(true)}>
              {t('hr.employees.new')}
            </Button>
          )}
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
              placeholder={t('common.search')}
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
                      {onlyMissing ? t('hr.employees.allHaveLogin') : t('hr.employees.empty')}
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
              {t('common.pageInfo', {
                from: total === 0 ? 0 : pageIndex * pageSize + 1,
                to: Math.min((pageIndex + 1) * pageSize, total),
                total,
              })}
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
              {t('common.cancel')}
            </Button>
            <Button onClick={() => settleConfirm(true)}>{t('common.ok')}</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
