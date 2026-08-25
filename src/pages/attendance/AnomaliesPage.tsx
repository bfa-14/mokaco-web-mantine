import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Loader, Modal, NumberInput, Pagination, Select, Table, Textarea, TextInput } from '@mantine/core'
import { DateTimePicker } from '@mantine/dates'
import { DateRangeField } from '../../components/DateRangeField'
import { t } from '../../i18n/t'
import { notifications } from '@mantine/notifications'
import { IconCalendar, IconPencil, IconRefresh, IconSearch } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { dateTimeToPicker, secondsDateTimeFromPicker } from '../../components/date/pickerValue'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { attendanceService, correctionsService } from '../../services/attendanceService'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { useAuth } from '../../auth/useAuth'
import { PERMISSIONS, type AttendanceRecord } from '../../types/attendance'
import { StatusBadge } from './attendanceShared'
import {
  currentPeriod,
  describeAnomaly,
  formatDate,
  formatMinutes,
  formatTime,
  periodRange,
  statusText,
} from './attendanceFormat'

/** The four values a day can be corrected to. Anything else is not a day payroll understands. */
const STATUS_OPTIONS = ['Present', 'Absent', 'RestDay', 'Leave']

interface CorrectionFormState {
  newFirstInUtc: string | null
  newLastOutUtc: string | null
  newExitMinutes: number | null
  newStatus: string | null
  reason: string
}

/**
 * What the day says RIGHT NOW, shown beside the fields that will change it. A correction
 * is a change to somebody's pay, so the user has to be able to see what they are changing
 * FROM, not just what they are typing.
 */
function CurrentValues({ record }: { record: AttendanceRecord }) {
  return (
    <div className="diff-col">
      <div className="diff-title">On record now</div>
      <div className="diff-line">
        <span className="diff-line-label">First in</span>
        <span>{formatTime(record.firstInUtc)}</span>
      </div>
      <div className="diff-line">
        <span className="diff-line-label">Last out</span>
        <span>{formatTime(record.lastOutUtc)}</span>
      </div>
      <div className="diff-line">
        <span className="diff-line-label">Exit minutes</span>
        <span>{formatMinutes(record.exitActualMinutes)}</span>
      </div>
      <div className="diff-line">
        <span className="diff-line-label">Status</span>
        <span>{record.status}</span>
      </div>
      <div className="diff-line">
        <span className="diff-line-label">Worked</span>
        <span>{formatMinutes(record.workedMinutes)}</span>
      </div>
    </div>
  )
}

/* PORT NOTE: the DevExtreme DataGrid is TanStack Table + Mantine Table per RequestsGrid.tsx;
   SearchPanel is the global search box, FilterRow the strip under the header, and
   HeaderFilter the funnel in each header cell — all three, as the original had them. */
const columnHelper = createColumnHelper<AttendanceRecord>()

const PAGE_SIZES = ['15', '30', '50']

