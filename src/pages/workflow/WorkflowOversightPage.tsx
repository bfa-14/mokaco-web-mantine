import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState, Table as TableInstance } from '@tanstack/react-table'
import { Button, Group, Loader, NumberInput, Pagination, Select, Table } from '@mantine/core'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { useLive } from '../../live/useLive'
import { useLiveEnabled } from '../../live/useLiveSettings'
import { getErrorMessage } from '../../api/errorMessage'
import { chainsService } from '../../services/workflowService'
import type { LongHold, StaleDraft } from '../../types/workflow'

const PAGE_SIZES = ['10', '25', '50']

/**
 * One panel's grid — the same TanStack + Mantine table both panels draw, with the original
 * DataGrid's multi-sort, its 10-row pages and its 10/25/50 pager with the page info line.
 */
function OversightTable<T>({ table }: { table: TableInstance<T> }) {
  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  // The count line must follow the filter row, not the raw load.
  const total = table.getFilteredRowModel().rows.length

  return (
    <>
      <Table striped highlightOnHover verticalSpacing="xs" fz="sm">
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
    </>
  )
}

const draftColumnHelper = createColumnHelper<StaleDraft>()
const holdColumnHelper = createColumnHelper<LongHold>()

/**
 * A read-only HR watch surface: two things that quietly stall a request and never announce
 * themselves — a decision saved as a draft and never signed, and a request parked on hold and left.
 * Neither is an error, so nothing else flags them; this page is where someone goes looking.
 *
 * Both panels are pure monitoring. The only control is the age threshold, so "show me everything
 * older than N days" is answerable without leaving the page. Every row links to the request itself,
 * because the fix always lives there, never here.
 */
