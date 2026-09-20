import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Loader, Pagination, SegmentedControl, Select, Table, Textarea, TextInput } from '@mantine/core'
import { DateTimePicker } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconCalendar, IconCheck, IconClockEdit, IconMinus, IconRefresh, IconSearch } from '@tabler/icons-react'
import { Modal } from '../../components/dialogs'
import { getErrorMessage } from '../../api/errorMessage'
import {
  dateTimeToPicker,
  secondsDateTimeFromPicker,
} from '../../components/date/pickerValue'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { PageHelp } from '../../components/PageHelp'
import { attendanceService } from '../../services/attendanceService'
import { branchesService } from '../../services/hrService'
import { useAuth } from '../../auth/useAuth'
import { t as tr } from '../../i18n/t'
import {
  PERMISSIONS,
  type AnomalyDecision,
  type AnomalyType,
  type AttendanceAnomaly,
} from '../../types/attendance'
import type { Branch } from '../../types/hr'
import { DateRangeField } from '../../components/DateRangeField'
import { DeviceQuarantineList, WorkedWithoutRosterList } from './AnomalyExtraLists'
import { currentPeriod, formatDate, formatMinutes, formatTime, periodLabel, periodRange } from './attendanceFormat'

/* ── words ── */

const TYPES: AnomalyType[] = ['LateArrival', 'EarlyDeparture', 'MissingPunch', 'HalfDayAbsence']

/** The three worklists of this page. The two beside the anomalies are not rulings — they are days and punches the
    system could not place: a day worked that the roster does not know, a punch from a PIN that belongs to nobody. */
type PageView = 'anomalies' | 'unrostered' | 'devices'
const DECISIONS: AnomalyDecision[] = ['Excused', 'Deducted', 'Corrected']

/** The type as the words on screen. Unknown codes render as themselves rather than as a missing key. */
function typeText(type: string): string {
  return tr(`attendance.anomalies.type.${type}`, { defaultValue: type })
}

/** The decision as the words on screen; null is 'Undecided', the one value payroll is blocked on. */
function decisionText(decision: string | null): string {
  return tr(`attendance.anomalies.decision.${decision ?? 'Undecided'}`, {
    defaultValue: decision ?? 'Undecided',
  })
}

