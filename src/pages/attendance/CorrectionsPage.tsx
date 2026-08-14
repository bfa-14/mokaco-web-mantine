import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Loader, Modal, Pagination, Select, Table, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconRefresh, IconSearch } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { correctionsService } from '../../services/attendanceService'
import { PERMISSIONS } from '../../types/attendance'
import type { Correction } from '../../types/attendance'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { StatusBadge } from './attendanceShared'
import {
  formatDate,
  formatMinutes,
  formatTime,
} from './attendanceFormat'

/** One "label — value" row inside either side of the before/after comparison. */
function DiffLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="diff-line">
      <span className="diff-line-label">{label}</span>
      <span>{value}</span>
    </div>
  )
}

/**
 * A null NEW value does not mean "clear this field" — it means the correction does not
 * touch it. Rendering it as "—" would read as "this becomes empty", and on an exit-minutes
 * line that is the difference between somebody being paid and not. So it says "unchanged",
 * and never borrows the em-dash the OLD side uses for genuinely absent values.
 */
function Unchanged() {
  return <span className="diff-line-label">unchanged</span>
}

/**
 * The whole review, side by side. HR is approving a change to a person's pay, so the two
 * states are shown together rather than as a form with the new values already typed into
 * it — the question being asked is "is this right?", not "what would you like it to be?".
 */
function CorrectionDiff({ correction }: { correction: Correction }) {
  return (
    <div className="diff-grid">
      <div className="diff-col">
        <div className="diff-title">Currently</div>
        <DiffLine label="First in" value={formatTime(correction.oldFirstInUtc)} />
        <DiffLine label="Last out" value={formatTime(correction.oldLastOutUtc)} />
        <DiffLine label="Exit" value={formatMinutes(correction.oldExitMinutes)} />
        <DiffLine
          label="Status"
          value={
            correction.oldStatus ? (
              <StatusBadge status={correction.oldStatus} />
            ) : (
              '—'
            )
          }
        />
      </div>

      <div className="diff-col diff-col--new">
        <div className="diff-title">Will become</div>
        <DiffLine
          label="First in"
          value={
            correction.newFirstInUtc ? (
              formatTime(correction.newFirstInUtc)
            ) : (
              <Unchanged />
            )
          }
        />
        <DiffLine
          label="Last out"
          value={
            correction.newLastOutUtc ? (
              formatTime(correction.newLastOutUtc)
            ) : (
              <Unchanged />
            )
          }
        />
        <DiffLine
          label="Exit"
          value={
            correction.newExitMinutes == null ? (
              <Unchanged />
            ) : (
              formatMinutes(correction.newExitMinutes)
            )
          }
        />
        <DiffLine
          label="Status"
          value={
            correction.newStatus ? (
              <StatusBadge status={correction.newStatus} />
            ) : (
              <Unchanged />
            )
          }
        />
      </div>
    </div>
  )
}

/* PORT NOTE: the DevExtreme DataGrid is TanStack Table + Mantine Table per RequestsGrid.tsx;
   SearchPanel is the global search box, FilterRow the strip under the header, and
   HeaderFilter the funnel in each header cell — all three, as the original had them. */
const columnHelper = createColumnHelper<Correction>()

const PAGE_SIZES = ['15', '30', '50']

