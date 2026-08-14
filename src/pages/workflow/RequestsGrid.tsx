import { useMemo, useState } from 'react'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { Group, Pagination, Select, Table, TextInput } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { referenceName } from '../../i18n/referenceName'
import { dateTime, statusLabel, statusRowClass } from './workflowFormat'
import { StatusChip, StepChip, TypeDot } from './workflowShared'
import type { ForUserRequest } from '../../types/workflow'
import { useTranslation } from 'react-i18next'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'

/**
 * The Requests hub as a TABLE — the same rows the cards draw, in the shape a queue is triaged in.
 *
 * It takes the already-filtered, already-bucketed array the cards receive: one fetch, one filter
 * pass, one bucketize, and both renderers are handed the result — which is the whole reason the
 * two views can never disagree. (Unchanged contract; the renderer is TanStack Table + Mantine
 * where it was a DevExtreme DataGrid.)
 *
 * AMOUNTS ARE DELIBERATELY ABSENT — titles already carry the figure, and a money column with no
 * currency context would be a second place for the same number to be right or wrong.
 */
const columnHelper = createColumnHelper<ForUserRequest>()

const PAGE_SIZES = ['25', '50', '100']

export function RequestsGrid({
  rows,
  onOpen,
}: {
  rows: ForUserRequest[]
  /** Same destination as a card click — one navigation, whichever view is on. */
  onOpen: (item: ForUserRequest) => void
}) {
  const { t } = useTranslation()
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(() => {
    /** The type name as the cell draws it — Arabic where the row carries one. */
    const typeText = (r: ForUserRequest) =>
      referenceName({ name: r.requestTypeName, nameAr: r.requestTypeNameAr })

    /** The step chip's words: "2. Owner", or the muted dash on a finished request. */
    const stepText = (r: ForUserRequest) =>
      r.currentStepNo == null
        ? '—'
        : `${r.currentStepNo}. ${r.currentStepName ?? t('workflow.chain.step')}`

    return [
      // Filters on the DISPLAYED type name, which in Arabic is the Arabic one — matching the raw
      // English `requestTypeName` would leave an Arabic reader typing a word not on their screen.
      columnHelper.accessor('requestTypeName', {
        header: t('requests.grid.type'),
        meta: { filterText: (_v, r) => typeText(r) },
        cell: (info) => (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <TypeDot code={info.row.original.requestTypeCode} />
            {referenceName({
              name: info.row.original.requestTypeName,
              nameAr: info.row.original.requestTypeNameAr,
            })}
          </span>
        ),
      }),
      // The auto-composed request title — "Leave 2026-08-01 to 2026-08-05 (5 days)" and the like.
      // Distinct per request, so no funnel; the box and the global search both reach it.
      columnHelper.accessor('title', {
        header: t('requests.grid.titleCol'),
        cell: (info) => info.getValue(),
        meta: { noHeaderFilter: true },
      }),
      columnHelper.accessor('employeeName', { header: t('requests.grid.employee') }),
      columnHelper.accessor('branchName', { header: t('requests.grid.branch') }),
      // Sorts by the step NUMBER while showing the name — sorting by a rendered label would order
      // "10. Owner" before "2. HR". (Same rule as the original grid.)
      columnHelper.accessor('currentStepNo', {
        header: t('requests.grid.currentStep'),
        // Sorts by the number, matches on the chip — so "owner" finds the Owner step, which
        // typing against the bare step number never could.
        meta: { filterText: (_v, r) => stepText(r) },
        cell: (info) => (
          <StepChip
            stepNo={info.row.original.currentStepNo}
            stepName={info.row.original.currentStepName}
          />
        ),
      }),
      // A closed set, and the one column people triage by — a dropdown of the statuses actually
      // present, so every option returns something.
      columnHelper.accessor('status', {
        header: t('requests.grid.status'),
        cell: (info) => <StatusChip status={info.getValue()} />,
        meta: { filterText: statusLabel, filterOptions: optionsFrom(rows, (r) => statusLabel(r.status)) },
      }),
      columnHelper.accessor('submittedAt', {
        header: t('requests.grid.raised'),
        cell: (info) => dateTime(info.getValue()),
        meta: { filterText: dateTime },
      }),
      /**
       * How long this has been waiting, in whole days — a READING AID, NOT A VERDICT. The 3/7
       * thresholds are the same the cards age by, so the two views agree about what looks urgent;
       * a closed request is never coloured, because it stopped waiting when it closed.
       */
      columnHelper.accessor('daysOpen', {
        header: t('requests.grid.waiting'),
        // Matches the words in the cell, dash included — so a closed request never answers a
        // search for a number of days it is no longer accruing.
        meta: { filterText: (_v, r) =>
          r.status === 'Pending' || r.status === 'OnHold'
            ? t('common.daysShort', { count: r.daysOpen })
            : '—' },
        cell: (info) => {
          const r = info.row.original
          const open = r.status === 'Pending' || r.status === 'OnHold'
          if (!open) return <span className="wf-muted">—</span>
          const cls =
            r.daysOpen > 7
              ? 'wf-wait wf-wait-red'
              : r.daysOpen > 3
                ? 'wf-wait wf-wait-amber'
                : 'wf-wait'
          return <span className={cls}>{t('common.daysShort', { count: r.daysOpen })}</span>
        },
      }),
    ]
    // `rows` only feeds the status dropdown's option list; the column shapes themselves do not
    // depend on the data.
  }, [t, rows])

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
    initialState: { pagination: { pageSize: 25 } },
    getRowId: (r) => String(r.requestInstanceId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      {/* Searches the rows already on screen — it narrows the view, it does not re-query, so the
          filter bar above remains the only thing that changes WHICH requests are in play. */}
      <Group justify="flex-end" p="xs">
        <TextInput
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.currentTarget.value)}
          placeholder={t('requests.grid.search')}
          leftSection={<IconSearch size={14} />}
          w={240}
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
                  style={{ cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}
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
                  {t('requests.noMatch')}
                </div>
              </Table.Td>
            </Table.Tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <Table.Tr
                key={row.id}
                // The status fill applied to the ROW element, so the whole row is washed with its
                // status however far the columns scroll — same classes workflow.css already defines.
                className={statusRowClass(row.original.status)}
                style={{ cursor: 'pointer' }}
                onClick={() => onOpen(row.original)}
              >
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
          {t('requests.grid.pageInfo', {
            defaultValue: '{{from}}–{{to}} of {{total}}',
            from: total === 0 ? 0 : pageIndex * pageSize + 1,
            to: Math.min((pageIndex + 1) * pageSize, total),
            total,
          })}
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
