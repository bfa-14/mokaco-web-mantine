/* src/pages/payroll/PayrollRunDetailPage.tsx */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Checkbox, Group, Pagination, Select, Table, Textarea, TextInput } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Modal } from '../../components/dialogs'
import { IconRefresh, IconSearch } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { useLive } from '../../live/useLive'
import { useLiveEnabled } from '../../live/useLiveSettings'
import { payrollRunsService } from '../../services/payrollService'
import type { PayrollRunDetail, PayrollRunStaleness, PayslipRow } from '../../types/payroll'
import { dateTime } from '../workflow/workflowFormat'
import {
  approveBody, canOfferApprove, dayAfter, earlyLockCutoff, isEarlyLock, summarizeStaleness,
} from './payrollRunRules'
import './payroll.css'

const EMPTY_SLIPS: PayslipRow[] = []
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
  // `t` is the run's totals below; the translation function is `tr` on this page.
  const { t: tr } = useTranslation()
  const { hasPermission, user } = useAuth()
  const canRun = hasPermission(PERMISSION.PAYROLL_RUN)
  /* APPROVING IS THE OWNER'S (QA3 PAY-12 / WEB-15). PAYROLL_APPROVE reaches the endpoint — a General
     Manager holds it to record payments — but usp_PayrollRun_Approve admits the Owner alone, so the
     button is offered to the Owner and everybody else holding the code is told whose act it is. */
  const holdsApprove = hasPermission(PERMISSION.PAYROLL_APPROVE)
  const canApprove = canOfferApprove(user?.roles, holdsApprove)

  const [detail, setDetail] = useState<PayrollRunDetail | null>(null)
  const [slips, setSlips] = useState<PayslipRow[]>(EMPTY_SLIPS)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmApprove, setConfirmApprove] = useState(false)
  /** The Owner ticked "I am locking early" — reset every time the dialog opens. */
  const [earlyConfirmed, setEarlyConfirmed] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [warningsOnly, setWarningsOnly] = useState(false)
  /** What changed since the run was generated — the server's own comparison (see below). */
  const [staleness, setStaleness] = useState<PayrollRunStaleness | null>(null)
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  // A failed read must not take the page down: the banner is an ADVISORY — Approve asks the same
  // question itself and refuses a stale run with the same names.
  const refreshStaleness = useCallback(() => {
    if (!runId) return
    payrollRunsService
      .staleness(runId)
      .then(setStaleness)
      .catch(() => setStaleness(null))
  }, [runId])

  const refresh = useCallback(() => {
    if (!runId) return
    Promise.all([payrollRunsService.get(runId), payrollRunsService.getPayslips(runId)])
      .then(([d, s]) => {
        setDetail(d)
        setSlips(s)
      })
      .catch((e) => setError(getErrorMessage(e)))
    refreshStaleness()
  }, [runId, refreshStaleness])
  useEffect(refresh, [refresh])

  // LIVE: another user regenerating or approving this run changes every total on the page; the
  // out-of-date banner re-reads with the same refetch, so it clears itself after a regenerate.
  const liveOn = useLiveEnabled('payroll')
  useLive(['payroll'], refresh, liveOn)
  // ...and it follows what the payslips are computed FROM: a day recorded or decided, a request
  // approved or taken back, a salary changed. Only the comparison is re-read, not the run.
  useLive(['attendance', 'workflow', 'hr'], refreshStaleness, liveOn)

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

  /* ── WHAT CHANGED SINCE THE RUN WAS GENERATED (QA3 PAY-5 / REL-3) ───────────────────────────
   *
   * A payslip is computed from many things that keep moving after Generate: a day recorded or decided,
   * a leave approved or taken back, an advance, an expense, an adjustment signed, a salary changed, a
   * setting or a tax table edited. The server keeps a fingerprint of everything each payslip was
   * computed from and compares it with the data now — Approve refuses a run that no longer matches
   * ("Regenerate the run"), and this banner says so, and names what moved, BEFORE anybody presses it.
   * (It replaces the page's own guess from adjustment timestamps, which saw adjustments only.)
   *
   * Only while the run is open and generated: an approved run is history, a cancelled one is gone.
   */
  const isOpen = h?.status === 'Draft' || h?.status === 'Review'
  const stale = useMemo(
    () => summarizeStaleness(isOpen && h?.generatedAt ? staleness?.items : null),
    [staleness, isOpen, h?.generatedAt],
  )

  /* ── THE EARLY LOCK (QA3 PAY-3) ─────────────────────────────────────────────────────────────────
   * A primary is locked once its last day is over in Beirut. Before that the procedure refuses unless
   * the Owner asks for an early lock — so the dialog says what an early lock leaves out (the days after
   * the run's attendance cut-off are paid as scheduled; anything dated after it, or entered later, is not
   * paid by this run) and sends the flag only once the Owner ticked that they mean it. */
  const early = h != null && isEarlyLock(h, new Date())
  const cutoff = earlyLockCutoff(staleness?.generatedUpTo, new Date())

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
            {h.generatedAt && <> · generated {dateTime(h.generatedAt)}</>}
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
          Locked {h.lockedAt ? dateTime(h.lockedAt) : ''} by {h.approvedBy}. Nothing
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
          {/* QA3 REL-11: a Draft re-reads its rates as of the period end at every Generate; from Review on
              the snapshot is frozen. Say which, so the figures below are read for what they are. */}
          {(h.status === 'Draft' || h.status === 'Review') && (
            <div className="pr-muted">
              {h.status === 'Draft' ? tr('payroll.run.ratesDraft') : tr('payroll.run.ratesFrozen')}
            </div>
          )}
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
          PAYROLL_RUN still needs to know these payslips no longer match their data — that is exactly
          the kind of thing they are reading the run to find — so the sentence stays and only the
          Regenerate button goes. */}
      {stale.isStale && (
        <div className="wf-balance-warn">
          <b>{tr('payroll.run.staleTitle')}</b>
          <div>
            {stale.peopleCount > 0
              ? tr('payroll.run.staleBody', { count: stale.peopleCount })
              : tr('payroll.run.staleRunWideOnly')}
          </div>
          {stale.people.length > 0 && (
            <ul style={{ margin: '6px 0' }}>
              {stale.people.map((p) => (
                <li key={p.employeeId}>
                  {p.name}: {p.sources.map((src) => tr(`payroll.run.source.${src}`)).join(', ')}
                </li>
              ))}
              {stale.morePeople > 0 && <li>{tr('payroll.run.staleMore', { count: stale.morePeople })}</li>}
            </ul>
          )}
          {stale.runWide && stale.peopleCount > 0 && <div>{tr('payroll.run.staleRunWide')}</div>}
          {canRun ? (
            <Button
              size="compact-sm"
              mt={6}
              disabled={busy}
              onClick={() => act(() => payrollRunsService.generate(runId), false)}
            >
              {tr('payroll.run.staleRegenerate')}
            </Button>
          ) : (
            <div className="pr-muted">{tr('payroll.run.staleReaderHint')}</div>
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
              <Button disabled={busy} onClick={() => { setEarlyConfirmed(false); setConfirmApprove(true) }}>
                Approve & lock…
              </Button>
            )}
            {!canApprove && holdsApprove && (
              <span className="pr-muted">{tr('payroll.run.awaitingOwner')}</span>
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
        {early && (
          <div className="wf-balance-warn">
            <b>{tr('payroll.run.earlyTitle')}</b>
            <div>
              {tr('payroll.run.earlyBody', {
                period: h.periodYearMonth,
                end: h.periodEnd.slice(0, 10),
                next: dayAfter(h.periodEnd),
                cutoff,
              })}
            </div>
            <Checkbox
              mt={8}
              checked={earlyConfirmed}
              disabled={busy}
              label={tr('payroll.run.earlyConfirm', { period: h.periodYearMonth })}
              onChange={(e) => setEarlyConfirmed(e.currentTarget.checked)}
            />
          </div>
        )}
        {error && <div className="wf-balance-warn">{error}</div>}
        <div className="pr-actions">
          <Button
            disabled={busy || (early && !earlyConfirmed)}
            onClick={() => act(() => payrollRunsService.approve(runId, approveBody(early, earlyConfirmed)))}
          >
            {busy ? 'Approving…' : early ? tr('payroll.run.approveEarly') : 'Approve & lock'}
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
