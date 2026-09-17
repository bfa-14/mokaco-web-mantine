import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import {
  ActionIcon,
  Button,
  Group,
  Loader,
  NumberInput,
  Pagination,
  Select,
  Table,
  TextInput,
} from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { notifications } from '@mantine/notifications'
import { IconPencil, IconPlus, IconRefresh, IconSearch, IconTrash } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { approvalTiersService } from '../../services/hrService'
import { useApprovalTiers } from '../../hr/useApprovalTiers'
import type { ApprovalTier } from '../../types/hr'

const EMP_EDIT = 'EMP_EDIT'

/** The range the tier number may take. */
const TIER_MIN = 1
const TIER_MAX = 9

const PAGE_SIZES = ['10', '25', '50']

function notify(message: string, type: 'success' | 'error', ms: number) {
  notifications.show({ message, color: type === 'success' ? 'green' : 'red', autoClose: ms })
}

const columnHelper = createColumnHelper<ApprovalTier>()

const WIDTHS: Record<string, number | undefined> = {
  tierNo: 110,
  actions: 190,
}

function TiersGrid({
  rows,
  canEdit,
  onEdit,
  onDelete,
}: {
  rows: ApprovalTier[]
  canEdit: boolean
  onEdit: (row: ApprovalTier) => void
  onDelete: (row: ApprovalTier) => void
}) {
  const { t } = useTranslation()
  const [sorting, setSorting] = useState<SortingState>([{ id: 'tierNo', desc: false }])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      columnHelper.accessor('tierNo', { header: t('hr.tiers.tierNo') }),
      columnHelper.accessor('name', { header: t('hr.tiers.name') }),
      columnHelper.accessor('nameAr', {
        header: t('hr.tiers.nameAr'),
        // An untranslated tier is a real state worth seeing, so it reads as a dash rather than
        // as an empty cell somebody might take for a rendering fault.
        cell: (info) => info.row.original.nameAr?.trim() || t('common.dash'),
        meta: { filterText: (v: string | null) => v?.trim() || t('common.dash') },
      }),
      ...(canEdit
        ? [
            columnHelper.display({
              id: 'actions',
              header: t('hr.tiers.actions'),
              cell: (info) => (
                <div className="grid-actions">
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    leftSection={<IconPencil size={14} />}
                    onClick={() => onEdit(info.row.original)}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="subtle"
                    color="red"
                    size="compact-sm"
                    leftSection={<IconTrash size={14} />}
                    onClick={() => onDelete(info.row.original)}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              ),
            }),
          ]
        : []),
    ],
    [canEdit, onDelete, onEdit, t],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter, columnFilters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 10 } },
    getRowId: (row) => String(row.tierNo),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  return (
    <div>
      <Group justify="flex-end" mb="xs">
        <TextInput
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.currentTarget.value)}
          placeholder={t('common.search')}
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
                  {t('hr.tiers.empty')}
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
  )
}

/**
 * HR → TIERS — the seniority dictionary.
 *
 * A tier is not a label on a person; it is which published approval chain their requests follow, so
 * renaming one changes what every employee screen prints and deleting one is refused while anybody
 * still holds it. Both of those rules live in the stored procedures, and this page's job is to
 * surface their answers rather than to re-implement them: the delete refusal in particular NAMES
 * who still uses the tier, which is the difference between "no" and something a user can act on.
 *
 * Every change invalidates the shared cache, so the badges on the employee list and the options in
 * the employee form follow immediately instead of waiting for a reload.
 */
