/* src/pages/payroll/PayrollRunsPage.tsx */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Pagination, Radio, Select, Table, Textarea } from '@mantine/core'
import { MonthPickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconCalendar, IconClock, IconPlus, IconRefresh } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import { monthFromPicker, monthToPicker } from '../../components/date/pickerValue'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { useLive } from '../../live/useLive'
import { useLiveEnabled } from '../../live/useLiveSettings'
import { payrollRunsService } from '../../services/payrollService'
import { exitPermissionsService } from '../../services/workflowService'
import { leaveTypesService } from '../../services/hrService'
import type { AttendanceReadiness, PayrollRunListItem, PayrollRunType } from '../../types/payroll'
import type { LeaveType } from '../../types/hr'
import './payroll.css'

const EMPTY_RUNS: PayrollRunListItem[] = []
const fmt = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * The two kinds of run, as the picker offers them.
 *
 * Module-level so the radio group's dataSource is referentially stable — a fresh array on every
 * render would rebuild the widget whenever anything else in the panel changed.
 */
const RUN_TYPES: { value: PayrollRunType; text: string }[] = [
  { value: 'Primary', text: 'Primary' },
  { value: 'Supplemental', text: 'Supplemental (off-cycle)' },
]

/** Each readiness count links to the page where it gets fixed. */
const READINESS_ITEMS: { key: keyof AttendanceReadiness; label: string; to: string }[] = [
  { key: 'unprocessedPunches', label: 'Unprocessed punches', to: '/attendance/import' },
  { key: 'unresolvedPinPunches', label: 'Unresolved PINs', to: '/attendance/unresolved' },
  { key: 'openAnomalies', label: 'Open anomalies', to: '/attendance/anomalies' },
  { key: 'pendingCorrections', label: 'Pending corrections', to: '/attendance/corrections' },
  { key: 'rosteredDaysWithNoRecord', label: 'Rostered days with no record', to: '/attendance/daily' },
  { key: 'undecidedExitVariances', label: 'Undecided exit variances', to: '/attendance/exit-variances' },
]

const columnHelper = createColumnHelper<PayrollRunListItem>()
const PAGE_SIZES = ['12', '24', '48']

/**
 * PAYROLL RUNS — the month list, and the one gate that matters before a run exists:
 * attendance readiness. The Create button is not disabled by policy hidden in the UI;
 * it is disabled by six visible counts, each a link to the page that clears it.
 */
