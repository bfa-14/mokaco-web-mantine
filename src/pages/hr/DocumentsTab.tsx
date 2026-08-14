import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Loader, Modal, Table } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconDownload, IconTrash, IconUpload } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { documentsService } from '../../services/hrService'
import type { Document } from '../../types/hr'

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/**
 * notify(msg, type, ms) → Mantine notifications, adapted once so every call site below
 * stays byte-identical to the original.
 */
function notify(message: string, type: 'success' | 'error', ms: number) {
  notifications.show({ message, color: type === 'success' ? 'green' : 'red', autoClose: ms })
}

/**
 * DevExtreme's `confirm(message, title)` dialog, rebuilt as a promise-backed Mantine Modal
 * so the call site keeps its original `const ok = await …; if (!ok) return` shape.
 * Closing the dialog any other way answers "no".
 */
interface ConfirmState {
  title: string
  message: ReactNode
  resolve: (proceed: boolean) => void
}

const columnHelper = createColumnHelper<Document>()

/** The pixel widths the original grid pinned; unlisted columns auto-size, as columnAutoWidth did. */
const WIDTHS: Record<string, number | undefined> = {
  contentType: 170,
  sizeBytes: 110,
  uploadedUtc: 180,
  actions: 120,
}

export function DocumentsTab({ employeeId }: { employeeId: number }) {
  const [rows, setRows] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [downloadingId, setDownloadingId] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  /** The confirm dialog currently on screen, if any — see ConfirmState. */
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  const askConfirm = useCallback(
    (message: ReactNode, title: string): Promise<boolean> =>
      new Promise<boolean>((resolve) => setConfirmState({ title, message, resolve })),
    [],
  )

  function settleConfirm(proceed: boolean) {
    confirmState?.resolve(proceed)
    setConfirmState(null)
  }

  async function reload() {
    setRows(await documentsService.getByEmployee(employeeId))
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await documentsService.getByEmployee(employeeId)
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
    void load()
    return () => {
      cancelled = true
    }
  }, [employeeId])

  async function onFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset the input so picking the same file again still fires onChange.
    event.target.value = ''
    if (!file) return

    setUploading(true)
    try {
      await documentsService.upload(employeeId, file)
      notify(`"${file.name}" uploaded.`, 'success', 2200)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4500)
    } finally {
      setUploading(false)
    }
  }

  async function handleDownload(doc: Document) {
    setDownloadingId(doc.documentId)
    try {
      await documentsService.download(doc)
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setDownloadingId(null)
    }
  }

  async function handleDelete(doc: Document) {
    const ok = await askConfirm(
      <>
        Delete <b>{doc.fileName}</b>?
      </>,
      'Confirm delete',
    )
    if (!ok) return
    try {
      await documentsService.remove(doc.documentId)
      notify('Deleted.', 'success', 2000)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    }
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor('fileName', { header: 'File' }),
      columnHelper.accessor('contentType', { header: 'Type' }),
      columnHelper.accessor('sizeBytes', {
        header: 'Size',
        cell: (info) => formatSize(info.row.original.sizeBytes),
        // Sorts by the byte count so the biggest file really is last; matches on "1.4 MB".
        meta: { filterText: formatSize },
      }),
      columnHelper.accessor('uploadedUtc', {
        header: 'Uploaded',
        cell: (info) => (info.getValue() ? new Date(info.getValue()).toLocaleString() : ''),
        meta: { filterText: (v) =>
          v ? new Date(v).toLocaleString() : '' },
      }),
      columnHelper.display({
        id: 'actions',
        header: 'Actions',
        cell: (info) => {
          const doc = info.row.original
          return (
            <div className="grid-actions">
              <ActionIcon
                variant="subtle"
                title="Download"
                aria-label="Download"
                disabled={downloadingId === doc.documentId}
                onClick={() => void handleDownload(doc)}
              >
                <IconDownload size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="red"
                title="Delete"
                aria-label="Delete"
                onClick={() => void handleDelete(doc)}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </div>
          )
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [downloadingId, employeeId],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    // This tab had no search of its own; the filter row is its first narrowing control, so the
    // filtered row model comes in with it.
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // The original's Sorting mode="multiple" — shift-click adds a column. No pager in the source,
    // so every document renders, exactly as the DataGrid did.
    enableMultiSort: true,
    getRowId: (doc) => String(doc.documentId),
  })

  if (loading) {
    return (
      <div className="page-loading">
        <Loader size={36} />
      </div>
    )
  }

  return (
    <div>
      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <div className="tab-toolbar">
        <span className="hint" style={{ flex: 1 }}>
          Files are stored on the server; type and size are detected automatically.
        </span>
        <Button
          leftSection={<IconUpload size={16} />}
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Upload Document'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => void onFilePicked(e)}
        />
      </div>

      <Table striped withTableBorder verticalSpacing="xs" fz="sm">
        <Table.Thead>
          {table.getHeaderGroups().map((hg) => (
            <Table.Tr key={hg.id}>
              {hg.headers.map((header) => (
                <Table.Th
                  key={header.id}
                  style={{
                    width: WIDTHS[header.column.id],
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
                  No documents yet.
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

      {/* The confirm dialog — devextreme/ui/dialog's confirm(), as a Mantine Modal. */}
      {confirmState && (
        <Modal
          opened
          onClose={() => settleConfirm(false)}
          title={confirmState.title}
          size={480}
          centered
        >
          <div>{confirmState.message}</div>
          <div className="form-actions">
            <Button variant="default" onClick={() => settleConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={() => settleConfirm(true)}>OK</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
