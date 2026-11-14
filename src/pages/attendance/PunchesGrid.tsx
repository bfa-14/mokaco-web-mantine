import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { t as translate } from '../../i18n/t'
import { utcToCompany } from './companyClock'
import { Link } from 'react-router-dom'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { Anchor, Group, Loader, Pagination, Table, TextInput } from '@mantine/core'
import { IconCheck, IconSearch } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { useLive } from '../../live/useLive'
import { useLiveEnabled } from '../../live/useLiveSettings'
import { importService } from '../../services/attendanceService'
import { formatDayLabel, formatTime } from './attendanceFormat'
import type { RawPunch } from '../../types/attendance'

/**
 * THE RAW PUNCHES OF ONE DAY — the answer to "did my punch arrive".
 *
 * This exists because that question previously had no answer inside the application. Punches landed
 * correctly and processed correctly, and the only way to see any of it was to query the database by
 * hand. Everything else in attendance shows the PROCESSOR'S view — paired intervals, worked minutes,
 * a day that is Present or Absent. That view is an interpretation, and when it looks wrong the first
 * thing anybody needs is the thing it was interpreting.
 *
 * So this grid deliberately shows the log unprocessed and unjoined-away: every punch, including the
 * ones on PINs belonging to nobody, including the ones the processor has not consumed yet, in the
 * order they happened. A punch missing from HERE is a machine or collection problem. A punch present
 * here but absent from the Days view is a processing or mapping problem. Being able to tell those
 * two apart in one glance is the entire point.
 *
 * It refetches on the live "attendance" signal, which the pull worker raises when punches land — so
 * a punch made at the terminal appears here within seconds of the next poll, with nobody pressing
 * anything.
 */

const punchColumnHelper = createColumnHelper<RawPunch>()

/** The pixel widths this grid pins; unlisted columns auto-size. */
const PUNCH_WIDTHS: Record<string, number | undefined> = {
  punchTimeUtc: 110,
  punchType: 110,
  isProcessed: 120,
  createdUtc: 170,
}

/**
 * IN, OUT, or a key we do not model.
 *
 * The third case is not an error and must not look like one. ZK terminals have break and overtime
 * keys (2..5 on most firmware); a punch on one is a REAL punch that the processor cannot pair, and
 * it is stored with the terminal's own value rather than guessed at. Naming it "Key 4" says exactly
 * that — something happened, we recorded it faithfully, and nobody has told us what it means.
 */
function DirectionChip({ punchType }: { punchType: number }) {
  if (punchType === 0) return <span className="badge badge--on">{translate('attendance.punchesGrid.in')}</span>
  if (punchType === 1) return <span className="badge badge--muted">{translate('attendance.punchesGrid.out')}</span>

  return (
    <span
      className="badge badge--off"
      title={translate('attendance.punchesGrid.keyTitle')}
    >
      {translate('attendance.punchesGrid.key', { value: punchType })}
    </span>
  )
}

/**
 * Who punched — or, when nobody is enrolled on the PIN, the PIN itself as a route to fixing it.
 *
 * The unmapped case is the one worth designing for. It is not a failure and nothing is lost: the
 * punch is stored and mapping the PIN claims it retroactively. But it IS the single most common
 * reason somebody's day looks empty, so it gets a warning chip and a link straight to the page
 * that resolves it rather than a blank cell that reads like a bug.
 */
function WhoCell({ punch }: { punch: RawPunch }) {
  if (punch.fullName) return <span>{punch.fullName}</span>

  return (
    <Link
      to="/attendance/unresolved"
      className="badge badge--off"
      title={translate('attendance.punchesGrid.unmappedTitle')}
    >
      {translate('attendance.punchesGrid.unmapped', { pin: punch.enrollPin })}
    </Link>
  )
}

/** What the Employee column filters on — the same words the cell shows. */
const whoText = (_value: unknown, punch: RawPunch) =>
  punch.fullName ?? translate('attendance.punchesGrid.unmapped', { pin: punch.enrollPin })

const directionText = (punchType: number) =>
  punchType === 0
    ? translate('attendance.punchesGrid.in')
    : punchType === 1
      ? translate('attendance.punchesGrid.out')
      : translate('attendance.punchesGrid.key', { value: punchType })

