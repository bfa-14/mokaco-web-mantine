import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Group, Loader, Pagination, Select, Table, TextInput } from '@mantine/core'
import { IconAlertTriangle, IconCheck, IconRefresh, IconSearch } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { PunchPipelineCard } from './PunchPipelineCard'
import { attendanceService } from '../../services/attendanceService'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { useLive } from '../../live/useLive'
import { useLiveEnabled } from '../../live/useLiveSettings'
import type { AttendanceSummary, PayrollReadiness } from '../../types/attendance'
import {
  currentPeriod,
  formatMinutes,
  periodLabel,
  previousPeriod,
} from './attendanceFormat'
import { Trans, useTranslation } from 'react-i18next'
import { t as tr } from '../../i18n/t'

/** One blocker: the count, where it gets fixed, and why an unfixed one costs money. */
interface Blocker {
  key: string
  count: number
  label: string
  to: string
  hint: string
}

/**
 * The last twelve months, newest first. HR closes a month a few days into the next one,
 * so the period they want is usually this one or the previous one — but a query about a
 * pay dispute can land on any month of the year, and typing 'yyyy-MM' by hand invites a
 * typo that silently reads an empty month.
 */
function recentPeriods(): string[] {
  const periods: string[] = [currentPeriod()]
  for (let index = 1; index < 12; index++) {
    periods.push(previousPeriod(periods[index - 1]))
  }
  return periods
}

/**
 * The seven counters, in the order they occur in the pipeline: a punch has to be ingested,
 * attributed to a person, read confidently and settled before payroll can trust the day.
 */
