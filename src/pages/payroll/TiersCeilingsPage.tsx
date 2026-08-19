import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel,
  getPaginationRowModel, getSortedRowModel, useReactTable,
} from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import {
  ActionIcon, Button, Group, Loader, Modal, NumberInput, Pagination, Select, Switch, Table,
  TextInput,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCopyPlus, IconPencil, IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { getErrorMessage } from '../../api/errorMessage'
import { PageHelp } from '../../components/PageHelp'
// The module-level `t`, for the warning builder below — it is a plain function, not a component,
// and threading the hook's TFunction through it buys nothing. Same rationale as attendanceFormat.
import { t as translate } from '../../i18n/t'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import { useApprovalTiers } from '../../hr/useApprovalTiers'
import { approvalTiersService } from '../../services/hrService'
import { currenciesService } from '../../services/coreService'
import { nssfRatesService, taxBracketsService } from '../../services/payrollService'
import { settingsService } from '../../services/settingsService'
import { NSSF_CEILING_USD_KEY } from '../../types/payroll'
import type {
  NssfRate, NssfRateUpsertRequest, TaxBracket, TaxBracketUpsertRequest,
} from '../../types/payroll'
import type { ApprovalTier } from '../../types/hr'
import type { Currency } from '../../types/core'
import type { Setting } from '../../types/settings'

/**
 * TIERS & CEILINGS — the rate tables payroll computes from, in one place.
 *
 * Both grids describe POLICY, not a transaction: what the tax law says a slice of income is taxed
 * at, and what the NSSF says each side contributes. Nothing here recomputes a payslip. A run
 * already generated keeps the figures it was generated with, which is why NSSF schemes are
 * versioned rather than edited in place — see the "New version" action.
 */

const PAGE_SIZES = ['10', '25', '50']

/** Rates cross the wire as fractions and are read by people as percentages. Both directions, once. */
const toPercent = (rate: number) => Math.round(rate * 1_000_000) / 10_000
const fromPercent = (percent: number) => Math.round(percent * 10_000) / 1_000_000

function notify(message: string, type: 'success' | 'error', ms: number) {
  notifications.show({ message, color: type === 'success' ? 'green' : 'red', autoClose: ms })
}

/** A money figure as the grids print it — grouped, two decimals, never a bare float. */
function money(value: number | null | undefined, dash: string): string {
  if (value == null) return dash
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 'yyyy-MM-dd' out of whatever the API sent, so a date input and a cell agree. */
const dateOnly = (value: string | null | undefined) => (value ? value.slice(0, 10) : '')

/**
 * One side of a salary band. NULL is not missing data — it is "this side is open" — so it says so
 * in words rather than printing the em-dash that everywhere else on this page means "no value".
 */
const bound = (value: number | null | undefined, noBound: string) =>
  value == null ? noBound : money(value, noBound)

/* ────────────────────────────── the tiers' own arithmetic ────────────────────────────── */

/**
 * The tiers of one currency, in one effective period, in floor order — the only grouping in which
 * "overlap" and "gap" mean anything. Two tiers that apply to different currencies, or to different
 * years, are not supposed to line up and must never be reported as broken.
 */
function tierGroups(rows: TaxBracket[]): TaxBracket[][] {
  const groups = new Map<string, TaxBracket[]>()
  for (const row of rows) {
    const key = `${row.currencyCode}|${dateOnly(row.effectiveFrom)}|${dateOnly(row.effectiveTo)}`
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }
  return [...groups.values()].map((group) => [...group].sort((a, b) => a.minAnnual - b.minAnnual))
}

/**
 * What is wrong with the tier table, in the user's terms — ADVISORY, never a block.
 *
 * A ceiling is treated as EXCLUSIVE: one tier ending at 20,000 and the next starting at 20,000 is
 * contiguous, which is how these tables are written. Anything below that is an overlap (income
 * taxed twice) and anything above it is a gap (income taxed at no rate at all) — both are real
 * defects, and both are the sort a person spots only when something is told to them.
 *
 * It does not refuse a save. Tier tables are edited one row at a time, so they are legitimately
 * broken for as long as it takes to type the next row; a validator that blocked on that would make
 * the page unusable for its only purpose.
 */
function tierWarnings(rows: TaxBracket[]): string[] {
  const problems: string[] = []

  for (const group of tierGroups(rows)) {
    const scope = `${group[0].currencyCode} · ${dateOnly(group[0].effectiveFrom)}`

    const openTiers = group.filter((row) => row.maxAnnual == null)
    if (openTiers.length > 1) {
      problems.push(translate('payroll.tiers.warnManyOpen', { scope, count: openTiers.length }))
    }

    for (let i = 0; i < group.length - 1; i++) {
      const current = group[i]
      const next = group[i + 1]

      // An open tier that is not last swallows everything after it.
      if (current.maxAnnual == null) {
        problems.push(
          translate('payroll.tiers.warnOpenNotLast', { scope, floor: money(current.minAnnual, '—') }),
        )
        continue
      }
      if (next.minAnnual < current.maxAnnual) {
        problems.push(
          translate('payroll.tiers.warnOverlap', {
            scope,
            from: money(next.minAnnual, '—'),
            to: money(current.maxAnnual, '—'),
          }),
        )
      } else if (next.minAnnual > current.maxAnnual) {
        problems.push(
          translate('payroll.tiers.warnGap', {
            scope,
            from: money(current.maxAnnual, '—'),
            to: money(next.minAnnual, '—'),
          }),
        )
      }
    }
  }

  return problems
}

/* ────────────────────────────────── income tax tiers ────────────────────────────────── */

const bracketHelper = createColumnHelper<TaxBracket>()

const BRACKET_WIDTHS: Record<string, number | undefined> = {
  rate: 90,
  currencyCode: 100,
  effectiveFrom: 120,
  effectiveTo: 120,
  actions: 130,
}

function TaxTiersGrid({
  rows,
  onEdit,
  onDelete,
}: {
  rows: TaxBracket[]
  onEdit: (row: TaxBracket) => void
  onDelete: (row: TaxBracket) => void
}) {
  const { t } = useTranslation()
  const [sorting, setSorting] = useState<SortingState>([{ id: 'minAnnual', desc: false }])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      bracketHelper.accessor('minAnnual', {
        header: t('payroll.tiers.floor'),
        cell: (info) => money(info.row.original.minAnnual, t('common.dash')),
        meta: { filterText: (v) => money(v as number, t('common.dash')) },
      }),
      // The open top tier reads as words, not as an empty cell: a blank here is a fact about the
      // law ("and above"), and an empty cell reads as a value somebody forgot to type.
      bracketHelper.accessor('maxAnnual', {
        header: t('payroll.tiers.ceiling'),
        cell: (info) =>
          info.row.original.maxAnnual == null ? (
            <span className="hint" style={{ margin: 0 }}>{t('payroll.tiers.andAbove')}</span>
          ) : (
            money(info.row.original.maxAnnual, t('common.dash'))
          ),
        meta: {
          filterText: (v) => (v == null ? t('payroll.tiers.andAbove') : money(v as number, '—')),
        },
      }),
      bracketHelper.accessor('rate', {
        header: t('payroll.tiers.rate'),
        cell: (info) => `${toPercent(info.row.original.rate)}%`,
        meta: { filterText: (v) => `${toPercent(v as number)}%` },
      }),
      bracketHelper.accessor('currencyCode', {
        header: t('payroll.tiers.currency'),
        meta: { filterOptions: optionsFrom(rows, (r) => r.currencyCode) },
      }),
      bracketHelper.accessor('effectiveFrom', {
        header: t('payroll.tiers.effectiveFrom'),
        cell: (info) => dateOnly(info.row.original.effectiveFrom),
        meta: { filterText: (v) => dateOnly(v as string) },
      }),
      bracketHelper.accessor('effectiveTo', {
        header: t('payroll.tiers.effectiveTo'),
        cell: (info) => dateOnly(info.row.original.effectiveTo) || t('common.dash'),
        meta: { filterText: (v) => dateOnly(v as string) || t('common.dash') },
      }),
      bracketHelper.accessor('note', {
        header: t('payroll.tiers.note'),
        cell: (info) => info.row.original.note ?? '',
      }),
      bracketHelper.display({
        id: 'actions',
        header: t('payroll.tiers.actions'),
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
              size="compact-sm"
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={() => onDelete(info.row.original)}
            >
              {t('common.delete')}
            </Button>
          </div>
        ),
        meta: { noFilter: true },
      }),
    ],
    [onEdit, onDelete, rows, t],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 10 } },
    getRowId: (row) => String(row.taxBracketId),
  })

  return <ConfigGrid table={table} columns={columns} empty={t('payroll.tiers.noTiers')} />
}

