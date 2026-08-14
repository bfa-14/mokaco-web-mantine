import { useCallback, useEffect, useMemo, useState } from 'react'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Loader, Modal, Select, Table } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconRefresh } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { branchManagerService } from '../../services/workflowService'
import { employeesService } from '../../services/hrService'
import type { EmployeeListItem } from '../../types/hr'
import type { BranchWithManager } from '../../types/workflow'

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

const columnHelper = createColumnHelper<BranchWithManager>()

/**
 * Branch managers — the post a 'BranchManager' approval step resolves through. Two failure states
 * are surfaced loudly, because each silently skips steps: a branch with no manager, and a manager
 * with no login.
 */
export default function BranchManagersPage() {
  const [branches, setBranches] = useState<BranchWithManager[]>([])
  const [employees, setEmployees] = useState<EmployeeListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [target, setTarget] = useState<BranchWithManager | null>(null)
  const [managerId, setManagerId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const load = useCallback(async () => {
    try {
      const [branchList, empList] = await Promise.all([
        branchManagerService.getAll(),
        employeesService.getAll().catch(() => [] as EmployeeListItem[]),
      ])
      setBranches(branchList)
      setEmployees(empList)
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Mount-time fetch. load() is async and setStates only after its awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function save() {
    if (!target) return
    setBusy(true)
    try {
      const result = await branchManagerService.setManager(target.branchId, managerId)
      // Use the API's own warning text when the new manager has no login.
      if (result.warning) notify(result.warning, 'warning', 5000)
      else notify(`Manager set for ${result.name}.`, 'success', 2500)
      setTarget(null)
      setManagerId(null)
      await load()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4500)
    } finally {
      setBusy(false)
    }
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', { header: 'Branch' }),
      // An unassigned branch prints "None" — the word that finds the branches this page exists
      // to fix, so it has to be matchable.
      columnHelper.accessor('managerName', {
        header: 'Manager',
        cell: (info) => {
          const b = info.row.original
          if (b.managerEmployeeId == null)
            return <span className="badge badge--muted">None</span>
          return b.managerName
        },
        meta: { filterText: (v, row) =>
          row.managerEmployeeId == null ? 'None' : (v ?? '') },
      }),
      columnHelper.display({
        id: 'status',
        header: 'Status',
        cell: (info) => {
          const b = info.row.original
          if (b.managerEmployeeId == null)
            return (
              <span style={{ color: '#b7791f' }}>
                Branch-manager steps will be skipped for this branch.
              </span>
            )
          if (b.managerHasNoLogin)
            return (
              <span style={{ color: '#c53030' }}>
                This manager has no user account, so they cannot approve anything yet.
              </span>
            )
          return <span className="badge badge--on">OK</span>
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => {
          const b = info.row.original
          return (
            <Button
              variant="subtle"
              size="xs"
              onClick={() => {
                setTarget(b)
                setManagerId(b.managerEmployeeId)
              }}
            >
              Assign
            </Button>
          )
        },
      }),
    ],
    [],
  )

  const table = useReactTable({
    data: branches,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    // This page had no search box; the filter row is its only narrowing control.
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (b) => String(b.branchId),
  })

  /** The row wash from the original's onCellPrepared — amber if no manager, red if no login. */
  function rowBackground(b: BranchWithManager): string | undefined {
    if (b.managerHasNoLogin) return '#fef2f2'
    if (b.managerEmployeeId == null) return '#fffaf0'
    return undefined
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Branch managers</h1>
          <p className="page-subtitle">Who signs the branch-manager step, per branch.</p>
        </div>
        <div className="page-head-actions">
          <ActionIcon
            variant="default"
            size="lg"
            title="Refresh"
            aria-label="Refresh"
            onClick={() => {
              setLoading(true)
              void load()
            }}
          >
            <IconRefresh size={16} />
          </ActionIcon>
        </div>
      </div>

      <PageHelp>
        Steps that need “the branch manager” resolve through this. A branch with no manager,
        or a manager with no login, means those steps get skipped.
      </PageHelp>

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
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <Table highlightOnHover verticalSpacing="xs" fz="sm">
            <Table.Thead>
              {table.getHeaderGroups().map((hg) => (
                <Table.Tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <Table.Th
                      key={header.id}
                      style={{
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
              {table.getRowModel().rows.map((row) => (
                // Colour the whole row by its state: amber if no manager, red if the manager cannot log in.
                <Table.Tr
                  key={row.id}
                  style={{ background: rowBackground(row.original) }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <Table.Td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
      )}

      {target && (
        <Modal
          opened
          onClose={() => setTarget(null)}
          title={`Manager for ${target.name}`}
          size={440}
          centered
        >
          <div className="form-field">
            <label className="form-label">Manager</label>
            <Select
              data={employees.map((e) => ({
                value: String(e.employeeId),
                label: `${e.fullName} — ${e.branch}`,
              }))}
              value={managerId != null ? String(managerId) : null}
              searchable
              clearable
              placeholder="Choose an employee (or clear to leave vacant)"
              disabled={busy}
              onChange={(v) => setManagerId(v != null ? Number(v) : null)}
            />
            <div className="hint">
              A branch manager can approve requests from their own branch only.
            </div>
          </div>
          <div className="form-actions">
            <Button variant="default" onClick={() => setTarget(null)} disabled={busy}>
              Back
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