function blockersOf(readiness: PayrollReadiness): Blocker[] {
  /**
   * Every tile carries THIS PERIOD'S range in its link.
   *
   * A counter that says "4 open anomalies" and then lands the user on a page showing a different
   * month — and therefore possibly none — reads as "there is nothing wrong". That is the most
   * dangerous thing any of these pages can say, and it is exactly what happens if the range does
   * not travel with the click.
   */
  const from = readiness.periodStart.slice(0, 10)
  const to = readiness.periodEnd.slice(0, 10)
  const range = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`

  // The label and hint come from one key pair per blocker, named by the counter itself, so adding a
  // seventh counter is a row here and two lines in the translation files.
  const label = (key: string) => tr(`attendance.home.blockers.${key}`)
  const hint = (key: string) => tr(`attendance.home.blockers.${key}Hint`)

  return [
    {
      key: 'unprocessedPunches',
      count: readiness.unprocessedPunches,
      to: `/attendance/daily${range}`,
    },
    {
      key: 'unresolvedPinPunches',
      count: readiness.unresolvedPinPunches,
      to: '/attendance/unresolved',
    },
    {
      key: 'openAnomalies',
      count: readiness.openAnomalies,
      to: `/attendance/anomalies${range}`,
    },
    {
      key: 'pendingCorrections',
      count: readiness.pendingCorrections,
      to: '/attendance/corrections',
    },
    {
      key: 'rosteredDaysWithNoRecord',
      count: readiness.rosteredDaysWithNoRecord,
      to: `/attendance/daily${range}`,
    },
    {
      key: 'undecidedExitVariances',
      count: readiness.undecidedExitVariances,
      to: `/attendance/exit-variances${range}`,
    },
    {
      key: 'undecidedAnomalies',
      count: readiness.undecidedAnomalies,
      // Straight onto the worklist: this month, undecided rows only.
      to: `/attendance/anomalies${range}&decision=undecided`,
    },
  ].map((b) => ({ ...b, label: label(b.key), hint: hint(b.key) }))
}

/**
 * The verdict, before any of the detail. An HR user opening this page has exactly one
 * question — can I run payroll — and they should not have to add up six numbers to
 * answer it themselves.
 */
function ReadinessVerdict({
  period,
  blockers,
}: {
  period: string
  blockers: Blocker[]
}) {
  // "Ready" is not the API's isReady flag alone: it is the same six counters the tiles
  // below show, so the headline and the grid can never contradict each other.
  const { t } = useTranslation()
  const openCount = blockers.filter((blocker) => blocker.count > 0).length
  const ready = openCount === 0

  return (
    <>
      <div
        className={ready ? 'readiness readiness--ready' : 'readiness readiness--blocked'}
        role="status"
      >
        {ready ? (
          <IconCheck size={26} className="readiness-icon" aria-hidden="true" />
        ) : (
          <IconAlertTriangle size={26} className="readiness-icon" aria-hidden="true" />
        )}
        <div>
          <p className="readiness-verdict">
            {ready
              ? t('attendance.home.ready', { period: periodLabel(period) })
              : t('attendance.home.notReady', {
                  period: periodLabel(period),
                  count: openCount,
                })}
          </p>
          <p className="readiness-sub">
            {ready ? t('attendance.home.readySub') : t('attendance.home.notReadySub')}
          </p>
        </div>
      </div>

      <div className="readiness-grid">
        {blockers.map((blocker) => (
          <Link
            key={blocker.key}
            to={blocker.to}
            className={
              blocker.count > 0
                ? 'readiness-tile readiness-tile--open'
                : 'readiness-tile readiness-tile--clear'
            }
          >
            <div className="readiness-tile-value">{blocker.count}</div>
            <div className="readiness-tile-label">{blocker.label}</div>
            <div className="readiness-tile-hint">
              {blocker.count > 0 ? blocker.hint : t('common.clear')}
            </div>
          </Link>
        ))}
      </div>
    </>
  )
}

const columnHelper = createColumnHelper<AttendanceSummary>()

const PAGE_SIZES = ['15', '30', '50']

/**
 * The DX grid aligned every dataType="number" column right, in both reading directions —
 * digits line up under digits only when the units digit sits on a fixed edge. Kept here.
 */
const NUMERIC_COLUMNS = new Set([
  'daysWorked',
  'fullDaysWorked',
  'totalLateMinutes',
  'totalOvertimeMinutes',
  'unpaidAbsenceDays',
  'exitLeaveDays',
])

/** What payroll will read — one row per employee. (DevExtreme DataGrid → TanStack + Mantine Table.) */
function SummaryGrid({ rows }: { rows: AttendanceSummary[] }) {
  const { t } = useTranslation()
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      columnHelper.accessor('fullName', { header: t('attendance.home.grid.employee') }),
      // Every numeric column here is rendered to 2dp or as a duration, so each matches on what it
      // PRINTS: raw 7.5 shows as "7.50", and a filter of "7.50" that found nothing would be a bug.
      columnHelper.accessor('daysWorked', {
        header: () => (
          <span
            className="metric"
            title={t('attendance.home.grid.daysWorkedTitle')}
          >
            {t('attendance.home.grid.daysWorked')}
          </span>
        ),
        size: 130,
        cell: (info) => info.row.original.daysWorked.toFixed(2),
        meta: { filterText: (v) => v.toFixed(2) },
      }),
      columnHelper.accessor('fullDaysWorked', {
        header: t('attendance.home.grid.fullDays'),
        size: 110,
      }),
      columnHelper.accessor('totalLateMinutes', {
        header: t('attendance.home.grid.late'),
        size: 110,
        cell: (info) =>
          formatMinutes(info.row.original.totalLateMinutes),
        meta: { filterText: formatMinutes },
      }),
      columnHelper.accessor('totalOvertimeMinutes', {
        header: t('attendance.home.grid.overtimeDetected'),
        size: 160,
        cell: (info) => (
          <span
            className="metric"
            title={t('attendance.home.grid.overtimeDetectedTitle')}
          >
            {formatMinutes(info.row.original.totalOvertimeMinutes)}
          </span>
        ),
        meta: { filterText: formatMinutes },
      }),
      columnHelper.accessor('unpaidAbsenceDays', {
        header: t('attendance.home.grid.unpaidAbsenceDays'),
        size: 170,
        cell: (info) => (
          <span
            className="metric"
            title={t('attendance.home.grid.unpaidAbsenceDaysTitle')}
          >
            {info.row.original.unpaidAbsenceDays.toFixed(2)}
          </span>
        ),
        meta: { filterText: (v) => v.toFixed(2) },
      }),
      columnHelper.accessor('exitLeaveDays', {
        header: t('attendance.home.grid.exitLeaveDays'),
        size: 150,
        cell: (info) => (
          <span
            className="metric"
            title={t('attendance.home.grid.exitLeaveDaysTitle')}
          >
            {info.row.original.exitLeaveDays.toFixed(2)}
          </span>
        ),
        meta: { filterText: (v) => v.toFixed(2) },
      }),
    ],
    [t],
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
    // Multi-column sort on shift-click, as the original's Sorting mode="multiple" allowed.
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 15 } },
    getRowId: (r) => String(r.employeeId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  return (
    <div>
      {/* PORT NOTE: the DevExtreme FilterRow + HeaderFilter are approximated by one global
          search box over the rows on screen. */}
      <Group justify="flex-end" p="xs">
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
                    width: header.column.columnDef.size,
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                    cursor: 'pointer',
                    textAlign: NUMERIC_COLUMNS.has(header.column.id)
                      ? 'right'
                      : undefined,
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
                  {t('attendance.home.noMatch')}
                </div>
              </Table.Td>
            </Table.Tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <Table.Tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <Table.Td
                    key={cell.id}
                    style={
                      NUMERIC_COLUMNS.has(cell.column.id)
                        ? { textAlign: 'right' }
                        : undefined
                    }
                  >
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
          {total === 0 ? 0 : pageIndex * pageSize + 1}–
          {Math.min((pageIndex + 1) * pageSize, total)} of {total}
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

export default function AttendanceHomePage() {
  const { t } = useTranslation()
  const [period, setPeriod] = useState<string>(currentPeriod())
  const [readiness, setReadiness] = useState<PayrollReadiness | null>(null)
  const [summary, setSummary] = useState<AttendanceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Bumped by the Refresh button. Somebody who just fixed an anomaly in another tab needs
  // the verdict to move without reloading the whole app.
  const [reloadToken, setReloadToken] = useState(0)

  const periods = useMemo(() => recentPeriods(), [])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      try {
        // The verdict and the numbers it guards are read together, so the grid can never
        // show figures from a month the verdict is not talking about.
        const [readinessData, summaryData] = await Promise.all([
          attendanceService.getPayrollReadiness(period),
          attendanceService.getSummaryAll(period),
        ])
        if (!cancelled) {
          setReadiness(readinessData)
          setSummary(summaryData)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          // Drop what was on screen. These belong to the PREVIOUS period, and the verdict
          // is rendered against the NEW one — keeping them would headline "June is ready
          // to pay" over July's counters, which is precisely the lie this page exists to
          // prevent. Better to show the error and nothing else.
          setReadiness(null)
          setSummary([])
          setError(getErrorMessage(err))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void initialLoad()
    return () => {
      cancelled = true
    }
  }, [period, reloadToken])

  // LIVE: an import, a processing run or a corrected day changes the readiness verdict this page
  // headlines. Bumping the token re-runs the effect above, so live and the Refresh button take
  // exactly the same path — there is only one way this page reloads.
  useLive(
    ['attendance'],
    useCallback(() => setReloadToken((t) => t + 1), []),
    useLiveEnabled('attendance'),
  )

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  function changePeriod(next: string) {
    setLoading(true)
    setPeriod(next)
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('attendance.home.title')}</h1>
          <p className="page-subtitle">{t('attendance.home.subtitle')}</p>
        </div>
        <div className="page-head-actions">
          <Select
            data={periods.map((item) => ({ value: item, label: periodLabel(item) }))}
            value={period}
            onChange={(v) => {
              if (v != null) changePeriod(v)
            }}
            allowDeselect={false}
            w={170}
            title={t('attendance.home.periodHint')}
          />
          <ActionIcon
            variant="default"
            size="lg"
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            onClick={refresh}
          >
            <IconRefresh size={16} />
          </ActionIcon>
        </div>
      </div>

      <PageHelp>{t('attendance.home.help')}</PageHelp>

      {/* TOP OF THE PAGE, above the period's readiness verdict, because it answers a different and
          more immediate question. Readiness is about closing a MONTH; this is about whether
          attendance is working RIGHT NOW — and "is anything reaching the system today" is the
          thing somebody opens this page to check between machine problems. It loads on its own so
          a slow device list never delays the verdict below. */}
      <PunchPipelineCard />

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : error ? null : (
        <>
          {readiness && (
            <ReadinessVerdict period={period} blockers={blockersOf(readiness)} />
          )}

          <div className="card" style={{ marginTop: 18 }}>
            <div className="card-title">
              {t('attendance.home.whatPayrollReads', { period: periodLabel(period) })}
            </div>
            <p className="hint">
              <Trans i18nKey="attendance.home.overtimeNote" components={{ b: <strong /> }} />
            </p>

            {summary.length === 0 ? (
              <div className="empty-hint">
                <div className="empty-hint-main">
                  {t('attendance.home.noneRecorded', { period: periodLabel(period) })}
                </div>
                {t('attendance.home.noneRecordedHint')}
              </div>
            ) : (
              <SummaryGrid rows={summary} />
            )}
          </div>
        </>
      )}
    </div>
  )
}
