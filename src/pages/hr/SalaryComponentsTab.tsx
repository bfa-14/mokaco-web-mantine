import { useEffect, useState } from 'react'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState, Table as TableInstance } from '@tanstack/react-table'
import { ActionIcon, Button, Loader, Modal, NumberInput, Select, Table } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconCalendar, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { currenciesService } from '../../services/coreService'
import { componentTypesService, salaryComponentsService } from '../../services/hrService'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { fmtDate, fmtNumber } from './hrFormat'
import type { ComponentType, SalaryComponent } from '../../types/hr'
import type { Currency } from '../../types/core'

interface FormState {
  componentTypeId: number | null
  amount: number
  currencyCode: string
  effectiveFrom: string
  effectiveTo: string
}

const EMPTY: FormState = {
  componentTypeId: null,
  amount: 0,
  currencyCode: '',
  effectiveFrom: '',
  effectiveTo: '',
}

/**
 * notify(msg, type, ms) → Mantine notifications, adapted once so every call site below
 * stays byte-identical to the original.
 */
function notify(message: string, type: 'success' | 'error', ms: number) {
  notifications.show({ message, color: type === 'success' ? 'green' : 'red', autoClose: ms })
}

/**
 * DevExtreme's `confirm(message, title)` dialog, rebuilt as a promise-backed Mantine Modal so the
 * call site keeps its `const ok = await …; if (!ok) return` shape. Any other close answers "no".
 */
interface ConfirmState {
  title: string
  message: React.ReactNode
  resolve: (proceed: boolean) => void
}

/* The formatters are SHARED and null-safe — see hrFormat.ts. Declared locally they were typed
   `(v: number)`, a promise the API cannot keep the moment a column is added server-side. */

/* PORT NOTE: the DevExtreme DataGrid is TanStack Table + Mantine Table, per RequestsGrid.tsx. The
   source grid declared no pager, search or export, so none is added; showBorders → withTableBorder,
   rowAlternationEnabled → striped, Sorting mode="multiple" → enableMultiSort. */
