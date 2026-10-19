import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState, Table as TableInstance } from '@tanstack/react-table'
import { Button, Loader, NumberInput, Select, Table } from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { DatePickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconCalendar, IconCalendarOff, IconPencil, IconPlus } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { currenciesService } from '../../services/coreService'
import { componentTypesService, salaryAdminService } from '../../services/hrService'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import { fmtDate, fmtNumber } from './hrFormat'
import { useApprovalTiers } from '../../hr/useApprovalTiers'
import type { ComponentType, EmployeeSalaryComponent } from '../../types/hr'
import type { Currency } from '../../types/core'
import { parseDecimal } from '../../components/numeric'
import type { NumberInputValue } from '../../components/numeric'
import { assignableTypes, canEndOn, isBasicType, isOpenRow, salaryRowState, sortSalaryRows } from './salaryRows'
import type { SalaryRowState } from './salaryRows'

/**
 * THE SALARY TAB, ON THE HISTORY-PRESERVING PATH (QA3 PAY-6 / REL-2).
 *
 * It used to insert, edit in place and hard-delete hr.SALARY_COMPONENT rows through POST / PUT / DELETE
 * /api/salary-components: no locked-month check, and a raise added as a second row left the first one
 * open, so payroll paid both in full. Those routes are gone. A salary now changes FROM a date
 * (PUT /api/employees/{id}/salary-components — the standing value ends the day before, a locked month is
 * refused with the earliest date that works) and a component stops on a date (POST …/{id}/end). Closed
 * rows are history: read-only, never deleted, so a month already paid keeps saying what it paid. The
 * pure rules — row state, which types may be assigned, the order — are in salaryRows.ts.
 */

interface SetFormState {
  componentTypeId: number | null
  /** As the box hands it over ("12." while typing) — coerced in submit. See components/numeric.ts. */
  amount: NumberInputValue
  currencyCode: string
  effectiveFrom: string
}

const EMPTY: SetFormState = { componentTypeId: null, amount: '', currencyCode: '', effectiveFrom: '' }

function notify(message: string, type: 'success' | 'error', ms: number) {
  notifications.show({ message, color: type === 'success' ? 'green' : 'red', autoClose: ms })
}

/** Today in Beirut, YYYY-MM-DD — the company's day, which is what "current" and "ended" are judged on. */
function beirutToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Beirut', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

const STATE_BADGE: Record<SalaryRowState, string> = {
  current: 'badge badge--on',
  scheduled: 'badge badge--muted',
  ended: 'badge badge--off',
}

/* The DevExtreme DataGrid port, kept: TanStack Table + Mantine Table, a filter row, no pager. */
function GridTable<T>({ table, emptyText }: { table: TableInstance<T>; emptyText: string }) {
  const columnCount = table.getAllColumns().length
  return (
    <Table striped withTableBorder verticalSpacing="xs" fz="sm">
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
                onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
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
            <Table.Td colSpan={columnCount}>
              <div className="empty-hint" style={{ padding: 16 }}>{emptyText}</div>
            </Table.Td>
          </Table.Tr>
        ) : (
          table.getRowModel().rows.map((row) => (
            <Table.Tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <Table.Td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</Table.Td>
              ))}
            </Table.Tr>
          ))
        )}
      </Table.Tbody>
    </Table>
  )
}

const columnHelper = createColumnHelper<EmployeeSalaryComponent>()

