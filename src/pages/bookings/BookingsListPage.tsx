import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { Badge, Group, Loader, Pagination, Select, Table, TextInput } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { getErrorMessage } from '../../api/errorMessage'
import { DateRangeField } from '../../components/DateRangeField'
import { PageHelp } from '../../components/PageHelp'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { bookingsService, roomsService } from '../../services/bookingService'
import type { BookingRow, Room } from '../../types/booking'
import {
  addDays,
  BOOKING_STATUSES,
  dayLabel,
  hasRefund,
  hhmm,
  isStruck,
  money,
  PERMISSIONS,
  REFUND_COLOR,
  refundLabel,
  refundStatusOf,
  STATUS_COLOR,
  statusLabel,
  today,
} from './bookingShared'
import { BookingDrawer } from './BookingDrawer'
import './bookings.css'

/**
 * Every booking in a period, as a list rather than a picture — the view you triage in, search in and
 * export a number out of.
 *
 * IT READS THE SAME ENDPOINT AS THE CALENDAR and opens the same drawer, so the two can never
 * disagree about what a booking is or what may be done to it. What differs is only what a list is
 * better at: a status filter that actually removes rows, sorting by money, and the per-column filter
 * strip.
 *
 * THE BLOCKS FROM THAT FETCH ARE DROPPED HERE. A block is not a booking — no guest, no money, no
 * status — and a row of dashes under those headings would be noise. They are on the calendar, which
 * is where a held-back room needs to be visible.
 */
const columnHelper = createColumnHelper<BookingRow>()

const PAGE_SIZES = ['25', '50', '100']