/* ─────────────────────────────────── NSSF schemes ─────────────────────────────────── */

const nssfHelper = createColumnHelper<NssfRate>()

const NSSF_WIDTHS: Record<string, number | undefined> = {
  employeeRate: 110,
  employerRate: 110,
  isCeilinged: 120,
  ceilingAmount: 140,
  effectiveFrom: 120,
  effectiveTo: 120,
  actions: 150,
}

function NssfGrid({
  rows,
  fallbackCeiling,
  onEdit,
  onNewVersion,
}: {
  rows: NssfRate[]
  fallbackCeiling: string
  onEdit: (row: NssfRate) => void
  onNewVersion: (row: NssfRate) => void
}) {
  const { t } = useTranslation()
  const [sorting, setSorting] = useState<SortingState>([{ id: 'scheme', desc: false }])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      nssfHelper.accessor('scheme', { header: t('payroll.tiers.scheme') }),
      nssfHelper.accessor('employeeRate', {
        header: t('payroll.tiers.employeeRate'),
        cell: (info) => `${toPercent(info.row.original.employeeRate)}%`,
        meta: { filterText: (v) => `${toPercent(v as number)}%` },
      }),
      nssfHelper.accessor('employerRate', {
        header: t('payroll.tiers.employerRate'),
        cell: (info) => `${toPercent(info.row.original.employerRate)}%`,
        meta: { filterText: (v) => `${toPercent(v as number)}%` },
      }),
      nssfHelper.accessor('isCeilinged', {
        header: t('payroll.tiers.hasCeiling'),
        cell: (info) =>
          info.row.original.isCeilinged ? (
            <span className="badge badge--on">{t('common.yes')}</span>
          ) : (
            <span className="badge badge--muted">{t('common.no')}</span>
          ),
        meta: {
          filterText: (v) => (v ? t('common.yes') : t('common.no')),
          filterOptions: [t('common.yes'), t('common.no')],
        },
      }),
      /* The ceiling that ACTUALLY applies, which is not always the one stored on the row: a
         ceilinged scheme with no ceiling of its own falls back to the global setting, and printing
         an empty cell there would hide the number payroll is really using. */
      nssfHelper.accessor('ceilingAmount', {
        header: t('payroll.tiers.ceilingAmount'),
        cell: (info) => {
          const row = info.row.original
          if (!row.isCeilinged) {
            return <span className="hint" style={{ margin: 0 }}>{t('common.dash')}</span>
          }
          if (row.ceilingAmount == null) {
            return (
              <span className="hint" style={{ margin: 0 }} title={t('payroll.tiers.fallbackTitle')}>
                {fallbackCeiling
                  ? t('payroll.tiers.usingFallback', {
                      value: money(Number(fallbackCeiling), t('common.dash')),
                    })
                  : t('payroll.tiers.usingFallbackUnset')}
              </span>
            )
          }
          return money(row.ceilingAmount, t('common.dash'))
        },
        meta: {
          filterText: (v, row) =>
            !row.isCeilinged ? t('common.dash') : v == null ? '' : money(v as number, '—'),
        },
      }),
      nssfHelper.accessor('effectiveFrom', {
        header: t('payroll.tiers.effectiveFrom'),
        cell: (info) => dateOnly(info.row.original.effectiveFrom),
        meta: { filterText: (v) => dateOnly(v as string) },
      }),
      nssfHelper.accessor('effectiveTo', {
        header: t('payroll.tiers.effectiveTo'),
        cell: (info) => dateOnly(info.row.original.effectiveTo) || t('common.dash'),
        meta: { filterText: (v) => dateOnly(v as string) || t('common.dash') },
      }),
      nssfHelper.accessor('note', {
        header: t('payroll.tiers.note'),
        cell: (info) => info.row.original.note ?? '',
      }),
      nssfHelper.display({
        id: 'actions',
        header: t('payroll.tiers.actions'),
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
            {/* The ordinary way a rate changes. Prefills from this row so the new version differs
                only where the decree differs. */}
            <Button
              variant="subtle"
              size="compact-sm"
              leftSection={<IconCopyPlus size={14} />}
              title={t('payroll.tiers.newVersionTitle')}
              onClick={() => onNewVersion(info.row.original)}
            >
              {t('payroll.tiers.newVersion')}
            </Button>
          </div>
        ),
        meta: { noFilter: true },
      }),
    ],
    [onEdit, onNewVersion, fallbackCeiling, t],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 10 } },
    getRowId: (row) => String(row.nssfRateId),
  })

  return <ConfigGrid table={table} columns={columns} empty={t('payroll.tiers.noSchemes')} />
}