const processedText = (isProcessed: boolean) =>
  translate(isProcessed ? 'attendance.punchesGrid.processed' : 'attendance.punchesGrid.waiting')

/** The machine's label if it has one, else its serial — the same fallback the Devices page uses. */
const machineText = (_value: unknown, punch: RawPunch) =>
  punch.deviceName && punch.deviceName.trim().length > 0
    ? punch.deviceName
    : punch.serialNumber

/**
 * @param date A calendar day as 'YYYY-MM-DD' — the page's own Day control value, passed through as
 *   a STRING on purpose. Converting it to a Date and back invites `toISOString()`, which shifts the
 *   day across the timezone boundary and quietly asks the server for yesterday.
 * @param onGoToToday Supplied by the page ONLY when `date` is not today, so this grid never has to
 *   work out what today is — the page owns the day, and a second definition of "today" living down
 *   here is a second thing that can disagree at midnight.
 */
export function PunchesGrid({
  date,
  to,
  branchId,
  onGoToToday,
}: {
  date: string
  /** The last day of a period (at most 31 days); absent or equal to `date` = the one day. */
  to?: string
  branchId: number | null
  onGoToToday?: () => void
}) {
  const isRange = !!to && to !== date
  const { t } = useTranslation()
  const [punches, setPunches] = useState<RawPunch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  /* ONLY THE LATEST REQUEST MAY LAND (QA3 WEB-17). Changing the day while a slow answer for the
     previous one is in flight, or a live signal firing during a load, used to let the OLDER answer
     arrive last and overwrite the grid with another day's punches. Each load takes a number; an
     answer that is no longer the latest is dropped, as RequestsHubPage does. */
  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const rows = await importService.getPunches(date, { to })
      if (seq !== loadSeq.current) return
      setPunches(rows)
      setError(null)
    } catch (err) {
      if (seq === loadSeq.current) setError(getErrorMessage(err))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [date, to])

  useEffect(() => {
    void load()
  }, [load])

  // The signal the pull worker raises when punches land. This is what makes the page answer
  // "did my punch arrive" without anybody reaching for a refresh button.
  useLive(['attendance'], () => void load(), useLiveEnabled('attendance'))

  // The branch filter belongs to the page, and the punches endpoint filters by DEVICE rather than
  // branch — so it is applied here, on the branch the punch's own machine sits in.
  const visible = useMemo(
    () => (branchId == null ? punches : punches.filter((p) => p.branchId === branchId)),
    [punches, branchId],
  )

  const columns = useMemo(
    () => [
      punchColumnHelper.accessor('punchTimeUtc', {
        header: () => (
          <span title={t('attendance.punchesGrid.timeTitle')}>
            {t('attendance.punchesGrid.time')}
          </span>
        ),
        meta: { filterText: (v) => formatTime(v as string) },
        // Over a period the day is part of the answer; over one day it is the heading.
        cell: (info) => (
          <span>
            {isRange ? `${formatDayLabel(info.row.original.punchTimeUtc)} ` : ''}
            {formatTime(info.row.original.punchTimeUtc)}
          </span>
        ),
      }),
      punchColumnHelper.accessor('fullName', {
        header: () => t('attendance.dailyPage.col.employee'),
        meta: { filterText: whoText },
        cell: (info) => <WhoCell punch={info.row.original} />,
      }),
      punchColumnHelper.accessor('punchType', {
        header: () => t('attendance.punchesGrid.direction'),
        meta: { filterText: directionText, filterOptions: [t('attendance.punchesGrid.in'), t('attendance.punchesGrid.out')] },
        cell: (info) => <DirectionChip punchType={info.row.original.punchType} />,
      }),
      punchColumnHelper.accessor('deviceName', {
        header: () => t('attendance.punchesGrid.machine'),
        meta: { filterText: machineText },
        cell: (info) => <span>{machineText(null, info.row.original)}</span>,
      }),
      punchColumnHelper.accessor('source', {
        header: () => (
          <span title={t('attendance.punchesGrid.sourceTitle')}>
            {t('attendance.dailyPage.col.source')}
          </span>
        ),
        cell: (info) => t(`attendance.source.${info.row.original.source}`, { defaultValue: info.row.original.source }),
      }),
      punchColumnHelper.accessor('isProcessed', {
        header: () => (
          <span title={t('attendance.punchesGrid.processedTitle')}>
            {t('attendance.punchesGrid.processed')}
          </span>
        ),
        meta: { filterText: processedText, filterOptions: [t('attendance.punchesGrid.processed'), t('attendance.punchesGrid.waiting')] },
        cell: (info) =>
          info.row.original.isProcessed ? (
            <IconCheck size={16} color="var(--mantine-color-green-7)" aria-label={t('attendance.punchesGrid.processed')} />
          ) : (
            <span className="badge badge--muted" title={t('attendance.punchesGrid.waitingTitle')}>
              {t('attendance.punchesGrid.waitingBadge')}
            </span>
          ),
      }),
      punchColumnHelper.accessor('createdUtc', {
        header: () => (
          <span title={t('attendance.punchesGrid.landedTitle')}>
            {t('attendance.punchesGrid.landed')}
          </span>
        ),
        // The server's own stamp is UTC: shown on Beirut's clock, like the punch beside it.
        meta: {
          filterText: (v) => {
            const at = utcToCompany(v as string)
            return at ? `${at.day} ${at.time}` : ''
          },
        },
        cell: (info) => {
          const at = utcToCompany(info.row.original.createdUtc)
          return (
            <span
              title={t('attendance.punchesGrid.landedCell', {
                punched: formatTime(info.row.original.punchTimeUtc),
                received: at?.time ?? '',
              })}
            >
              {at ? `${at.day} ${at.time}` : '—'}
            </span>
          )
        },
      }),
    ],
    [t, isRange],
  )

  const table = useReactTable({
    data: visible,
    columns,
    state: { sorting, globalFilter, columnFilters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    defaultColumn: { filterFn: gridFilterFn },
    // Newest first: the punch somebody is looking for is almost always the one they just made.
    initialState: { sorting: [{ id: 'punchTimeUtc', desc: true }], pagination: { pageSize: 25 } },
  })

  if (loading) {
    return (
      <div className="page-loading">
        <Loader size={40} />
      </div>
    )
  }

  return (
    <div className="card">
      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <div className="tab-toolbar">
        <TextInput
          value={globalFilter}
          onChange={(e) => {
            const value = e.currentTarget.value
            setGlobalFilter(value)
          }}
          leftSection={<IconSearch size={14} />}
          placeholder={t('attendance.punchesGrid.search')}
          w={240}
        />
        {/* Names the day rather than saying "this day": the bug this view exists to expose is
            looking at the wrong one, and a count with no date attached cannot show that. */}
        <span className="hint">
          {t('attendance.daily.punchCount', {
            count: visible.length,
            date: isRange ? `${formatDayLabel(date)} – ${formatDayLabel(to)}` : formatDayLabel(date),
          })}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="empty-hint">
          <div className="empty-hint-main">
            {t('attendance.daily.noPunches', {
              date: isRange ? `${formatDayLabel(date)} – ${formatDayLabel(to)}` : formatDayLabel(date),
            })}
          </div>
          {t('attendance.daily.noPunchesHint')}
          {/* An empty day that is NOT today is far more often the wrong day than a missing pull,
              so the way back is offered right where the doubt is. */}
          {onGoToToday && (
            <div style={{ marginTop: 8 }}>
              <Anchor component="button" type="button" onClick={onGoToToday}>
                {t('attendance.daily.goToToday')}
              </Anchor>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <Table highlightOnHover>
              <Table.Thead>
                {table.getHeaderGroups().map((group) => (
                  <Table.Tr key={group.id}>
                    {group.headers.map((header) => (
                      <Table.Th
                        key={header.id}
                        style={{ width: PUNCH_WIDTHS[header.column.id] }}
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
                {table.getRowModel().rows.map((row) => (
                  <Table.Tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <Table.Td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>

          {table.getPageCount() > 1 && (
            <Group justify="flex-end" mt="sm">
              <Pagination
                total={table.getPageCount()}
                value={table.getState().pagination.pageIndex + 1}
                onChange={(page) => table.setPageIndex(page - 1)}
                size="sm"
              />
            </Group>
          )}
        </>
      )}
    </div>
  )
}
