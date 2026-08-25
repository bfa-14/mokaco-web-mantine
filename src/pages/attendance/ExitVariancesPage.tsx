import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Checkbox, Group, Loader, Modal, NumberInput, Pagination, Select, Table, Textarea, TextInput } from '@mantine/core'
import { DateRangeField } from '../../components/DateRangeField'
import { t } from '../../i18n/t'
import { notifications } from '@mantine/notifications'
import { IconRefresh, IconSearch } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { attendanceService } from '../../services/attendanceService'
import { PERMISSIONS, type ExitVariance } from '../../types/attendance'
import {
  currentPeriod,
  formatDate,
  formatMinutes,
  periodRange,
} from './attendanceFormat'

/** HR's three possible rulings. Anything else is "undecided", and undecided blocks payroll. */
type Disposition = 'UnpaidAbsence' | 'Overtime' | 'Ignore'

const DISPOSITION_LABELS: Record<Disposition, string> = {
  UnpaidAbsence: 'Unpaid absence',
  Overtime: 'Offset overtime',
  Ignore: 'Ignore',
}

/**
 * The difference in plain English, with its SIGN said in words.
 *
 * "+30" and "-30" are two characters apart and mean opposite things — one costs the company
 * money and the other saves it. A reader skimming a column of signed numbers under time pressure
 * WILL misread them, so the direction is spelled out rather than left to a minus sign.
 */
function describeVariance(minutes: number): string {
  if (minutes > 0) return `${formatMinutes(minutes)} MORE than approved`
  if (minutes < 0) return `${formatMinutes(Math.abs(minutes))} LESS than approved`
  return 'Exactly what was approved'
}

/**
 * Which rulings are OFFERED for a given variance — and this is a correctness rule, not a
 * cosmetic one.
 *
 * WHY 'Overtime' IS HIDDEN ON A NEGATIVE VARIANCE
 *   Coming back early does not create overtime. The employee worked LESS, not more, and that
 *   shortfall is already reflected in DayFraction. Payroll sums the variance SIGNED:
 *
 *     SUM(CASE WHEN ExitVarianceDisposition = 'Overtime' THEN ExitVarianceMinutes ELSE 0 END)
 *
 *   so ruling a -30 variance as 'Overtime' writes -30 into ExitOffsetMinutes — crediting overtime
 *   that was never worked. Offering the button invites somebody to pay for the same time twice.
 *
 * WHY 'UnpaidAbsence' IS ALSO HIDDEN ON A NEGATIVE VARIANCE
 *   The same signed sum feeds ExitUnpaidMinutes, which payroll DEDUCTS. A -30 variance ruled
 *   'UnpaidAbsence' therefore produces a NEGATIVE deduction — it would ADD 30 minutes of pay for
 *   coming back early. There is nothing to deduct when somebody worked more than they were
 *   excused for, so the only ruling that is true is 'Ignore'.
 *
 * A negative variance costs the company nothing. It needs a decision only because payroll is
 * blocked until every variance has one.
 */
function optionsFor(minutes: number): Disposition[] {
  return minutes > 0
    ? ['UnpaidAbsence', 'Overtime', 'Ignore']
    : ['Ignore']
}

/**
 * What choosing this ruling will DO, in one line, using this row's real numbers.
 *
 * Only ever called for a ruling that optionsFor() actually offers, so it never has to invent a
 * consequence for an impossible combination.
 */
function describeConsequence(row: ExitVariance, disposition: Disposition): string {
  const extra = row.exitVarianceMinutes
  const amount = formatMinutes(Math.abs(extra))

  if (disposition === 'Ignore') {
    return extra < 0
      ? 'No effect on pay. They worked more than they were excused for, so there is nothing to settle.'
      : 'No effect on pay.'
  }

  if (disposition === 'UnpaidAbsence') {
    return `The extra ${amount} will be deducted in payroll.`
  }

  // 'Overtime'. Offsetting against overtime that was never worked is the one way this choice can
  // quietly do nothing, so the shortfall is said out loud BEFORE the click rather than discovered
  // in payroll.
  if (row.overtimeMinutes <= 0) {
    return `The extra ${amount} comes out of overtime already worked — but no overtime was detected that day, so there is none to take it from.`
  }
  if (row.overtimeMinutes < extra) {
    return `The extra ${amount} comes out of overtime already worked — but only ${formatMinutes(row.overtimeMinutes)} was detected that day, which does not cover it.`
  }
  return `The extra ${amount} comes out of the ${formatMinutes(row.overtimeMinutes)} of overtime already worked that day.`
}

