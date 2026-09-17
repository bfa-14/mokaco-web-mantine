import { useEffect, useMemo, useState } from 'react'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Loader, Pagination, Select, Switch, Table, TextInput } from '@mantine/core'
import { Modal } from './dialogs'
import { notifications } from '@mantine/notifications'
import { IconPencil, IconPlus, IconRefresh, IconSearch } from '@tabler/icons-react'
import { getErrorMessage } from '../api/errorMessage'
import { useAuth } from '../auth/useAuth'
import { alignStart } from '../i18n/physical'
import { gridFilterFn, GridFilterRow } from './grid/GridFilterRow'
import { GridHeaderContent } from './grid/GridHeaderFilter'

type LookupRow = Record<string, unknown>

/**
 * notify(msg, type, ms) → Mantine notifications, adapted once so every call site below
 * stays byte-identical to the original.
 */
function notify(message: string, type: 'success' | 'error', ms: number) {
  notifications.show({ message, color: type === 'success' ? 'green' : 'red', autoClose: ms })
}

/** The page sizes the original pager offered. */
const PAGE_SIZES = ['10', '25', '50']

/* PORT NOTE: the DevExtreme SearchPanel is the global search box; the FilterRow is back as the
   per-column strip under the header. Sorting mode="multiple" and the 10/25/50 pager carry over. */

/** The two words the Status cell can show — the closed set the filter dropdown offers. */
const ACTIVE_LABELS = ['Active', 'Inactive']
const activeText = (isActive: boolean) => (isActive ? 'Active' : 'Inactive')

const columnHelper = createColumnHelper<LookupRow>()

interface LookupGridPageProps {
  title: string
  subtitle: string
  /**
   * The permission code that may CHANGE this dictionary — 'ORG_MANAGE' and the like.
   *
   * Without it the grid renders read-only: no New, no Edit, no popup. The route guard usually keeps
   * such a reader out of these pages entirely (the setup tables follow their write trust), so this
   * is the second lock rather than the first — and it is the one that still holds if a page is ever
   * opened up to its read code, which is the change that would otherwise leave live buttons behind.
   *
   * Omitted, the grid is editable by anyone who reached it.
   */
  managePermission?: string
  /** Primary-key field name, e.g. "branchId". */
  keyField: string
  /** The editable text field name, e.g. "name" or "title". */
  textField: string
  /** Label shown for the text field, e.g. "Name" or "Title". */
  textLabel: string
  load: () => Promise<unknown[]>
  create: (text: string) => Promise<unknown>
  update: (id: number, text: string, isActive: boolean) => Promise<unknown>
}

