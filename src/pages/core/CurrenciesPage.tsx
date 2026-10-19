import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Loader, NumberInput, Pagination, Select, Table, TextInput } from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { notifications } from '@mantine/notifications'
import { IconPencil, IconPlus, IconRefresh, IconSearch, IconTrash } from '@tabler/icons-react'
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
  actions: 190,
}

/** The page sizes the original pager offered. */
const PAGE_SIZES = ['10', '25', '50']

function CurrenciesGrid({
  rows,
  canManage,
  onEdit,
  onDelete,
}: {
  rows: Currency[]
  /** False for a CORE_MANAGE-less reader: the grid still reads, the Actions column goes. */
  canManage: boolean
  onEdit: (row: Currency) => void
  onDelete: (row: Currency) => void
}) {
  const { t } = useTranslation()
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  // Every column here renders its raw value, so none needs a formatted match.
  const columns = useMemo(
    () => [
      columnHelper.accessor('currencyCode', { header: t('core.currencies.code') }),
      columnHelper.accessor('name', { header: t('core.currencies.name') }),
      columnHelper.accessor('decimalPlaces', { header: t('core.currencies.decimals') }),
      // The column, not just the button — an "Actions" header over empty cells reads as broken.
      ...(canManage
        ? [
            columnHelper.display({
              id: 'actions',
              header: t('core.exchangeRates.actions'),
              cell: (info) => (
                <div className="grid-actions">
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    leftSection={<IconPencil size={14} />}
                    onClick={() => onEdit(info.row.original)}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="subtle"
                    color="red"
                    size="compact-sm"
                    leftSection={<IconTrash size={14} />}
                    onClick={() => onDelete(info.row.original)}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              ),
            }),
          ]
        : []),
    ],
    [onEdit, onDelete, canManage, t],
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
          placeholder={t('common.search')}
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
                  {t('core.currencies.empty')}
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
  )
}

export default function CurrenciesPage() {
  const { t } = useTranslation()
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

  /** Only an unused currency can go: the API refuses a used one and says where it is used. */
  async function remove(row: Currency) {
    if (!window.confirm(t('core.currencies.deleteConfirm', { code: row.currencyCode, name: row.name }))) return
    try {
      await currenciesService.remove(row.currencyCode)
      notify(t('core.currencies.deleted'), 'success', 2000)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 8000)
    }
  }

  async function submit() {
    // The Validators' work, done by hand now they are gone — same messages, same order.
    const code = currencyCode.trim()
    if (!code) {
      setFormError(t('core.currencies.codeRequired'))
      return
    }
    if (code.length !== 3) {
      setFormError(t('core.currencies.codeLength'))
      return
    }
    if (!name.trim()) {
      setFormError(t('core.currencies.nameRequired'))
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
      notify(isEdit ? t('core.currencies.saved') : t('core.currencies.created'), 'success', 2000)
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
          <h1 className="page-title">{t('core.currencies.title')}</h1>
          <p className="page-subtitle">{t('core.currencies.subtitle')}</p>
        </div>
        <div className="page-head-actions">
          <ActionIcon
            variant="default"
            size="lg"
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            onClick={refresh}
          >
            <IconRefresh size={16} />
          </ActionIcon>
          {canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
              {t('core.currencies.new')}
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
        <CurrenciesGrid rows={rows} canManage={canManage} onEdit={openEdit} onDelete={remove} />
      )}

      <Modal
        opened={popupVisible}
        onClose={() => setPopupVisible(false)}
        title={isEdit ? t('core.currencies.editTitle') : t('core.currencies.newTitle')}
        size={400}
        centered
      >
        <div className="form-field">
          <label className="form-label" htmlFor="cur-code">
            {t('core.currencies.codeLabel')}
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
            {t('core.currencies.name')}
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
            {t('core.currencies.decimalPlaces')}
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
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? t('common.saving') : isEdit ? t('common.save') : t('core.currencies.create')}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
