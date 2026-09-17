import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState, Table as TableInstance } from '@tanstack/react-table'
import { ActionIcon, Button, Loader, NumberInput, Select, Table, Textarea } from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { DatePickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconAdjustments, IconCalendar, IconPlus, IconPrinter, IconTrash } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { leaveLedgerService, leaveTypesService } from '../../services/hrService'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { fmtDate, fmtNumber, fmtSigned } from './hrFormat'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import type { LeaveBalance, LeaveLedgerEntry, LeaveType } from '../../types/hr'
import { parseDecimal } from '../../components/numeric'
import type { NumberInputValue } from '../../components/numeric'

/** The movement an out-of-band balance correction is filed as — see AdjustBalanceModal. */
const ADJUSTMENT = 'Adjustment'

const MOVEMENT_TYPES = ['Accrual', 'Usage', 'CarryOver', ADJUSTMENT]

function todayYMD(): string {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

interface FormState {
  leaveTypeId: number | null
  movementType: string
  /** As the box hands it over ("0." on the way to 0.5) — coerced in submit. See numeric.ts. */
  days: NumberInputValue
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

/* The formatters are SHARED and null-safe — see hrFormat.ts. They used to be declared here as
   `(v: number) => v.toLocaleString(…)`, which threw the moment the API had not caught up with a
   new column and sent undefined for it. */

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

/**
 * ADJUST BALANCE — a correction to what the ledger says this person is owed.
 *
 * Deliberately NOT a second "Post Movement". That form can file any movement type on any date and
 * is the administrator's tool; this one asks only the three things a correction needs — which
 * leave, how many days, and WHY — and files them as an Adjustment dated today. The sign is the
 * whole interface: positive gives days back, negative takes them away, in halves because half days
 * are how leave is actually taken.
 *
 * THE NOTE IS REQUIRED, unlike on the movement form. The row lives in the ledger permanently and a
 * balance change nobody can explain a year later is worse than no correction at all — the note is
 * the audit trail, so it is a field, not an afterthought.
 *
 * Mounted only while open, so every opening starts from an empty form with no error left over.
 */
function AdjustBalanceModal({
  employeeId,
  leaveTypes,
  onClose,
  onPosted,
}: {
  employeeId: number
  leaveTypes: LeaveType[]
  onClose: () => void
  /** Refetches the balances and the ledger. Runs after the post, and cannot fail the save. */
  onPosted: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [leaveTypeId, setLeaveTypeId] = useState<number | null>(
    leaveTypes[0]?.leaveTypeId ?? null,
  )
  /** '' while the box is empty — an empty box is not the same answer as zero. */
  const [days, setDays] = useState<number | string>('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<{
    leaveTypeId?: string
    days?: string
    note?: string
  }>({})
  /** The API's own refusal text, kept in the form rather than a toast so it sits beside the
      fields that caused it and survives long enough to read. */
  const [serverError, setServerError] = useState<string | null>(null)

  const effectiveDate = todayYMD()
  const trimmedNote = note.trim()

  async function submit() {
    const parsedDays = typeof days === 'number' ? days : Number(days)
    const errors: { leaveTypeId?: string; days?: string; note?: string } = {}
    if (leaveTypeId == null) errors.leaveTypeId = t('hr.leaveAdjust.leaveTypeRequired')
    // Zero is refused rather than posted: it would write a permanent row that changes nothing,
    // and it is far more likely to be an unfilled box than a deliberate answer.
    if (days === '' || !Number.isFinite(parsedDays) || parsedDays === 0) {
      errors.days = t('hr.leaveAdjust.daysRequired')
    }
    if (!trimmedNote) errors.note = t('hr.leaveAdjust.noteRequired')
    setFieldErrors(errors)
    if (errors.leaveTypeId || errors.days || errors.note) return

    setServerError(null)
    setSaving(true)
    try {
      await leaveLedgerService.post({
        employeeId,
        leaveTypeId: leaveTypeId!,
        movementType: ADJUSTMENT,
        days: parsedDays,
        effectiveDate,
        // An adjustment answers to nobody's leave request — that is what makes it an adjustment.
        leaveRequestId: null,
        note: trimmedNote,
      })
    } catch (err) {
      // A 400 here is the stored procedure's refusal (a closed period, a type this employee has no
      // policy for). Its text is the whole value, so it is shown verbatim and the form stays open.
      setServerError(getErrorMessage(err))
      return
    } finally {
      setSaving(false)
    }

    // Saved. Nothing past this point can undo it, so the form closes and both lists are refetched —
    // the returned day has to appear in the balance without anybody reloading the page.
    notify(t('hr.leaveAdjust.posted'), 'success', 2000)
    onClose()
    await onPosted()
  }

  return (
    <Modal opened onClose={onClose} title={t('hr.leaveAdjust.title')} size={460} centered>
      <p className="hint" style={{ marginTop: 0 }}>
        {t('hr.leaveAdjust.intro')}
      </p>

      <div className="form-field">
        <label className="form-label" htmlFor="adjust-leave-type">
          {t('hr.leaveAdjust.leaveType')}
        </label>
        <Select
          id="adjust-leave-type"
          data={leaveTypes.map((x) => ({ value: String(x.leaveTypeId), label: x.name }))}
          value={leaveTypeId != null ? String(leaveTypeId) : null}
          placeholder={t('hr.leaveAdjust.leaveTypePlaceholder')}
          allowDeselect={false}
          disabled={saving || leaveTypes.length === 0}
          error={fieldErrors.leaveTypeId}
          onChange={(v) => setLeaveTypeId(v != null ? Number(v) : null)}
        />
        {leaveTypes.length === 0 && (
          <p className="hint" style={{ marginTop: 6 }}>
            {t('hr.leaveAdjust.noTypes')}
          </p>
        )}
      </div>

      <div className="form-field">
        <label className="form-label" htmlFor="adjust-days">
          {t('hr.leaveAdjust.days')}
        </label>
        <NumberInput
          id="adjust-days"
          value={days}
          step={0.5}
          decimalScale={2}
          // Negative IS the interface — it is how days are taken away.
          allowNegative
          disabled={saving}
          error={fieldErrors.days}
          w={160}
          onChange={setDays}
        />
        <p className="hint" style={{ marginTop: 6 }}>
          {t('hr.leaveAdjust.daysHint')}
        </p>
      </div>

      <div className="form-field">
        <label className="form-label" htmlFor="adjust-note">
          {t('hr.leaveAdjust.note')}
        </label>
        <Textarea
          id="adjust-note"
          value={note}
          minRows={3}
          autosize
          disabled={saving}
          error={fieldErrors.note}
          onChange={(e) => {
            const value = e.currentTarget.value
            setNote(value)
          }}
        />
        <p className="hint" style={{ marginTop: 6 }}>
          {t('hr.leaveAdjust.noteHint')}
        </p>
      </div>

      <p className="hint">{t('hr.leaveAdjust.effectiveHint', { date: effectiveDate })}</p>

      {serverError && (
        <div className="alert alert--error" role="alert">
          {serverError}
        </div>
      )}

      <div className="form-actions">
        <Button variant="default" onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void submit()} disabled={saving || leaveTypes.length === 0}>
          {saving ? t('hr.leaveAdjust.posting') : t('hr.leaveAdjust.post')}
        </Button>
      </div>
    </Modal>
  )
}

export function LeaveTab({ employeeId }: { employeeId: number }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  /* Reading a balance is EMP_VIEW, which opened this profile. CHANGING one is EMP_EDIT — the API
     enforces that either way, so this only keeps an action nobody may take off the screen. */
  const { hasPermission } = useAuth()
  const canEdit = hasPermission(PERMISSION.EMP_EDIT)
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [ledger, setLedger] = useState<LeaveLedgerEntry[]>([])
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [popupVisible, setPopupVisible] = useState(false)
  const [adjustVisible, setAdjustVisible] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  /* PORT NOTE: DX ValidationGroup/RequiredRule → the same required checks, message for message,
     run in submit() and shown as field-level errors. */
  const [fieldErrors, setFieldErrors] = useState<{
    leaveTypeId?: string
    effectiveDate?: string
    days?: string
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

  /** reload(), for callers whose own work already succeeded — a failed refetch is reported, not
      thrown back at them as though the save had failed. */
  async function refresh() {
    try {
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    }
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
    const errors: { leaveTypeId?: string; effectiveDate?: string; days?: string } = {}
    // Coerced HERE, once — the box holds raw text until now so a half day can actually be typed.
    const days = parseDecimal(form.days)
    if (form.leaveTypeId == null) errors.leaveTypeId = 'Leave type is required'
    if (days == null) errors.days = 'Days must be a number'
    if (!form.effectiveDate) errors.effectiveDate = 'Date is required'
    setFieldErrors(errors)
    if (errors.leaveTypeId || errors.effectiveDate || days == null) return
    setSaving(true)
    try {
      await leaveLedgerService.post({
        employeeId,
        leaveTypeId: form.leaveTypeId!,
        movementType: form.movementType,
        days,
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
    // fmtNumber groups thousands, so the printed figure differs from the raw one past 1,000.
    balanceHelper.accessor('accrued', {
      header: 'Accrued',
      cell: (c) => fmtNumber(c.getValue()),
      meta: { filterText: fmtNumber },
    }),
    balanceHelper.accessor('carriedOver', {
      header: 'Carried',
      cell: (c) => fmtNumber(c.getValue()),
      meta: { filterText: fmtNumber },
    }),
    balanceHelper.accessor('used', {
      header: 'Used',
      cell: (c) => fmtNumber(c.getValue()),
      meta: { filterText: fmtNumber },
    }),
    /* BETWEEN USED AND REMAINING, so the row reads as the sum it is:
       remaining = accrued + carried − used + adjusted. Without it a corrected balance looks like
       arithmetic that does not work, which is how a real adjustment gets reported as a bug.
       Signed both ways — fmtSigned keeps the + so "gave days back" is visible at a glance.

       `?? 0` AT THE ACCESSOR, not just inside the formatter. This column shipped ahead of the
       server field, so every row arrives without it until the API catches up; reading 0 here means
       the grid renders — and SORTS and FILTERS — as though nothing had been adjusted, which is the
       true answer, rather than throwing on the first cell and taking the whole profile down. */
    balanceHelper.accessor((row) => row.adjusted ?? 0, {
      id: 'adjusted',
      header: t('hr.leaveBalance.adjusted'),
      cell: (c) => fmtSigned(c.getValue()),
      meta: { filterText: fmtSigned },
    }),
    balanceHelper.accessor('remaining', {
      header: 'Remaining',
      cell: (c) => fmtNumber(c.getValue()),
      meta: { filterText: fmtNumber },
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
      cell: (c) => fmtNumber(c.getValue()),
      meta: { filterText: fmtNumber },
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
        {canEdit && (
          <Button
            leftSection={<IconAdjustments size={16} />}
            title={t('hr.leaveAdjust.intro')}
            onClick={() => setAdjustVisible(true)}
          >
            {t('hr.leaveAdjust.action')}
          </Button>
        )}
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
              step={0.5}
              decimalScale={2}
              allowNegative
              disabled={saving}
              error={fieldErrors.days}
              onChange={(v) => setForm((f) => ({ ...f, days: v }))}
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

      {adjustVisible && (
        <AdjustBalanceModal
          employeeId={employeeId}
          leaveTypes={leaveTypes}
          onClose={() => setAdjustVisible(false)}
          onPosted={refresh}
        />
      )}

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
