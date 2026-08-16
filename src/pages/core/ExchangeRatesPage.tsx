import { useEffect, useMemo, useState } from 'react'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Autocomplete, Button, Group, Loader, Modal, NumberInput, Pagination, Select, Table, TextInput } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconCalendar, IconPencil, IconPlus, IconRefresh, IconSearch, IconTrash } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { currenciesService, exchangeRatesService } from '../../services/coreService'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import { t } from '../../i18n/t'
import type { Currency, ExchangeRate } from '../../types/core'

/**
 * The stored rate-type CODES. The label is resolved at render, so the list follows the language —
 * and so 'NonOfficial' can read as "Non official" without the stored value growing a space.
 */
const RATE_TYPES = ['Official', 'Market', 'NonOfficial'] as const

/**
 * A rate type's words. Falls back to the CODE for anything the dictionary does not know, which is
 * the honest answer for a row written before this list grew — a blank cell would read as missing
 * data when the type is simply one this build has no wording for.
 */
function rateTypeLabel(code: string): string {
  return t(`core.exchangeRates.rateType.${code}`, { defaultValue: code })
}

interface FormState {
  fromCurrency: string
  toCurrency: string
  rateType: string
  effectiveDate: string
  rate: number
}

const EMPTY: FormState = {
  fromCurrency: '',
  toCurrency: '',
  rateType: 'Official',
  effectiveDate: '',
  rate: 0,
}

/**
 * notify(msg, type, ms) → Mantine notifications, adapted once so every call site below
 * stays byte-identical to the original.
 */
function notify(message: string, type: 'success' | 'error', ms: number) {
  notifications.show({ message, color: type === 'success' ? 'green' : 'red', autoClose: ms })
}

/** DX dataType="date" → the date part of the ISO string, same as the shared formatters. */
function formatDate(value: string): string {
  return value ? value.slice(0, 10) : ''
}

