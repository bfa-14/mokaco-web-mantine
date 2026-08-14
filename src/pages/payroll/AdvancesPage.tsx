/* src/pages/payroll/AdvancesPage.tsx */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Checkbox, Group, Modal, NumberInput, Pagination, Select, Table, TextInput } from '@mantine/core'
import { IconPencil, IconPlus, IconRefresh, IconSearch } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { advancesService } from '../../services/payrollService'
import type { SalaryAdvance } from '../../types/payroll'
import './payroll.css'

const EMPTY: SalaryAdvance[] = []
const fmt = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const columnHelper = createColumnHelper<SalaryAdvance>()
const PAGE_SIZES = ['15', '30', '60']

/**
 * ADVANCES — money already handed over, recovered a slice per run. The grid's
 * one bold column is REMAINING, because that is the question this page exists
 * to answer at any moment. Payroll takes MIN(monthly, remaining) each run and
 * moves the balance only when the run locks.
 *
 * NOTHING IS CREATED HERE ANY MORE. An advance is a request now: it is raised, approved, and the
 * payroll row is written by the FINAL approval — payroll.usp_Advance_Create refuses outright and
 * points at the request type, so the create form here was posting to a route the API deliberately
 * does not expose. The one thing this page still writes is the monthly deduction, which is a
 * recovery-pace decision rather than a new loan.
 */
export default function AdvancesPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<SalaryAdvance[]>(EMPTY)
  const [openOnly, setOpenOnly] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editRow, setEditRow] = useState<SalaryAdvance | null>(null)
  const [editMonthly, setEditMonthly] = useState<number | null>(null)
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const refresh = useCallback(() => {
    advancesService.getList({ openOnly })
      .then(setRows)
      .catch((e) => setError(getErrorMessage(e)))
  }, [openOnly])
  useEffect(refresh, [refresh])

  const saveMonthly = useCallback(async () => {
    if (!editRow || editMonthly == null || editMonthly <= 0) return
    setBusy(true); setError(null)
    try {
      await advancesService.updateMonthly(editRow.salaryAdvanceId, editMonthly)
      setEditRow(null)
      refresh()
    } catch (e) { setError(getErrorMessage(e)) } finally { setBusy(false) }
  }, [editRow, editMonthly, refresh])

  const grid = useMemo(() => rows, [rows])

  const columns = useMemo(
    () => [
      columnHelper.accessor('employeeName', { header: 'Employee' }),
      // Money columns print grouped to 2dp with a currency beside them, so every one of them
      // matches on what it prints rather than on the bare number underneath.
      columnHelper.accessor('amount', {
        header: 'Advance',
        cell: (c) => {
          const d = c.row.original; return `${fmt(d.amount)} ${d.currencyCode}`
        },
        meta: { filterText: (v, row) => `${fmt(v)} ${row.currencyCode}` },
      }),
      columnHelper.accessor('advanceDate', {
        header: 'Date',
        size: 110,
        cell: (c) => new Date(c.getValue()).toLocaleDateString(),
        meta: { filterText: (v) =>
          new Date(v).toLocaleDateString() },
      }),
      columnHelper.accessor('monthlyDeduction', {
        header: 'Monthly',
        size: 110,
        cell: (c) => fmt(c.getValue()),
        meta: { filterText: fmt },
      }),
      columnHelper.accessor('remainingAmount', {
        header: 'Remaining',
        size: 130,
        cell: (c) => <b>{fmt(c.getValue())}</b>,
        meta: { filterText: fmt },
      }),
      columnHelper.accessor('firstDeductionPeriod', { header: 'From', size: 90 }),
      // An unsettled advance shows an EMPTY cell, so the dropdown offers only 'Settled' — the
      // page's own "open only" tick-box is the other half of this question.
      columnHelper.accessor('isSettled', {
        header: 'Settled',
        size: 90,
        cell: (c) => (c.getValue() ? <span className="pr-chip pr-chip-approved">Settled</span> : null),
        meta: { filterText: (v) => (v ? 'Settled' : ''), filterOptions: ['Settled'] },
      }),
      columnHelper.accessor('reason', { header: 'Reason', meta: { noHeaderFilter: true } }),
      columnHelper.display({
        id: 'edit',
        header: '',
        size: 70,
        cell: (c) => {
          const d = c.row.original
          return d.isSettled ? null : (
            <ActionIcon
              variant="subtle"
              title="Change monthly deduction"
              aria-label="Change monthly deduction"
              onClick={() => { setEditRow(d); setEditMonthly(d.monthlyDeduction) }}
            >
              <IconPencil size={16} />
            </ActionIcon>
          )
        },
      }),
    ],
    [],
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
    getRowId: (r) => String(r.salaryAdvanceId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Salary advances</h1>
          <p className="page-subtitle">Handed over now, recovered a slice per payroll run.</p>
        </div>
        <div className="page-head-actions">
          <Checkbox
            label="Open only"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.currentTarget.checked)}
          />
          <ActionIcon variant="default" size="lg" aria-label="Refresh" onClick={refresh}>
            <IconRefresh size={16} />
          </ActionIcon>
          {/* An advance is a REQUEST now — raised, approved, and only then handed over. */}
          <Button leftSection={<IconPlus size={16} />}
            onClick={() => navigate('/requests/new?type=SALARY_ADVANCE')}>
            Raise an advance request
          </Button>
        </div>
      </div>

      <PageHelp>
        Every advance here arrived through an approved request — it is raised, signed, and the row is
        created by the final approval. Each payroll run then deducts the monthly amount (or whatever
        remains, if less) and the balance moves when the run is approved. To pause or slow recovery,
        change the monthly deduction.
      </PageHelp>

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
                  <div className="empty-hint" style={{ padding: 16 }}>No advances.</div>
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

      {/* change monthly */}
      <Modal
        opened={!!editRow}
        onClose={() => setEditRow(null)}
        title="Change monthly deduction"
        size={420}
        centered
      >
        {editRow && (
          <>
            <p>{editRow.employeeName} — {fmt(editRow.remainingAmount)} {editRow.currencyCode} remaining.</p>
            <NumberInput
              value={editMonthly ?? ''}
              min={0}
              decimalScale={2}
              disabled={busy}
              onChange={(v) => setEditMonthly(typeof v === 'number' ? v : null)}
            />
            {error && <div className="wf-balance-warn">{error}</div>}
            <div className="pr-actions">
              <Button disabled={busy || editMonthly == null || editMonthly <= 0}
                onClick={() => void saveMonthly()}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="subtle" onClick={() => setEditRow(null)}>Back</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