export function SalaryComponentsTab({
  employeeId,
  approvalTier,
}: {
  employeeId: number
  /**
   * The employee's tier, for the basic-salary band hint. Passed down rather than re-fetched: the
   * profile page has already loaded it, and a second fetch could disagree with the header on screen.
   */
  approvalTier?: number | null
}) {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  /* The two writes are EMP_EDIT, the endpoints' own code; the procedure then admits HR (or Admin) and
     says so in a sentence. A reader sees the history and nothing to press. */
  const canEdit = hasPermission(PERMISSION.EMP_EDIT)
  const { tiers, tierName } = useApprovalTiers()
  const [rows, setRows] = useState<EmployeeSalaryComponent[]>([])
  const [componentTypes, setComponentTypes] = useState<ComponentType[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const today = beirutToday()

  /** The Set dialog: null closed; `changing` is the open row being changed, null for a new component. */
  const [setOpen, setSetOpen] = useState(false)
  const [changing, setChanging] = useState<EmployeeSalaryComponent | null>(null)
  const [form, setForm] = useState<SetFormState>(EMPTY)
  const [fieldErrors, setFieldErrors] = useState<{ componentTypeId?: string; currencyCode?: string; effectiveFrom?: string; amount?: string }>({})

  /** The End dialog. */
  const [ending, setEnding] = useState<EmployeeSalaryComponent | null>(null)
  const [endOn, setEndOn] = useState('')

  const [saving, setSaving] = useState(false)
  /** The API's own refusal — the locked-through sentence with its earliest date, the tier band. */
  const [serverError, setServerError] = useState<string | null>(null)

  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [comps, types, curr] = await Promise.all([
          salaryAdminService.getForEmployee(employeeId),
          componentTypesService.getAll().catch(() => [] as ComponentType[]),
          currenciesService.getAll().catch(() => [] as Currency[]),
        ])
        if (!cancelled) {
          setRows(comps)
          setComponentTypes(types)
          setCurrencies(curr)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [employeeId])

  function openAdd() {
    setChanging(null)
    setFieldErrors({})
    setServerError(null)
    setForm({ ...EMPTY, currencyCode: currencies[0]?.currencyCode ?? '' })
    setSetOpen(true)
  }

  function openChange(row: EmployeeSalaryComponent) {
    setChanging(row)
    setFieldErrors({})
    setServerError(null)
    setForm({ componentTypeId: row.componentTypeId, amount: row.amount, currencyCode: row.currencyCode, effectiveFrom: '' })
    setSetOpen(true)
  }

  function openEnd(row: EmployeeSalaryComponent) {
    setEnding(row)
    setEndOn('')
    setServerError(null)
  }

  /**
   * The band hint for the component being set, or null when there is nothing to say: no tier, a tier
   * not in the dictionary, a type that is not the basic salary, or a tier without a band.
   */
  const basicBand = useMemo(() => {
    if (approvalTier == null) return null
    const selected = componentTypes.find((x) => x.componentTypeId === form.componentTypeId)
    if (!isBasicType(selected)) return null
    const tier = tiers.find((x) => x.tierNo === approvalTier)
    if (!tier?.salaryCurrency) return null
    if (tier.minBasicSalary == null && tier.maxBasicSalary == null) return null
    return { tier: tierName(approvalTier), min: tier.minBasicSalary, max: tier.maxBasicSalary, currency: tier.salaryCurrency }
  }, [approvalTier, componentTypes, form.componentTypeId, tiers, tierName])

  async function submitSet() {
    const errors: typeof fieldErrors = {}
    // Coerced HERE, once — the box holds raw text until now so a decimal can actually be typed.
    const amount = parseDecimal(form.amount)
    if (form.componentTypeId == null) errors.componentTypeId = 'Component type is required'
    // A zero is the server's to refuse, with its own sentence: to remove a component, END it.
    if (amount == null) errors.amount = 'Amount must be a number'
    if (!form.currencyCode) errors.currencyCode = 'Currency is required'
    if (!form.effectiveFrom) errors.effectiveFrom = 'Start date is required'
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0 || amount == null) return
    setServerError(null)
    setSaving(true)
    try {
      // The procedure answers with the employee's rows as they now stand: render them, no second fetch.
      setRows(await salaryAdminService.set(employeeId, {
        componentTypeId: form.componentTypeId!,
        amount,
        currencyCode: form.currencyCode,
        effectiveFrom: form.effectiveFrom,
      }))
      notify(t('hr.salaryComponents.saved'), 'success', 2000)
      setSetOpen(false)
    } catch (err) {
      /* IN THE FORM, NOT A TOAST. The locked-through refusal names the earliest date that works, and
         the tier band names what the basic must be between: the fix, kept beside the box it fixes. */
      setServerError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function submitEnd() {
    if (!ending || !endOn) return
    setServerError(null)
    setSaving(true)
    try {
      setRows(await salaryAdminService.end(ending.salaryComponentId, endOn))
      notify(t('hr.salaryComponents.ended'), 'success', 2000)
      setEnding(null)
    } catch (err) {
      setServerError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const ordered = useMemo(() => sortSalaryRows(rows), [rows])

  // Column defs are rebuilt per render on purpose — the action cells close over the current row
  // handlers. This table is small.
  const columns = [
    columnHelper.accessor('componentName', { header: 'Component' }),
    columnHelper.accessor('amount', {
      header: 'Amount',
      // 'right', not alignEnd() — a FIGURE column: digits keep a fixed edge in both directions.
      cell: (c) => <div style={{ textAlign: 'right' }}>{fmtNumber(c.getValue())}</div>,
      meta: { filterText: fmtNumber },
    }),
    columnHelper.accessor('currencyCode', {
      header: 'Currency',
      size: 100,
      meta: { filterOptions: optionsFrom(rows, (r) => r.currencyCode) },
    }),
    columnHelper.accessor('effectiveFrom', {
      header: 'From',
      size: 130,
      cell: (c) => fmtDate(c.getValue()),
      meta: { filterText: fmtDate },
    }),
    columnHelper.accessor('effectiveTo', {
      header: 'To',
      size: 130,
      cell: (c) => fmtDate(c.getValue()),
      meta: { filterText: fmtDate },
    }),
    columnHelper.accessor((r) => t(`hr.salaryComponents.state.${salaryRowState(r, today)}`), {
      id: 'state',
      header: t('hr.salaryComponents.status'),
      size: 110,
      cell: (c) => <span className={STATE_BADGE[salaryRowState(c.row.original, today)]}>{c.getValue()}</span>,
    }),
    ...(canEdit
      ? [
          columnHelper.display({
            id: 'actions',
            header: 'Actions',
            size: 230,
            cell: (c) => {
              const row = c.row.original
              // History is read-only: an ended row offers nothing — not a disabled button, nothing.
              if (!isOpenRow(row)) return null
              return (
                <div className="grid-actions">
                  <Button variant="subtle" size="compact-sm" leftSection={<IconPencil size={14} />} onClick={() => openChange(row)}>
                    {t('hr.salaryComponents.change')}
                  </Button>
                  <Button variant="subtle" size="compact-sm" color="red" leftSection={<IconCalendarOff size={14} />} onClick={() => openEnd(row)}>
                    {t('hr.salaryComponents.end')}
                  </Button>
                </div>
              )
            },
          }),
        ]
      : []),
  ]

  const table = useReactTable({
    data: ordered,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    defaultColumn: { filterFn: gridFilterFn },
    getFilteredRowModel: getFilteredRowModel(),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableMultiSort: true,
    getRowId: (r) => String(r.salaryComponentId),
  })

  if (loading) {
    return (
      <div className="page-loading">
        <Loader size={36} />
      </div>
    )
  }

  const typeOptions = assignableTypes(componentTypes, changing?.componentTypeId)

  return (
    <div>
      {error && <div className="alert alert--error" role="alert">{error}</div>}

      <p className="hint" style={{ marginTop: 0 }}>{t('hr.salaryComponents.intro')}</p>

      {canEdit && (
        <div className="tab-toolbar">
          <Button leftSection={<IconPlus size={16} />} onClick={openAdd}>
            {t('hr.salaryComponents.add')}
          </Button>
        </div>
      )}

      <GridTable table={table} emptyText={t('hr.salaryComponents.empty')} />

      {/* SET: a new component, or an open one changed FROM a date. */}
      <Modal
        opened={setOpen}
        onClose={() => setSetOpen(false)}
        title={changing
          ? t('hr.salaryComponents.changeTitle', { name: changing.componentName })
          : t('hr.salaryComponents.addTitle')}
        size={460}
        centered
      >
        <div className="form-field">
          <label className="form-label">Component type</label>
          <Select
            data={typeOptions.map((ct) => ({ value: String(ct.componentTypeId), label: ct.name }))}
            value={form.componentTypeId != null ? String(form.componentTypeId) : null}
            placeholder="Select type…"
            allowDeselect={false}
            disabled={saving || changing != null}
            error={fieldErrors.componentTypeId}
            onChange={(v) => setForm((f) => ({ ...f, componentTypeId: v != null ? Number(v) : null }))}
          />
        </div>

        <div className="form-grid">
          <div className="form-field">
            <label className="form-label">Amount</label>
            <NumberInput
              value={form.amount}
              min={0}
              decimalScale={2}
              disabled={saving}
              error={fieldErrors.amount}
              onChange={(v) => setForm((f) => ({ ...f, amount: v }))}
            />
            {/* THE RULE, BEFORE IT REFUSES. A trigger enforces the band on save; saying it here turns a
                refusal into something the user could have avoided. Advisory only. */}
            {basicBand && (
              <p className="hint" style={{ marginTop: 6 }}>
                {t('hr.salaryComponents.tierBand', {
                  tier: basicBand.tier,
                  min: basicBand.min == null ? t('hr.salaryComponents.noBound') : fmtNumber(basicBand.min),
                  max: basicBand.max == null ? t('hr.salaryComponents.noBound') : fmtNumber(basicBand.max),
                  currency: basicBand.currency,
                })}
              </p>
            )}
          </div>

          <div className="form-field">
            <label className="form-label">Currency</label>
            <Select
              data={currencies.map((c) => ({ value: c.currencyCode, label: c.currencyCode }))}
              value={form.currencyCode || null}
              placeholder="Currency…"
              allowDeselect={false}
              disabled={saving}
              error={fieldErrors.currencyCode}
              onChange={(v) => setForm((f) => ({ ...f, currencyCode: v ?? '' }))}
            />
          </div>

          <div className="form-field">
            <label className="form-label">{t('hr.salaryComponents.startsOn')}</label>
            {/* Required, so not clearable. State stays 'yyyy-MM-dd'. */}
            <DatePickerInput
              valueFormat="DD/MM/YYYY"
              leftSection={<IconCalendar size={14} />}
              value={form.effectiveFrom || null}
              disabled={saving}
              error={fieldErrors.effectiveFrom}
              onChange={(v) => setForm((f) => ({ ...f, effectiveFrom: v ?? '' }))}
            />
          </div>
        </div>

        {serverError && <div className="alert alert--error" role="alert">{serverError}</div>}

        <div className="form-actions">
          <Button variant="default" onClick={() => setSetOpen(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submitSet()} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </Modal>

      {/* END: an open row stops after a date. */}
      <Modal
        opened={ending != null}
        onClose={() => setEnding(null)}
        title={ending ? t('hr.salaryComponents.endTitle', { name: ending.componentName }) : ''}
        size={420}
        centered
      >
        <p className="hint" style={{ marginTop: 0 }}>{t('hr.salaryComponents.endHint')}</p>
        <div className="form-field">
          <label className="form-label">{t('hr.salaryComponents.lastDay')}</label>
          <DatePickerInput
            valueFormat="DD/MM/YYYY"
            leftSection={<IconCalendar size={14} />}
            value={endOn || null}
            minDate={ending ? ending.effectiveFrom.slice(0, 10) : undefined}
            disabled={saving}
            onChange={(v) => setEndOn(v ?? '')}
          />
        </div>
        {serverError && <div className="alert alert--error" role="alert">{serverError}</div>}
        <div className="form-actions">
          <Button variant="default" onClick={() => setEnding(null)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            color="red"
            onClick={() => void submitEnd()}
            disabled={saving || !ending || !endOn || !canEndOn(ending, endOn)}
          >
            {saving ? t('common.saving') : t('hr.salaryComponents.end')}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