/** '2026-08-14T09:05:00' → '14/08/2026 09:05' — a decision's timestamp, in the app's day-first shape. */
function formatWhen(value: string | null): string {
  if (!value) return tr('common.dash')
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year} ${formatTime(value)}`
}

/**
 * Which punch a "Correct time" replaces. The API stores it on that side: a late arrival corrects
 * the In, an early departure the Out, a missing punch whichever side is missing.
 */
function correctedSide(row: AttendanceAnomaly): 'in' | 'out' {
  if (row.type === 'LateArrival') return 'in'
  if (row.type === 'EarlyDeparture') return 'out'
  return row.punchIn == null ? 'in' : 'out'
}

/* ── small cells ── */

function TypeBadge({ type }: { type: AnomalyType }) {
  const tone =
    type === 'LateArrival'
      ? 'badge--late'
      : type === 'EarlyDeparture'
        ? 'badge--early'
        : type === 'HalfDayAbsence'
          ? 'badge--halfday'
          : 'badge--missing'
  return <span className={`badge ${tone}`}>{typeText(type)}</span>
}

/**
 * The punch beside the shift time it is measured against — "07:10 · shift 07:00". The side the
 * anomaly is ABOUT is bold, so a reader scanning the In column sees at once which rows it explains.
 */
function PunchVsShift({
  punch,
  shift,
  flagged,
}: {
  punch: string | null
  shift: string | null
  flagged: boolean
}) {
  return (
    <span className="punch-vs-shift">
      <span className={flagged ? 'punch-vs-shift-flagged' : undefined}>{formatTime(punch)}</span>
      <span className="punch-vs-shift-shift">
        {shift ? tr('attendance.anomalies.shiftAt', { time: formatTime(shift) }) : tr('attendance.anomalies.noShift')}
      </span>
    </span>
  )
}

/** The ruling, and under it who made it and when. Green means DECIDED, not "good for the employee". */
function DecisionCell({ row }: { row: AttendanceAnomaly }) {
  if (!row.decision) {
    return <span className="badge badge--muted">{decisionText(null)}</span>
  }
  const who = row.decidedBy ?? tr('attendance.anomalies.automatic')
  return (
    <span title={row.note ?? undefined}>
      <span className="badge badge--on">{decisionText(row.decision)}</span>
      <span className="decision-meta">
        {tr('attendance.anomalies.decidedLine', { who, when: formatWhen(row.decidedAt) })}
      </span>
    </span>
  )
}

/** The decision one row is being given, and the row it is about. */
interface DecideTarget {
  row: AttendanceAnomaly
  mode: 'Excuse' | 'Deduct' | 'Correct'
}

/* ── grid ── */

const columnHelper = createColumnHelper<AttendanceAnomaly>()

const PAGE_SIZES = ['15', '30', '50']

function AnomaliesGrid({
  rows,
  canCorrect,
  onDecide,
}: {
  rows: AttendanceAnomaly[]
  canCorrect: boolean
  onDecide: (target: DecideTarget) => void
}) {
  const { t } = useTranslation()
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      columnHelper.accessor('fullName', { header: t('attendance.anomalies.columns.employee') }),
      // The accessor stays the raw timestamp so the sort is chronological; the MATCH is against
      // the rendered date, because that is the string on screen to type at.
      columnHelper.accessor('workDate', {
        header: t('attendance.anomalies.columns.date'),
        cell: (info) => formatDate(info.getValue()),
        meta: { filterText: formatDate },
      }),
      columnHelper.accessor('type', {
        header: t('attendance.anomalies.columns.type'),
        cell: (info) => <TypeBadge type={info.getValue()} />,
        meta: { filterText: typeText, filterOptions: TYPES.map(typeText) },
      }),
      /* Zero for a missing punch is not "zero minutes late" — there is nothing to measure — so it
         prints as a dash. Sorting stays numeric on the raw value. */
      columnHelper.accessor('minutes', {
        header: t('attendance.anomalies.columns.minutes'),
        cell: (info) =>
          info.row.original.type === 'MissingPunch' ? t('common.dash') : formatMinutes(info.getValue()),
        meta: {
          filterText: (v, r) => (r.type === 'MissingPunch' ? '' : formatMinutes(v)),
          noHeaderFilter: true,
        },
      }),
      columnHelper.accessor('punchIn', {
        header: t('attendance.anomalies.columns.in'),
        cell: (info) => (
          <PunchVsShift
            punch={info.getValue()}
            shift={info.row.original.shiftStart}
            flagged={correctedSide(info.row.original) === 'in'}
          />
        ),
        meta: { filterText: formatTime, noHeaderFilter: true },
      }),
      columnHelper.accessor('punchOut', {
        header: t('attendance.anomalies.columns.out'),
        cell: (info) => (
          <PunchVsShift
            punch={info.getValue()}
            shift={info.row.original.shiftEnd}
            flagged={correctedSide(info.row.original) === 'out'}
          />
        ),
        meta: { filterText: formatTime, noHeaderFilter: true },
      }),
      columnHelper.accessor('branchName', {
        header: t('attendance.anomalies.columns.branch'),
        cell: (info) => info.getValue() ?? t('common.dash'),
        meta: { filterText: (v) => v ?? '' },
      }),
      columnHelper.accessor('decision', {
        header: t('attendance.anomalies.columns.decision'),
        cell: (info) => <DecisionCell row={info.row.original} />,
        meta: {
          filterText: (v, r) =>
            `${decisionText(v)} ${r.decidedBy ?? ''} ${formatWhen(r.decidedAt)}`.trim(),
          filterOptions: [decisionText(null), ...DECISIONS.map(decisionText)],
        },
      }),
      /* The column is ALWAYS rendered and only the BUTTONS are permission-gated: the page names
         minutes that will or will not be paid, and without a way to rule on them it is just a list
         of accusations. The rules, in words rather than greyed buttons:
           - a missing punch can only be corrected (there are no minutes to excuse or deduct);
           - Excused ↔ Deducted may be changed;
           - Corrected is final — the punch is on the day now. */
      columnHelper.display({
        id: 'actions',
        header: t('attendance.anomalies.columns.actions'),
        cell: (info) => {
          const row = info.row.original
          if (!canCorrect) {
            return <span className="hint">{t('attendance.anomalies.actions.needsPermission')}</span>
          }
          if (row.decision === 'Corrected') {
            return <span className="hint">{t('attendance.anomalies.actions.final')}</span>
          }
          const missing = row.type === 'MissingPunch'
          return (
            <Group gap={4} wrap="nowrap">
              {!missing && row.decision !== 'Excused' && (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  leftSection={<IconCheck size={14} />}
                  onClick={() => onDecide({ row, mode: 'Excuse' })}
                >
                  {t('attendance.anomalies.actions.excuse')}
                </Button>
              )}
              {!missing && row.decision !== 'Deducted' && (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  color="red"
                  leftSection={<IconMinus size={14} />}
                  onClick={() => onDecide({ row, mode: 'Deduct' })}
                >
                  {t('attendance.anomalies.actions.deduct')}
                </Button>
              )}
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={<IconClockEdit size={14} />}
                title={missing ? t('attendance.anomalies.actions.missingOnlyCorrect') : undefined}
                onClick={() => onDecide({ row, mode: 'Correct' })}
              >
                {t('attendance.anomalies.actions.correctTime')}
              </Button>
            </Group>
          )
        },
      }),
    ],
    [canCorrect, onDecide, t],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter, columnFilters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 15 } },
    // ONE ROW PER ANOMALY: a day with a late arrival AND an early departure is two rows sharing an
    // attendanceId, so the key has to be the anomaly's own id.
    getRowId: (r) => String(r.anomalyId),
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
          placeholder={`${t('common.search')}…`}
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
                  {t('attendance.anomalies.empty.noMatch')}
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

/* ── page ── */

/** The Decision filter's values. 'undecided' is the worklist and the default; the rest are for looking back. */
type DecisionFilter = 'undecided' | 'all' | AnomalyDecision

function parseDecisionFilter(value: string | null): DecisionFilter {
  if (value === 'all') return 'all'
  if (value && (DECISIONS as string[]).includes(value)) return value as AnomalyDecision
  return 'undecided'
}

function parseTypeFilter(value: string | null): AnomalyType | '' {
  return value && (TYPES as string[]).includes(value) ? (value as AnomalyType) : ''
}

export default function AnomaliesPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  // Every button here moves what somebody is paid, so it is HR-only. Anyone else sees the list
  // (the route itself needs the same right) with the reason in place of the buttons.
  const canCorrect = hasPermission(PERMISSIONS.correct)

  /**
   * THE FILTERS LIVE IN THE URL.
   *
   * Payroll readiness links here with THIS month's range and "undecided", and landing on a different
   * month — or on decided rows — would read as "there is nothing to do", which is the most dangerous
   * thing this page could say. `from`/`to` are kept (older links carry them); the month control
   * writes a whole month into them, and the bulk actions act on the month of `from`.
   */
  const [searchParams, setSearchParams] = useSearchParams()
  const defaultRange = periodRange(currentPeriod())
  const from = searchParams.get('from') ?? defaultRange.from
  const to = searchParams.get('to') ?? defaultRange.to
  const month = from.slice(0, 7)
  const typeFilter = parseTypeFilter(searchParams.get('type'))
  const decisionFilter = parseDecisionFilter(searchParams.get('decision'))
  const branchId = Number(searchParams.get('branchId')) || null
  const viewParam = searchParams.get('view')
  const view: PageView = viewParam === 'unrostered' || viewParam === 'devices' ? viewParam : 'anomalies'
  /** Bumped by the refresh button and after a PIN is mapped — the two side lists re-read on it. */
  const [extraReload, setExtraReload] = useState(0)

  function setParams(next: Record<string, string | null>) {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current)
        for (const [key, value] of Object.entries(next)) {
          if (value == null || value === '') params.delete(key)
          else params.set(key, value)
        }
        return params
      },
      // Replace rather than push: changing a filter should not bury the page the user came from
      // under a dozen history entries.
      { replace: true },
    )
  }

  const [rows, setRows] = useState<AttendanceAnomaly[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // The API filters by range, branch and "undecided only"; type and a specific decision are
  // narrowed here, on the same list, so switching between them costs no round trip.
  const onlyUndecided = decisionFilter === 'undecided'

  const load = useCallback(async () => {
    try {
      setRows(await attendanceService.getAnomalies(from, to, onlyUndecided, branchId))
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [from, to, onlyUndecided, branchId])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      // Changing the filters must show the spinner, not leave the PREVIOUS filters' rows on
      // screen: stale rows read as "these are still undecided" and invite a second ruling.
      setLoading(true)
      try {
        const data = await attendanceService.getAnomalies(from, to, onlyUndecided, branchId)
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
  }, [from, to, onlyUndecided, branchId])

  useEffect(() => {
    // The branch list is a filter, not a fact about the month: failing to load it costs the
    // dropdown, never the page.
    branchesService
      .getAll()
      .then(setBranches)
      .catch(() => setBranches([]))
  }, [])

  function refresh() {
    setExtraReload((n) => n + 1)
    setLoading(true)
    void load()
  }

  const shown = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!typeFilter || row.type === typeFilter) &&
          (decisionFilter === 'undecided'
            ? row.decision == null
            : decisionFilter === 'all' || row.decision === decisionFilter),
      ),
    [rows, typeFilter, decisionFilter],
  )

  /* The bulk buttons act on the UNDECIDED rows on screen. A missing punch has no minutes to excuse
     or deduct and is skipped — counted and said, never silently. */
  const bulkRows = useMemo(
    () => shown.filter((row) => row.decision == null && row.type !== 'MissingPunch'),
    [shown],
  )
  const bulkSkipped = useMemo(
    () => shown.filter((row) => row.decision == null && row.type === 'MissingPunch').length,
    [shown],
  )

  /* ── one row ── */

  const [target, setTarget] = useState<DecideTarget | null>(null)
  const [note, setNote] = useState('')
  const [correctedTime, setCorrectedTime] = useState<string | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /**
   * "Correct time" opens prefilled with the punch it replaces — the late In, the early Out — so HR
   * edits the one time that is wrong. A MISSING side has no punch to start from, so it opens on the
   * shift time for that side: the most likely answer, and one that is on the work date.
   */
  const openDecide = useCallback((next: DecideTarget) => {
    const { row } = next
    const side = correctedSide(row)
    setTarget(next)
    setNote('')
    setCorrectedTime(
      side === 'in' ? (row.punchIn ?? row.shiftStart) : (row.punchOut ?? row.shiftEnd),
    )
    setDialogError(null)
  }, [])

  function closeDecide() {
    if (saving) return
    setTarget(null)
  }

  async function submitDecision() {
    if (!target) return
    const { row, mode } = target

    if (mode === 'Correct' && !correctedTime) {
      setDialogError(t('attendance.anomalies.dialog.correctedTimeRequired'))
      return
    }

    setSaving(true)
    setDialogError(null)
    try {
      const result = await attendanceService.decideAnomaly(row.anomalyId, {
        decision: mode,
        correctedTime: mode === 'Correct' ? correctedTime : null,
        note: note.trim() || null,
      })
      const decided: AnomalyDecision =
        mode === 'Excuse' ? 'Excused' : mode === 'Deduct' ? 'Deducted' : 'Corrected'
      notifications.show({
        message: t(`attendance.anomalies.saved.${decided}`, {
          name: row.fullName,
          date: formatDate(row.workDate),
          minutes: formatMinutes(row.minutes),
          worked: formatMinutes(result.workedMinutes),
        }),
        color: 'green',
        autoClose: 4000,
      })
      setTarget(null)
      // Reload rather than patch: the decider's NAME comes only from the list, and a re-derived day
      // may have changed other rows of the same day.
      await load()
    } catch (err) {
      // The procedure's own sentence ("A missing punch can only be corrected", "the corrected time
      // must fall on the work date") is the message; it stays in the dialog where the fix is.
      setDialogError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  /* ── every row shown ── */

  const [bulkMode, setBulkMode] = useState<'Excuse' | 'Deduct' | null>(null)
  const [bulkNote, setBulkNote] = useState('')
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [bulkSaving, setBulkSaving] = useState(false)

  function openBulk(mode: 'Excuse' | 'Deduct') {
    setBulkMode(mode)
    setBulkNote('')
    setBulkError(null)
  }

  /**
   * The month's bulk endpoint covers exactly "every undecided late/early of the month, optionally
   * of one branch". When the rows on screen ARE that set — a whole month, no type narrowing — one
   * call does it. With a type filter or a partial range, the set on screen is smaller than the
   * endpoint's, so each row is decided on its own; the words on the button promised the rows shown.
   */
  const monthRange = periodRange(month)
  const bulkViaMonthEndpoint = !typeFilter && from === monthRange.from && to === monthRange.to

  async function submitBulk() {
    if (!bulkMode) return
    setBulkSaving(true)
    setBulkError(null)
    const noteValue = bulkNote.trim() || null
    try {
      let decided = 0
      let skipped = bulkSkipped
      if (bulkViaMonthEndpoint) {
        const result = await attendanceService.decideAllAnomalies({
          month,
          branchId,
          decision: bulkMode,
          note: noteValue,
        })
        decided = result.decided
        skipped = result.skipped
      } else {
        let failed = 0
        let firstError: string | null = null
        for (const row of bulkRows) {
          try {
            await attendanceService.decideAnomaly(row.anomalyId, { decision: bulkMode, note: noteValue })
            decided++
          } catch (err) {
            failed++
            firstError ??= getErrorMessage(err)
          }
        }
        if (failed > 0) {
          // Some went through: say how many, keep the dialog open with the reason, and let the
          // reload show which rows are still undecided.
          setBulkError(
            t('attendance.anomalies.bulk.partial', { decided, failed, error: firstError ?? '' }),
          )
          await load()
          return
        }
      }
      notifications.show({
        message: t('attendance.anomalies.bulk.done', {
          decided,
          skipped: skipped > 0 ? t('attendance.anomalies.bulk.doneSkipped', { count: skipped }) : '',
        }),
        color: 'green',
        autoClose: 5000,
      })
      setBulkMode(null)
      await load()
    } catch (err) {
      setBulkError(getErrorMessage(err))
    } finally {
      setBulkSaving(false)
    }
  }

  /* ── render ── */

  const branchName = branchId ? (branches.find((b) => b.branchId === branchId)?.name ?? null) : null
  const branchSuffix = branchName ? t('attendance.anomalies.empty.forBranch', { branch: branchName }) : ''

  const side = target ? correctedSide(target.row) : 'in'

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('attendance.anomalies.title')}</h1>
          <p className="page-subtitle">{t('attendance.anomalies.subtitle')}</p>
        </div>
        <div className="page-head-actions">
          {/* The month-end ruling, one click for the lot. Disabled — with the reason on hover —
              when nothing on screen is undecided, rather than hidden: an HR user who cannot find
              the button assumes it does not exist. */}
          {canCorrect && view === 'anomalies' && (
            <>
              <Button
                variant="default"
                leftSection={<IconCheck size={16} />}
                disabled={loading || bulkRows.length === 0}
                title={bulkRows.length === 0 ? t('attendance.anomalies.toolbar.nothingToDecide') : undefined}
                onClick={() => openBulk('Excuse')}
              >
                {t('attendance.anomalies.toolbar.decideAllExcuse')}
              </Button>
              <Button
                variant="default"
                color="red"
                leftSection={<IconMinus size={16} />}
                disabled={loading || bulkRows.length === 0}
                title={bulkRows.length === 0 ? t('attendance.anomalies.toolbar.nothingToDecide') : undefined}
                onClick={() => openBulk('Deduct')}
              >
                {t('attendance.anomalies.toolbar.decideAllDeduct')}
              </Button>
            </>
          )}
          <ActionIcon
            variant="default"
            size="lg"
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            onClick={refresh}
          >
            <IconRefresh size={18} />
          </ActionIcon>
        </div>
      </div>

      <SegmentedControl
        mb="md"
        value={view}
        onChange={(v) => setParams({ view: v === 'anomalies' ? null : v })}
        data={[
          { value: 'anomalies', label: t('attendance.anomalies.views.anomalies') },
          { value: 'unrostered', label: t('attendance.anomalies.views.unrostered') },
          { value: 'devices', label: t('attendance.anomalies.views.devices') },
        ]}
      />

      {view === 'anomalies' ? (
        <>
          <PageHelp>{t('attendance.anomalies.help')}</PageHelp>
          <p className="hint">
            <Trans i18nKey="attendance.anomalies.blockNote" components={{ strong: <strong /> }} />
          </p>
        </>
      ) : (
        <PageHelp>{t(view === 'unrostered' ? 'attendance.unrostered.help' : 'attendance.quarantine.help')}</PageHelp>
      )}

      <div className="filter-bar">
        <div className="filter-field" style={view === 'devices' ? { display: 'none' } : undefined}>
          <span className="filter-field-label">{t('common.period')}</span>
          {/* A RANGE, like every other attendance list — "This month" / "Last month" are one click in its shortcuts.
              Not clearable (the endpoint takes a range); the X goes back to this month. The bulk ruling still acts on
              the month of `from`, and only goes through the month endpoint while the range IS that whole month. */}
          <DateRangeField
            id="anomaly-period"
            w={230}
            from={from}
            to={to}
            defaultFrom={defaultRange.from}
            defaultTo={defaultRange.to}
            onChange={(nextFrom, nextTo) => {
              if (nextFrom && nextTo) setParams({ from: nextFrom, to: nextTo })
            }}
          />
        </div>
        <div className="filter-field" style={view !== 'anomalies' ? { display: 'none' } : undefined}>
          <span className="filter-field-label">{t('attendance.anomalies.filters.type')}</span>
          <Select
            data={[
              { value: 'all', label: t('attendance.anomalies.filters.allTypes') },
              ...TYPES.map((type) => ({ value: type, label: typeText(type) })),
            ]}
            value={typeFilter || 'all'}
            allowDeselect={false}
            onChange={(v) => setParams({ type: v === 'all' ? null : v })}
          />
        </div>
        <div className="filter-field" style={view !== 'anomalies' ? { display: 'none' } : undefined}>
          <span className="filter-field-label">{t('attendance.anomalies.filters.decision')}</span>
          <Select
            data={[
              { value: 'undecided', label: t('attendance.anomalies.filters.undecidedOnly') },
              { value: 'all', label: t('attendance.anomalies.filters.allDecisions') },
              ...DECISIONS.map((decision) => ({ value: decision, label: decisionText(decision) })),
            ]}
            value={decisionFilter}
            allowDeselect={false}
            onChange={(v) => setParams({ decision: v === 'undecided' ? null : v })}
          />
        </div>
        <div className="filter-field">
          <span className="filter-field-label">{t('attendance.anomalies.filters.branch')}</span>
          <Select
            data={[
              { value: 'all', label: t('attendance.anomalies.filters.allBranches') },
              ...branches
                .filter((b) => b.isActive || b.branchId === branchId)
                .map((b) => ({ value: String(b.branchId), label: b.name })),
            ]}
            value={branchId ? String(branchId) : 'all'}
            allowDeselect={false}
            onChange={(v) => setParams({ branchId: v === 'all' ? null : v })}
          />
        </div>
      </div>

      {view === 'anomalies' && error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {view === 'unrostered' ? (
        <WorkedWithoutRosterList from={from} to={to} branchId={branchId} reloadKey={extraReload} />
      ) : view === 'devices' ? (
        /* A mapped PIN replays its punches, which can raise or clear anomalies — the first view is re-read too. */
        <DeviceQuarantineList branchId={branchId} reloadKey={extraReload} onMapped={() => void load()} />
      ) : loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : shown.length === 0 ? (
        <div className="card">
          {/* Two different empty states, because "nothing undecided" and "nothing at all" are
              different claims — the first is the good news HR is after, the second is worth a
              second look at the month. */}
          <div className="empty-hint">
            <div className="empty-hint-main">
              {t(
                onlyUndecided
                  ? 'attendance.anomalies.empty.undecidedTitle'
                  : 'attendance.anomalies.empty.allTitle',
                { month: periodLabel(month) },
              )}
            </div>
            {t(
              onlyUndecided
                ? 'attendance.anomalies.empty.undecidedText'
                : 'attendance.anomalies.empty.allText',
              { branch: branchSuffix },
            )}
          </div>
        </div>
      ) : (
        <AnomaliesGrid rows={shown} canCorrect={canCorrect} onDecide={openDecide} />
      )}

      {/* ONE ROW. Mounted only once `target` exists, so the title needs no fallback. The same
          dialog carries all three rulings: what is on record (punches beside shift times) at the
          top, then the ruling's effect in words, then — for Correct time — the one time to enter. */}
      {target && (
        <Modal
          opened
          onClose={closeDecide}
          title={t(`attendance.anomalies.dialog.title${target.mode}`, {
            name: target.row.fullName,
            date: formatDate(target.row.workDate),
          })}
          size={480}
          centered
          closeOnClickOutside={!saving}
        >
          <div>
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="empty-hint-main">
                <TypeBadge type={target.row.type} />{' '}
                {target.row.type !== 'MissingPunch' && formatMinutes(target.row.minutes)}
              </div>
              <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
                {target.mode === 'Excuse' &&
                  t('attendance.anomalies.dialog.excuseEffect', { minutes: formatMinutes(target.row.minutes) })}
                {target.mode === 'Deduct' &&
                  t('attendance.anomalies.dialog.deductEffect', { minutes: formatMinutes(target.row.minutes) })}
                {target.mode === 'Correct' &&
                  t(side === 'in' ? 'attendance.anomalies.dialog.correctEffectIn' : 'attendance.anomalies.dialog.correctEffectOut')}
              </p>
            </div>

            {/* Re-ruling is allowed between Excused and Deducted; say that a ruling is being
                replaced, and that Correct is the one that cannot be. */}
            {target.row.decision && (
              <p className="hint">
                {t('attendance.anomalies.dialog.reDecide', { decision: decisionText(target.row.decision) })}
              </p>
            )}

            <div className="diff-col">
              <div className="diff-title">{t('attendance.anomalies.dialog.onRecord')}</div>
              <div className="diff-line">
                <span className="diff-line-label">{t('attendance.anomalies.dialog.shiftStart')}</span>
                <span>{formatTime(target.row.shiftStart)}</span>
              </div>
              <div className="diff-line">
                <span className="diff-line-label">{t('attendance.anomalies.dialog.punchIn')}</span>
                <span className={side === 'in' ? 'punch-vs-shift-flagged' : undefined}>
                  {formatTime(target.row.punchIn)}
                </span>
              </div>
              <div className="diff-line">
                <span className="diff-line-label">{t('attendance.anomalies.dialog.shiftEnd')}</span>
                <span>{formatTime(target.row.shiftEnd)}</span>
              </div>
              <div className="diff-line">
                <span className="diff-line-label">{t('attendance.anomalies.dialog.punchOut')}</span>
                <span className={side === 'out' ? 'punch-vs-shift-flagged' : undefined}>
                  {formatTime(target.row.punchOut)}
                </span>
              </div>
            </div>

            {target.mode === 'Correct' && (
              <div className="form-field">
                <label className="form-label">
                  {t(side === 'in' ? 'attendance.anomalies.dialog.correctedIn' : 'attendance.anomalies.dialog.correctedOut')}
                </label>
                {/* Not clearable: a correction IS a time. The state keeps the API's
                    'yyyy-MM-ddTHH:mm:ss' shape through the shared adapters. */}
                <DateTimePicker
                  valueFormat="DD/MM/YYYY HH:mm"
                  leftSection={<IconCalendar size={14} />}
                  value={dateTimeToPicker(correctedTime)}
                  disabled={saving}
                  onChange={(v) => {
                    setCorrectedTime(secondsDateTimeFromPicker(v))
                    if (dialogError) setDialogError(null)
                  }}
                />
                <span className="hint">{t('attendance.anomalies.dialog.correctedTimeHint')}</span>
              </div>
            )}

            <div className="form-field">
              <label className="form-label">{t('attendance.anomalies.dialog.note')}</label>
              <Textarea
                minRows={2}
                placeholder={t('attendance.anomalies.dialog.notePlaceholder')}
                value={note}
                disabled={saving}
                onChange={(e) => setNote(e.currentTarget.value)}
              />
            </div>

            {dialogError && (
              <div className="alert alert--error" role="alert">
                {dialogError}
              </div>
            )}

            <div className="form-actions">
              <Button variant="default" onClick={closeDecide} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button
                color={target.mode === 'Deduct' ? 'red' : undefined}
                onClick={() => void submitDecision()}
                loading={saving}
                disabled={saving}
              >
                {t(`attendance.anomalies.dialog.confirm${target.mode}`)}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* EVERY ROW SHOWN. The confirmation names the scope (month, branch), the count, what is
          skipped and why, and the effect — a month's pay changes on this click. */}
      {bulkMode && (
        <Modal
          opened
          onClose={() => !bulkSaving && setBulkMode(null)}
          title={t(`attendance.anomalies.bulk.title${bulkMode}`)}
          size={480}
          centered
          closeOnClickOutside={!bulkSaving}
        >
          <div>
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="empty-hint-main">
                {t('attendance.anomalies.bulk.scope', {
                  month: periodLabel(month),
                  branch: branchName ? t('attendance.anomalies.bulk.branchScope', { branch: branchName }) : '',
                  count: bulkRows.length,
                })}
              </div>
              <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
                {t(bulkMode === 'Excuse' ? 'attendance.anomalies.bulk.excuseEffect' : 'attendance.anomalies.bulk.deductEffect')}
                {bulkSkipped > 0 && <> {t('attendance.anomalies.bulk.skipped', { count: bulkSkipped })}</>}
              </p>
            </div>

            <div className="form-field">
              <label className="form-label">{t('attendance.anomalies.bulk.note')}</label>
              <Textarea
                minRows={2}
                placeholder={t('attendance.anomalies.bulk.notePlaceholder')}
                value={bulkNote}
                disabled={bulkSaving}
                onChange={(e) => setBulkNote(e.currentTarget.value)}
              />
            </div>

            {bulkError && (
              <div className="alert alert--error" role="alert">
                {bulkError}
              </div>
            )}

            <div className="form-actions">
              <Button variant="default" onClick={() => setBulkMode(null)} disabled={bulkSaving}>
                {t('common.cancel')}
              </Button>
              <Button
                color={bulkMode === 'Deduct' ? 'red' : undefined}
                onClick={() => void submitBulk()}
                loading={bulkSaving}
                disabled={bulkSaving}
              >
                {t(`attendance.anomalies.bulk.confirm${bulkMode}`, { count: bulkRows.length })}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
