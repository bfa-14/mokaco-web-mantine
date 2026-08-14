import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { formatDate, formatDayLabel, formatTime } from './attendanceFormat'
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
  if (punchType === 0) return <span className="badge badge--on">In</span>
  if (punchType === 1) return <span className="badge badge--muted">Out</span>

  return (
    <span
      className="badge badge--off"
      title="A device key the processor does not model — a break or overtime key on most firmware. The punch is stored exactly as the machine sent it."
    >
      Key {punchType}
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
      title="Nobody is enrolled on this PIN, so this punch belongs to no one yet. It is stored and waiting — map the PIN and it is claimed retroactively."
    >
      PIN {punch.enrollPin} — not mapped
    </Link>
  )
}

/** What the Employee column filters on — the same words the cell shows. */
const whoText = (_value: unknown, punch: RawPunch) =>
  punch.fullName ?? `PIN ${punch.enrollPin} — not mapped`

const directionText = (punchType: number) =>
  punchType === 0 ? 'In' : punchType === 1 ? 'Out' : `Key ${punchType}`

const processedText = (isProcessed: boolean) => (isProcessed ? 'Processed' : 'Waiting')

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
  branchId,
  onGoToToday,
}: {
  date: string
  branchId: number | null
  onGoToToday?: () => void
}) {
  const { t } = useTranslation()
  const [punches, setPunches] = useState<RawPunch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setPunches(await importService.getPunches(date))
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [date])

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
          <span title="The time the TERMINAL stamped, in its own clock. Nothing converts it — which is why a machine running fast quietly moves everybody's hours.">
            Time
          </span>
        ),
        meta: { filterText: (v) => formatTime(v as string) },
        cell: (info) => <span>{formatTime(info.row.original.punchTimeUtc)}</span>,
      }),
      punchColumnHelper.accessor('fullName', {
        header: 'Employee',
        meta: { filterText: whoText },
        cell: (info) => <WhoCell punch={info.row.original} />,
      }),
      punchColumnHelper.accessor('punchType', {
        header: 'In/Out',
        meta: { filterText: directionText, filterOptions: ['In', 'Out'] },
        cell: (info) => <DirectionChip punchType={info.row.original.punchType} />,
      }),
      punchColumnHelper.accessor('deviceName', {
        header: 'Machine',
        meta: { filterText: machineText },
        cell: (info) => <span>{machineText(null, info.row.original)}</span>,
      }),
      punchColumnHelper.accessor('source', {
        header: () => (
          <span title="How the punch reached us. Pull = the server called the machine; Device = the machine pushed to us; Excel = a spreadsheet; Manual = typed by a person.">
            Source
          </span>
        ),
      }),
      punchColumnHelper.accessor('isProcessed', {
        header: () => (
          <span title="Whether the processor has turned this punch into part of an employee-day yet. Waiting is normal for a punch made today — the nightly job consumes it, or you can process the day by hand.">
            Processed
          </span>
        ),
        meta: { filterText: processedText, filterOptions: ['Processed', 'Waiting'] },
        cell: (info) =>
          info.row.original.isProcessed ? (
            <IconCheck size={16} color="var(--mantine-color-green-7)" aria-label="Processed" />
          ) : (
            <span className="badge badge--muted" title="Stored, and not yet part of an employee-day.">
              waiting
            </span>
          ),
      }),
      punchColumnHelper.accessor('createdUtc', {
        header: () => (
          <span title="When WE received it, as opposed to when it was punched. On a pulled machine the two differ by up to one poll interval — and that gap is what separates 'the machine never recorded it' from 'we have not collected it yet'.">
            Landed
          </span>
        ),
        meta: { filterText: (v) => `${formatDate(v as string)} ${formatTime(v as string)}` },
        cell: (info) => (
          <span
            title={`Punched ${formatTime(info.row.original.punchTimeUtc)}, received ${formatTime(info.row.original.createdUtc)}`}
          >
            {formatDate(info.row.original.createdUtc)} {formatTime(info.row.original.createdUtc)}
          </span>
        ),
      }),
    ],
    [],
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
          placeholder="Search punches"
          w={240}
        />
        {/* Names the day rather than saying "this day": the bug this view exists to expose is
            looking at the wrong one, and a count with no date attached cannot show that. */}
        <span className="hint">
          {t('attendance.daily.punchCount', {
            count: visible.length,
            date: formatDayLabel(date),
          })}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="empty-hint">
          <div className="empty-hint-main">
            {t('attendance.daily.noPunches', { date: formatDayLabel(date) })}
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
