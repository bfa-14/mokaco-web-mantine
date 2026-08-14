/* src/pages/payroll/AdjustmentsPage.tsx */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Pagination, Select, Table, TextInput } from '@mantine/core'
import { MonthPickerInput } from '@mantine/dates'
import { IconCalendar, IconPlus, IconRefresh, IconSearch } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { monthFromPicker, monthToPicker } from '../../components/date/pickerValue'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { adjustmentsService, payrollRunsService } from '../../services/payrollService'
import type { PayrollAdjustment, PayrollRunListItem } from '../../types/payroll'
import './payroll.css'

const EMPTY: PayrollAdjustment[] = []
const NO_RUNS: PayrollRunListItem[] = []
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
 * ADJUSTMENTS — the LEDGER, and read-only.
 *
 * Nothing is created here any more. An adjustment is a request now: HR raises it, the Owner signs
 * it, and only that final approval writes the row this page lists. The database enforces it —
 * payroll.usp_Adjustment_Create refuses outright and points at the request type — so a create form
 * here would be a button that could only ever produce an error.
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
          {/* The only way in. The form defaults to the current month and lists locked runs itself,
              so nothing is prefilled from here. */}
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
    </div>
  )
}