function AnomaliesGrid({
  rows,
  canCorrect,
  onFix,
}: {
  rows: AttendanceRecord[]
  canCorrect: boolean
  onFix: (record: AttendanceRecord) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      columnHelper.accessor('fullName', { header: 'Employee' }),
      // The accessor stays the raw timestamp so the sort is chronological; the MATCH is against
      // the rendered date, because that is the string on screen to type at.
      columnHelper.accessor('workDate', {
        header: 'Date',
        cell: (info) => formatDate(info.getValue()),
        meta: { filterText: formatDate },
      }),
      columnHelper.accessor('firstInUtc', {
        header: 'First in',
        cell: (info) => formatTime(info.getValue()),
        meta: { filterText: formatTime },
      }),
      columnHelper.accessor('lastOutUtc', {
        header: 'Last out',
        cell: (info) => formatTime(info.getValue()),
        meta: { filterText: formatTime },
      }),
      /* Pairs, not punches: an IN with no OUT is not half a pair, it is the anomaly.
         (PORT NOTE: alignment={alignStart()} dropped — Mantine cells already start-align.) */
      columnHelper.accessor('punchPairs', { header: 'Pairs' }),
      /*
        The whole point of the page. A flag called HasAnomaly tells nobody what to do;
        "Punched in at 08:00, never punched out" tells them exactly what to fix.
      */
      columnHelper.display({
        id: 'whatHappened',
        header: 'What happened',
        cell: (info) => describeAnomaly(info.row.original),
      }),
      // A closed set of four, so a dropdown over the DISPLAYED words rather than a text box over
      // the codes — nobody looking at "Rest day" would think to type "RestDay".
      columnHelper.accessor('status', {
        header: 'Status',
        cell: (info) => <StatusBadge status={info.getValue()} />,
        meta: { filterText: statusText, filterOptions: STATUS_OPTIONS.map(statusText) },
      }),
      /* The column is ALWAYS rendered and only the BUTTON is permission-gated. The page names
         problems that block payroll; without a way out it is just a list of accusations. (The
         original also kept the <Column> unconditional to dodge a devextreme-react quirk with
         conditional children; that hazard is gone, the design stands.) */
      columnHelper.display({
        id: 'actions',
        header: 'Actions',
        cell: (info) =>
          canCorrect ? (
            <Button
              variant="subtle"
              size="compact-sm"
              leftSection={<IconPencil size={14} />}
              onClick={() => onFix(info.row.original)}
            >
              Fix this
            </Button>
          ) : (
            <span className="hint">
              Needs the &lsquo;correct attendance&rsquo; permission
            </span>
          ),
      }),
    ],
    [canCorrect, onFix],
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

export default function AnomaliesPage() {
  const { hasPermission } = useAuth()
  // Raising a correction changes what somebody is paid, so it is HR-only. Anyone else
  // simply never sees the button — a greyed-out control they can never use is noise.
  const canCorrect = hasPermission(PERMISSIONS.correct)

  /**
   * The date range lives in the URL, not just in state.
   *
   * Somebody arriving from Daily attendance is looking at a specific stretch of days, and landing
   * here on a DIFFERENT range would show them a different set of problems — or none — and read as
   * "there is nothing wrong", which is the most dangerous thing this page could say. So the range
   * travels with the link, and only falls back to the current month when nobody supplied one.
   * Keeping it in the URL also makes the view shareable and survives a reload.
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
      // Replace rather than push: dragging a date picker should not bury the page the user came
      // from under a dozen history entries.
      { replace: true },
    )
  }

  const setFrom = (value: string) => setRange({ from: value })
  const setTo = (value: string) => setRange({ to: value })

  const [rows, setRows] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [target, setTarget] = useState<AttendanceRecord | null>(null)
  const [form, setForm] = useState<CorrectionFormState>({
    newFirstInUtc: null,
    newLastOutUtc: null,
    newExitMinutes: null,
    newStatus: null,
    reason: '',
  })
  const [saving, setSaving] = useState(false)
  /** PORT NOTE: Validator/RequiredRule → the same required check, held as an inline error. */
  const [reasonError, setReasonError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await attendanceService.getAnomalies(from, to))
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      // Changing the range must show the spinner, not leave the PREVIOUS range's anomalies
      // on screen. Stale rows here read as "these days are still broken" and invite someone
      // to correct a day that is not in the range they are looking at.
      setLoading(true)
      try {
        const data = await attendanceService.getAnomalies(from, to)
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
  }, [from, to])

  function refresh() {
    setLoading(true)
    void load()
  }

  /**
   * Prefilled with what the machine already has, so the user edits the one thing that is
   * wrong instead of retyping a whole day from memory.
   */
  function openCorrection(record: AttendanceRecord) {
    setTarget(record)
    setForm({
      newFirstInUtc: record.firstInUtc,
      newLastOutUtc: record.lastOutUtc,
      newExitMinutes: record.exitActualMinutes,
      newStatus: record.status,
      reason: '',
    })
    setReasonError(null)
  }

  async function submitCorrection() {
    if (!target) return

    if (!form.reason.trim()) {
      setReasonError("A reason is required — this changes someone's pay.")
      return
    }

    setSaving(true)
    try {
      await correctionsService.create({
        attendanceId: target.attendanceId,
        newFirstInUtc: form.newFirstInUtc,
        newLastOutUtc: form.newLastOutUtc,
        newExitMinutes: form.newExitMinutes,
        newStatus: form.newStatus,
        reason: form.reason.trim(),
      })
      // A correction does NOT take effect on submission — it waits for approval. Saying so is
      // what stops somebody raising one, seeing the anomaly still listed, and raising it again.
      notifications.show({
        message: 'Correction raised. It will apply once approved on the Corrections page.',
        color: 'green',
        autoClose: 4000,
      })
      setTarget(null)
      await load()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Anomalies</h1>
          <p className="page-subtitle">
            Days the machine could not read confidently.
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
        The machine recorded something it could not read confidently — usually a missing
        punch-out. Fix each one with a correction; the original punches are never edited.
      </PageHelp>

      {/*
        The stakes, said plainly. An anomaly is not a cosmetic warning: the hours on that
        day are not trustworthy, so payroll refuses to run until every one is dealt with.
      */}
      <p className="hint">
        Anomalies <strong>block payroll</strong> — the hours on these days are not
        trustworthy, so the month cannot be paid while any are left open. A correction you
        raise here goes to the{' '}
        <Link to="/attendance/corrections">Corrections</Link> page and changes the day only
        once it is approved.
      </p>

      {/* NOT CLEARABLE. The range travels in the URL and /api/attendance/anomalies takes both
          dates as required query parameters — there is no "unfiltered" for this endpoint to answer,
          so an X here would only produce a broken request. The pair is one period, so it is one
          control; the empty state is the part the API would have to grow first. */}
      <div className="filter-bar">
        <div className="filter-field">
          <span className="filter-field-label">{t('common.period')}</span>
          <DateRangeField
            from={from}
            to={to}
            onChange={(nextFrom, nextTo) => {
              // Both or neither: a half-cleared range would send an empty bound to an endpoint that
              // requires one, so the standing value is kept until a full range replaces it.
              if (nextFrom && nextTo) {
                setFrom(nextFrom)
                setTo(nextTo)
              }
            }}
          />
        </div>
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">No anomalies in this range.</div>
            Every day from {from} to {to} was read cleanly, so nothing here is blocking
            payroll. If you expected to see something, widen the dates above — a day is
            only listed if it falls inside the range. If the punches for it were never
            imported or processed, the day does not exist yet: start from{' '}
            <Link to="/attendance">Attendance home</Link>.
          </div>
        </div>
      ) : (
        <AnomaliesGrid rows={rows} canCorrect={canCorrect} onFix={openCorrection} />
      )}

      {/* Mounted only once `target` exists — there is always a target by the time it renders, so
          the title needs no fallback. (The original's caveat about devextreme-react capturing
          Popup children as a content template does not apply to Mantine's Modal.) */}
      {target && (
        <Modal
          opened
          onClose={() => setTarget(null)}
          title={`Correct ${target.fullName} — ${formatDate(target.workDate)}`}
          size={480}
          centered
          closeOnClickOutside={!saving}
        >
          <div>
            {/* WHAT IS BROKEN, in words, at the top. The user came here from a grid of many
                rows; without this they would be editing times with no reminder of which day
                they are fixing or why it was flagged. */}
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="empty-hint-main">
                {target.fullName} — {formatDate(target.workDate)}
              </div>
              <p className="hint" style={{ marginTop: 4 }}>
                {describeAnomaly(target)}
              </p>
            </div>

            <p className="hint">
              A correction records what was changed, by whom, and why. The original punches
              from the machine are never overwritten.
            </p>

            <CurrentValues record={target} />

            {/* PORT NOTE: DateBox type="datetime" → DateTimePicker. The state keeps the API's
                'yyyy-MM-ddTHH:mm:ss' shape; the seconds are re-appended by the shared adapter
                rather than inline. Clearable, because a correction may deliberately blank a
                punch — that is the whole point of the "never punched out" case. */}
            <div className="form-field">
              <label className="form-label">First in</label>
              <DateTimePicker
                valueFormat="DD/MM/YYYY HH:mm"
                leftSection={<IconCalendar size={14} />}
                clearable
                value={dateTimeToPicker(form.newFirstInUtc)}
                disabled={saving}
                onChange={(v) =>
                  setForm((f) => ({ ...f, newFirstInUtc: secondsDateTimeFromPicker(v) }))
                }
              />
            </div>

            <div className="form-field">
              <label className="form-label">Last out</label>
              <DateTimePicker
                valueFormat="DD/MM/YYYY HH:mm"
                leftSection={<IconCalendar size={14} />}
                clearable
                value={dateTimeToPicker(form.newLastOutUtc)}
                disabled={saving}
                onChange={(v) =>
                  setForm((f) => ({ ...f, newLastOutUtc: secondsDateTimeFromPicker(v) }))
                }
              />
            </div>

            <div className="form-field">
              <label className="form-label">Exit minutes</label>
              <NumberInput
                min={0}
                value={form.newExitMinutes ?? ''}
                disabled={saving}
                onChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    newExitMinutes: typeof v === 'number' ? v : null,
                  }))
                }
              />
              <span className="hint">
                Minutes the person was away during the day, beyond their break.
              </span>
            </div>

            <div className="form-field">
              <label className="form-label">Status</label>
              <Select
                data={STATUS_OPTIONS}
                value={form.newStatus}
                disabled={saving}
                allowDeselect={false}
                onChange={(v) => setForm((f) => ({ ...f, newStatus: v }))}
              />
            </div>

            {/*
              Required, and deliberately so: a correction without a reason is an
              unexplained change to somebody's pay, and somebody WILL ask why later.
            */}
            <div className="form-field">
              <label className="form-label">Reason</label>
              <Textarea
                minRows={3}
                placeholder="e.g. Forgot to punch out; branch manager confirmed she left at 17:00."
                value={form.reason}
                disabled={saving}
                error={reasonError}
                onChange={(e) => {
                  const value = e.currentTarget.value
                  setForm((f) => ({ ...f, reason: value }))
                  if (reasonError) setReasonError(null)
                }}
              />
            </div>

            <div className="form-actions">
              <Button
                variant="default"
                onClick={() => setTarget(null)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void submitCorrection()}
                loading={saving}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Request correction'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
