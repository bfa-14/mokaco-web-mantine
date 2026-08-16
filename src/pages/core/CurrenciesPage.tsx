import { useEffect, useMemo, useState } from 'react'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Loader, Modal, NumberInput, Pagination, Select, Table, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconPencil, IconPlus, IconRefresh, IconSearch } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { currenciesService } from '../../services/coreService'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import type { Currency } from '../../types/core'

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
   Sorting mode="multiple" plus the 10/25/50 pager (showInfo) carry over. */

const columnHelper = createColumnHelper<Currency>()

/** The pixel widths the original grid pinned; unlisted columns auto-size, as columnAutoWidth did. */
const WIDTHS: Record<string, number | undefined> = {
  currencyCode: 100,
  decimalPlaces: 110,
  actions: 110,
}

/** The page sizes the original pager offered. */
const PAGE_SIZES = ['10', '25', '50']

function CurrenciesGrid({
  rows,
  canManage,
  onEdit,
}: {
  rows: Currency[]
  /** False for a CORE_MANAGE-less reader: the grid still reads, the Actions column goes. */
  canManage: boolean
  onEdit: (row: Currency) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  // Every column here renders its raw value, so none needs a formatted match.
  const columns = useMemo(
    () => [
      columnHelper.accessor('currencyCode', { header: 'Code' }),
      columnHelper.accessor('name', { header: 'Name' }),
      columnHelper.accessor('decimalPlaces', { header: 'Decimals' }),
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
    getRowId: (row) => row.currencyCode,
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
                  No currencies found.
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

export default function CurrenciesPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSION.CORE_MANAGE)
  const [rows, setRows] = useState<Currency[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [popupVisible, setPopupVisible] = useState(false)
  const [isEdit, setIsEdit] = useState(false)
  const [currencyCode, setCurrencyCode] = useState('')
  const [name, setName] = useState('')
  const [decimalPlaces, setDecimalPlaces] = useState(2)
  const [saving, setSaving] = useState(false)
  /** PORT NOTE: Validator (RequiredRule + StringLengthRule) → the same checks and messages, run
      in submit() in the same order. */
  const [formError, setFormError] = useState<string | null>(null)

  async function reload() {
    try {
      setRows(await currenciesService.getAll())
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
        const data = await currenciesService.getAll()
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
    setIsEdit(false)
    setCurrencyCode('')
    setName('')
    setDecimalPlaces(2)
    setFormError(null)
    setPopupVisible(true)
  }

  function openEdit(row: Currency) {
    setIsEdit(true)
    setCurrencyCode(row.currencyCode)
    setName(row.name)
    setDecimalPlaces(row.decimalPlaces)
    setFormError(null)
    setPopupVisible(true)
  }

  async function submit() {
    // The Validators' work, done by hand now they are gone — same messages, same order.
    const code = currencyCode.trim()
    if (!code) {
      setFormError('Code is required')
      return
    }
    if (code.length !== 3) {
      setFormError('Code must be 3 letters')
      return
    }
    if (!name.trim()) {
      setFormError('Name is required')
      return
    }
    setFormError(null)
    setSaving(true)
    try {
      await currenciesService.upsert({
        currencyCode: currencyCode.trim().toUpperCase(),
        name: name.trim(),
        decimalPlaces,
      })
      notify(isEdit ? 'Saved.' : 'Created.', 'success', 2000)
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
          <h1 className="page-title">Currencies</h1>
          <p className="page-subtitle">
            Currencies the system understands (money is always amount + currency).
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
        <CurrenciesGrid rows={rows} canManage={canManage} onEdit={openEdit} />
      )}

      <Modal
        opened={popupVisible}
        onClose={() => setPopupVisible(false)}
        title={isEdit ? 'Edit Currency' : 'New Currency'}
        size={400}
        centered
      >
        <div className="form-field">
          <label className="form-label" htmlFor="cur-code">
            Code (3 letters)
          </label>
          <TextInput
            id="cur-code"
            maxLength={3}
            styles={{ input: { textTransform: 'uppercase' } }}
            value={currencyCode}
            onChange={(e) => setCurrencyCode(e.currentTarget.value)}
            disabled={saving || isEdit}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="cur-name">
            Name
          </label>
          <TextInput
            id="cur-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            disabled={saving}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="cur-decimals">
            Decimal places
          </label>
          <NumberInput
            id="cur-decimals"
            value={decimalPlaces}
            onChange={(v) => setDecimalPlaces(typeof v === 'number' ? v : 0)}
            min={0}
            max={6}
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
            {saving ? 'Saving…' : isEdit ? 'Save' : 'Create'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
