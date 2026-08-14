import { useCallback, useEffect, useMemo, useState } from 'react'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Loader, Pagination, Select, Table, TextInput } from '@mantine/core'
import { IconRefresh, IconSearch, IconUpload } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { useAuth } from '../../auth/useAuth'
import { signaturesService } from '../../services/securityService'
import type { UserSignatureInfo } from '../../types/security'
import { SignatureThumb } from '../security/SignatureThumb'
import { SignatureDialog } from '../security/SignatureDialog'

const columnHelper = createColumnHelper<UserSignatureInfo>()

const PAGE_SIZES = ['15', '30', '50']

/**
 * Signature images. Shares the exact upload/thumbnail machinery the Users page uses — the list
 * carries only a HasSignature flag, and each thumbnail loads from its own cached URL, so the grid
 * never drags image bytes around.
 */
export default function WorkflowSignaturesPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('SIGNATURE_MANAGE')

  const [signatures, setSignatures] = useState<UserSignatureInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<UserSignatureInfo | null>(null)

  const [sorting, setSorting] = useState<SortingState>([])
  /* PORT NOTE: the grid keeps its SearchPanel as the global search box and its FilterRow as the
     per-column strip. Only User is filterable here — Signature and the upload button are display
     columns, and an image has nothing to type at. */
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const load = useCallback(async () => {
    try {
      setSignatures(await signaturesService.getAll())
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

  const columns = useMemo(
    () => [
      columnHelper.accessor('username', { header: 'User' }),
      columnHelper.display({
        id: 'signature',
        header: 'Signature',
        cell: (info) => {
          const s = info.row.original
          return s.hasSignature ? (
            <SignatureThumb userId={s.userId} version={s.updatedAt} />
          ) : (
            <span className="badge badge--muted">None</span>
          )
        },
      }),
      // The upload column exists only for whoever may manage signatures — same as the original.
      ...(canManage
        ? [
            columnHelper.display({
              id: 'actions',
              header: '',
              cell: (info) => (
                <Button
                  variant="subtle"
                  size="xs"
                  leftSection={<IconUpload size={14} />}
                  onClick={() => setTarget(info.row.original)}
                >
                  Upload
                </Button>
              ),
            }),
          ]
        : []),
    ],
    [canManage],
  )

  const table = useReactTable({
    data: signatures,
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
    getRowId: (s) => String(s.userId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Signatures</h1>
          <p className="page-subtitle">The signature images that appear on signed requests.</p>
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
        A signature image makes an approved request look like a signed document. The record
        of who approved what, and when, is kept separately and is what actually counts.
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
      ) : (
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

      {target && (
        <SignatureDialog
          user={{ userId: target.userId, username: target.username }}
          existing={target}
          onClose={() => setTarget(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}