function CorrectionsGrid({
  rows,
  canCorrect,
  onReview,
}: {
  rows: Correction[]
  canCorrect: boolean
  onReview: (correction: Correction) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      columnHelper.accessor('fullName', { header: 'Employee' }),
      // Raw accessor for a chronological sort, formatted match so the filter takes what is on
      // screen rather than the ISO timestamp behind it.
      columnHelper.accessor('workDate', {
        header: 'Date',
        cell: (info) => formatDate(info.getValue()),
        meta: { filterText: formatDate },
      }),
      columnHelper.accessor('requestedByUser', { header: 'Requested by' }),
      // PORT NOTE: dataType="datetime" → the shared date + time formatters.
      columnHelper.accessor('requestedUtc', {
        header: 'Requested',
        cell: (info) => `${formatDate(info.getValue())} ${formatTime(info.getValue())}`,
        meta: { filterText: (v) => `${formatDate(v)} ${formatTime(v)}` },
      }),
      /* The reason is never hidden behind a click. A correction whose reason nobody
         can read is just an unexplained change to somebody's pay. */
      // Free prose, one distinct value per row — a funnel here is a list of every correction
      // ever raised, which helps nobody. The filter-row box stays.
      columnHelper.accessor('reason', {
        header: 'Reason',
        cell: (info) => (
          <span title={info.row.original.reason}>{info.row.original.reason}</span>
        ),
        meta: { noHeaderFilter: true },
      }),
      ...(canCorrect
        ? [
            columnHelper.display({
              id: 'actions',
              header: 'Actions',
              cell: (info) => (
                <div className="grid-actions">
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={() => onReview(info.row.original)}
                  >
                    Review
                  </Button>
                </div>
              ),
            }),
          ]
        : []),
    ],
    [canCorrect, onReview],
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
    getRowId: (r) => String(r.correctionId),
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

export default function CorrectionsPage() {
  const { hasPermission } = useAuth()
  // Approving or rejecting changes what somebody is paid, so it is HR-only. Everyone else
  // may still READ the queue — knowing the figures are about to move is not a privilege.
  const canCorrect = hasPermission(PERMISSIONS.correct)

  const [corrections, setCorrections] = useState<Correction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [review, setReview] = useState<Correction | null>(null)
  const [acting, setActing] = useState(false)

  const load = useCallback(async () => {
    try {
      setCorrections(await correctionsService.getPending())
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      try {
        const data = await correctionsService.getPending()
        if (!cancelled) {
          setCorrections(data)
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
  }, [])

  function refresh() {
    setLoading(true)
    void load()
  }

  async function approve() {
    if (!review) return
    setActing(true)
    try {
      await correctionsService.approve(review.correctionId)
      notifications.show({
        message: 'Correction approved. The day has been recomputed.',
        color: 'green',
        autoClose: 2500,
      })
      setReview(null)
      await load()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setActing(false)
    }
  }

  // Rejecting throws the request away — the day keeps the figures it has, and whoever raised
  // the correction has to ask again. That is worth one confirmation.
  async function reject() {
    if (!review) return
    /* PORT NOTE: devextreme confirm() dialog → window.confirm (the "Reject correction" dialog
       title is lost; the question itself is unchanged). */
    const confirmed = window.confirm(
      `Reject this correction for ${review.fullName} on ${formatDate(review.workDate)}? The day keeps its current figures and the request is closed.`,
    )
    if (!confirmed) return

    setActing(true)
    try {
      await correctionsService.reject(review.correctionId)
      notifications.show({
        message: 'Correction rejected. Nothing on that day changed.',
        color: 'green',
        autoClose: 2500,
      })
      setReview(null)
      await load()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setActing(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Corrections</h1>
          <p className="page-subtitle">
            Changes waiting on a decision. Until they are decided, the days they touch are
            not final.
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
        A correction records what was changed, by whom, and why. The raw punches from the
        machine are never overwritten.
      </PageHelp>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : corrections.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">No corrections waiting.</div>
            Nothing is about to change, so this is not blocking payroll. Corrections are
            raised from the <Link to="/attendance/anomalies">Anomalies</Link> page, or from a
            day on <Link to="/attendance/daily">Daily attendance</Link>; they arrive here for
            a decision.
          </div>
        </div>
      ) : (
        <CorrectionsGrid rows={corrections} canCorrect={canCorrect} onReview={setReview} />
      )}

      {/* Mounted only once a correction is chosen — there is always a `review` by the time it
          renders, so the body never needs null fallbacks. (The original's caveat about
          devextreme-react capturing Popup children as a content template does not apply to
          Mantine's Modal.) */}
      {review && (
        <Modal
          opened
          onClose={() => setReview(null)}
          title="Review correction"
          size={560}
          centered
          closeOnClickOutside={!acting}
        >
          <div>
            <div className="form-field">
              <div className="form-label">
                {review.fullName} — {formatDate(review.workDate)}
              </div>
              <p>{review.reason}</p>
            </div>

            <CorrectionDiff correction={review} />

            <div className="form-actions">
              <Button
                variant="default"
                onClick={() => void reject()}
                disabled={acting}
              >
                Reject
              </Button>
              <Button
                onClick={() => void approve()}
                loading={acting}
                disabled={acting}
              >
                {acting ? 'Saving…' : 'Approve'}
              </Button>
            </div>

            <p className="hint">
              Approving applies the new values and recomputes the day against the rostered
              shift, by the same rules as any other day. The raw punches from the machine
              are never overwritten.
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}