/** The confirmation says what was actually decided, in the same words the choice used. */
function describeDecision(row: ExitVariance, disposition: Disposition): string {
  const who = `${row.fullName}, ${formatDate(row.workDate)}`
  const amount = formatMinutes(Math.abs(row.exitVarianceMinutes))

  if (disposition === 'Ignore') {
    return `${who}: ignored. No effect on pay.`
  }
  if (disposition === 'UnpaidAbsence') {
    return `${who}: the extra ${amount} is unpaid and will be deducted in payroll.`
  }
  return `${who}: the extra ${amount} comes out of overtime already worked.`
}

/**
 * One ruling, as a click target that states its own consequence. The consequence is the
 * point: nobody should have to know what "UnpaidAbsence" means in the database to use this.
 */
function DispositionChoice({
  title,
  consequence,
  busy,
  disabled,
  onClick,
}: {
  title: string
  consequence: string
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="disposition-choice"
      disabled={disabled}
      onClick={onClick}
    >
      <div>
        <div className="disposition-choice-title">{title}</div>
        <div className="disposition-choice-consequence">
          {busy ? 'Saving…' : consequence}
        </div>
      </div>
    </button>
  )
}

/**
 * The words the Decision cell prints. 'Undecided' is one of them, and it is the single most
 * useful thing to filter this page by — payroll is blocked on exactly those rows.
 */
function decisionText(disposition: string | null): string {
  if (!disposition) return 'Undecided'
  return DISPOSITION_LABELS[disposition as Disposition] ?? disposition
}

/** Every label the Decision column can show, for its filter dropdown. */
const DECISION_LABELS = ['Undecided', ...Object.values(DISPOSITION_LABELS)]

/** The row's decision, or the muted 'Undecided' that means payroll is still blocked. */
function DecisionCell({ disposition }: { disposition: string | null }) {
  if (!disposition) {
    return <span className="badge badge--muted">Undecided</span>
  }
  // Green here means DECIDED — this row is no longer holding payroll up. It is not a
  // judgement about whether the outcome was good for the employee.
  return <span className="badge badge--on">{decisionText(disposition)}</span>
}

/* PORT NOTE: the DevExtreme DataGrid is TanStack Table + Mantine Table per RequestsGrid.tsx;
   SearchPanel is the global search box, FilterRow the strip under the header, and
   HeaderFilter the funnel in each header cell — all three, as the original had them. */
const columnHelper = createColumnHelper<ExitVariance>()

const PAGE_SIZES = ['15', '30', '50']