/* ──────────────────────────── basic salary by tier ──────────────────────────── */

const tierHelper = createColumnHelper<ApprovalTier>()

const TIER_SALARY_WIDTHS: Record<string, number | undefined> = {
  tierNo: 90,
  minBasicSalary: 150,
  maxBasicSalary: 150,
  salaryCurrency: 120,
  actions: 120,
}

/**
 * What a basic salary may be at each rank.
 *
 * THIS GRID IS THE ONLY PLACE THE RULE IS VISIBLE BEFORE IT BITES. The band is enforced by a
 * database trigger on the salary-component write, so without this screen the first anybody hears of
 * it is a refusal while trying to pay someone. An unbounded side prints as "no bound" rather than a
 * dash, because a blank cell reads as missing data when it is actually a deliberate setting.
 */
function TierSalaryGrid({
  rows,
  canEdit,
  tierName,
  onEdit,
}: {
  rows: ApprovalTier[]
  canEdit: boolean
  tierName: (tierNo: number) => string
  onEdit: (row: ApprovalTier) => void
}) {
  const { t } = useTranslation()
  const [sorting, setSorting] = useState<SortingState>([{ id: 'tierNo', desc: false }])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      tierHelper.accessor('tierNo', { header: t('payroll.tiers.tierNo') }),
      /* The NAME comes from the shared dictionary, not from the row, so it follows the reader's
         language and any rename made on the HR tiers page without this grid re-fetching. */
      tierHelper.accessor((row) => tierName(row.tierNo), {
        id: 'name',
        header: t('payroll.tiers.tierName'),
      }),
      tierHelper.accessor((row) => row.minBasicSalary ?? null, {
        id: 'minBasicSalary',
        header: t('payroll.tiers.minBasic'),
        cell: (info) => bound(info.getValue(), t('payroll.tiers.noBound')),
        meta: { filterText: (v) => bound(v as number | null, t('payroll.tiers.noBound')) },
      }),
      tierHelper.accessor((row) => row.maxBasicSalary ?? null, {
        id: 'maxBasicSalary',
        header: t('payroll.tiers.maxBasic'),
        cell: (info) => bound(info.getValue(), t('payroll.tiers.noBound')),
        meta: { filterText: (v) => bound(v as number | null, t('payroll.tiers.noBound')) },
      }),
      tierHelper.accessor((row) => row.salaryCurrency ?? '', {
        id: 'salaryCurrency',
        header: t('common.currency'),
        cell: (info) => info.getValue() || t('common.dash'),
      }),
      ...(canEdit
        ? [
            tierHelper.display({
              id: 'actions',
              header: t('payroll.tiers.actions'),
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
                </div>
              ),
              meta: { noFilter: true },
            }),
          ]
        : []),
    ],
    [canEdit, onEdit, tierName, t],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableMultiSort: false,
    initialState: { pagination: { pageSize: 10 } },
    getRowId: (row) => String(row.tierNo),
  })

  return <ConfigGrid table={table} columns={columns} empty={t('payroll.tiers.noBands')} />
}

/* ───────────────────────────── the grid chrome both share ───────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The table body, pager and filter strip — identical between the two grids, so it is written once.
 * The generic is erased deliberately: this renders a TanStack table of ANY row type and never
 * touches a field, and threading the row type through would buy nothing but noise.
 */
