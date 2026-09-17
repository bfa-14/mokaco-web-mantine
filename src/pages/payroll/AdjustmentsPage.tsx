/* src/pages/payroll/AdjustmentsPage.tsx */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Pagination,
  Select,
  Table,
  Textarea,
  TextInput,
} from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { MonthPickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconCalendar, IconPlus, IconRefresh, IconSearch, IconUsersGroup } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { PERMISSION } from '../../auth/routeAccess'
import { useAuth } from '../../auth/useAuth'
import { monthFromPicker, monthToPicker } from '../../components/date/pickerValue'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { currenciesService } from '../../services/coreService'
import { branchesService } from '../../services/hrService'
import { adjustmentsService, payrollRunsService } from '../../services/payrollService'
import type { Currency } from '../../types/core'
import type { Branch } from '../../types/hr'
import type {
  PayrollAdjustment, PayrollComponentType, PayrollRunListItem,
} from '../../types/payroll'
import './payroll.css'

const EMPTY: PayrollAdjustment[] = []
const NO_RUNS: PayrollRunListItem[] = []
const NO_COMPONENTS: PayrollComponentType[] = []
const NO_CURRENCIES: Currency[] = []
const NO_BRANCHES: Branch[] = []
/**
 * The branch select's default, and a SENTINEL rather than an empty string: Mantine reads '' as
 * nothing-selected, which would make the default indistinguishable from a cleared box. It maps back
 * to `branchId: null` on submit, which is what the procedure reads as every branch.
 */
const ALL_BRANCHES = 'all'
const fmt = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/**
 * THE DEFAULT IS THE CURRENT MONTH, not the next one.
 *
 * A one-off item — a bonus, a deduction agreed this week — belongs to the month being worked on,
 * and the engine allows it: an adjustment is refused only when its target period is already locked,
 * and Generate picks up every row aimed at its own period.
 */
const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const columnHelper = createColumnHelper<PayrollAdjustment>()
const PAGE_SIZES = ['15', '30', '60']

/**
 * ADJUSTMENTS — the LEDGER, and very nearly read-only.
 *
 * NOBODY IS ADJUSTED INDIVIDUALLY HERE. An adjustment for one person is a request: HR raises it,
 * the Owner signs it, and only that final approval writes the row this page lists. The database
 * enforces it — payroll.usp_Adjustment_Create refuses outright and points at the request type — so
 * a single-employee form here would be a button that could only ever produce an error.
 *
 * THE ONE EXCEPTION IS THE WHOLE COMPANY AT ONCE, and it is an exception because the rule stops
 * making sense at that size. The chain protects an individual from having their pay changed
 * unsigned; a bonus for everybody is one decision, and putting it through the chain would mean one
 * request per head. So that act carries PAYROLL_APPROVE instead — the trust that locks a run — and
 * HR, who may raise an adjustment for anyone, may not give it to everyone. The button is hidden
 * without that permission and the server refuses regardless, which is the order those two belong in.
 *
 * Nothing is DELETED here either, for the same reason turned around: a row is the residue of a
 * signed chain. An unconsumed one is refused because it was authorised; a consumed one because it
 * is history. Both refusals come from the procedure, and the way back is to counter it, never to
 * delete what the signatures point at.
 *
 * What is left is the two questions the page can honestly answer: what is queued for this period,
 * and who authorised each row.
 */