export function LookupGridPage({
  title,
  subtitle,
  managePermission,
  keyField,
  textField,
  textLabel,
  load,
  create,
  update,
}: LookupGridPageProps) {
  const { hasPermission } = useAuth()
  const canManage = managePermission == null || hasPermission(managePermission)
  const [rows, setRows] = useState<LookupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [popupVisible, setPopupVisible] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  /** The RequiredRule's replacement: the same message, shown on the field, gating the same way. */
  const [textError, setTextError] = useState<string | null>(null)

  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  async function reload() {
    try {
      const data = await load()
      setRows(data as LookupRow[])
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      try {
        const data = await load()
        if (!cancelled) {
          setRows(data as LookupRow[])
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function refresh() {
    setLoading(true)
    void reload()
  }

  function openCreate() {
    setEditingId(null)
    setText('')
    setIsActive(true)
    setTextError(null)
    setPopupVisible(true)
  }

  function openEdit(row: LookupRow) {
    setEditingId(row[keyField] as number)
    setText((row[textField] as string) ?? '')
    setIsActive(Boolean(row.isActive))
    setTextError(null)
    setPopupVisible(true)
  }

  async function submit() {
    const trimmed = text.trim()
    if (!trimmed) {
      setTextError(`${textLabel} is required`)
      return
    }
    setSaving(true)
    try {
      if (editingId != null) {
        await update(editingId, trimmed, isActive)
        notify('Saved.', 'success', 2000)
      } else {
        await create(trimmed)
        notify('Created.', 'success', 2000)
      }
      setPopupVisible(false)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setSaving(false)
    }
  }

  /** The pixel widths the original grid pinned; unlisted columns auto-size, as columnAutoWidth did. */
  const widths: Record<string, number | undefined> = useMemo(
    () => ({ [keyField]: 80, isActive: 130, actions: 110 }),
    [keyField],
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor((row) => row[keyField] as number, {
        id: keyField,
        header: 'ID',
      }),
      columnHelper.accessor((row) => (row[textField] as string) ?? '', {
        id: textField,
        header: textLabel,
      }),
      // The accessor stays the boolean (so the sort groups cleanly); the filter matches the WORD
      // in the badge, offered as the closed two-value dropdown it is.
      columnHelper.accessor((row) => Boolean(row.isActive), {
        id: 'isActive',
        header: 'Status',
        cell: (info) => (
          <span className={info.getValue() ? 'badge badge--on' : 'badge badge--off'}>
            {activeText(info.getValue())}
          </span>
        ),
        meta: { filterText: activeText, filterOptions: ACTIVE_LABELS },
      }),
      // The whole COLUMN goes for a reader, not just the button inside it — an "Actions" header
      // over a strip of empty cells reads as a grid that failed to render its own controls.
      ...(canManage
        ? [
            columnHelper.display({
              id: 'actions',
              header: 'Actions',
              cell: (info) => (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  leftSection={<IconPencil size={14} />}
                  onClick={() => openEdit(info.row.original)}
                >
                  Edit
                </Button>
              ),
            }),
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyField, textField, textLabel, canManage],
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
    // The original's Sorting mode="multiple" — shift-click adds a column.
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 10 } },
    getRowId: (row) => String(row[keyField]),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        <div className="page-head-actions">
          <ActionIcon
            variant="default"
            size="lg"
            title="Refresh"
            aria-label="Refresh"
            onClick={refresh}
          >
            <IconRefresh size={16} />
          </ActionIcon>
          {canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
              New
            </Button>
          )}
        </div>
      </div>

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
        <div>
          <Group justify="flex-end" mb="xs">
            <TextInput
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.currentTarget.value)}
              placeholder="Search"
              leftSection={<IconSearch size={14} />}
              w={240}
              size="xs"
            />
          </Group>

          <Table striped withTableBorder verticalSpacing="xs" fz="sm">
            <Table.Thead>
              {table.getHeaderGroups().map((hg) => (
                <Table.Tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <Table.Th
                      key={header.id}
                      style={{
                        width: widths[header.column.id],
                        // The original pinned the ID column with alignment={alignStart()} so it
                        // survives RTL; everything else keeps the table's natural start alignment.
                        textAlign: header.column.id === keyField ? alignStart() : undefined,
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
                      No records found.
                    </div>
                  </Table.Td>
                </Table.Tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <Table.Tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <Table.Td
                        key={cell.id}
                        style={
                          cell.column.id === keyField ? { textAlign: alignStart() } : undefined
                        }
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>

          <Group justify="space-between" mt="xs">
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

      <Modal
        opened={popupVisible}
        onClose={() => setPopupVisible(false)}
        title={editingId != null ? `Edit ${title}` : `New ${title}`}
        size={400}
        centered
      >
        <div className="form-field">
          <label className="form-label" htmlFor="lookup-text">
            {textLabel}
          </label>
          <TextInput
            id="lookup-text"
            value={text}
            onChange={(e) => {
              setText(e.currentTarget.value)
              if (textError) setTextError(null)
            }}
            error={textError}
            disabled={saving}
          />
        </div>

        {editingId != null && (
          <div className="form-field form-field--row">
            <label className="form-label">Active</label>
            <Switch
              checked={isActive}
              onChange={(e) => setIsActive(e.currentTarget.checked)}
              disabled={saving}
            />
          </div>
        )}

        <div className="form-actions">
          <Button variant="default" onClick={() => setPopupVisible(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : editingId != null ? 'Save' : 'Create'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
