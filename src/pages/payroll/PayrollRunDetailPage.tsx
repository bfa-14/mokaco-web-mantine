/* src/pages/payroll/PayrollRunDetailPage.tsx */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Modal, Pagination, Select, Table, Textarea, TextInput } from '@mantine/core'
import { IconRefresh, IconSearch } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { useLive } from '../../live/useLive'
import { useLiveEnabled } from '../../live/useLiveSettings'
import { adjustmentsService, payrollRunsService } from '../../services/payrollService'
import type { PayrollAdjustment, PayrollRunDetail, PayslipRow } from '../../types/payroll'
import './payroll.css'

const EMPTY_SLIPS: PayslipRow[] = []
const NO_ADJUSTMENTS: PayrollAdjustment[] = []
const fmt = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const columnHelper = createColumnHelper<PayslipRow>()
const PAGE_SIZES = ['25', '50', '100']

/**
 * ONE RUN — the working surface. What it can DO is decided entirely by status:
 * a Draft generates and cancels; a Review regenerates and approves; an Approved
 * run shows NO mutation controls at all. Not disabled ones — none. A locked
 * month offering greyed-out "Regenerate" would whisper that regenerating is a
 * thing that happens to locked months. It is not.
 */
export default function PayrollRunDetailPage() {
  const { id } = useParams()
  const runId = Number(id)
  const navigate = useNavigate()
  /* THREE TRUSTS ON ONE PAGE. PAYROLL_VIEW got the reader in; generating and cancelling are
     PAYROLL_RUN; approving — which locks the month for ever — is PAYROLL_APPROVE. They are separate
     codes because they are separate acts: the person who prepares the figures is not always the
     person who signs them off, and this page is where that separation either holds or does not. */
  const { hasPermission } = useAuth()
  const canRun = hasPermission(PERMISSION.PAYROLL_RUN)
  const canApprove = hasPermission(PERMISSION.PAYROLL_APPROVE)

  const [detail, setDetail] = useState<PayrollRunDetail | null>(null)
  const [slips, setSlips] = useState<PayslipRow[]>(EMPTY_SLIPS)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmApprove, setConfirmApprove] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [warningsOnly, setWarningsOnly] = useState(false)
  /** Adjustments aimed at this period. Fetched only while the run is still open — see below. */
  const [adjustments, setAdjustments] = useState<PayrollAdjustment[]>(NO_ADJUSTMENTS)
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const refresh = useCallback(() => {
    if (!runId) return
    Promise.all([payrollRunsService.get(runId), payrollRunsService.getPayslips(runId)])
      .then(([d, s]) => {
        setDetail(d)
        setSlips(s)
      })
      .catch((e) => setError(getErrorMessage(e)))
  }, [runId])
  useEffect(refresh, [refresh])

  // LIVE: another user regenerating or approving this run changes every total on the page. The
  // pending-adjustments banner re-derives from the same refetch, so it clears itself too.
  useLive(['payroll'], refresh, useLiveEnabled('payroll'))

  const h = detail?.header ?? null
  const t = detail?.totals ?? null

  const act = useCallback(
    async (fn: () => Promise<unknown>, closeDialogs = true) => {
      setBusy(true)
      setError(null)
      try {
        await fn()
        if (closeDialogs) {
          setConfirmApprove(false)
          setCancelOpen(false)
        }
        refresh()
      } catch (e) {
        setError(getErrorMessage(e)) // procedure refusals verbatim
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const gridData = useMemo(
    () => (warningsOnly ? slips.filter((s) => s.notes && s.notes.trim() !== '') : slips),
    [slips, warningsOnly],
  )

  /* ── signed corrections that the payslips have not caught up with ──────────
   *
   * A payroll adjustment is created by the Owner's signature, NOT by the run — so a correction can
   * be approved at any moment, including the moment after this run was generated. Nothing breaks
   * when that happens: the money is simply not in the payslips yet, and stays out of them until
   * somebody regenerates. That silence is the problem this banner exists to end.
   *
   * ONLY WHILE THE RUN IS OPEN. On an approved run the answer is a supplemental, and the lock
   * banner already points at it; a second amber panel telling the user to regenerate a locked run
   * would be advice they cannot take.
   */
  const period = h?.periodYearMonth ?? null
  const generatedAt = h?.generatedAt ?? null
  const isOpen = h?.status === 'Draft' || h?.status === 'Review'

  useEffect(() => {
    if (!period || !isOpen) return
    let cancelled = false
    adjustmentsService
      .getForPeriod(period)
      .then((rows) => { if (!cancelled) setAdjustments(rows) })
      // A failed read must not take the page down: the banner is an ADVISORY, and its absence is
      // the same as "nothing pending" from the user's point of view.
      .catch(() => { if (!cancelled) setAdjustments(NO_ADJUSTMENTS) })
    return () => { cancelled = true }
    // generatedAt is a dependency on purpose: regenerating restamps it, which re-runs this fetch,
    // which is how the banner clears itself after a rebuild rather than being cleared by hand.
  }, [period, isOpen, generatedAt])

  /**
   * WHY THE TIMESTAMP, AND NOT appliedToPayslipId ALONE.
   *
   * `appliedToPayslipId` is stamped at APPROVAL, not at generation — so every adjustment in an
   * open run has it null, including the ones already sitting in the payslips. It cannot tell the
   * two apart. What can, without a new endpoint, is when the row was created: an adjustment created
   * after the run was last generated is by definition not in that snapshot.
   *
   * Both sides are SYSUTCDATETIME() in SQL — PAYROLL_ADJUSTMENT.CreatedAt's default and the
   * UPDATE that stamps GeneratedAt — so this compares one clock against itself. If either ever
   * became a local-time call, this banner would start lying by the timezone offset.
   *
   * A run never generated has nothing in it, so everything unapplied is pending.
   */
  const pending = useMemo(() => {
    if (!isOpen) return NO_ADJUSTMENTS
    return adjustments.filter((a) => {
      if (a.appliedToPayslipId) return false
      if (!generatedAt) return true
      return new Date(a.createdAt).getTime() > new Date(generatedAt).getTime()
    })
  }, [adjustments, isOpen, generatedAt])

  const columns = useMemo(
    () => [
      columnHelper.accessor('employeeName', { header: 'Employee' }),
      columnHelper.accessor('branchName', {
        header: 'Branch',
        size: 120,
        meta: { filterOptions: optionsFrom(gridData, (r) => r.branchName) },
      }),
      columnHelper.accessor('paidDayFraction', { header: 'Days', size: 70 }),
      columnHelper.accessor('overtimeMinutes', { header: 'OT min', size: 80 }),
      // Money columns group thousands and print an em-dash for null, so all four match on what
      // they print — a payroll figure is always four digits or more, where raw and printed differ.
      columnHelper.accessor('grossUsd', {
        header: 'Gross USD',
        cell: (c) => fmt(c.getValue()),
        meta: { filterText: fmt },
      }),
      columnHelper.accessor('grossLbp', {
        header: 'Gross LBP',
        cell: (c) => fmt(c.getValue()),
        meta: { filterText: fmt },
      }),
      columnHelper.accessor('netUsd', {
        header: 'Net USD',
        cell: (c) => <b>{fmt(c.getValue())}</b>,
        meta: { filterText: fmt },
      }),
      columnHelper.accessor('netLbp', {
        header: 'Net LBP',
        cell: (c) => <b>{fmt(c.getValue())}</b>,
        meta: { filterText: fmt },
      }),
      columnHelper.display({
        id: 'warn',
        header: '⚠',
        size: 44,
        cell: (c) => {
          const n = c.row.original.notes
          return n && n.trim() !== '' ? <span title={n}>⚠</span> : null
        },
      }),
      // An UNPAID payslip prints a dash whatever paymentMethod holds, so the match has to be on
      // the printed value — filtering the raw column would claim people were paid who were not.
      columnHelper.accessor('paymentMethod', {
        header: 'Paid',
        size: 80,
        cell: (c) => {
          const d = c.row.original
          return d.paidAt ? `${d.paymentMethod}` : '—'
        },
        meta: { filterText: (v, row) =>
          row.paidAt ? String(v ?? '') : '—' },
      }),
    ],
    // `gridData` only feeds the Branch dropdown's option list.
    [gridData],
  )

  const table = useReactTable({
    data: gridData,
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
    initialState: { pagination: { pageSize: 25 } },
    getRowId: (r) => String(r.payslipId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const totalRows = table.getFilteredRowModel().rows.length

  if (!h) {
    return (
      <div>
        <div className="page-head"><h1 className="page-title">Payroll run</h1></div>
        {error ? <div className="wf-balance-warn">{error}</div> : <p>Loading…</p>}
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Payroll · {h.periodYearMonth}</h1>
          <p className="page-subtitle">
            <span className={
              h.status === 'Approved' ? 'pr-chip pr-chip-approved'
              : h.status === 'Review' ? 'pr-chip pr-chip-review'
              : h.status === 'Cancelled' ? 'pr-chip pr-chip-cancelled' : 'pr-chip'
            }>
              {h.status === 'Approved' ? '🔒 Approved' : h.status}
            </span>
            {'  '}· primary {h.primaryCurrency}
            {h.runType === 'Supplemental' && <> · Supplemental (off-cycle)</>}
            {h.generatedAt && <> · generated {new Date(h.generatedAt).toLocaleString()}</>}
          </p>
        </div>
        <div className="page-head-actions">
          <ActionIcon variant="default" size="lg" aria-label="Refresh" onClick={refresh}>
            <IconRefresh size={16} />
          </ActionIcon>
        </div>
      </div>

      {h.status === 'Approved' && (
        <div className="pr-lock-banner">
          Locked {h.lockedAt ? new Date(h.lockedAt).toLocaleString() : ''} by {h.approvedBy}. Nothing
          in this run can change. Corrections go to the next period as adjustments.{' '}
          {/* An adjustment is a request now, so this goes to the chain, not to a form. The period
              and the run being corrected are no longer prefilled — the request form defaults to the
              current month and lists the locked runs itself. */}
          <Link to="/requests/new?type=PAYROLL_ADJUSTMENT">
            New adjustment
          </Link>
        </div>
      )}
      {h.status === 'Cancelled' && (
        <div className="wf-balance-warn">Cancelled: {h.cancelReason}</div>
      )}

      {/* frozen rates */}
      {detail!.rates.length > 0 && (
        <div className="pr-card">
          <div className="pr-card-title">Frozen rates — every payslip in this run uses these</div>
          {detail!.rates.map((r) => (
            <div key={`${r.fromCurrency}${r.toCurrency}`}>
              1 {r.toCurrency} = {fmt(1 / r.rate)} {r.fromCurrency} · {r.rateType} · frozen as of{' '}
              {r.sourceEffectiveDate.slice(0, 10)}
            </div>
          ))}
        </div>
      )}

      {/* totals per currency, never merged */}
      {t && t.payslipCount > 0 && (
        <div className="pr-card">
          <div className="pr-card-title">Totals — {t.payslipCount} payslip(s)</div>
          <table className="pr-totals">
            <thead><tr><th /><th>USD</th><th>LBP</th></tr></thead>
            <tbody>
              <tr><td>Gross</td><td>{fmt(t.grossUsd)}</td><td>{fmt(t.grossLbp)}</td></tr>
              <tr><td>Deductions</td><td>{fmt(t.deductionsUsd)}</td><td>{fmt(t.deductionsLbp)}</td></tr>
              <tr className="pr-totals-net"><td>Net</td><td>{fmt(t.netUsd)}</td><td>{fmt(t.netLbp)}</td></tr>
              {/* An off-cycle run computes no statutory contributions, so this row is always zero.
                  Printing a row of zeroes invites the reading that the employer owed nothing this
                  month, when the truth is that this run never asked the question. */}
              {h.runType !== 'Supplemental' && (
                <tr><td>Employer cost</td><td>{fmt(t.employerCostUsd)}</td><td>{fmt(t.employerCostLbp)}</td></tr>
              )}
            </tbody>
          </table>
          <div className="pr-muted">≈ {fmt(t.netPrimary)} {h.primaryCurrency} total net, at the frozen rate</div>
          {h.runType === 'Supplemental' && (
            <div className="pr-muted">
              Off-cycle run — statutory contributions are not computed; each payslip says so.
            </div>
          )}
          {t.payslipsWithWarnings > 0 && (
            <button className="pr-warn-link" onClick={() => setWarningsOnly((v) => !v)}>
              ⚠ {t.payslipsWithWarnings} payslip(s) with warnings — {warningsOnly ? 'show all' : 'show only those'}
            </button>
          )}
        </div>
      )}

      {/* actions by status — an approved run renders none of these */}
      {error && <div className="wf-balance-warn">{error}</div>}

      {/* THE FACT IS SHOWN TO EVERYONE; THE FIX ONLY TO WHOEVER CAN APPLY IT. A reader without
          PAYROLL_RUN still needs to know these payslips are missing signed adjustments — that is
          exactly the kind of thing they are reading the run to find — so the sentence stays and only
          the Regenerate link goes. */}
      {pending.length > 0 && (
        <div className="wf-balance-warn">
          {pending.length} approved adjustment(s) target {h.periodYearMonth} but are not in the
          current payslips
          {canRun ? (
            <>
              {' '}—{' '}
              <button
                type="button"
                className="pr-warn-link"
                disabled={busy}
                onClick={() => act(() => payrollRunsService.generate(runId), false)}
              >
                Regenerate
              </button>{' '}
              to include them.
            </>
          ) : (
            ' — regenerating the run would include them.'
          )}
        </div>
      )}

      <div className="pr-actions">
        {h.status === 'Draft' && (
          <>
            {/* Same endpoint either way — the server routes on the run's own type. Only the LABEL
                changes, because "Generate payslips" undersells what an off-cycle run does: it pays
                signed adjustments and nothing else. */}
            {canRun && (
              <>
                <Button
                  disabled={busy}
                  onClick={() => act(() => payrollRunsService.generate(runId), false)}
                >
                  {h.runType === 'Supplemental'
                    ? 'Generate from signed adjustments'
                    : h.generatedAt ? 'Regenerate payslips' : 'Generate payslips'}
                </Button>
                <Button variant="default" disabled={busy || !h.generatedAt}
                  onClick={() => act(() => payrollRunsService.sendToReview(runId), false)}>
                  Send to review
                </Button>
                <Button variant="subtle" disabled={busy} onClick={() => setCancelOpen(true)}>
                  Cancel run…
                </Button>
              </>
            )}
            {/* Raised as a request: HR states it, the Owner signs it, and the approval is what
                creates the row. Regenerate afterwards and it appears as a line. Left open to every
                reader — raising a request needs no payroll trust at all, and the chain decides. */}
            <Link to="/requests/new?type=PAYROLL_ADJUSTMENT">
              Add one-off item…
            </Link>
          </>
        )}
        {h.status === 'Review' && (
          <>
            {canRun && (
              <Button variant="default" disabled={busy}
                onClick={() => act(() => payrollRunsService.generate(runId), false)}>
                Regenerate
              </Button>
            )}
            {/* THE LOCK. Its own code, and hidden rather than disabled — a greyed-out "Approve &
                lock" on a month somebody may never approve is an invitation to go looking for the
                permission to press it. */}
            {canApprove && (
              <Button disabled={busy} onClick={() => setConfirmApprove(true)}>Approve & lock…</Button>
            )}
            {canRun && (
              <Button variant="subtle" disabled={busy} onClick={() => setCancelOpen(true)}>
                Cancel run…
              </Button>
            )}
            {/* Still open, so an adjustment can still reach this period — but it has to be signed
                first, and approving this run closes the door. */}
            <Link to="/requests/new?type=PAYROLL_ADJUSTMENT">
              Add one-off item…
            </Link>
          </>
        )}
      </div>

      {/* payslips */}
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <Group justify="flex-end" p="xs">
          <TextInput
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.currentTarget.value)}
            placeholder="Search employees…"
            leftSection={<IconSearch size={14} />}
            w={220}
            size="xs"
          />
        </Group>

        <Table highlightOnHover withColumnBorders={false} verticalSpacing="xs" fz="sm">
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
                <Table.Td colSpan={columns.length}>
                  <div className="empty-hint" style={{ padding: 16 }}>
                    {h.generatedAt ? 'No payslips.' : 'Not generated yet.'}
                  </div>
                </Table.Td>
              </Table.Tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <Table.Tr
                  key={row.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/payroll/payslips/${row.original.payslipId}`)}
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
            {totalRows === 0 ? 0 : pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, totalRows)} of {totalRows}
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

      {/* approve confirmation — states the consequence */}
      <Modal
        opened={confirmApprove}
        onClose={() => setConfirmApprove(false)}
        title="Approve and lock this run"
        size={480}
        centered
      >
        <p>
          Approving locks {h.periodYearMonth} permanently. Expenses on these payslips are stamped
          reimbursed, advance balances are reduced, and adjustments are consumed. None of it can be
          undone; later corrections go to the next period.
        </p>
        {error && <div className="wf-balance-warn">{error}</div>}
        <div className="pr-actions">
          <Button disabled={busy} onClick={() => act(() => payrollRunsService.approve(runId))}>
            {busy ? 'Approving…' : 'Approve & lock'}
          </Button>
          <Button variant="subtle" onClick={() => setConfirmApprove(false)}>Back</Button>
        </div>
      </Modal>

      {/* cancel with required reason */}
      <Modal
        opened={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this run"
        size={480}
        centered
      >
        <p>A cancelled run is kept for the record and a new run for {h.periodYearMonth} becomes possible.</p>
        <Textarea value={cancelReason} minRows={2}
          placeholder="Why is it being cancelled?" disabled={busy}
          onChange={(e) => setCancelReason(e.currentTarget.value)} />
        {error && <div className="wf-balance-warn">{error}</div>}
        <div className="pr-actions">
          <Button color="red" disabled={busy || cancelReason.trim() === ''}
            onClick={() => act(() => payrollRunsService.cancel(runId, cancelReason.trim()))}>
            Cancel the run
          </Button>
          <Button variant="subtle" onClick={() => setCancelOpen(false)}>Back</Button>
        </div>
      </Modal>
    </div>
  )
}
