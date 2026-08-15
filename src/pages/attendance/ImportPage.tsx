import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Loader, Pagination, Select, Table, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconDownload, IconPlus, IconRefresh, IconSearch, IconUpload } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { gridFilterFn, GridFilterRow, optionsFrom } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { useLive } from '../../live/useLive'
import { useLiveEnabled } from '../../live/useLiveSettings'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { devicesService, importService } from '../../services/attendanceService'
import { PERMISSIONS } from '../../types/attendance'
import type {
  Device,
  ImportBatch,
  ImportPreviewResult,
  ImportPreviewRow,
  ImportResult,
} from '../../types/attendance'
import {
  formatDate,
  formatTime,
} from './attendanceFormat'

/** The fingerprint machine exports a spreadsheet; nothing else is accepted. */
const ACCEPTED_EXTENSION = '.xlsx'

/** Served from public/, so HR can see the exact shape the importer expects. */
const SAMPLE_FILE_URL = '/sample_attendance_import.xlsx'

type WizardStep = 1 | 2 | 3

/** The page sizes the original pager offered. */
const PAGE_SIZES = ['15', '30', '50']

/**
 * notify(msg, type, ms) → Mantine notifications, adapted once so every call site below
 * stays byte-identical to the original.
 */
function notify(message: string, type: 'success' | 'error', ms: number) {
  notifications.show({ message, color: type === 'success' ? 'green' : 'red', autoClose: ms })
}

/** "3 punches" reads like English; "3 punch(es)" reads like a form. */
function punchCount(count: number): string {
  return count === 1 ? '1 punch' : `${count} punches`
}