export default function TiersPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canEdit = hasPermission(EMP_EDIT)

  const { tiers, loading, refetch } = useApprovalTiers()

  const [popupVisible, setPopupVisible] = useState(false)
  /** Null = creating. Otherwise the tier being renamed, whose NUMBER is locked. */
  const [editing, setEditing] = useState<ApprovalTier | null>(null)
  const [tierNo, setTierNo] = useState<number>(TIER_MIN)
  const [name, setName] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<ApprovalTier | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  function openCreate() {
    setEditing(null)
    // The next free number, so the common case needs no typing — but it stays editable.
    const used = new Set(tiers.map((x) => x.tierNo))
    let next = TIER_MIN
    while (next <= TIER_MAX && used.has(next)) next += 1
    setTierNo(Math.min(next, TIER_MAX))
    setName('')
    setNameAr('')
    setFormError(null)
    setPopupVisible(true)
  }

  function openEdit(row: ApprovalTier) {
    setEditing(row)
    setTierNo(row.tierNo)
    setName(row.name)
    setNameAr(row.nameAr ?? '')
    setFormError(null)
    setPopupVisible(true)
  }

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) {
      setFormError(t('hr.tiers.nameRequired'))
      return
    }
    setFormError(null)
    setSaving(true)

    // Empty means "no Arabic name", which is NULL rather than an empty string — otherwise the
    // fallback to the English name could never fire.
    const ar = nameAr.trim() ? nameAr.trim() : null

    try {
      if (editing) {
        await approvalTiersService.setName(editing.tierNo, { name: trimmed, nameAr: ar })
        notify(t('hr.tiers.saved'), 'success', 2000)
      } else {
        await approvalTiersService.create({ tierNo, name: trimmed, nameAr: ar })
        notify(t('hr.tiers.created'), 'success', 2000)
      }
      setPopupVisible(false)
      // Every screen that prints a tier reads the same cache — refresh it, not just this grid.
      await refetch()
    } catch (err) {
      // The procedures refuse a duplicate number and an out-of-range tier by name; show what they
      // said, in the form, where the field that caused it still is.
      setFormError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await approvalTiersService.remove(deleting.tierNo)
      notify(t('hr.tiers.deleted'), 'success', 2000)
      setDeleting(null)
      await refetch()
    } catch (err) {
      // THE GUARD'S MESSAGE IS THE POINT — it names who still holds the tier. Shown verbatim, and
      // the dialog closes because nothing was deleted and re-pressing would only repeat the answer.
      notify(getErrorMessage(err), 'error', 7000)
      setDeleting(null)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('hr.tiers.title')}</h1>
          <p className="page-subtitle">{t('hr.tiers.subtitle')}</p>
        </div>
        <div className="page-head-actions">
          <ActionIcon
            variant="default"
            size="lg"
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            onClick={() => void refetch()}
          >
            <IconRefresh size={16} />
          </ActionIcon>
          {canEdit && (
            <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
              {t('hr.tiers.add')}
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : (
        <TiersGrid
          rows={tiers}
          canEdit={canEdit}
          onEdit={openEdit}
          onDelete={(row) => setDeleting(row)}
        />
      )}

      <Modal
        opened={popupVisible}
        onClose={() => setPopupVisible(false)}
        title={editing ? t('hr.tiers.editTitle') : t('hr.tiers.addTitle')}
        size={440}
        centered
      >
        <div className="form-field">
          <label className="form-label" htmlFor="tier-no">
            {t('hr.tiers.tierNo')}
          </label>
          <NumberInput
            id="tier-no"
            value={tierNo}
            onChange={(v) =>
              setTierNo(typeof v === 'number' ? v : Number(v) || TIER_MIN)
            }
            min={TIER_MIN}
            max={TIER_MAX}
            step={1}
            allowDecimal={false}
            w={140}
            // LOCKED WHEN EDITING. The number is what employees and workflow definitions point at;
            // changing it would silently re-file everybody who holds it.
            disabled={saving || editing !== null}
          />
          <p className="hint" style={{ marginTop: 6 }}>
            {editing ? t('hr.tiers.numberLocked') : t('hr.tiers.numberHint')}
          </p>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="tier-name">
            {t('hr.tiers.name')}
          </label>
          <TextInput
            id="tier-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            disabled={saving}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="tier-name-ar">
            {t('hr.tiers.nameAr')} <span className="form-optional">{t('common.optional')}</span>
          </label>
          <TextInput
            id="tier-name-ar"
            value={nameAr}
            onChange={(e) => setNameAr(e.currentTarget.value)}
            disabled={saving}
            dir="rtl"
          />
          <p className="hint" style={{ marginTop: 6 }}>
            {t('hr.tiers.nameArHint')}
          </p>
        </div>

        {formError && (
          <div className="alert alert--error" role="alert">
            {formError}
          </div>
        )}

        <div className="form-actions">
          <Button variant="default" onClick={() => setPopupVisible(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? t('common.saving') : editing ? t('common.save') : t('hr.tiers.create')}
          </Button>
        </div>
      </Modal>

      {deleting && (
        <Modal
          opened
          onClose={() => setDeleting(null)}
          title={t('hr.tiers.deleteTitle')}
          size={480}
          centered
        >
          <p style={{ marginTop: 0 }}>
            {t('hr.tiers.deleteBody', { tier: deleting.tierNo, name: deleting.name })}
          </p>
          <p className="hint">{t('hr.tiers.deleteHint')}</p>

          <div className="form-actions">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              {t('common.cancel')}
            </Button>
            <Button color="red" onClick={() => void confirmDelete()} disabled={deleteBusy}>
              {deleteBusy ? t('hr.tiers.deletingBusy') : t('common.delete')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