export default function BookingsListPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canView = hasPermission(PERMISSIONS.view)
  const canManage = hasPermission(PERMISSIONS.manage)

  /* A fortnight around today, so the page opens on something rather than on an empty range. */
  const [from, setFrom] = useState<string | null>(addDays(today(), -7))
  const [to, setTo] = useState<string | null>(addDays(today(), 7))
  const [roomFilter, setRoomFilter] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)

  const [rooms, setRooms] = useState<Room[]>([])
  const [rows, setRows] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const [selected, setSelected] = useState<BookingRow | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    roomsService
      .getCatalog(true)
      .then((catalog) => {
        if (!cancelled) setRooms(catalog.rooms)
      })
      .catch(() => {
        /* The room filter degrades to "all rooms"; the list itself does not need the catalogue. */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(async () => {
    if (!from || !to) return

    setLoading(true)
    try {
      const result = await bookingsService.getRange(from, to, roomFilter, statusFilter)
      setRows(result.bookings)
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [from, to, roomFilter, statusFilter])

  useEffect(() => {
    if (!canView) return
    void load()
  }, [canView, load])

  const columns = useMemo(
    () => [
      columnHelper.accessor('bookDate', {
        header: t('booking.fields.date'),
        // Sorts on the ISO string (chronological) and matches on what the cell shows, so somebody
        // typing "14/07" finds the day they can see rather than nothing.
        cell: (info) => dayLabel(info.getValue()),
        meta: { filterText: (value) => dayLabel(value as string) },
      }),
      columnHelper.accessor('startTime', {
        header: t('booking.fields.time'),
        cell: (info) =>
          `${hhmm(info.getValue())}–${hhmm(info.row.original.endTime)}`,
        meta: {
          filterText: (_v, row) => `${hhmm(row.startTime)}–${hhmm(row.endTime)}`,
          noHeaderFilter: true,
        },
      }),
      columnHelper.accessor('roomName', {
        header: t('booking.fields.room'),
      }),
      columnHelper.accessor('guestName', {
        header: t('booking.fields.guest'),
        // A guest name is distinct per row, so a funnel listing every one of them helps nobody.
        meta: { noHeaderFilter: true },
      }),
      columnHelper.accessor('persons', {
        header: t('booking.fields.persons'),
      }),
      columnHelper.accessor('totalAmount', {
        header: t('booking.fields.total'),
        cell: (info) => money(info.getValue(), info.row.original.currencyCode),
        meta: {
          filterText: (_v, row) => money(row.totalAmount, row.currencyCode),
          noHeaderFilter: true,
        },
      }),
      columnHelper.accessor('paidAmount', {
        header: t('booking.fields.paid'),
        cell: (info) => money(info.getValue(), info.row.original.currencyCode),
        meta: {
          filterText: (_v, row) => money(row.paidAmount, row.currencyCode),
          noHeaderFilter: true,
        },
      }),
      /* The column somebody is actually scanning for. Sorted numerically, shown red when there is
         still money to collect — the same red the drawer and the receipt use for a balance. */
      columnHelper.accessor('balanceDue', {
        header: t('booking.fields.balance'),
        cell: (info) => (
          <span
            style={
              info.getValue() > 0 ? { color: '#b4442f', fontWeight: 600 } : undefined
            }
          >
            {money(info.getValue(), info.row.original.currencyCode)}
          </span>
        ),
        meta: {
          filterText: (_v, row) => money(row.balanceDue, row.currencyCode),
          noHeaderFilter: true,
        },
      }),
      columnHelper.accessor('status', {
        header: t('booking.fields.status'),
        /* A cancelled booking that owes money back wears a second badge — red until the refund
           has been handed over — so the list is where somebody finds the ones still to settle. */
        cell: (info) => (
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            <Badge color={STATUS_COLOR[info.getValue()]} variant="light">
              {statusLabel(info.getValue())}
            </Badge>
            {hasRefund(info.row.original) && (
              <Badge color={REFUND_COLOR[refundStatusOf(info.row.original)]} variant="light">
                {refundLabel(refundStatusOf(info.row.original))}
              </Badge>
            )}
          </span>
        ),
        meta: {
          filterText: (_v, row) =>
            hasRefund(row)
              ? `${statusLabel(row.status)} ${refundLabel(refundStatusOf(row))}`
              : statusLabel(row.status),
          // Only the statuses actually present, so every option in the dropdown returns something.
          filterOptions: optionsFrom(rows, (row) => statusLabel(row.status)),
        },
      }),
      columnHelper.accessor('source', {
        header: t('booking.fields.source'),
        cell: (info) => t(`booking.source.${info.getValue()}`),
        meta: {
          filterText: (_v, row) => t(`booking.source.${row.source}`),
          filterOptions: optionsFrom(rows, (row) => t(`booking.source.${row.source}`)),
        },
      }),
    ],
    // `rows` feeds the two option lists only; the column shapes do not depend on the data.
    [t, rows],
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
    initialState: { pagination: { pageSize: 25 } },
    getRowId: (row) => String(row.bookingId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  if (!canView) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1 className="page-title">{t('booking.list.title')}</h1>
          </div>
        </div>
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">{t('booking.noAccess')}</div>
            {t('booking.noAccessHint')}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('booking.list.title')}</h1>
          <p className="page-subtitle">{t('booking.list.subtitle')}</p>
        </div>
      </div>

      <PageHelp>{t('booking.list.help')}</PageHelp>

      <div className="bk-toolbar">
        <div className="form-field">
          <span className="form-label">{t('common.period')}</span>
          <DateRangeField
            from={from}
            to={to}
            onChange={(nextFrom, nextTo) => {
              setFrom(nextFrom)
              setTo(nextTo)
            }}
            w={240}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-list-room">
            {t('booking.fields.room')}
          </label>
          <Select
            id="bk-list-room"
            w={190}
            data={[
              { value: '', label: t('booking.calendar.allRooms') },
              ...rooms.map((room) => ({
                value: String(room.roomId),
                label: room.isActive
                  ? room.name
                  : t('common.inactiveOption', { name: room.name }),
              })),
            ]}
            value={roomFilter == null ? '' : String(roomFilter)}
            onChange={(value) => setRoomFilter(value ? Number(value) : null)}
            allowDeselect={false}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-list-status">
            {t('booking.fields.status')}
          </label>
          <Select
            id="bk-list-status"
            w={170}
            data={[
              { value: '', label: t('common.all') },
              ...BOOKING_STATUSES.map((status) => ({
                value: status,
                label: statusLabel(status),
              })),
            ]}
            value={statusFilter ?? ''}
            onChange={(value) => setStatusFilter(value || null)}
            allowDeselect={false}
          />
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
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          {/* Narrows what is on screen. It does NOT re-query — the toolbar above is the only thing
              that changes which bookings are in play. */}
          <Group justify="flex-end" p="xs">
            <TextInput
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.currentTarget.value)}
              placeholder={t('booking.list.search')}
              leftSection={<IconSearch size={14} />}
              w={240}
              size="xs"
            />
          </Group>

          <Table highlightOnHover withColumnBorders={false} verticalSpacing="xs" fz="sm">
            <Table.Thead>
              {table.getHeaderGroups().map((group) => (
                <Table.Tr key={group.id}>
                  {group.headers.map((header) => (
                    <Table.Th
                      key={header.id}
                      style={{ cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}
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
                      {t('booking.list.empty')}
                    </div>
                  </Table.Td>
                </Table.Tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <Table.Tr
                    key={row.id}
                    style={{
                      cursor: 'pointer',
                      // Struck through for cancelled and no-shows, exactly as the calendar draws
                      // them — the booking happened to nobody, and the row should read that way.
                      textDecoration: isStruck(row.original.status)
                        ? 'line-through'
                        : undefined,
                    }}
                    onClick={() => {
                      setSelected(row.original)
                      setDrawerOpen(true)
                    }}
                  >
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
              {t('booking.list.pageInfo', {
                from: total === 0 ? 0 : pageIndex * pageSize + 1,
                to: Math.min((pageIndex + 1) * pageSize, total),
                total,
              })}
            </span>
            <Group gap="xs">
              <Select
                data={PAGE_SIZES}
                value={String(pageSize)}
                onChange={(value) => value && table.setPageSize(Number(value))}
                w={80}
                size="xs"
              />
              <Pagination
                value={pageIndex + 1}
                total={pageCount}
                onChange={(page) => table.setPageIndex(page - 1)}
                size="sm"
              />
            </Group>
          </Group>
        </div>
      )}

      <BookingDrawer
        booking={selected}
        block={null}
        opened={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onChanged={load}
        canManage={canManage}
      />
    </div>
  )
}