function WizardSteps({ current }: { current: WizardStep }) {
  const steps: Array<{ num: WizardStep; label: string }> = [
    { num: 1, label: 'Upload' },
    { num: 2, label: 'Preview' },
    { num: 3, label: 'Result' },
  ]

  return (
    <div className="wizard-steps">
      {steps.map((step) => {
        const state =
          step.num === current
            ? ' wizard-step--active'
            : step.num < current
              ? ' wizard-step--done'
              : ''
        return (
          <div key={step.num} className={`wizard-step${state}`}>
            <span className="wizard-step-num">{step.num}</span>
            <span>{step.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function ResultTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="result-tile">
      <div className="result-tile-value">{value}</div>
      <div className="result-tile-label">{label}</div>
    </div>
  )
}

/**
 * What a row's flags mean, in the user's language. A duplicate is not an error and a
 * parked punch is not a loss — an unknown device is the only outcome that actually fails
 * to store the punch, so it is the only one coloured against the user.
 */
function OutcomeBadge({ row }: { row: ImportPreviewRow }) {
  // Severity order, NOT field order. A punch on an unregistered device is also a punch on
  // a PIN nobody is enrolled on — an enrollment is (device, PIN), so it cannot exist for a
  // device the system has never heard of. Checking `willBeUnresolved` first would therefore
  // label a punch that CANNOT BE STORED as a benign muted "Parked", i.e. tell the user their
  // data was kept when it is about to be dropped. The losing outcome has to be tested first.
  if (row.unknownDevice) {
    return <span className="badge badge--off">Cannot import</span>
  }
  if (row.willBeDuplicate) {
    return <span className="badge badge--muted">Skipped</span>
  }
  if (row.willBeUnresolved) {
    return <span className="badge badge--muted">Parked</span>
  }
  return <span className="badge badge--on">Will import</span>
}

/**
 * "Last seen 3 minutes ago" beats a timestamp for the one question this card answers —
 * is that machine still alive RIGHT NOW. An absolute time makes the reader do the
 * subtraction, and the whole point is to notice a gap at a glance.
 *
 * It falls back to the date once something is more than a day old, because "2 days ago"
 * stops being actionable and "which day did it die" starts mattering.
 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'

  const seconds = Math.round((Date.now() - then) / 1000)

  // A device clock running slightly fast, or ours slightly slow. "In 4 seconds" would
  // read like a bug in the page rather than the half-second of drift it actually is.
  if (seconds < 45) return 'just now'
  if (seconds < 5400) {
    const minutes = Math.round(seconds / 60)
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  }
  if (seconds < 86400) {
    const hours = Math.round(seconds / 3600)
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  }
  return `${formatDate(iso)} ${formatTime(iso)}`
}

/* PORT NOTE: the original set alignment={alignStart()} on numeric columns purely to counter
   DevExtreme's default right-alignment of numbers; an HTML table start-aligns every cell
   already, so the prop (and the alignStart import) has no work left to do here. */

const deviceColumnHelper = createColumnHelper<Device>()

/** The pixel widths the original grid pinned; unlisted columns auto-size, as columnAutoWidth did. */
const DEVICE_WIDTHS: Record<string, number | undefined> = {
  lastSyncUtc: 150,
  punchesToday: 140,
}

/** What the two health columns print — "3 minutes ago", or the word for a device never heard from. */
const seenText = (value: string | null) => (value ? relativeTime(value) : 'Never')

/** The device-health grid inside DevicesCard — small list, sortable, no pager needed. */
function DevicesGrid({ devices }: { devices: Device[] }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      deviceColumnHelper.accessor('name', {
        header: 'Device',
        meta: { filterText: (v) => v || 'Unnamed' },
        cell: (info) => {
          const device = info.row.original
          return device.name ? (
            <span>{device.name}</span>
          ) : (
            <span className="badge badge--muted">Unnamed</span>
          )
        },
      }),
      deviceColumnHelper.accessor('branchName', { header: 'Branch' }),
      deviceColumnHelper.accessor('serialNumber', { header: 'Serial' }),
      deviceColumnHelper.accessor('lastSyncUtc', {
        header: () => (
          <span title="Any contact at all, including the command poll a pushing terminal makes every few seconds. This proves the network, not the sensor.">
            Last seen
          </span>
        ),
        meta: { filterText: seenText },
        cell: (info) => {
          const device = info.row.original
          return device.lastSyncUtc ? (
            <span>{relativeTime(device.lastSyncUtc)}</span>
          ) : (
            <span className="badge badge--muted">Never</span>
          )
        },
      }),
      /* NO "Last punch" COLUMN HERE. It was bound to lastPushUtc — the PUSH heartbeat, which only
         moves when a terminal delivers punches to us itself. This deployment pulls, so that field
         is null on every machine forever and the column read "Never" down its whole length: not a
         health signal, an alarm that is always on and therefore ignored. "Punches today" beside it
         answers the same question from data that actually arrives. The genuine per-machine last
         punch (lastPunchUtc) is on Attendance → Devices, which is where a fault is diagnosed. */
      deviceColumnHelper.accessor('punchesToday', {
        header: 'Punches today',
        meta: { filterText: (v) => (v === 0 ? 'None yet' : String(v)) },
        cell: (info) => {
          const device = info.row.original
          // Zero is not styled as a failure. Before the first shift of the day it is
          // simply the truth, and a red zero every morning teaches people to ignore it.
          return device.punchesToday === 0 ? (
            <span className="badge badge--muted">None yet</span>
          ) : (
            <span>{device.punchesToday}</span>
          )
        },
      }),
    ],
    [],
  )

  const table = useReactTable({
    data: devices,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    // This card had no search of its own; the filter row is its first narrowing control, so the
    // filtered row model comes in with it.
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (device) => String(device.deviceId),
  })

  return (
    <Table striped withTableBorder verticalSpacing="xs" fz="sm">
      <Table.Thead>
        {table.getHeaderGroups().map((hg) => (
          <Table.Tr key={hg.id}>
            {hg.headers.map((header) => (
              <Table.Th
                key={header.id}
                style={{
                  width: DEVICE_WIDTHS[header.column.id],
                  cursor: 'pointer',
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
  )
}

const previewColumnHelper = createColumnHelper<ImportPreviewRow>()

const PREVIEW_WIDTHS: Record<string, number | undefined> = {
  rowNumber: 70,
  enrollPin: 90,
  punchTimeUtc: 160,
  punchType: 80,
  deviceSerial: 140,
}

/**
 * The step-2 preview grid. The original's SearchPanel is the global search box and its FilterRow
 * is the per-column strip; multi-sort and the 15/30/50 pager carry over.
 */
function PreviewGrid({ rows }: { rows: ImportPreviewRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      previewColumnHelper.accessor('rowNumber', { header: 'Row' }),
      previewColumnHelper.accessor('enrollPin', { header: 'PIN' }),
      // The name is here only so the user can recognise the row. The punch is
      // matched on device serial + PIN, never on this.
      previewColumnHelper.accessor('employeeName', {
        header: 'Name in file (not used to match)',
      }),
      previewColumnHelper.accessor('punchTimeUtc', {
        header: 'When',
        cell: (info) => {
          const row = info.row.original
          return `${formatDate(row.punchTimeUtc)} ${formatTime(row.punchTimeUtc)}`
        },
        meta: { filterText: (v) => `${formatDate(v)} ${formatTime(v)}` },
      }),
      // Two values, printed as words the file itself does not contain — a dropdown, not a box
      // somebody would have to guess "0" into.
      previewColumnHelper.accessor('punchType', {
        header: 'Type',
        cell: (info) => (info.row.original.punchType === 0 ? 'IN' : 'OUT'),
        meta: { filterText: (v) => (v === 0 ? 'IN' : 'OUT'), filterOptions: ['IN', 'OUT'] },
      }),
      previewColumnHelper.accessor('deviceSerial', { header: 'Device' }),
      previewColumnHelper.accessor('reason', {
        header: 'What will happen',
        // The original's allowFiltering={false} — the outcome column is neither searched nor
        // filtered, so the strip leaves its cell empty.
        enableGlobalFilter: false,
        meta: { noFilter: true },
        cell: (info) => {
          const row = info.row.original
          return (
            <div className="grid-actions">
              <OutcomeBadge row={row} />
              <span>{row.reason ?? ''}</span>
            </div>
          )
        },
      }),
    ],
    [],
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
    initialState: { pagination: { pageSize: 15 } },
    getRowId: (row) => String(row.rowNumber),
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
                    width: PREVIEW_WIDTHS[header.column.id],
                    cursor: 'pointer',
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
                  The file had no punch rows in it.
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
            onChange={(p) => table.setPageIndex(p - 1)}
            total={Math.max(pageCount, 1)}
            size="sm"
          />
        </Group>
      </Group>
    </div>
  )
}

const batchColumnHelper = createColumnHelper<ImportBatch>()

const HISTORY_WIDTHS: Record<string, number | undefined> = {
  rowCount: 90,
  status: 130,
  importedByUsername: 160,
  importedUtc: 180,
}

/** The import-history grid — same chrome as the preview grid, its own columns. */
function HistoryGrid({ batches }: { batches: ImportBatch[] }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      batchColumnHelper.accessor('fileName', { header: 'File' }),
      batchColumnHelper.accessor('rowCount', { header: 'Rows' }),
      // The badge prints the status verbatim, so the dropdown offers the statuses actually
      // present rather than a guessed list — "Failed" is the one people come here to isolate.
      batchColumnHelper.accessor('status', {
        header: 'Status',
        meta: { filterOptions: optionsFrom(batches, (b) => b.status) },
        cell: (info) => {
          const batch = info.row.original
          const failed = batch.status.toLowerCase() === 'failed'
          return (
            <span className={failed ? 'badge badge--off' : 'badge badge--on'}>
              {batch.status}
            </span>
          )
        },
      }),
      batchColumnHelper.accessor('importedByUsername', { header: 'Imported by' }),
      batchColumnHelper.accessor('importedUtc', {
        header: 'When',
        cell: (info) => {
          const batch = info.row.original
          return `${formatDate(batch.importedUtc)} ${formatTime(batch.importedUtc)}`
        },
        meta: { filterText: (v) => `${formatDate(v)} ${formatTime(v)}` },
      }),
      batchColumnHelper.accessor('note', { header: 'Note', meta: { noHeaderFilter: true } }),
    ],
    // `batches` only feeds the status dropdown's option list.
    [batches],
  )

  const table = useReactTable({
    data: batches,
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
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 15 } },
    getRowId: (batch) => String(batch.importBatchId),
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
                    width: HISTORY_WIDTHS[header.column.id],
                    cursor: 'pointer',
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
                  No import matches the filters — clear them to see the full history.
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
 * The terminals, and whether they are actually working.
 *
 * WHY THIS IS ON THE IMPORT PAGE. This is where somebody comes when they are worried
 * about punches — and the most useful thing that can happen here is for them to see that
 * the machines are pushing on their own and there is nothing to upload. When a device HAS
 * gone quiet, this is also the page they are on at the moment they need to know it.
 *
 * TWO TIMES, NOT ONE, and the difference is the whole diagnostic. A terminal polls us for
 * commands every few seconds whether or not anyone has touched it, so "last seen" alone
 * looks healthy right up until payroll is short. "Last punch" is the column that says the
 * fingerprint sensor still works. A machine seen seconds ago whose last punch was
 * yesterday is online and not reading anybody — which is a different repair from a machine
 * that is simply unplugged.
 */
function DevicesCard({
  devices,
  loading,
  error,
  onRefresh,
}: {
  devices: Device[]
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  const active = devices.filter((device) => device.isActive)

  return (
    <div className="card">
      <div className="tab-toolbar">
        <div className="card-title">Devices</div>
        <div className="page-head-actions">
          <ActionIcon
            variant="default"
            size="lg"
            title="Refresh the device list"
            aria-label="Refresh the device list"
            onClick={onRefresh}
            disabled={loading}
          >
            <IconRefresh size={16} />
          </ActionIcon>
        </div>
      </div>

      <p className="hint">
        A terminal set up to push sends its punches by itself, within seconds — there is
        nothing to upload for it. Use the file upload above for a machine that cannot
        push, or to backfill a stretch when one was offline.
      </p>

      {error ? (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      ) : loading ? (
        <div className="page-loading">
          <Loader size={30} />
        </div>
      ) : active.length === 0 ? (
        <div className="empty-hint">
          <div className="empty-hint-main">No terminal is registered and active.</div>
          A punch can only be stored against a device the system knows, so until one is
          registered, uploading a spreadsheet is the only way punches can arrive at all.{' '}
          <Link to="/attendance/devices">Register a device</Link>
        </div>
      ) : (
        <DevicesGrid devices={active} />
      )}
    </div>
  )
}

/**
 * Drag-and-drop or click-to-browse over one hidden file input. The input's value is
 * cleared after every pick so that choosing the SAME file again still fires a change:
 * re-importing a file is safe by design, and the UI must not quietly refuse to do it.
 */
function Dropzone({
  onFile,
  busy,
}: {
  onFile: (file: File) => void
  busy: boolean
}) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function choose(files: FileList | null) {
    const file = files?.[0]
    if (file) onFile(file)
  }

  function openPicker() {
    if (busy) return
    inputRef.current?.click()
  }

  return (
    <div
      className={over ? 'dropzone dropzone--over' : 'dropzone'}
      role="button"
      tabIndex={0}
      aria-label="Choose the .xlsx file exported from the fingerprint machine"
      onClick={openPicker}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openPicker()
        }
      }}
      onDragOver={(event) => {
        // Without preventDefault the browser leaves the app and opens the dropped file.
        event.preventDefault()
        if (!busy) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        if (!busy) choose(event.dataTransfer.files)
      }}
    >
      {busy ? (
        <>
          <Loader size={30} />
          <div className="dropzone-main">Reading the file…</div>
          <div className="dropzone-sub">Nothing has been saved yet.</div>
        </>
      ) : (
        <>
          <IconUpload size={30} className="dropzone-icon" aria-hidden="true" />
          <div className="dropzone-main">
            Drop the .xlsx file here, or click to choose one
          </div>
          <div className="dropzone-sub">
            You will see exactly what it does before anything is saved.
          </div>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSION}
        hidden
        onChange={(event) => {
          choose(event.target.files)
          event.target.value = ''
        }}
      />
    </div>
  )
}

export default function ImportPage() {
  const { hasPermission } = useAuth()
  // Uploading writes punches, so it is gated. Reading the history only needs ATTENDANCE_VIEW.
  const canImport = hasPermission(PERMISSIONS.import)

  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // The device list is a SEPARATE resource with its own failure. A device fetch that fails
  // must not blank the import history, and vice versa — they answer different questions and
  // one being unavailable says nothing about the other.
  const [devices, setDevices] = useState<Device[]>([])
  const [devicesLoading, setDevicesLoading] = useState(true)
  const [devicesError, setDevicesError] = useState<string | null>(null)

  const [step, setStep] = useState<WizardStep>(1)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    try {
      setBatches(await importService.getBatches())
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDevices = useCallback(async () => {
    try {
      setDevices(await devicesService.getAll())
      setDevicesError(null)
    } catch (err) {
      setDevicesError(getErrorMessage(err))
    } finally {
      setDevicesLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      // allSettled, not all: these are two independent resources with two independent
      // failures, and a device list that will not load must still leave the import history
      // readable — and vice versa. Each one reports its own problem in its own place.
      const [batchResult, deviceResult] = await Promise.allSettled([
        importService.getBatches(),
        devicesService.getAll(),
      ])

      if (cancelled) return

      if (batchResult.status === 'fulfilled') {
        setBatches(batchResult.value)
        setError(null)
      } else {
        setError(getErrorMessage(batchResult.reason))
      }
      setLoading(false)

      if (deviceResult.status === 'fulfilled') {
        setDevices(deviceResult.value)
        setDevicesError(null)
      } else {
        setDevicesError(getErrorMessage(deviceResult.reason))
      }
      setDevicesLoading(false)
    }
    void initialLoad()
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * A pushed punch changes this page without anybody touching it — which is the entire
   * promise of a device that pushes. Refetching the devices alone is deliberate: the
   * signal means punches arrived, and punches arriving does not create an import batch.
   */
  useLive(['attendance'], () => void loadDevices(), useLiveEnabled('attendance'))

  function refresh() {
    setLoading(true)
    setDevicesLoading(true)
    void load()
    void loadDevices()
  }

  function refreshDevices() {
    setDevicesLoading(true)
    void loadDevices()
  }

  /**
   * The preview WRITES NOTHING. It runs the same parse and the same duplicate check as the
   * real import, so what step 2 promises is what step 3 does.
   */
  async function handleFile(chosen: File) {
    if (!chosen.name.toLowerCase().endsWith(ACCEPTED_EXTENSION)) {
      notify(
        `"${chosen.name}" is not an .xlsx file. Export the punch log from the machine as Excel and try again.`,
        'error',
        4000,
      )
      return
    }

    setPreviewing(true)
    try {
      const parsed = await importService.preview(chosen)
      setFile(chosen)
      setPreview(parsed)
      setStep(2)
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setPreviewing(false)
    }
  }

  async function confirmImport() {
    if (!file) return

    setImporting(true)
    try {
      const imported = await importService.upload(file)
      setResult(imported)
      setStep(3)
      notify(
        `Imported ${punchCount(imported.inserted)} from "${file.name}".`,
        'success',
        2500,
      )
      await load()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setImporting(false)
    }
  }

  function startOver() {
    setStep(1)
    setFile(null)
    setPreview(null)
    setResult(null)
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Import punches</h1>
          <p className="page-subtitle">
            Load the fingerprint machine's spreadsheet into attendance.
          </p>
        </div>
        <div className="page-head-actions">
          <ActionIcon
            variant="default"
            size="lg"
            title="Refresh the import history"
            aria-label="Refresh the import history"
            onClick={refresh}
          >
            <IconRefresh size={16} />
          </ActionIcon>
        </div>
      </div>

      <PageHelp>
        Upload the file exported from the fingerprint machine. Importing the same
        file twice is safe: punches already in the system are ignored.
      </PageHelp>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {canImport && (
        <>
          {/* The reassurance sits ABOVE the wizard because the fear of importing twice is
              what stops people importing at all. */}
          <div className="card">
            <div className="empty-hint">
              <div className="empty-hint-main">
                Nothing here overwrites anything.
              </div>
              A punch that is already in the system is ignored, and a punch on an
              unknown PIN is kept, not thrown away.
            </div>
          </div>

          <WizardSteps current={step} />

          {step === 1 && (
            <div className="card">
              <div className="card-title">Choose the file</div>

              <Dropzone
                onFile={(chosen) => void handleFile(chosen)}
                busy={previewing}
              />

              <p className="hint">
                Expected columns: EnrollPin · EmployeeName · PunchDateTime ·
                PunchType · DeviceSerial
              </p>
              <p className="hint">
                The importer reads the FIRST sheet. A punch is matched to a person
                by device serial + PIN — never by name, because devices export
                names inconsistently.
              </p>

              <div className="form-actions">
                {/* A real anchor, so the browser downloads the sample without any JS —
                    Mantine's polymorphic Button renders an actual <a>. */}
                <Button
                  component="a"
                  href={SAMPLE_FILE_URL}
                  download
                  variant="default"
                  leftSection={<IconDownload size={16} />}
                >
                  Download sample file
                </Button>
              </div>
            </div>
          )}

          {step === 2 && preview && (
            <div className="card">
              <div className="card-title">
                What this file will do — nothing has been saved yet
              </div>

              <div className="result-row">
                <ResultTile value={preview.parsed} label="Rows read" />
                <ResultTile value={preview.willInsert} label="Will import" />
                <ResultTile
                  value={preview.duplicates}
                  label="Already in the system"
                />
                <ResultTile
                  value={preview.unresolvedPins}
                  label="Unknown PIN"
                />
                <ResultTile
                  value={preview.unknownDevices}
                  label="Unknown device"
                />
              </div>

              {preview.errors.length > 0 && (
                <div className="alert alert--error" role="alert">
                  {preview.errors.length === 1
                    ? '1 row could not be read and will be skipped:'
                    : `${preview.errors.length} rows could not be read and will be skipped:`}
                  <ul>
                    {preview.errors.map((rowError) => (
                      <li key={rowError.rowNumber}>
                        Row {rowError.rowNumber}: {rowError.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <PreviewGrid rows={preview.rows} />

              <div className="form-actions">
                <Button
                  variant="default"
                  onClick={startOver}
                  disabled={importing}
                >
                  Back
                </Button>
                <Button
                  leftSection={<IconCheck size={16} />}
                  onClick={() => void confirmImport()}
                  disabled={importing}
                >
                  {importing
                    ? 'Importing…'
                    : `Import ${punchCount(preview.willInsert)}`}
                </Button>
              </div>
            </div>
          )}

          {step === 3 && result && (
            <div className="card">
              <div className="card-title">Imported</div>

              <div className="result-row">
                <ResultTile value={result.parsed} label="Rows read" />
                <ResultTile value={result.inserted} label="Imported" />
                <ResultTile
                  value={result.duplicates}
                  label="Already in the system"
                />
                <ResultTile value={result.unresolvedPins} label="Unknown PIN" />
                <ResultTile
                  value={result.errors.length}
                  label="Unreadable rows"
                />
              </div>

              {result.duplicates > 0 && (
                <p className="hint">
                  {punchCount(result.duplicates)} were already in the system and
                  were ignored. That is normal — importing the same file twice is
                  safe.
                </p>
              )}

              {result.unresolvedPins > 0 && (
                <p className="hint">
                  {punchCount(result.unresolvedPins)} are on a PIN nobody is
                  enrolled on. They have been KEPT, not thrown away.{' '}
                  <Link to="/attendance/unresolved">Map these PINs</Link>
                </p>
              )}

              {result.unknownDevices > 0 && (
                <p className="hint">
                  {punchCount(result.unknownDevices)} came from a device that is
                  not registered and could NOT be imported.{' '}
                  <Link to="/attendance/devices">Add the device</Link>
                </p>
              )}

              {result.errors.length > 0 && (
                <div className="alert alert--error" role="alert">
                  These rows could not be read:
                  <ul>
                    {result.errors.map((rowError) => (
                      <li key={rowError.rowNumber}>
                        Row {rowError.rowNumber}: {rowError.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* A punch is not attendance until the processor pairs it into a day. */}
              <p className="hint">
                Next: run the processor on the Daily page to turn these punches
                into attendance days.{' '}
                <Link to="/attendance/daily">Go to Daily attendance</Link>
              </p>

              <div className="form-actions">
                <Button
                  variant="default"
                  leftSection={<IconPlus size={16} />}
                  onClick={startOver}
                >
                  Import another file
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Below the uploader, above the history. Somebody who came here to upload gets the
          dropzone first; somebody who came here worried about missing punches finds, one
          scroll down, the answer to "are the machines even talking to us". For a user
          without import rights the wizard is absent entirely and this becomes the first
          thing on the page — which is right, since it is the only part they can act on. */}
      <DevicesCard
        devices={devices}
        loading={devicesLoading}
        error={devicesError}
        onRefresh={refreshDevices}
      />

      <div className="card">
        <div className="card-title">Import history</div>

        {loading ? (
          <div className="page-loading">
            <Loader size={40} />
          </div>
        ) : batches.length === 0 ? (
          // An empty list after a FAILED load is not the same as no imports. "No file has
          // been imported yet" would send somebody off to re-upload a file that is already
          // in there. When the fetch failed the alert above is the whole story.
          error ? null : (
            <div className="empty-hint">
              <div className="empty-hint-main">No file has been imported yet.</div>
              {canImport
                ? 'Export the punch log from the fingerprint machine as Excel, then drop it in the box above.'
                : 'Ask someone with import rights to upload the punch log from the fingerprint machine.'}
            </div>
          )
        ) : (
          <HistoryGrid batches={batches} />
        )}
      </div>
    </div>
  )
}