export default function PayrollRunsPage() {
  const navigate = useNavigate()
  /* PAYROLL_VIEW OPENS THIS PAGE; CREATING A RUN IS PAYROLL_RUN. The two used to be one code, so
     anybody who needed to read a month's figures was also trusted to start payroll for it. The list
     below stays fully readable without the write trust — only the acts disappear. */
  const { hasPermission } = useAuth()
  const canRun = hasPermission(PERMISSION.PAYROLL_RUN)
  const [runs, setRuns] = useState<PayrollRunListItem[]>(EMPTY_RUNS)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [period, setPeriod] = useState<string>(currentPeriod())
  const [runType, setRunType] = useState<PayrollRunType>('Primary')
  const [notes, setNotes] = useState('')
  const [readiness, setReadiness] = useState<{ key: string; data: AttendanceReadiness } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  /* ── period close: posting converted exit-permission minutes as leave ── */
  const [closeOpen, setCloseOpen] = useState(false)
  const [closePeriod, setClosePeriod] = useState<string>(currentPeriod())
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [closeLeaveTypeId, setCloseLeaveTypeId] = useState<number | null>(null)
  const [posting, setPosting] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    payrollRunsService
      .getList()
      .then(setRuns)
      .catch((e) => setError(getErrorMessage(e)))
      .finally(() => setLoading(false))
  }, [])
  // The FIRST load is its own effect rather than a call to `refresh`, because refresh opens with a
  // synchronous setLoading(true) — a cascading render when it happens in an effect body, and
  // redundant besides: `loading` already starts true. Here every setState is inside a promise
  // callback, which is the shape the rule is asking for.
  useEffect(() => {
    let cancelled = false
    payrollRunsService
      .getList()
      .then((r) => { if (!cancelled) setRuns(r) })
      .catch((e) => { if (!cancelled) setError(getErrorMessage(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // LIVE: a run created, generated, approved or cancelled by anyone changes this list.
  useLive(['payroll'], refresh, useLiveEnabled('payroll'))

  // Leave types, for the period-close picker. Fetched only when the panel opens — it is a rare act,
  // and every other visit to this page should not pay for it.
  useEffect(() => {
    if (!closeOpen || leaveTypes.length > 0) return
    let cancelled = false
    leaveTypesService
      .getAll()
      .then((t) => {
        if (cancelled) return
        setLeaveTypes(t)
        // Annual is where converted exit time comes from in practice, so it opens on it when there
        // is one — but it stays a choice, because the setting that names it is not read here.
        const annual = t.find((x) => x.name.toLowerCase().includes('annual'))
        setCloseLeaveTypeId(annual?.leaveTypeId ?? t[0]?.leaveTypeId ?? null)
      })
      .catch(() => { /* the picker stays empty and the button stays held; nothing else breaks */ })
    return () => { cancelled = true }
  }, [closeOpen, leaveTypes.length])

  /**
   * POSTS THE CONVERTED EXIT MINUTES for a month as leave usage.
   *
   * Nothing schedules this. The nightly job pushes approved permissions into the attendance day, but
   * the LEAVE side is a period-close act — so until somebody runs it, exit time marked "convert to
   * leave" is never actually deducted from anybody's balance. Idempotent, so a second run reports 0
   * rather than double-posting.
   */
  const postExitLeave = useCallback(async () => {
    if (!closePeriod || closeLeaveTypeId == null) return
    setPosting(true)
    try {
      const result = await exitPermissionsService.postLeave(closePeriod, closeLeaveTypeId)
      setCloseOpen(false)
      notifications.show({
        message:
          result.leaveMovementsPosted > 0
            ? `Posted ${result.leaveMovementsPosted} leave movement(s) for ${closePeriod}.`
            : `Nothing left to post for ${closePeriod} — every converted exit permission was already done.`,
        color: result.leaveMovementsPosted > 0 ? 'green' : 'blue',
        autoClose: 5000,
      })
    } catch (e) {
      notifications.show({ message: getErrorMessage(e), color: 'red', autoClose: 7000 })
    } finally {
      setPosting(false)
    }
  }, [closePeriod, closeLeaveTypeId])

  /* readiness for the chosen period, tagged so a period change drops stale data.
     NOT FETCHED FOR A SUPPLEMENTAL: attendance completeness is the primary run's gate. An
     off-cycle run pays adjustments that were already signed for, and asking whether last month's
     punches are all processed would be answering a question nobody asked. */
  useEffect(() => {
    if (!creating || !period || runType === 'Supplemental') return
    let cancelled = false
    payrollRunsService
      .readiness(period)
      .then((data) => {
        if (!cancelled) setReadiness({ key: period, data })
      })
      .catch((e) => {
        if (!cancelled) setError(getErrorMessage(e))
      })
    return () => {
      cancelled = true
    }
  }, [creating, period, runType])

  const ready = readiness?.key === period ? readiness.data : null

  /** The picker hands back 'YYYY-MM-DD'; the run's period is 'yyyy-MM'. Empty is ignored — the
   *  form always names a month, exactly as the native input's slice always produced one. */
  const onPeriodChanged = useCallback((value: string | null) => {
    const s = monthFromPicker(value)
    if (!s) return
    setPeriod((prev) => (prev === s ? prev : s))
  }, [])

  const create = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const r = await payrollRunsService.create({
        periodYearMonth: period,
        notes: notes.trim() || null,
        runType,
      })
      navigate(`/payroll/runs/${r.payrollRunId}`)
    } catch (e) {
      // The procedure's refusal, verbatim — and for a supplemental this is the ONLY gate the user
      // sees: "the primary is not locked yet", "nothing for a supplemental to pay", "one open
      // supplemental already". Each names its own cause better than a pre-check could.
      setError(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }, [period, notes, runType, navigate])

  const statusCell = useCallback((s: string) => {
    const cls =
      s === 'Approved' ? 'pr-chip pr-chip-approved'
      : s === 'Review' ? 'pr-chip pr-chip-review'
      : s === 'Cancelled' ? 'pr-chip pr-chip-cancelled'
      : 'pr-chip'
    return <span className={cls}>{s === 'Approved' ? '🔒 Approved' : s}</span>
  }, [])

  /** The period, with the off-cycle runs saying so — two runs can share a month otherwise. */
  const periodCell = useCallback((r: PayrollRunListItem) => {
    return (
      <span>
        {r.periodYearMonth}
        {r.runType === 'Supplemental' && (
          <>
            {' '}
            <span className="pr-chip">Supplemental</span>
          </>
        )}
      </span>
    )
  }, [])

  const grid = useMemo(() => runs, [runs])

  const columns = useMemo(
    () => [
      // The cell appends a "Supplemental" chip, so a search for "supplemental" has to reach it —
      // the raw 'yyyy-MM' alone would never match the word the reader can see.
      columnHelper.accessor('periodYearMonth', {
        header: 'Period',
        size: 190,
        cell: (info) => periodCell(info.row.original),
        meta: { filterText: (v, r) =>
          r.runType === 'Supplemental' ? `${v} Supplemental` : v },
      }),
      // Approved prints with a padlock glyph in front of it, so the dropdown offers the statuses
      // present and matches on the raw code behind them rather than on the decorated label.
      columnHelper.accessor('status', {
        header: 'Status',
        size: 130,
        cell: (info) => statusCell(info.getValue()),
        meta: { filterOptions: optionsFrom(grid, (r) => r.status) },
      }),
      columnHelper.accessor('payslipCount', { header: 'Payslips', size: 90 }),
      columnHelper.accessor('totalNetPrimary', {
        header: 'Total net (≈)',
        cell: (info) => <span>≈ {fmt(info.getValue())}</span>,
        meta: { filterText: fmt },
      }),
      columnHelper.accessor('createdBy', { header: 'Created by', size: 130 }),
      columnHelper.accessor('approvedBy', { header: 'Approved by', size: 130 }),
      // An unlocked run prints nothing here, so an empty cell is genuinely empty rather than a
      // formatted null — matching the printed value keeps that true.
      columnHelper.accessor('lockedAt', {
        header: 'Locked',
        size: 150,
        cell: (info) => {
          const v = info.getValue()
          return v ? new Date(v).toLocaleString() : ''
        },
        meta: { filterText: (v) =>
          v ? new Date(v).toLocaleString() : '' },
      }),
    ],
    // `grid` only feeds the Status dropdown's option list.
    [periodCell, statusCell, grid],
  )

  const table = useReactTable({
    data: grid,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    // This page had no search box; the filter row is its only narrowing control.
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 12 } },
    getRowId: (r) => String(r.payrollRunId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  // The count under the pager must follow the filter row, not the raw load.
  const total = table.getFilteredRowModel().rows.length

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Payroll runs</h1>
          <p className="page-subtitle">One run per month. Approved runs are locked for ever.</p>
        </div>
        <div className="page-head-actions">
          <ActionIcon variant="default" size="lg" aria-label="Refresh" onClick={refresh}>
            <IconRefresh size={16} />
          </ActionIcon>
          {/* A period-close chore rather than a run: nothing schedules it, and skipping it leaves
              converted exit time never deducted from anybody's leave balance. It writes the leave
              ledger for a payroll period, so it belongs to whoever runs payroll. */}
          {canRun && (
            <Button
              variant="default"
              leftSection={<IconClock size={16} />}
              onClick={() => setCloseOpen((v) => !v)}
            >
              Post exit-permission leave
            </Button>
          )}
          {canRun && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating((v) => !v)}>
              New payroll run
            </Button>
          )}
        </div>
      </div>

      {closeOpen && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-title">Post exit-permission leave</div>
          <p className="hint" style={{ marginTop: 0 }}>
            Exit permissions marked “convert to leave” are applied to the attendance day by the
            nightly job, but the leave itself is only deducted here. Run this once the month's
            permissions are settled — running it twice is safe and posts nothing the second time.
          </p>
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label">Period</label>
              {/* Both period fields name the month being acted on, so neither is clearable —
                  the state stays 'yyyy-MM' and the API payload is unchanged. */}
              <MonthPickerInput
                valueFormat="MMMM YYYY"
                leftSection={<IconCalendar size={14} />}
                value={monthToPicker(closePeriod)}
                disabled={posting}
                onChange={(v) => {
                  const month = monthFromPicker(v)
                  if (month) setClosePeriod(month)
                }}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Deduct from</label>
              <Select
                data={leaveTypes.map((lt) => ({ value: String(lt.leaveTypeId), label: lt.name }))}
                value={closeLeaveTypeId != null ? String(closeLeaveTypeId) : null}
                allowDeselect={false}
                disabled={posting}
                onChange={(v) => setCloseLeaveTypeId(v != null ? Number(v) : null)}
              />
            </div>
          </div>
          <div className="pr-actions">
            <Button
              disabled={posting || !closePeriod || closeLeaveTypeId == null}
              onClick={() => void postExitLeave()}
            >
              {posting ? 'Posting…' : 'Post leave usage'}
            </Button>
            <Button variant="subtle" disabled={posting} onClick={() => setCloseOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <PageHelp>
        A run freezes the exchange rate, builds one payslip per employee, and locks on
        approval. Mistakes found after the lock become adjustments in the next period.
      </PageHelp>

      {creating && (
        <div className="pr-create-panel">
          <div className="form-field">
            <label className="form-label">Kind of run</label>
            <Radio.Group
              value={runType}
              onChange={(v) => setRunType((v as PayrollRunType) ?? 'Primary')}
            >
              <Group gap="lg">
                {RUN_TYPES.map((rt) => (
                  <Radio key={rt.value} value={rt.value} label={rt.text} disabled={saving} />
                ))}
              </Group>
            </Radio.Group>
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label">Period</label>
              <MonthPickerInput
                valueFormat="MMMM YYYY"
                leftSection={<IconCalendar size={14} />}
                value={monthToPicker(period)}
                disabled={saving}
                onChange={onPeriodChanged}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Notes <span className="form-optional">(optional)</span></label>
              <Textarea value={notes} minRows={1} disabled={saving}
                onChange={(e) => setNotes(e.currentTarget.value)} />
            </div>
          </div>

          {/* A supplemental has no readiness gate — it pays what was already signed for. The panel
              is replaced by the one sentence that says what this run IS, so the absence of the
              six counts reads as deliberate rather than as something that failed to load. */}
          {runType === 'Supplemental' && (
            <div className="pr-ready">
              <div className="pr-ready-verdict">
                Pays approved, unconsumed adjustments for the period. Possible only after the
                primary is locked.
              </div>
            </div>
          )}

          {/* the gate, visible */}
          {runType === 'Primary' && ready && (
            <div className={ready.isReady ? 'pr-ready pr-ready-ok' : 'pr-ready pr-ready-bad'}>
              {READINESS_ITEMS.map((it) => {
                const n = ready[it.key] as number
                return (
                  <span key={it.key} className={n > 0 ? 'pr-ready-item pr-ready-item-bad' : 'pr-ready-item'}>
                    {n > 0 ? <Link to={it.to}>{it.label}: {n}</Link> : <>{it.label}: 0</>}
                  </span>
                )
              })}
              <div className="pr-ready-verdict">
                {ready.isReady
                  ? 'Attendance is ready — the run can be created.'
                  : 'Attendance is not ready — every count above must reach zero first.'}
              </div>
            </div>
          )}

          {error && <div className="wf-balance-warn">{error}</div>}
          {/* Readiness governs Create for a PRIMARY only. A supplemental is enabled straight away
              and let through to the procedure, which owns its three refusals — a client-side
              pre-check would be a fourth opinion about rules it cannot see. */}
          <Button
            disabled={saving || (runType === 'Primary' && (!ready || !ready.isReady))}
            onClick={() => void create()}
          >
            {saving ? 'Creating…' : `Create ${runType === 'Supplemental' ? 'supplemental' : 'run'} for ${period}`}
          </Button>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <Table highlightOnHover withColumnBorders={false} verticalSpacing="xs" fz="sm">
          <Table.Thead>
            {table.getHeaderGroups().map((hg) => (
              <Table.Tr key={hg.id}>
                {hg.headers.map((header) => (
                  <Table.Th
                    key={header.id}
                    style={{
                      width: header.column.columnDef.size,
                      cursor: 'pointer',
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
                    {loading ? 'Loading…' : 'No payroll runs yet.'}
                  </div>
                </Table.Td>
              </Table.Tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <Table.Tr
                  key={row.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/payroll/runs/${row.original.payrollRunId}`)}
                >
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

        <Group justify="space-between" p="xs">
          <span className="hint" style={{ margin: 0 }}>
            {total === 0 ? 0 : pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, total)} of {total}
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
    </div>
  )
}