function GridTable<T>({ table, emptyText }: { table: TableInstance<T>; emptyText: string }) {
  const columnCount = table.getAllColumns().length
  return (
    <Table striped withTableBorder verticalSpacing="xs" fz="sm">
      <Table.Thead>
        {table.getHeaderGroups().map((hg) => (
          <Table.Tr key={hg.id}>
            {hg.headers.map((header) => (
              <Table.Th
                key={header.id}
                style={{
                  width: header.column.columnDef.size,
                  cursor: header.column.getCanSort() ? 'pointer' : undefined,
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                }}
                onClick={
                  header.column.getCanSort()
                    ? header.column.getToggleSortingHandler()
                    : undefined
                }
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
            <Table.Td colSpan={columnCount}>
              <div className="empty-hint" style={{ padding: 16 }}>
                {emptyText}
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
  )
}

const columnHelper = createColumnHelper<SalaryComponent>()

export function SalaryComponentsTab({ employeeId }: { employeeId: number }) {
  const [rows, setRows] = useState<SalaryComponent[]>([])
  const [componentTypes, setComponentTypes] = useState<ComponentType[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [popupVisible, setPopupVisible] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  /* PORT NOTE: DX ValidationGroup/RequiredRule → the same required checks, message for message,
     run in submit() and shown as field-level errors. */
  const [fieldErrors, setFieldErrors] = useState<{
    componentTypeId?: string
    currencyCode?: string
    effectiveFrom?: string
  }>({})

  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  /** The confirm dialog currently on screen, if any — see ConfirmState. */
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  const askConfirm = (message: React.ReactNode, title: string): Promise<boolean> =>
    new Promise<boolean>((resolve) => setConfirmState({ title, message, resolve }))

  function settleConfirm(proceed: boolean) {
    confirmState?.resolve(proceed)
    setConfirmState(null)
  }

  async function reload() {
    try {
      setRows(await salaryComponentsService.getByEmployee(employeeId))
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [comps, types, curr] = await Promise.all([
          salaryComponentsService.getByEmployee(employeeId),
          componentTypesService.getAll().catch(() => [] as ComponentType[]),
          currenciesService.getAll().catch(() => [] as Currency[]),
        ])
        if (!cancelled) {
          setRows(comps)
          setComponentTypes(types)
          setCurrencies(curr)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [employeeId])

  function openCreate() {
    setEditingId(null)
    setFieldErrors({})
    setForm({ ...EMPTY, currencyCode: currencies[0]?.currencyCode ?? '' })
    setPopupVisible(true)
  }

  function openEdit(row: SalaryComponent) {
    setEditingId(row.salaryComponentId)
    setFieldErrors({})
    setForm({
      componentTypeId: row.componentTypeId,
      amount: row.amount,
      currencyCode: row.currencyCode,
      effectiveFrom: row.effectiveFrom.slice(0, 10),
      effectiveTo: row.effectiveTo?.slice(0, 10) ?? '',
    })
    setPopupVisible(true)
  }

  async function submit() {
    /* The DX "Amount is required" rule is not reproduced: the state coerces an empty box to 0, so
       that rule could never fire in the original either (0 satisfies a RequiredRule). */
    const errors: { componentTypeId?: string; currencyCode?: string; effectiveFrom?: string } = {}
    if (form.componentTypeId == null) errors.componentTypeId = 'Component type is required'
    if (!form.currencyCode) errors.currencyCode = 'Currency is required'
    if (!form.effectiveFrom) errors.effectiveFrom = 'Start date is required'
    setFieldErrors(errors)
    if (errors.componentTypeId || errors.currencyCode || errors.effectiveFrom) return
    setSaving(true)
    try {
      if (editingId != null) {
        await salaryComponentsService.update(editingId, {
          amount: form.amount,
          currencyCode: form.currencyCode,
          effectiveFrom: form.effectiveFrom,
          effectiveTo: form.effectiveTo || null,
        })
        notify('Salary component updated.', 'success', 2000)
      } else {
        await salaryComponentsService.create({
          employeeId,
          componentTypeId: form.componentTypeId!,
          amount: form.amount,
          currencyCode: form.currencyCode,
          effectiveFrom: form.effectiveFrom,
          effectiveTo: form.effectiveTo || null,
        })
        notify('Salary component added.', 'success', 2000)
      }
      setPopupVisible(false)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row: SalaryComponent) {
    const ok = await askConfirm(
      <>
        Delete the <b>{row.componentName}</b> component?
      </>,
      'Confirm delete',
    )
    if (!ok) return
    try {
      await salaryComponentsService.remove(row.salaryComponentId)
      notify('Deleted.', 'success', 2000)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    }
  }

  // Column defs are rebuilt per render on purpose — the action cells close over openEdit and
  // handleDelete, which follow the current employeeId. This table is small.
  const columns = [
    columnHelper.accessor('componentName', { header: 'Component' }),
    columnHelper.accessor('amount', {
      header: 'Amount',
      // 'right', not alignEnd() — a FIGURE column, and figures keep a fixed edge in both
      // directions so digits line up. See the note in src/i18n/physical.ts.
      cell: (c) => <div style={{ textAlign: 'right' }}>{fmtNumber(c.getValue())}</div>,
      // fmtNumber groups thousands, so a salary line prints "1,500" where the row holds 1500.
      meta: { filterText: fmtNumber },
    }),
    columnHelper.accessor('currencyCode', {
      header: 'Currency',
      size: 100,
      meta: { filterOptions: optionsFrom(rows, (r) => r.currencyCode) },
    }),
    columnHelper.accessor('effectiveFrom', {
      header: 'From',
      size: 130,
      cell: (c) => fmtDate(c.getValue()),
      meta: { filterText: fmtDate },
    }),
    // An open-ended component has no end date and prints blank; matching the blank is what a
    // filter on this column can usefully do beyond the dates themselves.
    columnHelper.accessor('effectiveTo', {
      header: 'To',
      size: 130,
      cell: (c) => fmtDate(c.getValue()),
      meta: { filterText: fmtDate },
    }),
    columnHelper.display({
      id: 'actions',
      header: 'Actions',
      size: 110,
      cell: (c) => {
        const row = c.row.original
        return (
          <div className="grid-actions">
            <ActionIcon
              variant="subtle"
              title="Edit"
              aria-label="Edit"
              onClick={() => openEdit(row)}
            >
              <IconPencil size={16} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              color="red"
              title="Delete"
              aria-label="Delete"
              onClick={() => void handleDelete(row)}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </div>
        )
      },
    }),
  ]

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    // This tab had no search box; the filter row is its only narrowing control.
    defaultColumn: { filterFn: gridFilterFn },
    getFilteredRowModel: getFilteredRowModel(),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // Sorting mode="multiple" on the source grid.
    enableMultiSort: true,
    getRowId: (r) => String(r.salaryComponentId),
  })

  if (loading) {
    return (
      <div className="page-loading">
        <Loader size={36} />
      </div>
    )
  }

  return (
    <div>
      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <div className="tab-toolbar">
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
          Add Component
        </Button>
      </div>

      <GridTable table={table} emptyText="No salary components yet." />

      <Modal
        opened={popupVisible}
        onClose={() => setPopupVisible(false)}
        title={editingId != null ? 'Edit Salary Component' : 'Add Salary Component'}
        size={460}
        centered
      >
        <div className="form-field">
          <label className="form-label">Component type</label>
          <Select
            data={componentTypes.map((t) => ({
              value: String(t.componentTypeId),
              label: t.name,
            }))}
            value={form.componentTypeId != null ? String(form.componentTypeId) : null}
            placeholder="Select type…"
            allowDeselect={false}
            disabled={saving || editingId != null}
            error={fieldErrors.componentTypeId}
            onChange={(v) =>
              setForm((f) => ({ ...f, componentTypeId: v != null ? Number(v) : null }))
            }
          />
        </div>

        <div className="form-grid">
          <div className="form-field">
            <label className="form-label">Amount</label>
            <NumberInput
              value={form.amount}
              min={0}
              disabled={saving}
              onChange={(v) =>
                setForm((f) => ({ ...f, amount: typeof v === 'number' ? v : 0 }))
              }
            />
          </div>

          <div className="form-field">
            <label className="form-label">Currency</label>
            <Select
              data={currencies.map((c) => ({
                value: c.currencyCode,
                label: c.currencyCode,
              }))}
              value={form.currencyCode || null}
              placeholder="Currency…"
              allowDeselect={false}
              disabled={saving}
              error={fieldErrors.currencyCode}
              onChange={(v) => setForm((f) => ({ ...f, currencyCode: v ?? '' }))}
            />
          </div>

          <div className="form-field">
            <label className="form-label">Effective from</label>
            {/* Required, so not clearable. State stays 'yyyy-MM-dd'. */}
            <DatePickerInput
              valueFormat="DD/MM/YYYY"
              leftSection={<IconCalendar size={14} />}
              value={form.effectiveFrom || null}
              disabled={saving}
              error={fieldErrors.effectiveFrom}
              onChange={(v) => setForm((f) => ({ ...f, effectiveFrom: v ?? '' }))}
            />
          </div>

          <div className="form-field">
            <label className="form-label">Effective to (optional)</label>
            {/* PORT NOTE: the DX showClearButton + "— open-ended —" placeholder is back as the
                picker's own clear button and placeholder. Empty means open-ended, so this one
                MUST be clearable — re-opening a closed component is a real edit. */}
            <DatePickerInput
              valueFormat="DD/MM/YYYY"
              leftSection={<IconCalendar size={14} />}
              clearable
              placeholder="— open-ended —"
              value={form.effectiveTo || null}
              disabled={saving}
              onChange={(v) => setForm((f) => ({ ...f, effectiveTo: v ?? '' }))}
            />
          </div>
        </div>

        <div className="form-actions">
          <Button variant="default" onClick={() => setPopupVisible(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Modal>

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
