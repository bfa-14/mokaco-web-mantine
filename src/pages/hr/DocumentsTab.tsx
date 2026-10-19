import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Loader, Table } from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { notifications } from '@mantine/notifications'
import { IconDownload, IconTrash, IconUpload } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { fmtBytes, fmtDateTime } from './hrFormat'
import { documentsService } from '../../services/hrService'
import type { Document } from '../../types/hr'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import { currentLocale } from '../../i18n'

/* formatSize/date formatting are SHARED and null-safe — see hrFormat.ts. The local version was
   typed `(bytes: number)` and called .toFixed on it directly, which throws rather than renders the
   moment the API omits the field. */

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
  const { t } = useTranslation()
  /* EMP_VIEW shows the documents; uploading and deleting one is EMP_EDIT, and the API answers 403
     to anyone else — so those two are not offered without it (QA3 WEB-14). Download stays. */
  const { hasPermission } = useAuth()
  const canEdit = hasPermission(PERMISSION.EMP_EDIT)
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
      notify(t('hr.documents.uploaded', { name: file.name }), 'success', 2200)
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
      <Trans i18nKey="hr.documents.deleteBody" values={{ name: doc.fileName }} components={{ name: <b /> }} />,
      t('hr.documents.deleteTitle'),
    )
    if (!ok) return
    try {
      await documentsService.remove(doc.documentId)
      notify(t('hr.documents.deleted'), 'success', 2000)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    }
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor('fileName', { header: t('hr.documents.cols.file') }),
      columnHelper.accessor('contentType', { header: t('hr.documents.cols.type') }),
      columnHelper.accessor('sizeBytes', {
        header: t('hr.documents.cols.size'),
        cell: (info) => fmtBytes(info.row.original?.sizeBytes),
        // Sorts by the byte count so the biggest file really is last; matches on "1.4 MB".
        meta: { filterText: fmtBytes },
      }),
      columnHelper.accessor('uploadedUtc', {
        header: t('hr.documents.cols.uploaded'),
        // UTC on the wire with no zone — fmtDateTime reads it as UTC (QA3 WEB-11).
        cell: (info) => fmtDateTime(info.getValue(), currentLocale()),
        meta: { filterText: (v) => fmtDateTime(v, currentLocale()) },
      }),
      columnHelper.display({
        id: 'actions',
        header: t('hr.documents.cols.actions'),
        cell: (info) => {
          const doc = info.row.original
          return (
            <div className="grid-actions">
              <ActionIcon
                variant="subtle"
                title={t('hr.documents.download')}
                aria-label={t('hr.documents.download')}
                disabled={downloadingId === doc.documentId}
                onClick={() => void handleDownload(doc)}
              >
                <IconDownload size={16} />
              </ActionIcon>
              {canEdit && (
                <ActionIcon
                  variant="subtle"
                  color="red"
                  title={t('common.delete')}
                  aria-label={t('common.delete')}
                  onClick={() => void handleDelete(doc)}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              )}
            </div>
          )
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [downloadingId, employeeId, canEdit, t],
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
          {t('hr.documents.hint')}
        </span>
        {canEdit && (
          <>
            <Button
              leftSection={<IconUpload size={16} />}
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? t('hr.documents.uploading') : t('hr.documents.upload')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => void onFilePicked(e)}
            />
          </>
        )}
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
                  {t('hr.documents.empty')}
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
              {t('common.cancel')}
            </Button>
            <Button onClick={() => settleConfirm(true)}>{t('common.ok')}</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