function ExitVariancesGrid({
  rows,
  canCorrect,
  onDecide,
}: {
  rows: ExitVariance[]
  canCorrect: boolean
  onDecide: (row: ExitVariance) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      columnHelper.accessor('fullName', { header: 'Employee' }),
      columnHelper.accessor('workDate', {
        header: 'Date',
        cell: (info) => formatDate(info.getValue()),
        meta: { filterText: formatDate },
      }),
      columnHelper.accessor('exitApprovedMinutes', {
        header: 'Approved',
        cell: (info) => formatMinutes(info.getValue()),
        meta: { filterText: formatMinutes },
      }),
      columnHelper.accessor('exitActualMinutes', {
        header: 'Actually took',
        cell: (info) => formatMinutes(info.getValue()),
        meta: { filterText: formatMinutes },
      }),
      // Matching the SENTENCE, not the signed number: the cell says "30m MORE than approved",
      // so typing "more" is how a reader narrows to the rows that cost money.
      columnHelper.accessor('exitVarianceMinutes', {
        header: 'Difference',
        meta: { filterText: describeVariance },
        cell: (info) => {
          const row = info.row.original
          const over = row.exitVarianceMinutes > 0

          // AMBER when they were away longer: it costs money and a human has to rule on it.
          // NEUTRAL when they came back early — it costs the company nothing, and colouring
          // it red would tell the reader something alarming and false.
          return (
            <span
              className={over ? 'badge badge--muted variance--over' : 'badge badge--muted'}
            >
              {describeVariance(row.exitVarianceMinutes)}
            </span>
          )
        },
      }),
      columnHelper.accessor('overtimeMinutes', {
        header: 'Overtime that day',
        cell: (info) => (
          <span
            className="metric"
            title="Overtime detected on the same day. This is what the extra time could be offset against."
          >
            {formatMinutes(info.getValue())}
          </span>
        ),
        meta: { filterText: formatMinutes },
      }),
      columnHelper.accessor('leaveDaysToDeduct', {
        header: 'Leave days to deduct',
        meta: { filterText: (v) => v.toFixed(2) },
        cell: (info) => {
          const row = info.row.original
          return (
            <span
              className="metric"
              title={`${formatMinutes(row.exitLeaveMinutes)} comes off the leave balance.`}
            >
              {row.leaveDaysToDeduct.toFixed(2)}
            </span>
          )
        },
      }),
      // The page's own "Only undecided" tick-box filters the FETCH; this filters what is on
      // screen, and lets a reader isolate one ruling without re-querying.
      columnHelper.accessor('exitVarianceDisposition', {
        header: 'Decision',
        cell: (info) => <DecisionCell disposition={info.getValue()} />,
        meta: { filterText: decisionText, filterOptions: DECISION_LABELS },
      }),
      ...(canCorrect
        ? [
            columnHelper.display({
              id: 'actions',
              header: 'Actions',
              cell: (info) => {
                const row = info.row.original
                const decided = row.exitVarianceDisposition != null
                return (
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    color={decided ? 'gray' : undefined}
                    onClick={() => onDecide(row)}
                  >
                    {decided ? 'Change' : 'Decide'}
                  </Button>
                )
              },
            }),
          ]
        : []),
    ],
    [canCorrect, onDecide],
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
    getRowId: (r) => String(r.attendanceId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <Group justify="flex-end" p="xs">
        <TextInput
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.currentTarget.value)}
          placeholder="Search…"
          leftSection={<IconSearch size={14} />}
          w={240}
          size="xs"
        />
      </Group>

      <Table striped verticalSpacing="xs" fz="sm">
        <Table.Thead>
          {table.getHeaderGroups().map((hg) => (
            <Table.Tr key={hg.id}>
              {hg.headers.map((header) => (
                <Table.Th
                  key={header.id}
                  style={{
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
                  Nothing matches the search.
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

export default function ExitVariancesPage() {
  const { hasPermission } = useAuth()
  // Deciding a variance changes what someone is paid, so it is HR-only. Everyone else sees
  // the queue and can chase it, but the Decide button simply is not there for them.
  const canCorrect = hasPermission(PERMISSIONS.correct)

  /**
   * The range travels in the URL, so the Overview's "undecided exit variances" counter opens this
   * page on the period it was counting. A range that silently reset to this month would show a
   * different queue than the number the user just clicked — possibly an empty one.
   */
  const [searchParams, setSearchParams] = useSearchParams()
  const defaultRange = periodRange(currentPeriod())

  const from = searchParams.get('from') ?? defaultRange.from
  const to = searchParams.get('to') ?? defaultRange.to

  function setRange(next: { from?: string; to?: string }) {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current)
        params.set('from', next.from ?? from)
        params.set('to', next.to ?? to)
        return params
      },
      { replace: true },
    )
  }

  const setFrom = (value: string) => setRange({ from: value })
  const setTo = (value: string) => setRange({ to: value })
  const [onlyUndecided, setOnlyUndecided] = useState(true)

  const [rows, setRows] = useState<ExitVariance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [decideRow, setDecideRow] = useState<ExitVariance | null>(null)
  const [leaveOverride, setLeaveOverride] = useState<number | null>(null)
  const [hrNote, setHrNote] = useState('')
  const [saving, setSaving] = useState<Disposition | null>(null)
  /** PORT NOTE: Validator/RangeRule → the same min-0 check, held as an inline error. */
  const [overrideError, setOverrideError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await attendanceService.getExitVariances(from, to, onlyUndecided))
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [from, to, onlyUndecided])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      setLoading(true)
      try {
        const data = await attendanceService.getExitVariances(from, to, onlyUndecided)
        if (!cancelled) {
          setRows(data)
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
  }, [from, to, onlyUndecided])

  function refresh() {
    setLoading(true)
    void load()
  }

  function openDecide(row: ExitVariance) {
    setDecideRow(row)
    // Left empty on purpose: empty means "keep the default leave deduction". Pre-filling it
    // would turn every decision into an override, whether HR meant one or not.
    setLeaveOverride(null)
    setHrNote(row.hrNote ?? '')
    setSaving(null)
    setOverrideError(null)
  }

  async function decide(disposition: Disposition) {
    if (!decideRow) return

    if (leaveOverride != null && leaveOverride < 0) {
      setOverrideError('Leave deducted cannot be a negative number of minutes')
      return
    }

    setSaving(disposition)
    try {
      await attendanceService.setExitDisposition(decideRow.attendanceId, {
        disposition,
        exitLeaveMinutesOverride: leaveOverride,
        hrNote: hrNote.trim() ? hrNote.trim() : null,
      })
      const message =
        leaveOverride == null
          ? describeDecision(decideRow, disposition)
          : `${describeDecision(decideRow, disposition)} Leave deducted: ${formatMinutes(leaveOverride)}.`
      notifications.show({ message, color: 'green', autoClose: 4000 })
      setDecideRow(null)
      await load()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSaving(null)
    }
  }

  const undecidedCount = rows.filter((row) => row.exitVarianceDisposition == null).length

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Exit variances</h1>
          <p className="page-subtitle">
            Approved exits that do not match the punches. Each one needs a decision.
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
            <IconRefresh size={18} />
          </ActionIcon>
        </div>
      </div>

      <PageHelp>
        Someone was approved for a short exit but the punches show something different.
        Attendance reports the difference; you decide what it means. Payroll will not run until
        every one of these is decided.
      </PageHelp>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <div className="filter-bar">
        <div className="filter-field">
          <label className="filter-field-label" htmlFor="variance-period">
            {t('common.period')}
          </label>
          {/* NOT CLEARABLE — the range travels in the URL and the endpoint requires both ends. */}
          <DateRangeField
            id="variance-period"
            from={from}
            to={to}
            onChange={(nextFrom, nextTo) => {
              if (nextFrom && nextTo) {
                setFrom(nextFrom)
                setTo(nextTo)
              }
            }}
          />
        </div>

        <div className="filter-field">
          <span className="filter-field-label">Show</span>
          <Checkbox
            label="Only undecided"
            checked={onlyUndecided}
            onChange={(e) => setOnlyUndecided(e.currentTarget.checked)}
          />
        </div>

        <div className="filter-spacer" />
      </div>

      {loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">
              {onlyUndecided
                ? `Nothing is waiting on a decision between ${from} and ${to}.`
                : `No exit variances between ${from} and ${to}.`}
            </div>
            {/*
              With "Only undecided" on, an empty list means nothing is UNDECIDED — it does not
              mean every exit matched. Saying so would tell HR the month is clean while decided
              variances sit behind the filter. The two cases get different, true copy.
            */}
            {onlyUndecided ? (
              <>
                Nothing in this range is holding payroll up. Untick &ldquo;Only
                undecided&rdquo; above to see the ones already ruled on, or widen the dates to
                look further back.
              </>
            ) : (
              <>
                Every approved exit in this range matches what the punches show, so there is
                nothing to rule on. If you expected somebody here, widen the dates — a day is
                only listed once its punches have been imported and processed on{' '}
                <Link to="/attendance/daily">Daily attendance</Link>.
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <h2 className="card-title">
              Payroll will not run while anything is in this queue.
            </h2>
            <p>
              Attendance reports the difference; you decide what it means.
              {undecidedCount > 0
                ? ` ${undecidedCount} still to decide.`
                : ' Everything shown here has already been decided.'}
            </p>
          </div>

          <ExitVariancesGrid rows={rows} canCorrect={canCorrect} onDecide={openDecide} />
        </>
      )}

      {/* Mounted only once a row is chosen — there is always a `decideRow` by the time it renders,
          so the title needs no fallback. (The original's caveat about devextreme-react capturing
          Popup children as a content template does not apply to Mantine's Modal.) */}
      {decideRow && (
        <Modal
          opened
          onClose={() => setDecideRow(null)}
          title={`Decide — ${decideRow.fullName}, ${formatDate(decideRow.workDate)}`}
          size={480}
          centered
          closeOnClickOutside={saving === null}
        >
          <div>
            <div className="result-row">
              <div className="result-tile">
                <div className="result-tile-value">
                  {formatMinutes(decideRow.exitApprovedMinutes)}
                </div>
                <div className="result-tile-label">Approved</div>
              </div>
              <div className="result-tile">
                <div className="result-tile-value">
                  {formatMinutes(decideRow.exitActualMinutes)}
                </div>
                <div className="result-tile-label">Actually took</div>
              </div>
              <div className="result-tile">
                <div className="result-tile-value">
                  {formatMinutes(decideRow.exitVarianceMinutes)}
                </div>
                <div className="result-tile-label">
                  {describeVariance(decideRow.exitVarianceMinutes)}
                </div>
              </div>
            </div>

            {/* TWO SEPARATE DECISIONS, and people confuse them constantly:
                  - the DISPOSITION settles the DIFFERENCE between approved and actual;
                  - the OVERRIDE sets how many minutes come off the LEAVE BALANCE.
                A day can need both, one, or neither. They are labelled and boxed apart so that
                choosing a disposition never reads as "and that is the leave sorted too". */}
            <div className="form-field">
              <span className="form-label">
                What should happen to the difference?
              </span>

              <div className="disposition-actions">
                {optionsFor(decideRow.exitVarianceMinutes).map((option) => (
                  <DispositionChoice
                    key={option}
                    title={DISPOSITION_LABELS[option]}
                    consequence={describeConsequence(decideRow, option)}
                    busy={saving === option}
                    disabled={saving !== null}
                    onClick={() => void decide(option)}
                  />
                ))}
              </div>

              {/* Say WHY the other two rulings are not on offer. A missing button with no
                  explanation reads as a bug; the reason is the whole point. */}
              {decideRow.exitVarianceMinutes < 0 && (
                <p className="hint">
                  They came back early, so there is no extra time to deduct and no overtime to
                  offset — coming back early means they worked <em>more</em> than they were
                  excused for, and that is already reflected in the day fraction. Ignoring it is
                  the only ruling that is true. It still needs the click, because payroll will not
                  run while any variance is undecided.
                </p>
              )}
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="variance-leave-override">
                Minutes to deduct from leave
              </label>
              <NumberInput
                id="variance-leave-override"
                value={leaveOverride ?? ''}
                min={0}
                hideControls
                onChange={(v) => {
                  setLeaveOverride(typeof v === 'number' ? v : null)
                  if (overrideError) setOverrideError(null)
                }}
                placeholder={`Leave empty to deduct ${formatMinutes(decideRow.exitLeaveMinutes)} (${decideRow.leaveDaysToDeduct.toFixed(2)} days)`}
                disabled={saving !== null}
                error={overrideError}
              />
              <p className="hint">
                This is a <strong>different decision</strong> from the one above. The buttons
                settle the <em>difference</em> between what was approved and what happened; this
                sets how many minutes come off their <em>leave balance</em>. By default that is
                the time they actually took —{' '}
                {formatMinutes(decideRow.exitActualMinutes)}. It applies whichever ruling you
                choose, and on an early return too.
              </p>
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="variance-note">
                Note (optional)
              </label>
              <Textarea
                id="variance-note"
                value={hrNote}
                minRows={2}
                onChange={(e) => setHrNote(e.currentTarget.value)}
                placeholder="Why you decided it this way. Somebody will ask."
                disabled={saving !== null}
              />
            </div>

            <div className="form-actions">
              <Button
                variant="default"
                onClick={() => setDecideRow(null)}
                disabled={saving !== null}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