/** DX format="#,##0.####" — thousands separators, up to four decimals. */
function formatRate(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

/* PORT NOTE: the DevExtreme DataGrid is TanStack Table + Mantine Table per RequestsGrid.tsx;
   SearchPanel, FilterRow and HeaderFilter are all present — search box, filter strip and
   funnel respectively. The
   Sorting mode="multiple" plus the 10/25/50 pager (showInfo) carry over.
   alignment={alignStart()} on the ID column is dropped — Mantine cells already start-align. */

const columnHelper = createColumnHelper<ExchangeRate>()

/** The pixel widths the original grid pinned; unlisted columns auto-size, as columnAutoWidth did. */
const WIDTHS: Record<string, number | undefined> = {
  exchangeRateId: 80,
  fromCurrency: 90,
  toCurrency: 90,
  rateType: 120,
  effectiveDate: 140,
}

/** The page sizes the original pager offered. */
const PAGE_SIZES = ['10', '25', '50']

function ExchangeRatesGrid({
  rows,
  canManage,
  onEdit,
  onDelete,
}: {
  rows: ExchangeRate[]
  /** False without CORE_MANAGE: the grid still reads, the Actions column goes entirely. */
  canManage: boolean
  onEdit: (row: ExchangeRate) => void
  onDelete: (row: ExchangeRate) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      columnHelper.accessor('exchangeRateId', { header: 'ID' }),
      // From/To/Type are small closed sets in practice — a dropdown of what is present beats a
      // text box for the two questions this page gets asked ("USD to LBP?", "official or market?").
      columnHelper.accessor('fromCurrency', {
        header: 'From',
        meta: { filterOptions: optionsFrom(rows, (r) => r.fromCurrency) },
      }),
      columnHelper.accessor('toCurrency', {
        header: 'To',
        meta: { filterOptions: optionsFrom(rows, (r) => r.toCurrency) },
      }),
      // The CODE is stored, the LABEL is shown, and the filter matches the label — otherwise
      // ticking "Non official" in the funnel would find nothing, since no cell prints that string.
      columnHelper.accessor('rateType', {
        header: 'Type',
        cell: (info) => rateTypeLabel(info.getValue()),
        meta: {
          filterText: rateTypeLabel,
          filterOptions: optionsFrom(rows, (r) => rateTypeLabel(r.rateType)),
        },
      }),
      columnHelper.accessor('effectiveDate', {
        header: 'Effective',
        cell: (info) => formatDate(info.getValue()),
        meta: { filterText: formatDate },
      }),
      // The cell adds thousands separators, so the raw number and the printed one differ once a
      // rate passes 1,000 — which is the normal case for LBP.
      columnHelper.accessor('rate', {
        header: 'Rate',
        cell: (info) => formatRate(info.getValue()),
        meta: { filterText: formatRate },
      }),
      // The column, not just the buttons — an "Actions" header over empty cells reads as broken.
      ...(canManage
        ? [
            columnHelper.display({
              id: 'actions',
              header: t('core.exchangeRates.actions'),
              cell: (info) => (
                <div className="grid-actions">
                  <ActionIcon
                    variant="subtle"
                    title={t('core.exchangeRates.edit')}
                    aria-label={t('core.exchangeRates.edit')}
                    onClick={() => onEdit(info.row.original)}
                  >
                    <IconPencil size={16} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    title={t('core.exchangeRates.delete')}
                    aria-label={t('core.exchangeRates.delete')}
                    onClick={() => onDelete(info.row.original)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </div>
              ),
            }),
          ]
        : []),
    ],
    // `rows` only feeds the three dropdowns' option lists.
    [rows, canManage, onEdit, onDelete],
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
    getRowId: (row) => String(row.exchangeRateId),
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
                  No exchange rates found.
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

export default function ExchangeRatesPage() {
  /* CORE_MANAGE gates every write — creating, correcting and deleting alike. Without it the page is
     the read-only record of what the rates are, which is what most of payroll actually needs. */
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSION.CORE_MANAGE)
  const [rows, setRows] = useState<ExchangeRate[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [popupVisible, setPopupVisible] = useState(false)
  /**
   * The row being corrected, or null when the form is adding one.
   *
   * ONE FORM FOR BOTH, because they ask the same questions — but not the same EDITABLE ones: the
   * pair and the type are fixed on an edit, since the endpoint takes only the figure and the date.
   * Moving them would not correct the row, it would reassign it to a different question.
   */
  const [editing, setEditing] = useState<ExchangeRate | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  /**
   * The required-field checks AND the server's own refusal, in one place under the form.
   *
   * THE DUPLICATE-RATE MESSAGE IS WHY THIS IS NOT A TOAST. It names the pair, the type and the date
   * and tells the user to edit the existing row — advice they act on by changing the very fields
   * still on screen, so it has to stay visible while they do.
   */
  const [formError, setFormError] = useState<string | null>(null)
  /** The rate a delete is being confirmed for. Null when no confirmation is on screen. */
  const [deleting, setDeleting] = useState<ExchangeRate | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function reload() {
    try {
      setRows(await exchangeRatesService.getAll())
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
        const [rateList, currencyList] = await Promise.all([
          exchangeRatesService.getAll(),
          currenciesService.getAll().catch(() => [] as Currency[]),
        ])
        if (!cancelled) {
          setRows(rateList)
          setCurrencies(currencyList)
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
    setEditing(null)
    setForm(EMPTY)
    setFormError(null)
    setPopupVisible(true)
  }

  function openEdit(row: ExchangeRate) {
    setEditing(row)
    setForm({
      fromCurrency: row.fromCurrency,
      toCurrency: row.toCurrency,
      rateType: row.rateType,
      effectiveDate: formatDate(row.effectiveDate),
      rate: row.rate,
    })
    setFormError(null)
    setPopupVisible(true)
  }

  /** Corrects the figure and, when it moved, the date. The pair and the type are never sent. */
  async function submitEdit() {
    if (!editing) return
    if (!form.effectiveDate) {
      setFormError('Effective date is required')
      return
    }
    setFormError(null)
    setSaving(true)
    try {
      await exchangeRatesService.update(editing.exchangeRateId, {
        rate: form.rate,
        // Sent only when it actually moved — null is the endpoint's "leave the date as it is",
        // and re-asserting an unchanged date would put the row through the uniqueness check for
        // no reason, against itself.
        effectiveDate:
          form.effectiveDate !== formatDate(editing.effectiveDate) ? form.effectiveDate : null,
      })
      notify(t('core.exchangeRates.updated'), 'success', 2000)
      setPopupVisible(false)
      setEditing(null)
      await reload()
    } catch (err) {
      // The clash message, verbatim, beside the fields it is about.
      setFormError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await exchangeRatesService.remove(deleting.exchangeRateId)
      notify(t('core.exchangeRates.deleted'), 'success', 2000)
      setDeleting(null)
      await reload()
    } catch (err) {
      // A rate the procedure refuses to drop says why — shown in the dialog rather than as a toast
      // behind it, so the reason and the row it is about stay together.
      setDeleteError(getErrorMessage(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  async function submit() {
    // The RequiredRules' work, done by hand now the Validators are gone — same messages.
    // (The rate rule could never fire: the NumberBox pinned its value at 0, which passes it.)
    if (!form.fromCurrency.trim()) {
      setFormError('From currency is required')
      return
    }
    if (!form.toCurrency.trim()) {
      setFormError('To currency is required')
      return
    }
    if (!form.rateType.trim()) {
      setFormError('Rate type is required')
      return
    }
    if (!form.effectiveDate) {
      setFormError('Effective date is required')
      return
    }
    setFormError(null)
    setSaving(true)
    try {
      await exchangeRatesService.create(form)
      notify('Exchange rate added.', 'success', 2000)
      setPopupVisible(false)
      await reload()
    } catch (err) {
      // WAS A TOAST, NOW A FIELD MESSAGE. The duplicate refusal says "edit the existing row
      // instead" — advice you act on using the fields still on screen, which a toast that fades
      // over a closed thought does not support.
      setFormError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const currencyCodes = currencies.map((c) => c.currencyCode)

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Exchange Rates</h1>
          <p className="page-subtitle">
            Time-stamped rates per currency pair and rate type.
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
              New Rate
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
        <ExchangeRatesGrid
          rows={rows}
          canManage={canManage}
          onEdit={openEdit}
          onDelete={(row) => {
            setDeleteError(null)
            setDeleting(row)
          }}
        />
      )}

      <Modal
        opened={popupVisible}
        onClose={() => setPopupVisible(false)}
        title={editing ? t('core.exchangeRates.editTitle') : 'New Exchange Rate'}
        size={420}
        centered
      >
        {/* SelectBox acceptCustomValue → Autocomplete: the list offers the known codes, and a
            code the list does not know may still be typed, exactly as before. */}
        <div className="form-field">
          <label className="form-label" htmlFor="er-from">
            From currency
          </label>
          <Autocomplete
            id="er-from"
            data={currencyCodes}
            value={form.fromCurrency}
            onChange={(v) => setForm((f) => ({ ...f, fromCurrency: v }))}
            placeholder="Select…"
            // Fixed on an edit — the endpoint does not accept it, and the row IS the answer for
            // this pair. Shown rather than hidden: it is the context the figure belongs to.
            disabled={saving || editing !== null}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="er-to">
            To currency
          </label>
          <Autocomplete
            id="er-to"
            data={currencyCodes}
            value={form.toCurrency}
            onChange={(v) => setForm((f) => ({ ...f, toCurrency: v }))}
            placeholder="Select…"
            disabled={saving || editing !== null}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="er-type">
            Rate type
          </label>
          {/* A SELECT, NOT AN AUTOCOMPLETE, now the codes and their words differ: 'NonOfficial' has
              to be storable while "Non official" is what people read, and free text cannot carry
              both. The closed list is also the truth — the rate types are a fixed set. */}
          <Select
            id="er-type"
            data={RATE_TYPES.map((code) => ({ value: code, label: rateTypeLabel(code) }))}
            value={form.rateType}
            allowDeselect={false}
            onChange={(v) => setForm((f) => ({ ...f, rateType: v ?? f.rateType }))}
            disabled={saving || editing !== null}
          />
        </div>

        {/* Said once, where the three greyed fields are — otherwise a disabled pair reads as a bug. */}
        {editing && <p className="hint">{t('core.exchangeRates.pairLocked')}</p>}

        <div className="form-field">
          <label className="form-label" htmlFor="er-date">
            Effective date
          </label>
          {/* Required ("Effective date is required"), so not clearable. State stays 'yyyy-MM-dd'. */}
          <DatePickerInput
            id="er-date"
            valueFormat="DD/MM/YYYY"
            leftSection={<IconCalendar size={14} />}
            value={form.effectiveDate || null}
            onChange={(v) => setForm((f) => ({ ...f, effectiveDate: v ?? '' }))}
            disabled={saving}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="er-rate">
            Rate
          </label>
          <NumberInput
            id="er-rate"
            value={form.rate}
            onChange={(v) => setForm((f) => ({ ...f, rate: typeof v === 'number' ? v : 0 }))}
            min={0}
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
          <Button
            onClick={() => void (editing ? submitEdit() : submit())}
            disabled={saving}
          >
            {saving ? 'Saving…' : editing ? t('common.save') : 'Create'}
          </Button>
        </div>
      </Modal>

      {/* DELETE, CONFIRMED — and the confirmation names the row, because "are you sure?" over a grid
          of near-identical rates tells nobody which one is about to go. */}
      <Modal
        opened={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('core.exchangeRates.deleteTitle')}
        size={440}
        centered
      >
        {deleting && (
          <>
            <p style={{ marginTop: 0 }}>
              {t('core.exchangeRates.deleteBody', {
                from: deleting.fromCurrency,
                to: deleting.toCurrency,
                type: rateTypeLabel(deleting.rateType),
                date: formatDate(deleting.effectiveDate),
                rate: formatRate(deleting.rate),
              })}
            </p>
            <p className="hint">{t('core.exchangeRates.deleteHint')}</p>
            {deleteError && (
              <div className="alert alert--error" role="alert">
                {deleteError}
              </div>
            )}
            <div className="form-actions">
              <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteBusy}>
                {t('common.cancel')}
              </Button>
              <Button color="red" onClick={() => void confirmDelete()} disabled={deleteBusy}>
                {deleteBusy ? t('common.saving') : t('core.exchangeRates.delete')}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
