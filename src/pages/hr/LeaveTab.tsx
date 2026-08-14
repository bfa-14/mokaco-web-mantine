import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState, Table as TableInstance } from '@tanstack/react-table'
import { ActionIcon, Button, Loader, Modal, NumberInput, Select, Table, Textarea } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconCalendar, IconPlus, IconPrinter, IconTrash } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { leaveLedgerService, leaveTypesService } from '../../services/hrService'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import type { LeaveBalance, LeaveLedgerEntry, LeaveType } from '../../types/hr'

const MOVEMENT_TYPES = ['Accrual', 'Usage', 'CarryOver', 'Adjustment']

interface FormState {
  leaveTypeId: number | null
  movementType: string
  days: number
  effectiveDate: string
  note: string
}

const EMPTY: FormState = {
  leaveTypeId: null,
  movementType: 'Accrual',
  days: 0,
  effectiveDate: '',
  note: '',
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

/** DX format="#,##0.##" — grouped thousands, up to two decimals. */
const fmtNum = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 })

/** DX dataType="date" — the API timestamp shown as its plain date. */
const fmtDate = (v: string | null | undefined) => (v ? v.slice(0, 10) : '')

/* PORT NOTE: the two DevExtreme DataGrids are TanStack Table + Mantine Table, per RequestsGrid.tsx.
   The source grids declared no pager, search or export, so none is added; showBorders →
   withTableBorder, rowAlternationEnabled → striped, and the Ledger keeps its multi-column sort.
   Both carry the DX FilterRow, which is why the filter strip lives in this shared shell rather
   than being written twice. */
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

const balanceHelper = createColumnHelper<LeaveBalance>()
const ledgerHelper = createColumnHelper<LeaveLedgerEntry>()

