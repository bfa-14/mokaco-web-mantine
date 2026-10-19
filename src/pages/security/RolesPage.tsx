import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createColumnHelper, flexRender, getCoreRowModel, getExpandedRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, ExpandedState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Loader, Pagination, Select, Table, TextInput } from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { notifications } from '@mantine/notifications'
import { IconChevronDown, IconChevronRight, IconPencil, IconPlus, IconRefresh, IconSearch } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { rolesService } from '../../services/securityService'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import type {
  Role,
  RoleRejectionBehaviour,
  RoleSignatureRequirement,
} from '../../types/security'
import { RoleWorkflowBehaviour } from './RoleWorkflowBehaviour'
import { dateTime } from '../workflow/workflowFormat'

/**
 * notify(msg, type, ms) → Mantine notifications, adapted once so every call site below
 * stays byte-identical to the original.
 */
function notify(message: string, type: 'success' | 'error', ms: number) {
  notifications.show({ message, color: type === 'success' ? 'green' : 'red', autoClose: ms })
}

/** DevExtreme's dataType="datetime" rendering, by hand: locale string, blank for null. The value is
    UTC with no zone on the wire, which dateTime() reads as UTC (QA3 WEB-11). */
function dateTimeCell(value: string | null): string {
  return value ? dateTime(value) : ''
}

/* PORT NOTE: the grid's SearchPanel, FilterRow and HeaderFilter are all present — search box,
   filter strip and header funnel; Sorting mode="multiple" and the 10/25/50 pager carry over. MasterDetail became
   a chevron expander column plus a full-width detail row (expansion state keyed by roleId, so the
   in-place map updates never collapse an open panel).
   alignment={alignStart()} on the ID column is dropped — Mantine cells already start-align. */

const columnHelper = createColumnHelper<Role>()

/** The pixel widths the original grid pinned; unlisted columns auto-size, as columnAutoWidth did. */
const ROLE_WIDTHS: Record<string, number | undefined> = {
  expander: 36,
  roleId: 80,
  isSystem: 110,
  createdAt: 180,
  modifiedAt: 180,
  actions: 110,
}

/** The page sizes the original pager offered. */
const PAGE_SIZES = ['10', '25', '50']