export default function AdjustmentsPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  /* The bulk create is the only act on this page, and it is not the trust that opened it: reading
     adjustments is PAYROLL_RUN, giving one to everybody is PAYROLL_APPROVE. Hiding the button from
     HR is a courtesy — the route refuses them anyway — but it is the honest courtesy: an affordance
     that could only ever return 403 is worse than no affordance at all. */
  const { hasPermission } = useAuth()
  const canAddForAll = hasPermission(PERMISSION.PAYROLL_APPROVE)
  const period = params.get('period') ?? currentMonth()

  const [rows, setRows] = useState<PayrollAdjustment[]>(EMPTY)
  /** Every run — used only to say whether this period's run is still open. */
  const [runsAll, setRunsAll] = useState<PayrollRunListItem[]>(NO_RUNS)
  const [error, setError] = useState<string | null>(null)
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const refresh = useCallback(() => {
    adjustmentsService.getForPeriod(period)
      .then(setRows)
      .catch((e) => setError(getErrorMessage(e)))
  }, [period])
  useEffect(refresh, [refresh])

  useEffect(() => {
    let cancelled = false
    payrollRunsService.getList()
      .then((r) => { if (!cancelled) setRunsAll(r) })
      .catch(() => { /* the banner is a courtesy; its absence is not an error worth showing */ })
    return () => { cancelled = true }
  }, [])

  const setPeriod = useCallback((s: string) => {
    const next = new URLSearchParams(params)
    next.set('period', s)
    setParams(next, { replace: true })
  }, [params, setParams])

  /* ─────────────────────────── add for all employees ─────────────────────────── */

  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [componentTypes, setComponentTypes] = useState<PayrollComponentType[]>(NO_COMPONENTS)
  const [currencies, setCurrencies] = useState<Currency[]>(NO_CURRENCIES)
  const [branches, setBranches] = useState<Branch[]>(NO_BRANCHES)
  /** The branch list needs EMP_VIEW, which two of the roles that may be here do not hold. */
  const [branchesUnreadable, setBranchesUnreadable] = useState(false)
  const [refLoaded, setRefLoaded] = useState(false)

  const [bulkForm, setBulkForm] = useState({
    componentTypeId: null as string | null,
    amount: '' as number | string,
    currencyCode: '',
    targetPeriod: period,
    reason: '',
    branchId: ALL_BRANCHES,
  })

  /**
   * The three reference lists, fetched on FIRST OPEN rather than with the page.
   *
   * Nobody who cannot press the button should pay for its dropdowns, and most visits here are
   * somebody checking what is queued. Loading them lazily also puts any permission failure in
   * front of the person it affects, at the moment it affects them, rather than into a console on
   * page load.
   */
  useEffect(() => {
    if (!bulkOpen || refLoaded) return
    setRefLoaded(true)

    // The component list is the one the modal cannot work without, so its failure is shown.
    adjustmentsService.componentTypes()
      .then(setComponentTypes)
      .catch((e) => setBulkError(getErrorMessage(e)))

    // Currencies and branches are EMP_VIEW, which the General Manager and Operations Manager roles
    // do not hold — and both of those ARE PAYROLL_APPROVE holders, so this is the ordinary case
    // here rather than an edge one. Neither failure is an error: the currency list falls back to
    // the codes already on the page, and an unreadable branch list leaves every branch, which is
    // the default anyway.
    currenciesService.getAll()
      .then(setCurrencies)
      .catch(() => setCurrencies(NO_CURRENCIES))

    branchesService.getAll()
      .then((all) => setBranches(all.filter((b) => b.isActive)))
      .catch(() => setBranchesUnreadable(true))
  }, [bulkOpen, refLoaded])

  const componentOptions = useMemo(
    () => componentTypes.map((c) => ({
      value: String(c.componentTypeId),
      label: `${c.name} — ${c.category}`,
    })),
    [componentTypes],
  )

  /** The picked component, only so the form can show WHICH WAY the amount is about to go. */
  const pickedComponent = useMemo(
    () => componentTypes.find((c) => String(c.componentTypeId) === bulkForm.componentTypeId) ?? null,
    [componentTypes, bulkForm.componentTypeId],
  )

  /**
   * Currencies, with a fallback that needs no permission the reader is missing.
   *
   * The codes already on this page — the ones on the listed adjustments, and every run’s primary
   * currency — arrived through PAYROLL_RUN, which everyone here holds. A General Manager therefore
   * gets a usable list rather than an empty box; what they lose is the NAME beside the code.
   */
  const currencyOptions = useMemo(() => {
    if (currencies.length > 0) {
      return currencies.map((c) => ({ value: c.currencyCode, label: `${c.currencyCode} — ${c.name}` }))
    }
    const codes = new Set<string>()
    rows.forEach((r) => { if (r.currencyCode) codes.add(r.currencyCode) })
    runsAll.forEach((r) => { if (r.primaryCurrency) codes.add(r.primaryCurrency) })
    return Array.from(codes).sort().map((c) => ({ value: c, label: c }))
  }, [currencies, rows, runsAll])

  const branchOptions = useMemo(
    () => [{ value: ALL_BRANCHES, label: t('payroll.adjustments.branchAll') }]
      .concat(branches.map((b) => ({ value: String(b.branchId), label: b.name }))),
    [branches, t],
  )

  /** Filled once the options arrive, and never over a choice the user has already made. */
  useEffect(() => {
    if (!bulkOpen || currencyOptions.length === 0) return
    setBulkForm((f) => (f.currencyCode ? f : {
      ...f,
      currencyCode: currencyOptions.some((o) => o.value === 'USD') ? 'USD' : currencyOptions[0].value,
    }))
  }, [bulkOpen, currencyOptions])

  /** Opens on the period being LOOKED AT — the month the reader already has in mind. */
  const openBulk = useCallback(() => {
    setBulkForm({
      componentTypeId: null,
      amount: '',
      currencyCode: '',
      targetPeriod: period,
      reason: '',
      branchId: ALL_BRANCHES,
    })
    setBulkError(null)
    setBulkOpen(true)
  }, [period])

  /**
   * Submits, and reports THE NUMBER OF ROWS WRITTEN rather than the headcount.
   *
   * The procedure skips anyone who already carries this component, period and reason, so a second
   * submit answers zero instead of paying everybody twice. That zero earns a sentence of its own:
   * alone it reads as a failure, when what it means is that the first submit already did the work.
   *
   * Only the two fields that would otherwise make a NONSENSE request are checked here. The amount,
   * the currency and the component’s existence are the procedure’s to refuse, and its sentences are
   * better than any this page could invent — they arrive as a 400 and are shown verbatim, in red.
   */
  const submitBulk = useCallback(async () => {
    setBulkError(null)

    const componentTypeId = Number(bulkForm.componentTypeId)
    if (!componentTypeId || bulkForm.reason.trim().length === 0) {
      setBulkError(t('common.formIncomplete'))
      return
    }

    setBulkSaving(true)
    try {
      const result = await adjustmentsService.createBulk({
        componentTypeId,
        amount: typeof bulkForm.amount === 'number' ? bulkForm.amount : Number(bulkForm.amount),
        currencyCode: bulkForm.currencyCode,
        targetPeriod: bulkForm.targetPeriod,
        reason: bulkForm.reason.trim(),
        branchId: bulkForm.branchId === ALL_BRANCHES ? null : Number(bulkForm.branchId),
      })

      const given = t('payroll.adjustments.given', { count: result.employeesGiven })
      notifications.show({
        message: result.employeesGiven === 0
          ? `${given} — ${t('payroll.adjustments.givenNoneHint')}`
          : given,
        color: result.employeesGiven === 0 ? 'yellow' : 'green',
        autoClose: 5000,
      })

      setBulkOpen(false)
      // The rows exist NOW, so the grid had better be showing the month they exist in. Refreshing
      // the month on screen after writing into a different one would show the reader nothing at
      // all, which reads as "it did not work".
      if (bulkForm.targetPeriod === period) refresh()
      else setPeriod(bulkForm.targetPeriod)
    } catch (e) {
      setBulkError(getErrorMessage(e))
    } finally {
      setBulkSaving(false)
    }
  }, [bulkForm, period, refresh, setPeriod, t])

  /**
   * A queued adjustment is INVISIBLE on the run until the run is regenerated — the row exists, but
   * no payslip mentions it yet. Derived from the period rather than set by a save, now that saving
   * happens on the request page: the sentence is about the state of this month, not about an event.
   */
  const notice = useMemo(() => {
    const waiting = rows.filter((r) => r.appliedToPayslipId == null).length
    if (waiting === 0) return null
    const openRun = runsAll.find(
      (x) => x.periodYearMonth === period &&
             (x.status === 'Draft' || x.status === 'Review'))
    return openRun
      ? `${waiting} adjustment(s) waiting. Run ${period} is ${openRun.status} — regenerate it to pick them up.`
      : `${waiting} adjustment(s) waiting. They will land when ${period} is generated.`
  }, [rows, runsAll, period])

  const grid = useMemo(() => rows, [rows])

  const columns = useMemo(
    () => [
      columnHelper.accessor('employeeName', { header: 'Employee' }),
      columnHelper.display({
        id: 'amount',
        header: 'Amount',
        cell: (c) => {
          const d = c.row.original
          return (
            <span className={d.sign < 0 ? 'pr-neg' : undefined}>
              {d.sign < 0 ? '−' : '+'}{fmt(d.amount)} {d.currencyCode}
            </span>
          )
        },
      }),
      columnHelper.accessor('componentName', {
        header: 'Component',
        meta: { filterOptions: optionsFrom(grid, (r) => r.componentName) },
      }),
      columnHelper.accessor('correctsPeriod', {
        header: 'Corrects',
        size: 100,
        cell: (c) => c.getValue() ?? '—',
        // A row that corrects nothing prints a dash, and the dash is what a reader would type.
        meta: { filterText: (v) => v ?? '—' },
      }),
      columnHelper.accessor('reason', { header: 'Reason', meta: { noHeaderFilter: true } }),
      /* WHO SIGNED FOR THIS. Rows predating the request type have no request behind them and say
         so plainly rather than pretending to a chain that never existed. */
      columnHelper.accessor('requestInstanceId', {
        header: 'Authorised by',
        size: 150,
        cell: (c) => {
          const id = c.getValue()
          return id != null
            ? <Link to={`/requests/${id}`}>Request #{id}</Link>
            : <span className="pr-muted">Direct entry (pre-request)</span>
        },
        // Matches the LINK TEXT, so "#41" finds request 41 and "direct" finds the legacy rows.
        meta: { filterText: (v) =>
          v != null ? `Request #${v}` : 'Direct entry (pre-request)' },
      }),
      // Two states, and the one question this page is opened to answer — a dropdown, not a box.
      columnHelper.accessor('appliedToPayslipId', {
        header: 'State',
        size: 150,
        cell: (c) =>
          c.getValue() != null
            ? <span className="pr-chip pr-chip-approved">Consumed by payslip</span>
            : <span className="pr-chip">Waiting for the run</span>,
        meta: { filterText: (v) =>
          v != null ? 'Consumed by payslip' : 'Waiting for the run', filterOptions: ['Waiting for the run', 'Consumed by payslip'] },
      }),
    ],
    // `grid` only feeds the Component dropdown's option list.
    [grid],
  )

  const table = useReactTable({
    data: grid,
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
    initialState: { pagination: { pageSize: 15 } },
    getRowId: (r) => String(r.payrollAdjustmentId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Payroll adjustments</h1>
          <p className="page-subtitle">The signed corrections queued against a period.</p>
        </div>
        <div className="page-head-actions">
          {/* The page IS a period, so it can never be empty — clearing is refused exactly as the
              native input's `if (s)` guard refused it. State and URL stay 'yyyy-MM'. */}
          <MonthPickerInput
            valueFormat="MMMM YYYY"
            leftSection={<IconCalendar size={14} />}
            w={170}
            value={monthToPicker(period)}
            onChange={(v) => {
              const month = monthFromPicker(v)
              if (month) setPeriod(month)
            }}
          />
          <ActionIcon variant="default" size="lg" aria-label="Refresh" onClick={refresh}>
            <IconRefresh size={16} />
          </ActionIcon>
          {/* EVERYBODY AT ONCE — secondary on purpose. Raising a request is the ordinary act and
              stays the primary button; this one is rarer, larger in effect, and gated on a
              permission most people reading this page do not hold. */}
          {canAddForAll && (
            <Button
              variant="default"
              leftSection={<IconUsersGroup size={16} />}
              onClick={openBulk}
            >
              {t('payroll.adjustments.addForAll')}
            </Button>
          )}
          {/* The only way in for ONE person. The form defaults to the current month and lists
              locked runs itself, so nothing is prefilled from here. */}
          <Button leftSection={<IconPlus size={16} />}
            onClick={() => navigate('/requests/new?type=PAYROLL_ADJUSTMENT')}>
            Raise an adjustment request
          </Button>
        </div>
      </div>

      <PageHelp>
        Every adjustment here arrived through an approved request — HR raised it, the Owner signed
        it. Rows are consumed by the period's payslip at lock.
      </PageHelp>

      {error && <div className="wf-balance-warn">{error}</div>}
      {notice && <div className="pr-lock-banner">{notice}</div>}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <Group justify="flex-end" p="xs">
          <TextInput
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.currentTarget.value)}
            placeholder="Search…"
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
                    No adjustments target {period}.
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

      {/* ── add for all employees ── */}
      <Modal
        opened={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={t('payroll.adjustments.bulkTitle')}
        size={520}
        centered
      >
        {/* What the button DOES, above the fields rather than buried under them. This is the one
            action on the page that touches everybody at once, and the reader should have read that
            sentence before they start filling anything in — not while their hand is on Submit. */}
        <p className="hint" style={{ marginTop: 0 }}>
          {t('payroll.adjustments.confirm')}
        </p>

        <div className="form-field">
          <label className="form-label" htmlFor="bulk-component">
            {t('payroll.adjustments.component')}
          </label>
          <Select
            id="bulk-component"
            data={componentOptions}
            value={bulkForm.componentTypeId}
            onChange={(v) => setBulkForm((f) => ({ ...f, componentTypeId: v }))}
            placeholder={t('payroll.adjustments.componentPlaceholder')}
            searchable
            required
            disabled={bulkSaving}
          />
          {/* WHICH WAY THE MONEY GOES. The amount is always positive and the component decides the
              direction, which is easy to forget when the same box is used for a bonus and for a
              deduction — and this one lands on every employee. */}
          {pickedComponent && (
            <p className="hint" style={{ marginTop: 6 }}>
              {pickedComponent.sign < 0 ? '−' : '+'} {pickedComponent.category}
            </p>
          )}
        </div>

        <div className="form-grid">
          <div className="form-field">
            <label className="form-label" htmlFor="bulk-amount">
              {t('common.amount')}
            </label>
            <NumberInput
              id="bulk-amount"
              value={bulkForm.amount}
              onChange={(v) => setBulkForm((f) => ({ ...f, amount: v }))}
              min={0}
              decimalScale={2}
              required
              disabled={bulkSaving}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="bulk-currency">
              {t('common.currency')}
            </label>
            <Select
              id="bulk-currency"
              data={currencyOptions}
              value={bulkForm.currencyCode || null}
              onChange={(v) => setBulkForm((f) => ({ ...f, currencyCode: v ?? f.currencyCode }))}
              allowDeselect={false}
              searchable
              disabled={bulkSaving}
            />
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bulk-period">
            {t('payroll.adjustments.targetPeriod')}
          </label>
          {/* Same guard as the page header: a period is never nothing, so a clear is refused
              rather than written through as an empty string. */}
          <MonthPickerInput
            id="bulk-period"
            valueFormat="MMMM YYYY"
            leftSection={<IconCalendar size={14} />}
            value={monthToPicker(bulkForm.targetPeriod)}
            onChange={(v) => {
              const month = monthFromPicker(v)
              if (month) setBulkForm((f) => ({ ...f, targetPeriod: month }))
            }}
            disabled={bulkSaving}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bulk-reason">
            {t('common.reason')}
          </label>
          {/* 300 is the column, not a guess: payroll.PAYROLL_ADJUSTMENT.Reason is nvarchar(300),
              and it is also half the key the procedure skips re-runs on — a reason silently cut
              short would quietly stop matching the one already stored. */}
          <Textarea
            id="bulk-reason"
            value={bulkForm.reason}
            onChange={(e) => {
              const value = e.currentTarget.value
              setBulkForm((f) => ({ ...f, reason: value }))
            }}
            maxLength={300}
            autosize
            minRows={2}
            required
            disabled={bulkSaving}
          />
          <p className="hint" style={{ marginTop: 6 }}>
            {t('payroll.adjustments.reasonHint')}
          </p>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bulk-branch">
            {t('common.branch')} {t('common.optional')}
          </label>
          <Select
            id="bulk-branch"
            data={branchOptions}
            value={bulkForm.branchId}
            onChange={(v) => setBulkForm((f) => ({ ...f, branchId: v ?? ALL_BRANCHES }))}
            allowDeselect={false}
            searchable
            disabled={bulkSaving || branchesUnreadable}
          />
          <p className="hint" style={{ marginTop: 6 }}>
            {branchesUnreadable
              ? t('payroll.adjustments.branchUnreadable')
              : t('payroll.adjustments.branchHint')}
          </p>
        </div>

        {/* The procedure’s own sentence, verbatim and in red — "The amount must be above zero.",
            "Unknown currency." Nothing is rewritten on the way through. */}
        {bulkError && (
          <div className="alert alert--error" role="alert">
            {bulkError}
          </div>
        )}

        <div className="form-actions">
          <Button variant="default" onClick={() => setBulkOpen(false)} disabled={bulkSaving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submitBulk()} disabled={bulkSaving}>
            {bulkSaving ? t('payroll.adjustments.submitting') : t('payroll.adjustments.submit')}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