export function LeaveTab({ employeeId }: { employeeId: number }) {
  const navigate = useNavigate()
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [ledger, setLedger] = useState<LeaveLedgerEntry[]>([])
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [popupVisible, setPopupVisible] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  /* PORT NOTE: DX ValidationGroup/RequiredRule → the same required checks, message for message,
     run in submit() and shown as field-level errors. */
  const [fieldErrors, setFieldErrors] = useState<{
    leaveTypeId?: string
    effectiveDate?: string
  }>({})

  const [balanceSorting, setBalanceSorting] = useState<SortingState>([])
  const [ledgerSorting, setLedgerSorting] = useState<SortingState>([])
  const [balanceFilters, setBalanceFilters] = useState<ColumnFiltersState>([])
  const [ledgerFilters, setLedgerFilters] = useState<ColumnFiltersState>([])

  /** The confirm dialog currently on screen, if any — see ConfirmState. */
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  const askConfirm = (message: React.ReactNode, title: string): Promise<boolean> =>
    new Promise<boolean>((resolve) => setConfirmState({ title, message, resolve }))

  function settleConfirm(proceed: boolean) {
    confirmState?.resolve(proceed)
    setConfirmState(null)
  }

  const typeName = useMemo(() => {
    const map = new Map<number, string>()
    for (const t of leaveTypes) map.set(t.leaveTypeId, t.name)
    return (id: number) => map.get(id) ?? `#${id}`
  }, [leaveTypes])

  async function reload() {
    const [bal, led] = await Promise.all([
      leaveLedgerService.getBalance(employeeId),
      leaveLedgerService.getByEmployee(employeeId),
    ])
    setBalances(bal)
    setLedger(led)
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [bal, led, types] = await Promise.all([
          leaveLedgerService.getBalance(employeeId),
          leaveLedgerService.getByEmployee(employeeId),
          leaveTypesService.getAll().catch(() => [] as LeaveType[]),
        ])
        if (!cancelled) {
          setBalances(bal)
          setLedger(led)
          setLeaveTypes(types)
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

  function openPost() {
    setFieldErrors({})
    setForm({ ...EMPTY, leaveTypeId: leaveTypes[0]?.leaveTypeId ?? null })
    setPopupVisible(true)
  }

  async function submit() {
    /* The DX "Days is required" rule is not reproduced: the state coerces an empty box to 0, so
       that rule could never fire in the original either. */
    const errors: { leaveTypeId?: string; effectiveDate?: string } = {}
    if (form.leaveTypeId == null) errors.leaveTypeId = 'Leave type is required'
    if (!form.effectiveDate) errors.effectiveDate = 'Date is required'
    setFieldErrors(errors)
    if (errors.leaveTypeId || errors.effectiveDate) return
    setSaving(true)
    try {
      await leaveLedgerService.post({
        employeeId,
        leaveTypeId: form.leaveTypeId!,
        movementType: form.movementType,
        days: form.days,
        effectiveDate: form.effectiveDate,
        leaveRequestId: null,
        note: form.note.trim() || null,
      })
      notify('Movement posted.', 'success', 2000)
      setPopupVisible(false)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row: LeaveLedgerEntry) {
    const ok = await askConfirm(
      `Delete this ${row.movementType} movement of ${row.days} day(s)?`,
      'Confirm delete',
    )
    if (!ok) return
    try {
      await leaveLedgerService.remove(row.leaveLedgerId)
      notify('Deleted.', 'success', 2000)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    }
  }

  // Column defs are rebuilt per render on purpose — their cells close over typeName and
  // handleDelete, which follow the current employeeId. These tables are small.
  const balanceColumns = [
    // The accessor is the numeric type ID, so sorting stays stable; the filter offers — and
    // matches — the type NAMES the cell resolves them to.
    balanceHelper.accessor('leaveTypeId', {
      header: 'Leave Type',
      cell: (c) => typeName(c.row.original.leaveTypeId),
      meta: { filterText: typeName, filterOptions: optionsFrom(balances, (b) => typeName(b.leaveTypeId)) },
    }),
    balanceHelper.accessor('periodYearMonth', { header: 'Period', size: 120 }),
    // fmtNum groups thousands, so the printed figure differs from the raw one past 1,000.
    balanceHelper.accessor('accrued', {
      header: 'Accrued',
      cell: (c) => fmtNum(c.getValue()),
      meta: { filterText: fmtNum },
    }),
    balanceHelper.accessor('carriedOver', {
      header: 'Carried',
      cell: (c) => fmtNum(c.getValue()),
      meta: { filterText: fmtNum },
    }),
    balanceHelper.accessor('used', {
      header: 'Used',
      cell: (c) => fmtNum(c.getValue()),
      meta: { filterText: fmtNum },
    }),
    balanceHelper.accessor('remaining', {
      header: 'Remaining',
      cell: (c) => fmtNum(c.getValue()),
      meta: { filterText: fmtNum },
    }),
  ]

  const ledgerColumns = [
    ledgerHelper.accessor('effectiveDate', {
      header: 'Date',
      size: 120,
      cell: (c) => fmtDate(c.getValue()),
      meta: { filterText: fmtDate },
    }),
    ledgerHelper.accessor('periodYearMonth', { header: 'Period', size: 110 }),
    ledgerHelper.accessor('leaveTypeId', {
      header: 'Type',
      cell: (c) => typeName(c.row.original.leaveTypeId),
      meta: { filterText: typeName, filterOptions: optionsFrom(ledger, (l) => typeName(l.leaveTypeId)) },
    }),
    ledgerHelper.accessor('movementType', {
      header: 'Movement',
      size: 120,
      meta: { filterOptions: MOVEMENT_TYPES },
    }),
    ledgerHelper.accessor('days', {
      header: 'Days',
      size: 90,
      cell: (c) => fmtNum(c.getValue()),
      meta: { filterText: fmtNum },
    }),
    ledgerHelper.accessor('note', { header: 'Note', meta: { noHeaderFilter: true } }),
    ledgerHelper.display({
      id: 'actions',
      header: 'Actions',
      size: 90,
      cell: (c) => (
        <ActionIcon
          variant="subtle"
          color="red"
          title="Delete"
          aria-label="Delete"
          onClick={() => void handleDelete(c.row.original)}
        >
          <IconTrash size={16} />
        </ActionIcon>
      ),
    }),
  ]

  const balanceTable = useReactTable({
    data: balances,
    columns: balanceColumns,
    state: { sorting: balanceSorting, columnFilters: balanceFilters },
    onSortingChange: setBalanceSorting,
    onColumnFiltersChange: setBalanceFilters,
    // Neither grid had a search box; the filter row is their only narrowing control.
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // The source balance grid used DX's default single-column sorting.
    enableMultiSort: false,
    getRowId: (r) => `${r.leaveTypeId}:${r.periodYearMonth}`,
  })

  const ledgerTable = useReactTable({
    data: ledger,
    columns: ledgerColumns,
    state: { sorting: ledgerSorting, columnFilters: ledgerFilters },
    onSortingChange: setLedgerSorting,
    onColumnFiltersChange: setLedgerFilters,
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // Sorting mode="multiple" on the source Ledger grid.
    enableMultiSort: true,
    getRowId: (r) => String(r.leaveLedgerId),
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
        <h3 className="tab-section-title" style={{ margin: 0, flex: 1 }}>
          Balance
        </h3>
        {/* Deep-link to the printable Leave Balance REPORT, pre-filled with THIS employee. It only
            navigates — the report page reads employeeId from the URL and runs itself, so the
            balances live in one place, not two. */}
        <Button
          variant="default"
          leftSection={<IconPrinter size={16} />}
          title="Open the printable leave-balance report for this employee."
          onClick={() =>
            navigate(`/reports/leave-balance?employeeId=${employeeId}`)
          }
        >
          Print balances
        </Button>
      </div>
      <GridTable table={balanceTable} emptyText="No leave balance yet." />

      <div className="tab-toolbar" style={{ marginTop: 20 }}>
        <h3 className="tab-section-title" style={{ margin: 0, flex: 1 }}>
          Ledger
        </h3>
        <Button leftSection={<IconPlus size={16} />} onClick={openPost}>
          Post Movement
        </Button>
      </div>

      <GridTable table={ledgerTable} emptyText="No movements yet." />

      <Modal
        opened={popupVisible}
        onClose={() => setPopupVisible(false)}
        title="Post Leave Movement"
        size={460}
        centered
      >
        <div className="form-grid">
          <div className="form-field">
            <label className="form-label">Leave type</label>
            <Select
              data={leaveTypes.map((t) => ({ value: String(t.leaveTypeId), label: t.name }))}
              value={form.leaveTypeId != null ? String(form.leaveTypeId) : null}
              placeholder="Select…"
              allowDeselect={false}
              disabled={saving}
              error={fieldErrors.leaveTypeId}
              onChange={(v) =>
                setForm((f) => ({ ...f, leaveTypeId: v != null ? Number(v) : null }))
              }
            />
          </div>

          <div className="form-field">
            <label className="form-label">Movement</label>
            <Select
              data={MOVEMENT_TYPES}
              value={form.movementType}
              allowDeselect={false}
              disabled={saving}
              onChange={(v) => setForm((f) => ({ ...f, movementType: v ?? '' }))}
            />
          </div>

          <div className="form-field">
            <label className="form-label">Days (− for usage)</label>
            <NumberInput
              value={form.days}
              disabled={saving}
              onChange={(v) =>
                setForm((f) => ({ ...f, days: typeof v === 'number' ? v : 0 }))
              }
            />
          </div>

          <div className="form-field">
            <label className="form-label">Effective date</label>
            {/* Required (the RequiredRule's replacement checks it), so not clearable. */}
            <DatePickerInput
              valueFormat="DD/MM/YYYY"
              leftSection={<IconCalendar size={14} />}
              value={form.effectiveDate || null}
              disabled={saving}
              error={fieldErrors.effectiveDate}
              onChange={(v) => setForm((f) => ({ ...f, effectiveDate: v ?? '' }))}
            />
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">Note (optional)</label>
          <Textarea
            value={form.note}
            minRows={2}
            disabled={saving}
            onChange={(e) => {
              const value = e.currentTarget.value
              setForm((f) => ({ ...f, note: value }))
            }}
          />
        </div>

        <div className="form-actions">
          <Button variant="default" onClick={() => setPopupVisible(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? 'Posting…' : 'Post'}
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