function ConfigGrid({
  table,
  columns,
  empty,
}: {
  table: any
  columns: unknown[]
  empty: string
}) {
  const widths: Record<string, number | undefined> = {
    ...BRACKET_WIDTHS,
    ...NSSF_WIDTHS,
    ...TIER_SALARY_WIDTHS,
  }
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  return (
    <div>
      <Table striped withTableBorder verticalSpacing="xs" fz="sm">
        <Table.Thead>
          {table.getHeaderGroups().map((hg: any) => (
            <Table.Tr key={hg.id}>
              {hg.headers.map((header: any) => (
                <Table.Th
                  key={header.id}
                  style={{
                    width: widths[header.column.id],
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
                <div className="empty-hint" style={{ padding: 16 }}>{empty}</div>
              </Table.Td>
            </Table.Tr>
          ) : (
            table.getRowModel().rows.map((row: any) => (
              <Table.Tr key={row.id}>
                {row.getVisibleCells().map((cell: any) => (
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
          {total === 0 ? 0 : pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, total)}{' '}
          of {total}
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
            onChange={(p: number) => table.setPageIndex(p - 1)}
            total={Math.max(table.getPageCount(), 1)}
            size="sm"
          />
        </Group>
      </Group>
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ──────────────────────────────────── the page ──────────────────────────────────── */

/** The tax-tier dialog's fields, as the form holds them (percent, and strings from date inputs). */
interface BracketForm {
  minAnnual: number
  maxAnnual: number | null
  ratePercent: number
  currencyCode: string
  effectiveFrom: string
  effectiveTo: string
  note: string
}

/** The NSSF dialog's fields. `nssfRateId` null means create — a brand-new scheme OR a new version. */
interface NssfForm {
  scheme: string
  employeePercent: number
  employerPercent: number
  isCeilinged: boolean
  ceilingAmount: number | null
  effectiveFrom: string
  effectiveTo: string
  note: string
}

const EMPTY_BRACKET: BracketForm = {
  minAnnual: 0, maxAnnual: null, ratePercent: 0, currencyCode: 'USD',
  effectiveFrom: '', effectiveTo: '', note: '',
}

const EMPTY_NSSF: NssfForm = {
  scheme: '', employeePercent: 0, employerPercent: 0, isCeilinged: false,
  ceilingAmount: null, effectiveFrom: '', effectiveTo: '', note: '',
}

export default function TiersCeilingsPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  /* PAYROLL_RUN already opens this route, so this is not the gate — it is the answer for a future
     reader who arrives here with only PAYROLL_VIEW. The API enforces it either way. */
  const canSetBand = hasPermission(PERMISSION.PAYROLL_RUN)

  /* The shared dictionary, so a rename made on the HR tiers page is reflected here without this
     page knowing it happened — and so setting a band can invalidate the one copy everybody reads. */
  const { tiers, tierName, refetch: refetchTiers } = useApprovalTiers()

  const [brackets, setBrackets] = useState<TaxBracket[]>([])
  const [schemes, setSchemes] = useState<NssfRate[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [fallbackSetting, setFallbackSetting] = useState<Setting | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [bracketRows, schemeRows] = await Promise.all([
        taxBracketsService.getAll(),
        nssfRatesService.getAll(),
      ])
      setBrackets(bracketRows)
      setSchemes(schemeRows)
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * Currencies and the fallback setting are loaded SEPARATELY and never block the page.
   * `/api/settings` needs SETTING_MANAGE, which a PAYROLL_RUN holder may not have — a 403 there
   * must cost them the one fallback field, not the two grids they came for.
   */
  const loadAside = useCallback(async () => {
    try {
      setCurrencies(await currenciesService.getAll())
    } catch {
      setCurrencies([])
    }
    try {
      const all = await settingsService.getAll()
      setFallbackSetting(all.find((s) => s.settingKey === NSSF_CEILING_USD_KEY) ?? null)
    } catch {
      setFallbackSetting(null)
    }
  }, [])

  useEffect(() => {
    void load()
    void loadAside()
  }, [load, loadAside])

  function refresh() {
    setLoading(true)
    void load()
    void loadAside()
  }

  const fallbackCeiling = fallbackSetting?.settingValue ?? ''
  // `t` stays in the deps though tierWarnings reads the module-level one: its identity changes with
  // the language, which is what re-runs the memo so the warnings are not left in the old one.
  const warnings = useMemo(() => tierWarnings(brackets), [brackets, t])

  const currencyOptions = useMemo(
    () =>
      currencies.length > 0
        ? currencies.map((c) => ({ value: c.currencyCode, label: `${c.currencyCode} — ${c.name}` }))
        : optionsFrom(brackets, (b) => b.currencyCode).map((c) => ({ value: c, label: c })),
    [currencies, brackets],
  )

  /* ---- basic salary by tier ---- */

  /** The tier whose band is being edited, or null when the dialog is closed. */
  const [bandTier, setBandTier] = useState<ApprovalTier | null>(null)
  /** '' is the blank box, which MEANS "no bound" — distinct from 0, which is a real floor. */
  const [bandMin, setBandMin] = useState<number | ''>('')
  const [bandMax, setBandMax] = useState<number | ''>('')
  const [bandCurrency, setBandCurrency] = useState<string>('')
  const [bandSaving, setBandSaving] = useState(false)
  const [bandError, setBandError] = useState<string | null>(null)

  function openBand(row: ApprovalTier) {
    setBandTier(row)
    setBandMin(row.minBasicSalary ?? '')
    setBandMax(row.maxBasicSalary ?? '')
    // Defaulted to the first currency only when the tier has no band yet — never overriding one.
    setBandCurrency(row.salaryCurrency ?? currencyOptions[0]?.value ?? '')
    setBandError(null)
  }

  async function saveBand() {
    if (!bandTier) return
    setBandError(null)
    setBandSaving(true)
    try {
      await approvalTiersService.setSalaryRange(bandTier.tierNo, {
        // Blank → null → "no bound". Sent explicitly so clearing a side actually clears it.
        minBasicSalary: bandMin === '' ? null : bandMin,
        maxBasicSalary: bandMax === '' ? null : bandMax,
        salaryCurrency: bandCurrency,
      })
      notify(t('payroll.tiers.bandSaved'), 'success', 2200)
      setBandTier(null)
      // The dictionary is what this grid renders AND what the salary form's hint reads, so the one
      // shared copy is invalidated rather than a local list being patched.
      await refetchTiers()
    } catch (err) {
      // "Minimum cannot be above the maximum", "Unknown currency 'XYZ'" — the procedure's own
      // sentences, kept in the dialog beside the fields that caused them.
      setBandError(getErrorMessage(err))
    } finally {
      setBandSaving(false)
    }
  }

  /* ---- tax tier dialog ---- */
  const [bracketOpen, setBracketOpen] = useState(false)
  const [bracketId, setBracketId] = useState<number | null>(null)
  const [bracketForm, setBracketForm] = useState<BracketForm>(EMPTY_BRACKET)
  const [bracketError, setBracketError] = useState<string | null>(null)
  const [savingBracket, setSavingBracket] = useState(false)

  function openNewBracket() {
    setBracketId(null)
    setBracketForm({ ...EMPTY_BRACKET, currencyCode: currencyOptions[0]?.value ?? 'USD' })
    setBracketError(null)
    setBracketOpen(true)
  }

  function openEditBracket(row: TaxBracket) {
    setBracketId(row.taxBracketId)
    setBracketForm({
      minAnnual: row.minAnnual,
      maxAnnual: row.maxAnnual,
      ratePercent: toPercent(row.rate),
      currencyCode: row.currencyCode,
      effectiveFrom: dateOnly(row.effectiveFrom),
      effectiveTo: dateOnly(row.effectiveTo),
      note: row.note ?? '',
    })
    setBracketError(null)
    setBracketOpen(true)
  }

  async function submitBracket() {
    const f = bracketForm
    // The procedure's own rules, checked here so the refusal arrives before the round trip.
    if (f.ratePercent < 0 || f.ratePercent > 100) {
      setBracketError(t('payroll.tiers.errRate'))
      return
    }
    if (f.maxAnnual != null && f.maxAnnual <= f.minAnnual) {
      setBracketError(t('payroll.tiers.errCeiling'))
      return
    }
    if (!f.currencyCode || !f.effectiveFrom) {
      setBracketError(t('payroll.tiers.errRequired'))
      return
    }
    setBracketError(null)

    const body: TaxBracketUpsertRequest = {
      minAnnual: f.minAnnual,
      maxAnnual: f.maxAnnual,
      rate: fromPercent(f.ratePercent),
      currencyCode: f.currencyCode,
      effectiveFrom: f.effectiveFrom,
      effectiveTo: f.effectiveTo || null,
      note: f.note.trim() || null,
    }

    setSavingBracket(true)
    try {
      if (bracketId != null) await taxBracketsService.update(bracketId, body)
      else await taxBracketsService.create(body)
      notify(t('payroll.tiers.saved'), 'success', 2000)
      setBracketOpen(false)
      await load()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setSavingBracket(false)
    }
  }

  /* ---- delete confirm ---- */
  const [deleting, setDeleting] = useState<TaxBracket | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await taxBracketsService.remove(deleting.taxBracketId)
      notify(t('payroll.tiers.deleted'), 'success', 2000)
      setDeleting(null)
      await load()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setDeleteBusy(false)
    }
  }

  /* ---- NSSF dialog ---- */
  const [nssfOpen, setNssfOpen] = useState(false)
  const [nssfId, setNssfId] = useState<number | null>(null)
  const [nssfIsVersion, setNssfIsVersion] = useState(false)
  const [nssfForm, setNssfForm] = useState<NssfForm>(EMPTY_NSSF)
  const [nssfError, setNssfError] = useState<string | null>(null)
  const [savingNssf, setSavingNssf] = useState(false)

  function formFromScheme(row: NssfRate): NssfForm {
    return {
      scheme: row.scheme,
      employeePercent: toPercent(row.employeeRate),
      employerPercent: toPercent(row.employerRate),
      isCeilinged: row.isCeilinged,
      ceilingAmount: row.ceilingAmount,
      effectiveFrom: dateOnly(row.effectiveFrom),
      effectiveTo: dateOnly(row.effectiveTo),
      note: row.note ?? '',
    }
  }

  function openNewScheme() {
    setNssfId(null)
    setNssfIsVersion(false)
    setNssfForm(EMPTY_NSSF)
    setNssfError(null)
    setNssfOpen(true)
  }

  function openEditScheme(row: NssfRate) {
    setNssfId(row.nssfRateId)
    setNssfIsVersion(false)
    setNssfForm(formFromScheme(row))
    setNssfError(null)
    setNssfOpen(true)
  }

  /**
   * A NEW ROW prefilled from an existing one — not an edit of it. The effective-from is cleared on
   * purpose: it is the one field that MUST differ, and carrying the old date over is how somebody
   * ends up with two versions claiming the same day.
   */
  function openNewVersion(row: NssfRate) {
    setNssfId(null)
    setNssfIsVersion(true)
    setNssfForm({ ...formFromScheme(row), effectiveFrom: '', effectiveTo: '' })
    setNssfError(null)
    setNssfOpen(true)
  }

  async function submitScheme() {
    const f = nssfForm
    if (!f.scheme.trim() || !f.effectiveFrom) {
      setNssfError(t('payroll.tiers.errRequired'))
      return
    }
    if (
      f.employeePercent < 0 || f.employeePercent > 100 ||
      f.employerPercent < 0 || f.employerPercent > 100
    ) {
      setNssfError(t('payroll.tiers.errRate'))
      return
    }
    // Mirrors the procedure: a ceiling of zero is not "no ceiling", it is a scheme that contributes
    // nothing. Empty is how you say "use the fallback".
    if (f.isCeilinged && f.ceilingAmount != null && f.ceilingAmount <= 0) {
      setNssfError(t('payroll.tiers.errCeilingAmount'))
      return
    }
    setNssfError(null)

    const body: NssfRateUpsertRequest = {
      scheme: f.scheme.trim(),
      employeeRate: fromPercent(f.employeePercent),
      employerRate: fromPercent(f.employerPercent),
      isCeilinged: f.isCeilinged,
      // A ceiling on a scheme that has none would be a number nothing reads.
      ceilingAmount: f.isCeilinged ? f.ceilingAmount : null,
      effectiveFrom: f.effectiveFrom,
      effectiveTo: f.effectiveTo || null,
      note: f.note.trim() || null,
    }

    setSavingNssf(true)
    try {
      if (nssfId != null) await nssfRatesService.update(nssfId, body)
      else await nssfRatesService.create(body)
      notify(t('payroll.tiers.saved'), 'success', 2000)
      setNssfOpen(false)
      await load()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setSavingNssf(false)
    }
  }

  /* ---- the global fallback field ---- */
  const [fallbackDraft, setFallbackDraft] = useState<string | null>(null)
  const [savingFallback, setSavingFallback] = useState(false)
  const fallbackValue = fallbackDraft ?? fallbackCeiling
  const fallbackDirty = fallbackDraft != null && fallbackDraft !== fallbackCeiling

  async function saveFallback() {
    if (!fallbackSetting) return
    setSavingFallback(true)
    try {
      await settingsService.update(NSSF_CEILING_USD_KEY, {
        settingValue: fallbackValue,
        dataType: fallbackSetting.dataType,
        description: fallbackSetting.description,
      })
      setFallbackDraft(null)
      notify(t('payroll.tiers.saved'), 'success', 2000)
      await loadAside()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setSavingFallback(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('payroll.tiers.title')}</h1>
          <p className="page-subtitle">{t('payroll.tiers.subtitle')}</p>
        </div>
        <div className="page-head-actions">
          <ActionIcon
            variant="default"
            size="lg"
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            onClick={refresh}
          >
            <IconRefresh size={16} />
          </ActionIcon>
        </div>
      </div>

      <PageHelp>{t('payroll.tiers.help')}</PageHelp>

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
        <>
          <div className="card">
            <div className="tab-toolbar">
              <div className="card-title" style={{ margin: 0 }}>
                {t('payroll.tiers.taxCard')}
              </div>
              <Button
                leftSection={<IconPlus size={16} />}
                size="compact-sm"
                onClick={openNewBracket}
              >
                {t('payroll.tiers.newTier')}
              </Button>
            </div>
            <p className="hint">{t('payroll.tiers.taxHint')}</p>

            {/* ADVISORY. Never blocks a save — see tierWarnings. */}
            {warnings.length > 0 && (
              <div className="alert alert--warn" role="status">
                <strong>{t('payroll.tiers.warnTitle')}</strong>
                <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <TaxTiersGrid rows={brackets} onEdit={openEditBracket} onDelete={setDeleting} />
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="tab-toolbar">
              <div className="card-title" style={{ margin: 0 }}>
                {t('payroll.tiers.nssfCard')}
              </div>
              <Button
                leftSection={<IconPlus size={16} />}
                size="compact-sm"
                onClick={openNewScheme}
              >
                {t('payroll.tiers.newScheme')}
              </Button>
            </div>
            <p className="hint">{t('payroll.tiers.nssfHint')}</p>

            <NssfGrid
              rows={schemes}
              fallbackCeiling={fallbackCeiling}
              onEdit={openEditScheme}
              onNewVersion={openNewVersion}
            />
          </div>

          {/* BELOW the NSSF schemes: this is the newest and least-visited of the three, and it
              describes a rule enforced elsewhere rather than a figure payroll computes from. */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-title">{t('payroll.tiers.bandCard')}</div>
            <p className="hint">{t('payroll.tiers.bandHint')}</p>

            <TierSalaryGrid
              rows={tiers}
              canEdit={canSetBand}
              tierName={tierName}
              onEdit={openBand}
            />
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-title">{t('payroll.tiers.fallbackCard')}</div>
            {fallbackSetting ? (
              <div className="form-field">
                <label className="form-label" htmlFor="nssf-fallback">
                  {t('payroll.tiers.fallbackLabel')}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <NumberInput
                    id="nssf-fallback"
                    value={fallbackValue === '' ? '' : Number(fallbackValue)}
                    onChange={(v) => setFallbackDraft(v === '' || v == null ? '' : String(v))}
                    min={0}
                    decimalScale={2}
                    w={200}
                    disabled={savingFallback}
                  />
                  <Button
                    disabled={savingFallback || !fallbackDirty}
                    onClick={() => void saveFallback()}
                  >
                    {savingFallback ? t('common.saving') : t('common.save')}
                  </Button>
                </div>
                <p className="hint" style={{ marginTop: 6 }}>
                  {t('payroll.tiers.fallbackHint')}
                </p>
              </div>
            ) : (
              <div className="empty-hint">
                <div className="empty-hint-main">{t('payroll.tiers.fallbackMissing')}</div>
                {t('payroll.tiers.fallbackMissingHint')}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── tax tier dialog ── */}
      <Modal
        opened={bracketOpen}
        onClose={() => setBracketOpen(false)}
        title={bracketId != null ? t('payroll.tiers.editTier') : t('payroll.tiers.newTier')}
        size={520}
        centered
      >
        <div className="form-grid">
          <div className="form-field">
            <label className="form-label" htmlFor="tb-min">{t('payroll.tiers.floor')}</label>
            <NumberInput
              id="tb-min"
              value={bracketForm.minAnnual}
              onChange={(v) =>
                setBracketForm((f) => ({ ...f, minAnnual: typeof v === 'number' ? v : 0 }))
              }
              min={0}
              decimalScale={2}
              disabled={savingBracket}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="tb-max">{t('payroll.tiers.ceiling')}</label>
            {/* Empty IS the value for the top tier, so the box must be clearable — an empty box
                means "and above", not "unfilled". */}
            <NumberInput
              id="tb-max"
              value={bracketForm.maxAnnual ?? ''}
              onChange={(v) =>
                setBracketForm((f) => ({
                  ...f,
                  maxAnnual: v === '' || v == null ? null : Number(v),
                }))
              }
              min={0}
              decimalScale={2}
              placeholder={t('payroll.tiers.andAbove')}
              disabled={savingBracket}
            />
            <p className="hint" style={{ marginTop: 6 }}>{t('payroll.tiers.ceilingHint')}</p>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="tb-rate">{t('payroll.tiers.rate')}</label>
            <NumberInput
              id="tb-rate"
              value={bracketForm.ratePercent}
              onChange={(v) =>
                setBracketForm((f) => ({ ...f, ratePercent: typeof v === 'number' ? v : 0 }))
              }
              min={0}
              max={100}
              decimalScale={4}
              suffix="%"
              disabled={savingBracket}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="tb-ccy">{t('payroll.tiers.currency')}</label>
            <Select
              id="tb-ccy"
              data={currencyOptions}
              value={bracketForm.currencyCode}
              onChange={(v) => setBracketForm((f) => ({ ...f, currencyCode: v ?? f.currencyCode }))}
              allowDeselect={false}
              searchable
              disabled={savingBracket}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="tb-from">{t('payroll.tiers.effectiveFrom')}</label>
            <TextInput
              id="tb-from"
              type="date"
              value={bracketForm.effectiveFrom}
              onChange={(e) =>
                setBracketForm((f) => ({ ...f, effectiveFrom: e.currentTarget.value }))
              }
              disabled={savingBracket}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="tb-to">{t('payroll.tiers.effectiveTo')}</label>
            <TextInput
              id="tb-to"
              type="date"
              value={bracketForm.effectiveTo}
              onChange={(e) => setBracketForm((f) => ({ ...f, effectiveTo: e.currentTarget.value }))}
              disabled={savingBracket}
            />
            <p className="hint" style={{ marginTop: 6 }}>{t('payroll.tiers.effectiveToHint')}</p>
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="tb-note">{t('payroll.tiers.note')}</label>
          <TextInput
            id="tb-note"
            value={bracketForm.note}
            onChange={(e) => setBracketForm((f) => ({ ...f, note: e.currentTarget.value }))}
            disabled={savingBracket}
          />
        </div>

        {bracketError && (
          <div className="alert alert--error" role="alert">
            {bracketError}
          </div>
        )}

        <div className="form-actions">
          <Button variant="default" onClick={() => setBracketOpen(false)} disabled={savingBracket}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submitBracket()} disabled={savingBracket}>
            {savingBracket ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </Modal>

      {/* ── NSSF dialog ── */}
      <Modal
        opened={nssfOpen}
        onClose={() => setNssfOpen(false)}
        title={
          nssfIsVersion
            ? t('payroll.tiers.newVersionOf', { scheme: nssfForm.scheme })
            : nssfId != null
              ? t('payroll.tiers.editScheme')
              : t('payroll.tiers.newScheme')
        }
        size={520}
        centered
      >
        {nssfIsVersion && (
          <p className="hint" style={{ marginTop: 0 }}>{t('payroll.tiers.newVersionHint')}</p>
        )}

        <div className="form-field">
          <label className="form-label" htmlFor="ns-scheme">{t('payroll.tiers.scheme')}</label>
          <TextInput
            id="ns-scheme"
            value={nssfForm.scheme}
            onChange={(e) => setNssfForm((f) => ({ ...f, scheme: e.currentTarget.value }))}
            disabled={savingNssf}
          />
        </div>

        <div className="form-grid">
          <div className="form-field">
            <label className="form-label" htmlFor="ns-emp">{t('payroll.tiers.employeeRate')}</label>
            <NumberInput
              id="ns-emp"
              value={nssfForm.employeePercent}
              onChange={(v) =>
                setNssfForm((f) => ({ ...f, employeePercent: typeof v === 'number' ? v : 0 }))
              }
              min={0}
              max={100}
              decimalScale={4}
              suffix="%"
              disabled={savingNssf}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="ns-empr">{t('payroll.tiers.employerRate')}</label>
            <NumberInput
              id="ns-empr"
              value={nssfForm.employerPercent}
              onChange={(v) =>
                setNssfForm((f) => ({ ...f, employerPercent: typeof v === 'number' ? v : 0 }))
              }
              min={0}
              max={100}
              decimalScale={4}
              suffix="%"
              disabled={savingNssf}
            />
          </div>
        </div>

        <div className="form-field">
          <Switch
            checked={nssfForm.isCeilinged}
            onChange={(e) =>
              setNssfForm((f) => ({ ...f, isCeilinged: e.currentTarget.checked }))
            }
            label={t('payroll.tiers.hasCeiling')}
            disabled={savingNssf}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="ns-ceiling">{t('payroll.tiers.ceilingAmount')}</label>
          {/* Disabled rather than hidden when the switch is off: a scheme that HAD a ceiling and
              had it switched off should still show what that ceiling was, so switching back is not
              a retyping exercise. The placeholder carries the fallback, so an empty box says what
              will actually apply rather than nothing at all. */}
          <NumberInput
            id="ns-ceiling"
            value={nssfForm.ceilingAmount ?? ''}
            onChange={(v) =>
              setNssfForm((f) => ({
                ...f,
                ceilingAmount: v === '' || v == null ? null : Number(v),
              }))
            }
            min={0}
            decimalScale={2}
            placeholder={
              fallbackCeiling
                ? t('payroll.tiers.ceilingPlaceholder', { value: fallbackCeiling })
                : t('payroll.tiers.ceilingPlaceholderUnset')
            }
            disabled={savingNssf || !nssfForm.isCeilinged}
          />
          <p className="hint" style={{ marginTop: 6 }}>{t('payroll.tiers.ceilingAmountHint')}</p>
        </div>

        <div className="form-grid">
          <div className="form-field">
            <label className="form-label" htmlFor="ns-from">{t('payroll.tiers.effectiveFrom')}</label>
            <TextInput
              id="ns-from"
              type="date"
              value={nssfForm.effectiveFrom}
              onChange={(e) => setNssfForm((f) => ({ ...f, effectiveFrom: e.currentTarget.value }))}
              disabled={savingNssf}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="ns-to">{t('payroll.tiers.effectiveTo')}</label>
            <TextInput
              id="ns-to"
              type="date"
              value={nssfForm.effectiveTo}
              onChange={(e) => setNssfForm((f) => ({ ...f, effectiveTo: e.currentTarget.value }))}
              disabled={savingNssf}
            />
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="ns-note">{t('payroll.tiers.note')}</label>
          <TextInput
            id="ns-note"
            value={nssfForm.note}
            onChange={(e) => setNssfForm((f) => ({ ...f, note: e.currentTarget.value }))}
            disabled={savingNssf}
          />
        </div>

        {nssfError && (
          <div className="alert alert--error" role="alert">
            {nssfError}
          </div>
        )}

        <div className="form-actions">
          <Button variant="default" onClick={() => setNssfOpen(false)} disabled={savingNssf}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submitScheme()} disabled={savingNssf}>
            {savingNssf ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </Modal>

      {/* ── delete confirm ── */}
      <Modal
        opened={deleting != null}
        onClose={() => setDeleting(null)}
        title={t('payroll.tiers.deleteTitle')}
        size={440}
        centered
      >
        <p>
          {deleting &&
            t('payroll.tiers.deleteBody', {
              floor: money(deleting.minAnnual, '—'),
              ceiling:
                deleting.maxAnnual == null
                  ? t('payroll.tiers.andAbove')
                  : money(deleting.maxAnnual, '—'),
              currency: deleting.currencyCode,
            })}
        </p>
        <p className="hint">{t('payroll.tiers.deleteHint')}</p>

        <div className="form-actions">
          <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteBusy}>
            {t('common.cancel')}
          </Button>
          <Button color="red" onClick={() => void confirmDelete()} disabled={deleteBusy}>
            {deleteBusy ? t('common.saving') : t('common.delete')}
          </Button>
        </div>
      </Modal>

      {/* THE BAND for one tier. Mounted only while open, so each opening starts from the stored
          row with no error left over from the last attempt. */}
      {bandTier && (
        <Modal
          opened
          onClose={() => setBandTier(null)}
          title={t('payroll.tiers.bandTitle', { tier: tierName(bandTier.tierNo) })}
          size={480}
          centered
        >
          <p className="hint" style={{ marginTop: 0 }}>
            {t('payroll.tiers.bandBlankHint')}
          </p>

          <div className="form-grid">
            <div className="form-field">
              <label className="form-label" htmlFor="band-min">
                {t('payroll.tiers.minBasic')}
              </label>
              <NumberInput
                id="band-min"
                value={bandMin}
                min={0}
                decimalScale={2}
                placeholder={t('payroll.tiers.noBound')}
                disabled={bandSaving}
                onChange={(v) => setBandMin(v === '' || v == null ? '' : Number(v))}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="band-max">
                {t('payroll.tiers.maxBasic')}
              </label>
              <NumberInput
                id="band-max"
                value={bandMax}
                min={0}
                decimalScale={2}
                placeholder={t('payroll.tiers.noBound')}
                disabled={bandSaving}
                onChange={(v) => setBandMax(v === '' || v == null ? '' : Number(v))}
              />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="band-currency">
              {t('common.currency')}
            </label>
            <Select
              id="band-currency"
              data={currencyOptions}
              value={bandCurrency || null}
              allowDeselect={false}
              disabled={bandSaving}
              onChange={(v) => setBandCurrency(v ?? '')}
            />
          </div>

          {bandError && (
            <div className="alert alert--error" role="alert">
              {bandError}
            </div>
          )}

          <div className="form-actions">
            <Button variant="default" onClick={() => setBandTier(null)} disabled={bandSaving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void saveBand()} loading={bandSaving} disabled={bandSaving}>
              {bandSaving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