export default function RolesPage() {
  const { t } = useTranslation()
  const [roles, setRoles] = useState<Role[]>([])
  // Workflow-behaviour data, keyed by roleId. signature-requirements covers every role (approver +
  // signature flags); rejection-behaviour covers only approver roles, so a missing entry is the
  // default ("recommendation"), which the detail panel reads as such.
  const [sigByRole, setSigByRole] = useState<Map<number, RoleSignatureRequirement>>(new Map())
  const [rejByRole, setRejByRole] = useState<Map<number, RoleRejectionBehaviour>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [popupVisible, setPopupVisible] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  /** The RequiredRule's replacement: its message, shown in the dialog when the name is missing. */
  const [formError, setFormError] = useState<string | null>(null)

  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [expanded, setExpanded] = useState<ExpandedState>({})

  const loadRoles = useCallback(async () => {
    try {
      const [data, sigs, rejs] = await Promise.all([
        rolesService.getRoles(),
        rolesService.getSignatureRequirements().catch(() => [] as RoleSignatureRequirement[]),
        rolesService.getRejectionBehaviour().catch(() => [] as RoleRejectionBehaviour[]),
      ])
      setRoles(data)
      setSigByRole(new Map(sigs.map((s) => [s.roleId, s])))
      setRejByRole(new Map(rejs.map((r) => [r.roleId, r])))
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  function refresh() {
    setLoading(true)
    void loadRoles()
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRoles()
  }, [loadRoles])

  // The PUTs return the role's fresh standing, so the maps are updated from the response — never
  // recomputed, and never a full refetch that would collapse the expanded panel.
  function updateSig(updated: RoleSignatureRequirement) {
    setSigByRole((prev) => new Map(prev).set(updated.roleId, updated))
  }
  function updateRej(updated: RoleRejectionBehaviour) {
    setRejByRole((prev) => new Map(prev).set(updated.roleId, updated))
  }

  function openCreate() {
    setEditingRole(null)
    setName('')
    setFormError(null)
    setPopupVisible(true)
  }

  const openEdit = useCallback((role: Role) => {
    setEditingRole(role)
    setName(role.name)
    setFormError(null)
    setPopupVisible(true)
  }, [])

  async function submit() {
    const trimmed = name.trim()
    // The RequiredRule's work, done by hand now the Validator is gone.
    if (!trimmed) {
      setFormError(t('security.roles.nameRequired'))
      return
    }
    setFormError(null)
    setSaving(true)
    try {
      if (editingRole) {
        await rolesService.updateRole(editingRole.roleId, trimmed)
        notify(t('security.roles.updated', { name: trimmed }), 'success', 2500)
      } else {
        await rolesService.createRole(trimmed)
        notify(t('security.roles.created', { name: trimmed }), 'success', 2500)
      }
      setPopupVisible(false)
      await loadRoles()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo(
    () => [
      // The MasterDetail expander — one chevron per row, toggling its detail panel.
      columnHelper.display({
        id: 'expander',
        header: () => null,
        cell: (info) => (
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label={info.row.getIsExpanded() ? t('security.roles.collapse') : t('security.roles.expand')}
            onClick={info.row.getToggleExpandedHandler()}
          >
            {info.row.getIsExpanded() ? (
              <IconChevronDown size={16} />
            ) : (
              <IconChevronRight size={16} />
            )}
          </ActionIcon>
        ),
      }),
      columnHelper.accessor('roleId', { header: t('security.roles.cols.id') }),
      columnHelper.accessor('name', { header: t('security.roles.cols.name') }),
      // A user-defined role prints an EMPTY cell here, so only 'System' is on offer — picking it
      // is the one useful narrowing, and the cleared filter is "all roles".
      columnHelper.accessor('isSystem', {
        header: t('security.roles.cols.system'),
        cell: (info) =>
          info.row.original.isSystem ? (
            <span className="badge badge--muted">{t('security.roles.cols.system')}</span>
          ) : (
            ''
          ),
        meta: {
          filterText: (v) => (v ? t('security.roles.cols.system') : ''),
          filterOptions: [t('security.roles.cols.system')],
        },
      }),
      columnHelper.accessor('createdAt', {
        header: t('security.roles.cols.created'),
        cell: (info) => dateTimeCell(info.getValue()),
        meta: { filterText: dateTimeCell },
      }),
      columnHelper.accessor('modifiedAt', {
        header: t('security.roles.cols.modified'),
        cell: (info) => dateTimeCell(info.getValue()),
        meta: { filterText: dateTimeCell },
      }),
      columnHelper.display({
        id: 'actions',
        header: t('security.roles.cols.actions'),
        cell: (info) => {
          const role = info.row.original
          return (
            <Button
              variant="subtle"
              size="compact-sm"
              leftSection={<IconPencil size={14} />}
              disabled={role.isSystem}
              title={role.isSystem ? t('security.roles.systemLocked') : t('security.roles.edit')}
              onClick={() => openEdit(role)}
            >
              {t('common.edit')}
            </Button>
          )
        },
      }),
    ],
    [openEdit, t],
  )

  const table = useReactTable({
    data: roles,
    columns,
    state: { sorting, globalFilter, expanded, columnFilters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onExpandedChange: setExpanded,
    onColumnFiltersChange: setColumnFilters,
    // The one shared filter function: the funnel's ticked values AND the filter row's text,
    // both tested against the same displayed string. Per-column formatting lives in meta.filterText.
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
    // The original's Sorting mode="multiple" — shift-click adds a column.
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 10 } },
    getRowId: (r) => String(r.roleId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  /** The detail panel's content for one role — behaviour settings, or why they are absent. */
  function detailPanel(role: Role) {
    const sig = sigByRole.get(role.roleId)
    if (!sig) {
      return (
        <p className="hint" style={{ margin: 0 }}>
          {t('security.roles.noWorkflowSettings')}
        </p>
      )
    }
    return (
      <RoleWorkflowBehaviour
        sig={sig}
        rejection={rejByRole.get(role.roleId)}
        onSigChanged={updateSig}
        onRejectionChanged={updateRej}
      />
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('security.roles.title')}</h1>
          <p className="page-subtitle">{t('security.roles.subtitle')}</p>
        </div>
        <div className="page-head-actions">
          <ActionIcon
            variant="default"
            size="lg"
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            onClick={refresh}
          >
            <IconRefresh size={18} />
          </ActionIcon>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            {t('security.roles.new')}
          </Button>
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
                        width: ROLE_WIDTHS[header.column.id],
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
                      {t('security.roles.empty')}
                    </div>
                  </Table.Td>
                </Table.Tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <Fragment key={row.id}>
                    <Table.Tr>
                      {row.getVisibleCells().map((cell) => (
                        <Table.Td key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </Table.Td>
                      ))}
                    </Table.Tr>
                    {/* Expand a role to reveal its workflow-behaviour settings — approver usage,
                        signature and rejection together in one panel, each saving on change. */}
                    {row.getIsExpanded() && (
                      <Table.Tr>
                        <Table.Td colSpan={columns.length}>
                          {detailPanel(row.original)}
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Fragment>
                ))
              )}
            </Table.Tbody>
          </Table>

          <Group justify="space-between" mt="xs">
            <span className="hint" style={{ margin: 0 }}>
              {t('common.pageInfo', {
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
      )}

      <Modal
        opened={popupVisible}
        onClose={() => setPopupVisible(false)}
        title={editingRole ? t('security.roles.editTitle') : t('security.roles.new')}
        size={400}
        centered
      >
        <div className="form-field">
          <label className="form-label" htmlFor="role-name">
            {t('security.roles.name')}
          </label>
          <TextInput
            id="role-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            disabled={saving}
          />
        </div>

        {formError && (
          <div className="alert alert--error" role="alert">
            {formError}
          </div>
        )}

        <div className="form-actions">
          <Button
            variant="default"
            onClick={() => setPopupVisible(false)}
            disabled={saving}
          >
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? t('common.saving') : editingRole ? t('common.save') : t('security.roles.create')}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
