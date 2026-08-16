import { useEffect, useMemo, useState } from 'react'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Loader, Modal, Pagination, Select, Switch, Table, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconPencil, IconPlus, IconRefresh, IconSearch } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { leaveTypesService } from '../../services/hrService'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import type { LeaveType } from '../../types/hr'

interface FormState {
  name: string
  isPaid: boolean
  carryOver: boolean
}

const EMPTY: FormState = {
  name: '',
  isPaid: true,
  carryOver: false,
}

/** The words a YesNo badge prints — also the closed set its filter dropdown offers. */
const YES_NO = ['Yes', 'No']
const yesNoText = (value: boolean) => (value ? 'Yes' : 'No')

function YesNo({ value }: { value: boolean }) {
  return (
    <span className={value ? 'badge badge--on' : 'badge badge--muted'}>{yesNoText(value)}</span>
  )
}

/**
 * notify(msg, type, ms) → Mantine notifications, adapted once so every call site below
 * stays byte-identical to the original.
 */
function notify(message: string, type: 'success' | 'error', ms: number) {
  notifications.show({ message, color: type === 'success' ? 'green' : 'red', autoClose: ms })
}

/* PORT NOTE: the DevExtreme DataGrid is TanStack Table + Mantine Table per RequestsGrid.tsx;
   SearchPanel, FilterRow and HeaderFilter are all present — search box, filter strip and
   funnel respectively. The
   Sorting mode="multiple" plus the 10/25/50 pager (showInfo) carry over.
   alignment={alignStart()} on the ID column is dropped — Mantine cells already start-align. */

const columnHelper = createColumnHelper<LeaveType>()

/** The pixel widths the original grid pinned; unlisted columns auto-size, as columnAutoWidth did. */
const WIDTHS: Record<string, number | undefined> = {
  leaveTypeId: 80,
  isPaid: 100,
  carryOver: 120,
  actions: 110,
}

/** The page sizes the original pager offered. */
const PAGE_SIZES = ['10', '25', '50']

function LeaveTypesGrid({
  rows,
  canManage,
  onEdit,
}: {
  rows: LeaveType[]
  /** False for a LEAVE_POLICY_MANAGE-less reader: the grid still reads, the Actions column goes. */
  canManage: boolean
  onEdit: (row: LeaveType) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      columnHelper.accessor('leaveTypeId', { header: 'ID' }),
      columnHelper.accessor('name', { header: 'Name' }),
      // Booleans behind Yes/No badges: a dropdown over the words, not a box the reader would
      // have to type "true" into.
      columnHelper.accessor('isPaid', {
        header: 'Paid',
        cell: (info) => <YesNo value={info.row.original.isPaid} />,
        meta: { filterText: yesNoText, filterOptions: YES_NO },
      }),
      columnHelper.accessor('carryOver', {
        header: 'Carry Over',
        cell: (info) => <YesNo value={info.row.original.carryOver} />,
        meta: { filterText: yesNoText, filterOptions: YES_NO },
      }),
      // The column, not just the button — an "Actions" header over empty cells reads as broken.
      ...(canManage
        ? [
            columnHelper.display({
              id: 'actions',
              header: 'Actions',
              cell: (info) => (
                <div className="grid-actions">
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    leftSection={<IconPencil size={14} />}
                    onClick={() => onEdit(info.row.original)}
                  >
                    Edit
                  </Button>
                </div>
              ),
            }),
          ]
        : []),
    ],
    [onEdit, canManage],
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
    // The original's Sorting mode="multiple" — shift-click adds a column.
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 10 } },
    getRowId: (row) => String(row.leaveTypeId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  return (
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
                  No leave types found.
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
          {total === 0 ? 0 : pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, total)}{' '}
          of {total}
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
  )
}

export default function LeaveTypesPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSION.LEAVE_POLICY_MANAGE)
  const [rows, setRows] = useState<LeaveType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [popupVisible, setPopupVisible] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  /** PORT NOTE: Validator/RequiredRule → the same required check and message, run in submit(). */
  const [formError, setFormError] = useState<string | null>(null)

  async function reload() {
    try {
      setRows(await leaveTypesService.getAll())
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
        const data = await leaveTypesService.getAll()
        if (!cancelled) {
          setRows(data)
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

  function refresh() {
    setLoading(true)
    void reload()
  }

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY)
    setFormError(null)
    setPopupVisible(true)
  }

  function openEdit(row: LeaveType) {
    setEditingId(row.leaveTypeId)
    setForm({
      name: row.name,
      isPaid: row.isPaid,
      carryOver: row.carryOver,
    })
    setFormError(null)
    setPopupVisible(true)
  }

  async function submit() {
    // The RequiredRule's work, done by hand now the Validator is gone — same message.
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    setFormError(null)
    const payload = { ...form, name: form.name.trim() }
    setSaving(true)
    try {
      if (editingId != null) {
        await leaveTypesService.update(editingId, payload)
        notify('Saved.', 'success', 2000)
      } else {
        await leaveTypesService.create(payload)
        notify('Created.', 'success', 2000)
      }
      setPopupVisible(false)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Leave Types</h1>
          <p className="page-subtitle">
            Kinds of leave, paid flag and monthly accrual policy.
          </p>
        </div>
        <div className="page-head-actions">
          <ActionIcon
            variant="default"
            size="lg"
            title="Refresh"
            aria-label="Refresh"
            onClick={refresh}
          >
            <IconRefresh size={16} />
          </ActionIcon>
          {canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
              New
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
        <LeaveTypesGrid rows={rows} canManage={canManage} onEdit={openEdit} />
      )}

      <Modal
        opened={popupVisible}
        onClose={() => setPopupVisible(false)}
        title={editingId != null ? 'Edit Leave Type' : 'New Leave Type'}
        size={420}
        centered
      >
        <div className="form-field">
          <label className="form-label" htmlFor="lt-name">
            Name
          </label>
          <TextInput
            id="lt-name"
            value={form.name}
            onChange={(e) => {
              const value = e.currentTarget.value
              setForm((f) => ({ ...f, name: value }))
            }}
            disabled={saving}
          />
        </div>

        <div className="form-field form-field--row">
          <label className="form-label">Paid</label>
          <Switch
            checked={form.isPaid}
            onChange={(e) => {
              const checked = e.currentTarget.checked
              setForm((f) => ({ ...f, isPaid: checked }))
            }}
            disabled={saving}
          />
        </div>

        <div className="form-field form-field--row">
          <label className="form-label">Carry over unused</label>
          <Switch
            checked={form.carryOver}
            onChange={(e) => {
              const checked = e.currentTarget.checked
              setForm((f) => ({ ...f, carryOver: checked }))
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
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : editingId != null ? 'Save' : 'Create'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
