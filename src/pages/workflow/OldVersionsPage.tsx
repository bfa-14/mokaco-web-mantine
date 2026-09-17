import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Loader, Pagination, Select, Table, Textarea } from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { notifications } from '@mantine/notifications'
import { IconRefresh } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { requestsService, chainsService } from '../../services/workflowService'
import type { OldVersionRequest } from '../../types/workflow'

/**
 * notify(msg, type, ms) → Mantine notifications, adapted once so every call site below
 * stays byte-identical to the original.
 */
function notify(message: string, type: 'success' | 'error', ms: number) {
  notifications.show({ message, color: type === 'success' ? 'green' : 'red', autoClose: ms })
}

const columnHelper = createColumnHelper<OldVersionRequest>()

const PAGE_SIZES = ['15', '30', '50']

/**
 * Pending requests still on a superseded chain — HR's move queue. There is deliberately NO bulk
 * move: each move rewrites who must sign a live request, so it is one at a time, each with its own
 * reason. If that feels slow, that is the intent.
 */
export default function OldVersionsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<OldVersionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [target, setTarget] = useState<OldVersionRequest | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const load = useCallback(async () => {
    try {
      setRows(await chainsService.getOnOldVersions())
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Mount-time fetch. load() is async and setStates only after its awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function move() {
    if (!target) return
    if (!reason.trim()) {
      notify('A reason is required to move a request.', 'error', 3000)
      return
    }
    setBusy(true)
    try {
      await requestsService.moveVersion(
        target.requestInstanceId,
        reason.trim(),
        target.activeWorkflowDefinitionId,
      )
      notify(
        `Moved to v${target.activeVersion}. Signatures already given were kept.`,
        'success',
        3500,
      )
      setTarget(null)
      setReason('')
      await load()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4500)
    } finally {
      setBusy(false)
    }
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor('requestTypeName', {
        header: 'Request',
        meta: { filterOptions: optionsFrom(rows, (r) => r.requestTypeName) },
      }),
      columnHelper.accessor('employeeName', { header: 'Employee' }),
      columnHelper.accessor('branchName', {
        header: 'Branch',
        meta: { filterOptions: optionsFrom(rows, (r) => r.branchName) },
      }),
      columnHelper.accessor('currentStepName', {
        header: 'Current step',
        cell: (info) => info.row.original.currentStepName ?? '—',
        meta: { filterText: (v) => v ?? '—' },
      }),
      columnHelper.display({
        id: 'version',
        header: 'Version',
        cell: (info) => {
          const r = info.row.original
          return `on v${r.currentVersion} · active is v${r.activeVersion}`
        },
      }),
      columnHelper.accessor('daysWaiting', { header: 'Waiting (days)' }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => {
          const r = info.row.original
          return (
            <div className="grid-actions">
              <Button
                variant="subtle"
                size="xs"
                color="gray"
                onClick={() => navigate(`/requests/${r.requestInstanceId}`)}
              >
                Open
              </Button>
              <Button variant="subtle" size="xs" onClick={() => setTarget(r)}>
                Move to v{r.activeVersion}
              </Button>
            </div>
          )
        },
      }),
    ],
    // `rows` only feeds the two dropdowns' option lists.
    [navigate, rows],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    // This page had no search box; the filter row is its only narrowing control.
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // Multi-column sort on shift-click, as the original's Sorting mode="multiple" allowed.
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 15 } },
    getRowId: (r) => String(r.requestInstanceId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  // The count under the pager must follow the filter row, not the raw load.
  const total = table.getFilteredRowModel().rows.length

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Requests on old chains</h1>
          <p className="page-subtitle">
            Pending requests still following a superseded chain.
          </p>
        </div>
        <div className="page-head-actions">
          <ActionIcon
            variant="default"
            size="lg"
            title="Refresh"
            aria-label="Refresh"
            onClick={() => {
              setLoading(true)
              void load()
            }}
          >
            <IconRefresh size={16} />
          </ActionIcon>
        </div>
      </div>

      <PageHelp>
        These requests started on an earlier chain. Moving one applies the new chain to its
        remaining steps — signatures already given are never asked for twice.
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
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">Nothing is on an old chain.</div>
            Every pending request is following the current version. There is nothing to move.
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
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
        </div>
      )}

      {/* The move confirmation states the rules, because they are genuinely not guessable. */}
      {target && (
        <Modal
          opened
          onClose={() => {
            setTarget(null)
            setReason('')
          }}
          title={`Move to v${target.activeVersion}`}
          size={520}
          centered
        >
          <p className="hint" style={{ marginTop: 0 }}>
            Moving <strong>{target.requestTypeName}</strong> for{' '}
            <strong>{target.employeeName}</strong> from v{target.currentVersion} to v
            {target.activeVersion}:
          </p>
          <ul className="hint" style={{ marginTop: 0, paddingInlineStart: 18, lineHeight: 1.7 }}>
            <li>Steps already approved keep their signatures and will not be asked again.</li>
            <li>The remaining steps come from the new chain.</li>
            <li>
              Any step the new chain adds BEFORE the point this request has already reached
              will be skipped and logged, not run retroactively.
            </li>
          </ul>
          <div className="form-field">
            <label className="form-label">Reason</label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
              minRows={2}
              placeholder="Why is this request being moved?"
              disabled={busy}
            />
          </div>
          <div className="form-actions">
            <Button
              variant="default"
              onClick={() => {
                setTarget(null)
                setReason('')
              }}
              disabled={busy}
            >
              Back
            </Button>
            <Button onClick={() => void move()} disabled={busy}>
              {busy ? 'Moving…' : `Move to v${target.activeVersion}`}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
