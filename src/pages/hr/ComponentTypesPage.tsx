import { useEffect, useMemo, useState } from 'react'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Loader, Modal, Pagination, Select, Table, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconPencil, IconPlus, IconRefresh, IconSearch } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { componentTypesService } from '../../services/hrService'
import type { ComponentType } from '../../types/hr'

const CATEGORIES = ['Earning', 'Deduction']

/** Sign is fully determined by the category (Earning = +1, Deduction = -1). */
function signFor(category: string): number {
  return category === 'Deduction' ? -1 : 1
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

const columnHelper = createColumnHelper<ComponentType>()

/** The pixel widths the original grid pinned; unlisted columns auto-size, as columnAutoWidth did. */
const WIDTHS: Record<string, number | undefined> = {
  componentTypeId: 80,
  category: 150,
  sign: 100,
  actions: 110,
}

/** The page sizes the original pager offered. */
const PAGE_SIZES = ['10', '25', '50']

function ComponentTypesGrid({
  rows,
  onEdit,
}: {
  rows: ComponentType[]
  onEdit: (row: ComponentType) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      columnHelper.accessor('componentTypeId', { header: 'ID' }),
      columnHelper.accessor('name', { header: 'Name' }),
      columnHelper.accessor('category', {
        header: 'Category',
        meta: { filterOptions: optionsFrom(rows, (r) => r.category) },
      }),
      // The cell prints a typographic minus (−1), not a hyphen, so an equality dropdown over the
      // two printed values is the only way this column can be filtered without a trap.
      columnHelper.accessor('sign', {
        header: 'Sign',
        cell: (info) => (info.row.original.sign < 0 ? '−1' : '+1'),
        meta: { filterText: (v) => (v < 0 ? '−1' : '+1'), filterOptions: ['+1', '−1'] },
      }),
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
    ],
    // `rows` only feeds the Category dropdown's option list.
    [onEdit, rows],
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
    getRowId: (row) => String(row.componentTypeId),
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
                  No component types found.
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

export default function ComponentTypesPage() {
  const [rows, setRows] = useState<ComponentType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [popupVisible, setPopupVisible] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('Earning')
  const [saving, setSaving] = useState(false)
  /** PORT NOTE: Validator/RequiredRule → the same required check and message, run in submit(). */
  const [formError, setFormError] = useState<string | null>(null)

  async function reload() {
    try {
      setRows(await componentTypesService.getAll())
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
        const data = await componentTypesService.getAll()
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
    setName('')
    setCategory('Earning')
    setFormError(null)
    setPopupVisible(true)
  }

  function openEdit(row: ComponentType) {
    setEditingId(row.componentTypeId)
    setName(row.name)
    setCategory(row.category)
    setFormError(null)
    setPopupVisible(true)
  }

  async function submit() {
    const trimmed = name.trim()
    // The RequiredRule's work, done by hand now the Validator is gone — same message.
    if (!trimmed) {
      setFormError('Name is required')
      return
    }
    setFormError(null)
    const sign = signFor(category)
    setSaving(true)
    try {
      if (editingId != null) {
        await componentTypesService.update(editingId, trimmed, category, sign)
        notify('Saved.', 'success', 2000)
      } else {
        await componentTypesService.create(trimmed, category, sign)
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
          <h1 className="page-title">Component Types</h1>
          <p className="page-subtitle">
            Pay components — earnings (+) and deductions (−).
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
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            New
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
        <ComponentTypesGrid rows={rows} onEdit={openEdit} />
      )}

      <Modal
        opened={popupVisible}
        onClose={() => setPopupVisible(false)}
        title={editingId != null ? 'Edit Component Type' : 'New Component Type'}
        size={420}
        centered
      >
        <div className="form-field">
          <label className="form-label" htmlFor="ct-name">
            Name
          </label>
          <TextInput
            id="ct-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            disabled={saving}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="ct-category">
            Category
          </label>
          <Select
            id="ct-category"
            data={CATEGORIES}
            value={category}
            onChange={(v) => setCategory(v ?? 'Earning')}
            allowDeselect={false}
            disabled={saving}
          />
          <p className="hint" style={{ marginTop: 6 }}>
            Sign is set automatically: Earning = +1, Deduction = −1.
          </p>
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