export default function WorkflowOversightPage() {
  const navigate = useNavigate()

  // Drafts default to 3 days — an unsigned decision going stale is a faster problem than a hold.
  const [draftDays, setDraftDays] = useState(3)
  const [drafts, setDrafts] = useState<StaleDraft[] | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)

  const [holdDays, setHoldDays] = useState(7)
  const [holds, setHolds] = useState<LongHold[] | null>(null)
  const [holdError, setHoldError] = useState<string | null>(null)

  const [draftSorting, setDraftSorting] = useState<SortingState>([])
  const [holdSorting, setHoldSorting] = useState<SortingState>([])
  const [draftFilters, setDraftFilters] = useState<ColumnFiltersState>([])
  const [holdFilters, setHoldFilters] = useState<ColumnFiltersState>([])

  const loadDrafts = useCallback(async (days: number) => {
    setDrafts(null)
    try {
      setDrafts(await chainsService.getStaleDrafts(days))
      setDraftError(null)
    } catch (err) {
      setDraftError(getErrorMessage(err))
      setDrafts([])
    }
  }, [])

  const loadHolds = useCallback(async (days: number) => {
    setHolds(null)
    try {
      setHolds(await chainsService.getLongHolds(days))
      setHoldError(null)
    } catch (err) {
      setHoldError(getErrorMessage(err))
      setHolds([])
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDrafts(draftDays)
  }, [loadDrafts, draftDays])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHolds(holdDays)
  }, [loadHolds, holdDays])

  // LIVE: a draft being signed or a hold released removes a row from this watch list. Both panels
  // refresh together — they are two views of the same "what has stalled" question.
  useLive(
    ['workflow'],
    useCallback(() => {
      void loadDrafts(draftDays)
      void loadHolds(holdDays)
    }, [loadDrafts, draftDays, loadHolds, holdDays]),
    useLiveEnabled('workflow'),
  )

  const draftColumns = useMemo(
    () => [
      draftColumnHelper.accessor('requestTypeName', {
        header: 'Request',
        meta: { filterOptions: optionsFrom(drafts ?? [], (r) => r.requestTypeName) },
      }),
      draftColumnHelper.accessor('employeeName', { header: 'Employee' }),
      draftColumnHelper.accessor('branchName', {
        header: 'Branch',
        meta: { filterOptions: optionsFrom(drafts ?? [], (r) => r.branchName) },
      }),
      draftColumnHelper.accessor('stepName', { header: 'Step' }),
      // A draft with no decision recorded prints a dash rather than an empty cell.
      draftColumnHelper.accessor('draftDecision', {
        header: 'Draft decision',
        cell: (info) => info.row.original.draftDecision ?? '—',
        meta: { filterText: (v) => v ?? '—' },
      }),
      draftColumnHelper.accessor('savedBy', { header: 'Saved by' }),
      draftColumnHelper.accessor('daysUnsigned', { header: 'Days unsigned' }),
      // How long the REQUESTER has been waiting, which is longer than the draft has sat and is
      // the number that matters to them.
      draftColumnHelper.accessor('daysWaiting', { header: 'Days waiting' }),
      draftColumnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => (
          <Button
            variant="subtle"
            size="xs"
            onClick={() => navigate(`/requests/${info.row.original.requestInstanceId}`)}
          >
            Open
          </Button>
        ),
      }),
    ],
    // `drafts` only feeds the two dropdowns' option lists.
    [navigate, drafts],
  )

  const holdColumns = useMemo(
    () => [
      holdColumnHelper.accessor('requestTypeName', {
        header: 'Request',
        meta: { filterOptions: optionsFrom(holds ?? [], (r) => r.requestTypeName) },
      }),
      holdColumnHelper.accessor('employeeName', { header: 'Employee' }),
      holdColumnHelper.accessor('branchName', {
        header: 'Branch',
        meta: { filterOptions: optionsFrom(holds ?? [], (r) => r.branchName) },
      }),
      holdColumnHelper.accessor('stepName', { header: 'Step' }),
      holdColumnHelper.accessor('detail', { header: 'Waiting on', meta: { noHeaderFilter: true } }),
      holdColumnHelper.accessor('heldBy', { header: 'Held by' }),
      holdColumnHelper.accessor('daysOnHold', { header: 'Days on hold' }),
      holdColumnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => (
          <Button
            variant="subtle"
            size="xs"
            onClick={() => navigate(`/requests/${info.row.original.requestInstanceId}`)}
          >
            Open
          </Button>
        ),
      }),
    ],
    // `holds` only feeds the two dropdowns' option lists.
    [navigate, holds],
  )

  const draftTable = useReactTable({
    data: drafts ?? [],
    columns: draftColumns,
    state: { sorting: draftSorting, columnFilters: draftFilters },
    onSortingChange: setDraftSorting,
    onColumnFiltersChange: setDraftFilters,
    // Neither panel had a search box; the filter row is their only narrowing control besides the
    // age threshold, which is a page-level control over the FETCH.
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // Multi-column sort on shift-click, as the original's Sorting mode="multiple" allowed.
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 10 } },
    getRowId: (r) => String(r.requestInstanceId),
  })

  const holdTable = useReactTable({
    data: holds ?? [],
    columns: holdColumns,
    state: { sorting: holdSorting, columnFilters: holdFilters },
    onSortingChange: setHoldSorting,
    onColumnFiltersChange: setHoldFilters,
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 10 } },
    getRowId: (r) => String(r.requestInstanceId),
  })

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Workflow oversight</h1>
          <p className="page-subtitle">
            Requests that have quietly stalled — unsigned drafts and long-running holds.
          </p>
        </div>
      </div>

      <PageHelp>
        Nothing here is broken — a draft is a decision someone started and left unsigned, and a hold
        is a deliberate pause. Both simply need a nudge. Open the request to act; this page only
        watches.
      </PageHelp>

      {/* ── Unsigned drafts ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="wf-oversight-head">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Drafts left unsigned
          </div>
          <div className="wf-oversight-control">
            <span className="wf-filter-label">Older than</span>
            <NumberInput
              value={draftDays}
              min={0}
              max={365}
              w={90}
              onChange={(v) => setDraftDays(typeof v === 'number' ? v : 3)}
            />
            <span className="wf-filter-label">days</span>
          </div>
        </div>

        {draftError && (
          <div className="alert alert--error" role="alert">
            {draftError}
          </div>
        )}

        {drafts == null ? (
          <div className="page-loading">
            <Loader size={34} />
          </div>
        ) : drafts.length === 0 ? (
          <div className="empty-hint">
            <div className="empty-hint-main">No stale drafts.</div>
            Every started decision older than {draftDays} day{draftDays === 1 ? '' : 's'} has been
            signed or discarded.
          </div>
        ) : (
          <OversightTable table={draftTable} />
        )}
      </div>

      {/* ── Long holds ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="wf-oversight-head">
          <div className="card-title" style={{ marginBottom: 0 }}>
            Requests held too long
          </div>
          <div className="wf-oversight-control">
            <span className="wf-filter-label">Older than</span>
            <NumberInput
              value={holdDays}
              min={0}
              max={365}
              w={90}
              onChange={(v) => setHoldDays(typeof v === 'number' ? v : 7)}
            />
            <span className="wf-filter-label">days</span>
          </div>
        </div>

        {holdError && (
          <div className="alert alert--error" role="alert">
            {holdError}
          </div>
        )}

        {holds == null ? (
          <div className="page-loading">
            <Loader size={34} />
          </div>
        ) : holds.length === 0 ? (
          <div className="empty-hint">
            <div className="empty-hint-main">No long-running holds.</div>
            Nothing has been on hold longer than {holdDays} day{holdDays === 1 ? '' : 's'}.
          </div>
        ) : (
          <OversightTable table={holdTable} />
        )}
      </div>
    </div>
  )
}
