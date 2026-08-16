import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Checkbox, Group, Loader, Modal, NumberInput, Pagination, Select, Switch, Table, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconRefresh, IconSearch } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { devicesService } from '../../services/attendanceService'
import { branchesService, departmentsService, employeesService } from '../../services/hrService'
import { branchOptions, departmentOptions } from '../../hr/assignableOptions'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { useAuth } from '../../auth/useAuth'
import {
  formatDate,
  formatTime,
} from './attendanceFormat'
import { DEVICE_PULL_DEFAULTS, PERMISSIONS } from '../../types/attendance'
import type {
  Device,
  EmployeeDevice,
} from '../../types/attendance'
import type { Branch, Department, EmployeeListItem } from '../../types/hr'

interface DeviceFormState {
  deviceId: number | null
  serialNumber: string
  name: string
  branchId: number | null
  departmentId: number | null
  isActive: boolean
  /* Connection — how the server reaches this machine to pull its log. */
  pullIp: string
  pullPort: number
  pullCommKey: number
  pullEnabled: boolean
}

const EMPTY_DEVICE_FORM: DeviceFormState = {
  deviceId: null,
  serialNumber: '',
  name: '',
  branchId: null,
  departmentId: null,
  isActive: true,
  pullIp: '',
  pullPort: DEVICE_PULL_DEFAULTS.port,
  pullCommKey: DEVICE_PULL_DEFAULTS.commKey,
  pullEnabled: false,
}

/**
 * When we last CALLED this machine, and whether it answered.
 *
 * A pulled machine is the one case where failure is completely silent: it is unreachable, so it
 * cannot tell us it has a problem, and nothing else in the system notices that a five-minute
 * timer has been failing since Tuesday. So an error is shown IN the cell, not hidden behind a
 * status column — with the machine's own words in the tooltip, because "connection refused" and
 * "authentication failed" send you to two completely different places.
 */
function LastPullCell({ device }: { device: Device }) {
  if (!device.pullEnabled && !device.lastPullUtc) {
    return <span className="badge badge--muted">Not pulled</span>
  }

  if (!device.lastPullUtc) {
    return <span className="badge badge--muted">Never pulled</span>
  }

  const when = `${formatDate(device.lastPullUtc)} ${formatTime(device.lastPullUtc)}`

  if (device.lastPullError) {
    return (
      <span
        className="badge badge--off"
        title={`Last attempt ${when} failed: ${device.lastPullError}`}
      >
        ⚠ {when}
      </span>
    )
  }

  return <span title={`Last successful pull ${when}`}>{when}</span>
}

/** Blank is "unnamed", not a name of length zero — the API stores null for both. */
function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

interface EnrollmentFormState {
  employeeId: number | null
  deviceId: number | null
  enrollPin: string
}

const EMPTY_ENROLLMENT_FORM: EnrollmentFormState = {
  employeeId: null,
  deviceId: null,
  enrollPin: '',
}

/** The page sizes the original pager offered. */
const PAGE_SIZES = ['15', '30', '50']

/**
 * notify(msg, type, ms) → Mantine notifications, adapted once so every call site below
 * stays byte-identical to the original.
 */
/**
 * 'warning' is amber rather than red on purpose, and it exists for exactly one case: a machine
 * that ANSWERED but whose clock is wrong. That is not a failure — it is worse, because everything
 * keeps working and the times are quietly wrong — so it must not look like either success or an
 * error the user can dismiss as "the machine is off again".
 */
function notify(message: string, type: 'success' | 'error' | 'warning', ms: number) {
  notifications.show({
    message,
    color: type === 'success' ? 'green' : type === 'warning' ? 'yellow' : 'red',
    autoClose: ms,
  })
}

/** What to call a terminal in a message: its label if it has one, else the serial. */
function labelOf(device: Device): string {
  return device.name && device.name.trim().length > 0 ? device.name : device.serialNumber
}

/**
 * DevExtreme's `confirm(message, title)` dialog, rebuilt as a promise-backed Mantine Modal
 * so both call sites keep their original `const proceed = await …; if (!proceed) return`
 * shape. Closing the dialog any other way answers "no".
 */
interface ConfirmState {
  title: string
  message: ReactNode
  resolve: (proceed: boolean) => void
}

/** The two words the Active cell can show — also the closed set its filter dropdown offers. */
const ACTIVE_LABELS = ['Active', 'Inactive']
const activeText = (isActive: boolean) => (isActive ? 'Active' : 'Inactive')

function ActiveCell({ isActive }: { isActive: boolean }) {
  return (
    <span className={isActive ? 'badge badge--on' : 'badge badge--off'}>
      {activeText(isActive)}
    </span>
  )
}

/** What {@link LastSyncCell} prints — shared so the filter matches the words, dead device included. */
const lastSyncText = (value: string | null) =>
  value ? `${formatDate(value)} ${formatTime(value)}` : 'Never synced'

/**
 * A terminal that has quietly stopped talking still looks fine on the wall — nobody
 * notices until the month is short of punches. The last sync time is the only place that
 * failure is visible, so a device that has never synced says so in words rather than
 * showing an empty cell that reads like "nothing to see here".
 */
function LastSyncCell({ value }: { value: string | null }) {
  if (!value) {
    return <span className="badge badge--muted">Never synced</span>
  }
  return <span>{lastSyncText(value)}</span>
}

/* PORT NOTE: each DevExtreme grid keeps its SearchPanel as the global search box and its
   FilterRow as the per-column strip; Sorting mode="multiple" and the 15/30/50 pager carry over. */

/** What the Last punch cell prints — a terminal that has recorded nothing says so in words. */
const lastPunchText = (value: string | null) =>
  value ? `${formatDate(value)} ${formatTime(value)}` : 'No punches yet'

const deviceColumnHelper = createColumnHelper<Device>()

/** The pixel widths the original grid pinned; unlisted columns auto-size, as columnAutoWidth did. */
const DEVICE_WIDTHS: Record<string, number | undefined> = {
  isActive: 110,
  lastSyncUtc: 190,
  lastPunchUtc: 190,
  pullEnabled: 90,
  lastPullUtc: 200,
  actions: 320,
}

/** The two words the Pull cell can show — also the closed set its filter dropdown offers. */
const PULL_LABELS = ['On', 'Off']
const pullText = (pullEnabled: boolean) => (pullEnabled ? 'On' : 'Off')

/** What the Last pull cell prints for filtering — the same words LastPullCell shows. */
const lastPullText = (_value: string | null, device: Device) => {
  if (!device.pullEnabled && !device.lastPullUtc) return 'Not pulled'
  if (!device.lastPullUtc) return 'Never pulled'
  return `${formatDate(device.lastPullUtc)} ${formatTime(device.lastPullUtc)}`
}

function DevicesGrid({
  devices,
  canManage,
  onEdit,
  onTest,
  onPull,
  onClearLog,
  testingDeviceId,
  pullingDeviceId,
}: {
  devices: Device[]
  canManage: boolean
  onEdit: (device: Device) => void
  onTest: (device: Device) => void
  onPull: (device: Device) => void
  onClearLog: (device: Device) => void
  testingDeviceId: number | null
  pullingDeviceId: number | null
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      deviceColumnHelper.accessor('name', {
        header: 'Name',
        // "Unnamed" is a word the user can see, so it is a word they can filter by.
        meta: { filterText: (v) => v || 'Unnamed' },
        cell: (info) => {
          const device = info.row.original
          // An unnamed terminal is normal, not broken — say so quietly rather
          // than leaving a blank cell that reads like a failed load.
          return device.name ? (
            <span>{device.name}</span>
          ) : (
            <span className="badge badge--muted">Unnamed</span>
          )
        },
      }),
      deviceColumnHelper.accessor('serialNumber', { header: 'Serial' }),
      deviceColumnHelper.accessor('branchName', { header: 'Branch' }),
      deviceColumnHelper.accessor('departmentName', { header: 'Department' }),
      deviceColumnHelper.accessor('isActive', {
        header: 'Active',
        cell: (info) => <ActiveCell isActive={info.row.original.isActive} />,
        meta: { filterText: activeText, filterOptions: ACTIVE_LABELS },
      }),
      deviceColumnHelper.accessor('lastSyncUtc', {
        header: () => (
          <span title="A terminal that has quietly died does not announce it — it simply stops sending. A last sync that is days old, on a branch that is open, is how you notice before the month is short of punches.">
            Last sync
          </span>
        ),
        cell: (info) => <LastSyncCell value={info.row.original.lastSyncUtc} />,
        meta: { filterText: lastSyncText },
      }),
      // Bound to lastPunchUtc, NOT lastPushUtc. The push heartbeat only moves when a machine
      // delivers punches itself, so on a PULLED terminal it is null forever and this column read
      // "No punches yet" while punches arrived every five minutes.
      deviceColumnHelper.accessor('lastPunchUtc', {
        header: () => (
          <span title="The newest punch we hold from this machine, however it reached us — polled, pushed, or imported from a spreadsheet. 'Last sync' can look perfectly healthy while the fingerprint sensor is dead; this column is the one that answers 'is it still recording anyone'.">
            Last punch
          </span>
        ),
        meta: { filterText: lastPunchText },
        cell: (info) => {
          const device = info.row.original
          return device.lastPunchUtc ? (
            <span>{lastPunchText(device.lastPunchUtc)}</span>
          ) : (
            <span className="badge badge--muted">No punches yet</span>
          )
        },
      }),
      deviceColumnHelper.accessor('pullEnabled', {
        header: () => (
          <span title="Whether the server CALLS this machine on a timer and reads its log, rather than waiting for the machine to push. A terminal whose firmware has no cloud-server menu can only be read this way.">
            Pull
          </span>
        ),
        meta: { filterText: pullText, filterOptions: PULL_LABELS },
        cell: (info) => {
          const device = info.row.original
          return (
            <span
              className={device.pullEnabled ? 'badge badge--on' : 'badge badge--muted'}
              title={device.pullIp ?? 'No address configured'}
            >
              {pullText(device.pullEnabled)}
            </span>
          )
        },
      }),
      deviceColumnHelper.accessor('lastPullUtc', {
        header: () => (
          <span title="When the server last CALLED this machine, and whether it answered. A pulled machine that has dropped off the network cannot tell you itself — this column is the only place that failure shows.">
            Last pull
          </span>
        ),
        meta: { filterText: lastPullText },
        cell: (info) => <LastPullCell device={info.row.original} />,
      }),
      ...(canManage
        ? [
            deviceColumnHelper.display({
              id: 'actions',
              header: 'Actions',
              cell: (info) => {
                const device = info.row.original
                const busy =
                  testingDeviceId === device.deviceId || pullingDeviceId === device.deviceId
                // A machine with no address cannot be called at all, and a button that fails
                // every time teaches people to ignore the ones that work.
                const noAddress = !device.pullIp
                return (
                  <div className="grid-actions">
                    <Button
                      variant="subtle"
                      size="compact-sm"
                      onClick={() => onEdit(device)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="subtle"
                      size="compact-sm"
                      disabled={busy || noAddress}
                      title={
                        noAddress
                          ? 'This machine has no address. Add its IP under Edit → Connection.'
                          : `Connect to ${device.pullIp} and read its clock. Reads no punches.`
                      }
                      onClick={() => onTest(device)}
                    >
                      {testingDeviceId === device.deviceId ? 'Testing…' : 'Test'}
                    </Button>
                    <Button
                      variant="subtle"
                      size="compact-sm"
                      disabled={busy || noAddress}
                      title={
                        noAddress
                          ? 'This machine has no address. Add its IP under Edit → Connection.'
                          : 'Read this machine now instead of waiting for the timer. Nothing is duplicated.'
                      }
                      onClick={() => onPull(device)}
                    >
                      {pullingDeviceId === device.deviceId ? 'Pulling…' : 'Pull now'}
                    </Button>
                    {/* Only for a machine we can actually reach — there is nothing to clear on a
                        terminal that pushes to us, and the command would have nowhere to go. */}
                    {device.pullIp && (
                      <Button
                        variant="subtle"
                        color="red"
                        size="compact-sm"
                        disabled={busy}
                        title="Pull anything still on the machine, then erase the machine's own punch log. Fingerprints are not touched."
                        onClick={() => onClearLog(device)}
                      >
                        Clear machine log
                      </Button>
                    )}
                    {/* NO "Issue key" HERE. The device API key authenticates a terminal that
                        PUSHES to /api — a path this deployment does not use, since the server
                        calls the machines itself. The endpoint and its service call are kept
                        (devicesService.issueApiKey), so re-exposing it is one button; what is
                        gone is a control that hands out a credential nothing consumes. */}
                  </div>
                )
              },
            }),
          ]
        : []),
    ],
    [
      canManage,
      onEdit,
      onTest,
      onPull,
      onClearLog,
      testingDeviceId,
      pullingDeviceId,
    ],
  )

  const table = useReactTable({
    data: devices,
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
    getRowId: (device) => String(device.deviceId),
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
                    width: DEVICE_WIDTHS[header.column.id],
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
                  No device matches the filter. Clear it to see the rest.
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

const enrollmentColumnHelper = createColumnHelper<EmployeeDevice>()

const ENROLLMENT_WIDTHS: Record<string, number | undefined> = {
  enrollPin: 120,
  actions: 120,
}

function EnrollmentsGrid({
  enrollments,
  canManage,
  onRemove,
}: {
  enrollments: EmployeeDevice[]
  canManage: boolean
  onRemove: (enrollment: EmployeeDevice) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      enrollmentColumnHelper.accessor('fullName', { header: 'Employee' }),
      enrollmentColumnHelper.accessor('serialNumber', { header: 'Device' }),
      enrollmentColumnHelper.accessor('branchName', { header: 'Branch' }),
      enrollmentColumnHelper.accessor('enrollPin', {
        header: () => (
          <span title="The PIN exactly as the device stores it. Leading zeros are part of it: '0042' and '42' are different PINs.">
            PIN
          </span>
        ),
      }),
      ...(canManage
        ? [
            enrollmentColumnHelper.display({
              id: 'actions',
              header: 'Actions',
              cell: (info) => {
                const enrollment = info.row.original
                return (
                  <div className="grid-actions">
                    <Button
                      variant="subtle"
                      color="red"
                      size="compact-sm"
                      onClick={() => onRemove(enrollment)}
                    >
                      Remove
                    </Button>
                  </div>
                )
              },
            }),
          ]
        : []),
    ],
    [canManage, onRemove],
  )

  const table = useReactTable({
    data: enrollments,
    columns,
    state: { sorting, globalFilter, columnFilters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    // The one shared filter function: the funnel's ticked values AND the filter row's text,
    // both tested against the same displayed string. Per-column formatting lives in meta.filterText.
    // A PIN's leading zeros are part of it, so matching on the printed text is also the only
    // correct match here.
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 15 } },
    getRowId: (enrollment) => String(enrollment.employeeDeviceId),
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
                    width: ENROLLMENT_WIDTHS[header.column.id],
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
                  No enrollment matches the filter. Clear it to see the rest.
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

export default function DevicesPage() {
  const { hasPermission } = useAuth()
  // DEVICE_MANAGE covers adding terminals, enrolling PINs and issuing keys — all three
  // decide whose punches count, so they are gated together and hidden when absent.
  const canManageDevices = hasPermission(PERMISSIONS.devices)

  const [devices, setDevices] = useState<Device[]>([])
  const [enrollments, setEnrollments] = useState<EmployeeDevice[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [employees, setEmployees] = useState<EmployeeListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshingDevices, setRefreshingDevices] = useState(false)
  const [refreshingEnrollments, setRefreshingEnrollments] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Why a lookup the FORMS depend on could not be loaded (employees, branches).
   *
   * Kept apart from `error`, which is about the grids. A lookup failure leaves the page perfectly
   * readable but makes the forms unfillable, and the user has to be told which of those it is —
   * otherwise they open "Add enrollment", find an empty employee list, and have no idea why.
   */
  const [lookupError, setLookupError] = useState<string | null>(null)

  const [devicePopupVisible, setDevicePopupVisible] = useState(false)
  const [deviceForm, setDeviceForm] = useState<DeviceFormState>(EMPTY_DEVICE_FORM)
  const [savingDevice, setSavingDevice] = useState(false)
  /* Per-device rather than a single boolean: with one flag, testing one machine would grey out
     the buttons on every row, which reads as the whole page having locked up. */
  const [testingDeviceId, setTestingDeviceId] = useState<number | null>(null)
  const [pullingDeviceId, setPullingDeviceId] = useState<number | null>(null)
  /* The machine whose log is about to be erased, or null. Holding the DEVICE rather than an id
     keeps the dialog's serial check reading from the same object the request will name. */
  const [clearLogFor, setClearLogFor] = useState<Device | null>(null)
  const [clearConfirmText, setClearConfirmText] = useState('')
  const [clearing, setClearing] = useState(false)
  /** The RequiredRules' replacement: the first missing field's message, shown in the dialog. */
  const [deviceFormError, setDeviceFormError] = useState<string | null>(null)

  const [enrollmentPopupVisible, setEnrollmentPopupVisible] = useState(false)
  const [enrollmentForm, setEnrollmentForm] = useState<EnrollmentFormState>(
    EMPTY_ENROLLMENT_FORM,
  )
  const [savingEnrollment, setSavingEnrollment] = useState(false)
  const [enrollmentFormError, setEnrollmentFormError] = useState<string | null>(null)

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

  /**
   * The two sections are independent resources, so each reloads on its own. Refreshing the
   * enrollment list after mapping a PIN should not blank the device grid the user is reading.
   */
  const loadDevices = useCallback(async () => {
    setRefreshingDevices(true)
    try {
      setDevices(await devicesService.getAll())
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setRefreshingDevices(false)
      setLoading(false)
    }
  }, [])

  const loadEnrollments = useCallback(async () => {
    setRefreshingEnrollments(true)
    try {
      setEnrollments(await devicesService.getEnrollments())
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setRefreshingEnrollments(false)
      setLoading(false)
    }
  }, [])

  /**
   * Mapping a PIN changes BOTH lists: the enrollment appears, and the device it belongs to may
   * now be resolving punches it previously could not. So a mapping reloads the pair.
   */
  const load = useCallback(async () => {
    await Promise.all([loadDevices(), loadEnrollments()])
  }, [loadDevices, loadEnrollments])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      // The lookups only feed the two forms, so a lookup failure must not blank the page — the
      // grids are still worth reading. But the failure is RECORDED, not swallowed: a form that
      // opens with an empty dropdown and no explanation is worse than one that says it is broken.
      const [
        deviceResult,
        enrollmentResult,
        branchResult,
        departmentResult,
        employeeResult,
      ] = await Promise.allSettled([
        devicesService.getAll(),
        devicesService.getEnrollments(),
        branchesService.getAll(),
        departmentsService.getAll(),
        employeesService.getAll(),
      ])

      if (cancelled) return

      if (deviceResult.status === 'fulfilled') setDevices(deviceResult.value)
      if (enrollmentResult.status === 'fulfilled')
        setEnrollments(enrollmentResult.value)

      if (deviceResult.status === 'rejected') {
        setError(getErrorMessage(deviceResult.reason))
      } else if (enrollmentResult.status === 'rejected') {
        setError(getErrorMessage(enrollmentResult.reason))
      } else {
        setError(null)
      }

      setBranches(branchResult.status === 'fulfilled' ? branchResult.value : [])
      setDepartments(
        departmentResult.status === 'fulfilled' ? departmentResult.value : [],
      )
      setEmployees(
        employeeResult.status === 'fulfilled' ? employeeResult.value : [],
      )

      // The enrollment form is useless without employees, and the device form without branches.
      // Say which one is missing, and why, rather than presenting an empty dropdown.
      const failed = [
        employeeResult.status === 'rejected'
          ? getErrorMessage(employeeResult.reason)
          : null,
        branchResult.status === 'rejected'
          ? getErrorMessage(branchResult.reason)
          : null,
      ].filter(Boolean)

      setLookupError(failed.length > 0 ? (failed[0] as string) : null)
      setLoading(false)
    }
    void initialLoad()
    return () => {
      cancelled = true
    }
  }, [])


  function openCreateDevice() {
    setDeviceForm(EMPTY_DEVICE_FORM)
    setDeviceFormError(null)
    setDevicePopupVisible(true)
  }

  function openEditDevice(device: Device) {
    setDeviceForm({
      deviceId: device.deviceId,
      serialNumber: device.serialNumber,
      name: device.name ?? '',
      branchId: device.branchId,
      departmentId: device.departmentId,
      isActive: device.isActive,
      pullIp: device.pullIp ?? '',
      // `|| default` rather than `??`: a device saved before these columns existed reads back 0,
      // which is not a port anybody can connect to and would look deliberate in the box.
      pullPort: device.pullPort || DEVICE_PULL_DEFAULTS.port,
      pullCommKey: device.pullCommKey ?? DEVICE_PULL_DEFAULTS.commKey,
      pullEnabled: device.pullEnabled,
    })
    setDeviceFormError(null)
    setDevicePopupVisible(true)
  }

  async function submitDevice() {
    // The RequiredRules' work, done by hand now the Validators are gone: name the first
    // missing field with the same message the rule showed.
    const serial = deviceForm.serialNumber.trim()
    if (!serial) {
      setDeviceFormError('The serial number is required')
      return
    }
    // The guard doubles for the request types, which do not allow null.
    if (deviceForm.branchId == null) {
      setDeviceFormError('The branch is required')
      return
    }
    // Switching pulling on without an address would save a machine the worker can never call,
    // and the only symptom would be a poll that quietly never happens. Checked here because it is
    // conditional — the field is required only when that switch is on.
    const address = deviceForm.pullIp.trim()
    if (deviceForm.pullEnabled && address.length === 0) {
      setDeviceFormError(
        'Pulling is switched on for this machine, but it has no address. Enter its IP — the server has to know where to call.',
      )
      return
    }
    setDeviceFormError(null)
    setSavingDevice(true)
    try {
      const label = trimmedOrNull(deviceForm.name)
      const connection = {
        pullIp: address.length > 0 ? address : null,
        pullPort: deviceForm.pullPort || DEVICE_PULL_DEFAULTS.port,
        pullCommKey: deviceForm.pullCommKey ?? DEVICE_PULL_DEFAULTS.commKey,
        pullEnabled: deviceForm.pullEnabled,
      }
      if (deviceForm.deviceId == null) {
        await devicesService.create({
          serialNumber: serial,
          name: label,
          branchId: deviceForm.branchId,
          departmentId: deviceForm.departmentId,
          ...connection,
        })
        notify(
          `Device ${serial} registered. It can push over the cloud-server (iclock) path now; the /api punch endpoint additionally needs a key.`,
          'success',
          4000,
        )
      } else {
        await devicesService.update(deviceForm.deviceId, {
          serialNumber: serial,
          name: label,
          branchId: deviceForm.branchId,
          departmentId: deviceForm.departmentId,
          isActive: deviceForm.isActive,
          ...connection,
        })
        notify(`Device ${serial} updated.`, 'success', 2500)
      }
      setDevicePopupVisible(false)
      await load()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setSavingDevice(false)
    }
  }

  /**
   * Reachability, and the machine's own clock.
   *
   * The CLOCK is the half nobody expects to need. Punches are stored exactly as the terminal
   * stamps them — no conversion, on any ingestion path — so a machine running forty minutes
   * fast writes forty minutes onto everyone's day and every downstream number agrees with it.
   */
  async function testConnection(device: Device) {
    setTestingDeviceId(device.deviceId)
    try {
      const result = await devicesService.testConnection(device.deviceId)
      if (result.ok && result.deviceTime) {
        const drift = Math.round(
          Math.abs(Date.now() - new Date(result.deviceTime).getTime()) / 60000,
        )
        const clock = `${formatDate(result.deviceTime)} ${formatTime(result.deviceTime)}`
        notify(
          drift >= 2
            ? `${labelOf(device)} answered. Its clock reads ${clock} — about ${drift} minute(s) off this computer. Punches are stored at the machine's own time, so fix it on the terminal (Setting → Date/Time).`
            : `${labelOf(device)} answered. Machine time: ${clock}.`,
          drift >= 2 ? 'warning' : 'success',
          drift >= 2 ? 8000 : 4000,
        )
      } else {
        notify(
          result.error ??
            `${labelOf(device)} did not answer, and gave no reason. Check the address and that the machine is on the same network.`,
          'error',
          6000,
        )
      }
      // The attempt itself is recorded on the device row, so the grid's Last pull is now stale.
      await load()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setTestingDeviceId(null)
    }
  }

  /**
   * One pull, now. Nothing is destructive — the machine's own buffer is never cleared and the
   * dedup hash discards anything already held — so this is safe to press repeatedly.
   */
  async function pullNow(device: Device) {
    setPullingDeviceId(device.deviceId)
    try {
      const result = await devicesService.pullNow(device.deviceId)

      if (result.error) {
        notify(result.error, 'error', 6000)
      } else if (result.inserted === 0) {
        // Not a failure, and the wording has to say so: from the second pull onwards almost
        // everything on the machine is something we already have.
        notify(
          `${labelOf(device)}: nothing new. ${result.received} punch(es) read, all already recorded.`,
          'success',
          4000,
        )
      } else {
        const parts = [`${result.inserted} new punch(es)`]
        if (result.duplicates > 0) parts.push(`${result.duplicates} already recorded`)
        if (result.unresolvedPins > 0)
          parts.push(
            `${result.unresolvedPins} on PIN(s) nobody is enrolled on — see Unresolved PINs`,
          )
        notify(`${labelOf(device)}: ${parts.join(', ')}.`, 'success', 6000)
      }

      await load()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setPullingDeviceId(null)
    }
  }

  /**
   * Rescue-then-erase, confirmed.
   *
   * The server refuses the erase unless everything on the machine landed, so a `cleared: false`
   * answer is the safety net working, NOT a failed request — it gets the red notification and the
   * dialog stays open, because the machine still holds those punches and the user has a decision
   * to make about them.
   */
  async function confirmClearLog() {
    const device = clearLogFor
    if (!device) return

    setClearing(true)
    try {
      const result = await devicesService.clearMachineLog(device.deviceId, clearConfirmText.trim())

      if (!result.cleared) {
        notify(result.error ?? 'The machine log was not cleared.', 'error', 8000)
        return
      }

      const pulled = result.pulledBeforeClear
      notify(
        `Machine log cleared — pulled ${pulled.received} first (${pulled.inserted} new, ${pulled.duplicates} already stored)`,
        'success',
        6000,
      )
      setClearLogFor(null)
      await load()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 6000)
    } finally {
      setClearing(false)
    }
  }

  /* ISSUING A DEVICE API KEY IS NO LONGER OFFERED FROM THIS PAGE.
     The key authenticates a terminal POSTING to /api/punches — the push path. This deployment
     pulls: the server opens a TCP connection to each machine and reads its log, which is
     authenticated by the device's comm key, not by an API key. So the button handed out a
     credential nothing would ever present, and issuing one silently revoked the previous key.
     `devicesService.issueApiKey` and the DeviceApiKeyResult type are deliberately KEPT, so a
     site that switches to pushing needs a button and no new plumbing. */

  function openCreateEnrollment() {
    setEnrollmentForm(EMPTY_ENROLLMENT_FORM)
    setEnrollmentFormError(null)
    setEnrollmentPopupVisible(true)
  }

  async function submitEnrollment() {
    // Same hand-rolled RequiredRules as the device form, same messages.
    const pin = enrollmentForm.enrollPin.trim()
    if (enrollmentForm.employeeId == null) {
      setEnrollmentFormError('The employee is required')
      return
    }
    if (enrollmentForm.deviceId == null) {
      setEnrollmentFormError('The device is required')
      return
    }
    if (!pin) {
      setEnrollmentFormError('The PIN is required')
      return
    }
    setEnrollmentFormError(null)
    setSavingEnrollment(true)
    try {
      const mapResult = await devicesService.mapEnrollment({
        employeeId: enrollmentForm.employeeId,
        deviceId: enrollmentForm.deviceId,
        enrollPin: pin,
      })
      const employee = employees.find(
        (e) => e.employeeId === enrollmentForm.employeeId,
      )
      const device = devices.find((d) => d.deviceId === enrollmentForm.deviceId)
      const who = employee ? employee.fullName : 'The employee'
      const where = device ? device.serialNumber : 'the device'
      // Mapping a PIN is retroactive: punches that arrived before anyone was enrolled on
      // it were parked, not discarded. Saying how many were claimed is how the user sees
      // that the fix actually recovered somebody's hours.
      notify(
        mapResult.orphanPunchesResolved > 0
          ? `${who} enrolled on ${where} as PIN ${pin}. ${mapResult.orphanPunchesResolved} punch(es) that were waiting have now been claimed.`
          : `${who} enrolled on ${where} as PIN ${pin}. No punches were waiting on that PIN.`,
        'success',
        4000,
      )
      setEnrollmentPopupVisible(false)
      await load()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    } finally {
      setSavingEnrollment(false)
    }
  }

  async function removeEnrollment(enrollment: EmployeeDevice) {
    const proceed = await askConfirm(
      <>
        Remove {enrollment.fullName} from {enrollment.serialNumber}?
        <br />
        <br />
        Punches already attributed to them keep their employee — nothing that has been
        recorded changes. This only stops FUTURE punches on PIN {enrollment.enrollPin}{' '}
        from being matched to anyone; they will be parked as unresolved until the PIN is
        mapped again.
      </>,
      'Remove enrollment',
    )
    if (!proceed) return

    try {
      await devicesService.unmapEnrollment(enrollment.employeeDeviceId)
      notify(
        `${enrollment.fullName} is no longer enrolled on ${enrollment.serialNumber}.`,
        'success',
        2500,
      )
      await load()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Devices &amp; Enrollment</h1>
          <p className="page-subtitle">
            The terminals that record punches, and who each PIN belongs to.
          </p>
        </div>
        {/* No page-level actions: this page is TWO independent things, and each one owns its
            own refresh and its own primary action on its own card. A single refresh up here
            read as belonging to neither. */}
      </div>

      <PageHelp>
        A device is a source of truth about pay: every punch names the terminal that
        recorded it, and every terminal needs a key before it can send anything. A PIN
        below only means something on the device it was enrolled on, so a device with no
        enrollments records punches that belong to nobody.
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
        <>
          <div className="card">
            <div className="tab-toolbar">
              <div className="card-title">Devices</div>
              <div className="page-head-actions">
                <ActionIcon
                  variant="default"
                  size="lg"
                  title="Refresh devices"
                  aria-label="Refresh devices"
                  onClick={() => void loadDevices()}
                  disabled={refreshingDevices}
                >
                  <IconRefresh size={16} />
                </ActionIcon>
                {canManageDevices && (
                  <Button
                    leftSection={<IconPlus size={16} />}
                    onClick={openCreateDevice}
                  >
                    New device
                  </Button>
                )}
              </div>
            </div>
            <p className="hint">
              A fingerprint terminal has no user and no password. The server reaches each
              machine at its own address and reads the log itself, so a terminal is known by
              its serial number and its connection — register it here, then give it an address
              under Edit → Connection.
            </p>

            {devices.length === 0 ? (
              <div className="empty-hint">
                <div className="empty-hint-main">No terminals are registered.</div>
                {canManageDevices
                  ? 'No punches can arrive until a terminal is registered here. Add the device, then give it an address under Edit → Connection so the server can read it.'
                  : 'Nothing can send a punch until its serial number is registered here. Until somebody with device rights registers a terminal, no punches can arrive at all.'}
              </div>
            ) : (
              <DevicesGrid
                devices={devices}
                canManage={canManageDevices}
                onEdit={openEditDevice}
                onTest={(device) => void testConnection(device)}
                onPull={(device) => void pullNow(device)}
                onClearLog={(device) => {
                  // The confirmation always starts empty, even on a second visit to the same
                  // machine — a pre-filled serial is not a confirmation of anything.
                  setClearConfirmText('')
                  setClearLogFor(device)
                }}
                testingDeviceId={testingDeviceId}
                pullingDeviceId={pullingDeviceId}
              />
            )}
          </div>

          <div className="card">
            <div className="tab-toolbar">
              <div className="card-title">Enrollment</div>
              <div className="page-head-actions">
                <ActionIcon
                  variant="default"
                  size="lg"
                  title="Refresh enrollments"
                  aria-label="Refresh enrollments"
                  onClick={() => void loadEnrollments()}
                  disabled={refreshingEnrollments}
                >
                  <IconRefresh size={16} />
                </ActionIcon>
                {canManageDevices && (
                  <Button
                    leftSection={<IconPlus size={16} />}
                    onClick={openCreateEnrollment}
                  >
                    Add enrollment
                  </Button>
                )}
              </div>
            </div>
            <p className="hint">
              A PIN is only unique within one device. An employee who punches at two
              branches needs one row per device.
            </p>

            {enrollments.length === 0 ? (
              <div className="empty-hint">
                <div className="empty-hint-main">Nobody is enrolled on any device.</div>
                {canManageDevices
                  ? 'Punches will still be recorded, but they will belong to nobody and will sit on the Unresolved PINs page until you map them. Add an enrollment for each person on each device they punch at.'
                  : 'Punches will still be recorded, but they will belong to nobody and will sit on the Unresolved PINs page until somebody with device rights maps them.'}
              </div>
            ) : (
              <EnrollmentsGrid
                enrollments={enrollments}
                canManage={canManageDevices}
                onRemove={(enrollment) => void removeEnrollment(enrollment)}
              />
            )}
          </div>
        </>
      )}

      {/* Erasing a terminal's log cannot be undone and the machine keeps no copy, so the gate is
          the DangerZone's: type the thing's name, and the red button stays dead until it matches.
          A dialog somebody can dismiss with one careless Enter is not a gate. */}
      <Modal
        opened={clearLogFor != null}
        onClose={() => {
          if (!clearing) setClearLogFor(null)
        }}
        title="Clear machine log"
        size={520}
        centered
      >
        {clearLogFor && (
          <>
            <p className="danger-zone-text">
              This pulls any punches still stored on the machine into the system first, then ERASES
              the machine&apos;s own punch log. Enrolled users and fingerprints on the machine are
              not touched. Punches already in the system are unaffected.
            </p>
            <p className="hint">
              If anything on the machine cannot be read, the erase is refused and nothing is
              deleted.
            </p>

            <div className="form-field">
              <label className="form-label" htmlFor="clear-confirm-serial">
                Type the machine&apos;s serial to confirm
              </label>
              <TextInput
                id="clear-confirm-serial"
                value={clearConfirmText}
                onChange={(e) => {
                  const value = e.currentTarget.value
                  setClearConfirmText(value)
                }}
                placeholder={clearLogFor.serialNumber}
                disabled={clearing}
                autoComplete="off"
              />
              <p className="hint">
                {clearLogFor.name ? `${clearLogFor.name} — ` : ''}
                {clearLogFor.serialNumber} at {clearLogFor.pullIp}:{clearLogFor.pullPort}
              </p>
            </div>

            <div className="form-actions">
              <Button
                variant="default"
                onClick={() => setClearLogFor(null)}
                disabled={clearing}
              >
                Cancel
              </Button>
              <Button
                color="red"
                // Trimmed, exact, case-sensitive — the same comparison the server makes.
                disabled={clearing || clearConfirmText.trim() !== clearLogFor.serialNumber}
                onClick={() => void confirmClearLog()}
              >
                {clearing ? 'Clearing…' : 'Pull, then clear the machine'}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        opened={devicePopupVisible}
        onClose={() => setDevicePopupVisible(false)}
        title={deviceForm.deviceId == null ? 'New Device' : 'Edit Device'}
        size={480}
        centered
      >
        <div className="form-field">
          <label className="form-label" htmlFor="device-serial">
            Serial number
          </label>
          <TextInput
            id="device-serial"
            value={deviceForm.serialNumber}
            onChange={(e) => {
              const value = e.currentTarget.value
              setDeviceForm((f) => ({ ...f, serialNumber: value }))
            }}
            disabled={savingDevice}
          />
          <p className="hint">
            This is the name the terminal sends with every punch. It must match the
            device exactly, or its punches cannot be stored at all. It is printed on the
            back of the machine, and shown under Menu → System Info.
          </p>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="device-name">
            Name (optional)
          </label>
          <TextInput
            id="device-name"
            value={deviceForm.name}
            onChange={(e) => {
              const value = e.currentTarget.value
              setDeviceForm((f) => ({ ...f, name: value }))
            }}
            placeholder="e.g. Verdun front door"
            disabled={savingDevice}
          />
          <p className="hint">
            What to call this machine in a sentence. A serial identifies the hardware to
            the system and nothing at all to a person trying to work out which terminal,
            in which room, has stopped reporting.
          </p>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="device-branch">
            Branch
          </label>
          <Select
            id="device-branch"
            /* A device is POSTED to a branch, so the active-only rule applies here as it does on
               the employee form — with the branch an existing device already sits at kept, or
               editing that device's name would silently blank where it is. */
            data={branchOptions(branches, deviceForm.branchId)}
            value={deviceForm.branchId != null ? String(deviceForm.branchId) : null}
            onChange={(v) =>
              setDeviceForm((f) => ({
                ...f,
                branchId: v != null ? Number(v) : null,
              }))
            }
            placeholder="Select a branch…"
            searchable
            disabled={savingDevice}
          />
          <p className="hint">
            The branch a punch was made at comes from the device, which is how somebody
            who works two shops is counted at the right one.
          </p>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="device-department">
            Department (optional)
          </label>
          <Select
            id="device-department"
            data={departmentOptions(departments, deviceForm.departmentId)}
            value={deviceForm.departmentId != null ? String(deviceForm.departmentId) : null}
            onChange={(v) =>
              setDeviceForm((f) => ({
                ...f,
                departmentId: v != null ? Number(v) : null,
              }))
            }
            placeholder="No department"
            searchable
            clearable
            disabled={savingDevice}
          />
        </div>

        {deviceForm.deviceId != null && (
          <div className="form-field">
            <Checkbox
              checked={deviceForm.isActive}
              label="Active"
              onChange={(e) => {
                const checked = e.currentTarget.checked
                setDeviceForm((f) => ({ ...f, isActive: checked }))
              }}
              disabled={savingDevice}
            />
            <p className="hint">
              Deactivating stops the terminal being used, but nothing it already
              recorded is removed. Past punches stay exactly as they are.
            </p>
          </div>
        )}

        {/* CONNECTION — only for the pull direction. Everything above describes what the
            machine IS; this describes how we REACH it, which is why it is set apart. */}
        <div className="form-section">
          <h3 className="form-section-title">Connection</h3>
          <p className="hint" style={{ marginBottom: 12 }}>
            Leave this alone for a terminal that pushes to us on its own. Fill it in when the
            server has to call the machine instead — which is the only option on firmware with
            no cloud-server menu.
          </p>

          <div className="form-field">
            <label className="form-label" htmlFor="device-pull-ip">
              Machine IP
            </label>
            <TextInput
              id="device-pull-ip"
              value={deviceForm.pullIp}
              onChange={(e) => {
                const value = e.currentTarget.value
                setDeviceForm((f) => ({ ...f, pullIp: value }))
              }}
              placeholder="192.168.45.12"
              disabled={savingDevice}
            />
            <p className="hint">
              The address the machine answers on, from its own network menu. The server has to
              be able to reach it — a terminal on a different subnet, or behind a router, will
              not answer.
            </p>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="device-pull-port">
              Port
            </label>
            {/* Mantine hands back a string while typing and '' for a cleared box; neither may
                reach the request as NaN, so anything non-numeric falls back to the default. */}
            <NumberInput
              id="device-pull-port"
              value={deviceForm.pullPort}
              onChange={(value) =>
                setDeviceForm((f) => ({
                  ...f,
                  pullPort:
                    typeof value === 'number'
                      ? value
                      : Number(value) || DEVICE_PULL_DEFAULTS.port,
                }))
              }
              min={1}
              max={65535}
              step={1}
              allowDecimal={false}
              w={180}
              disabled={savingDevice}
            />
            <p className="hint">
              {DEVICE_PULL_DEFAULTS.port} on every unit anyone ships. Change it only if the
              machine's own menu says otherwise.
            </p>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="device-pull-commkey">
              Comm key
            </label>
            <NumberInput
              id="device-pull-commkey"
              value={deviceForm.pullCommKey}
              onChange={(value) =>
                setDeviceForm((f) => ({
                  ...f,
                  pullCommKey:
                    typeof value === 'number'
                      ? value
                      : Number(value) || DEVICE_PULL_DEFAULTS.commKey,
                }))
              }
              min={0}
              step={1}
              allowDecimal={false}
              w={180}
              disabled={savingDevice}
            />
            <p className="hint">
              The machine's own device password for this connection — {DEVICE_PULL_DEFAULTS.commKey} means
              none, which is how these terminals leave the factory. It is not a key we issue;
              it is one the machine already has, and we have to present it to be let in.
            </p>
          </div>

          <div className="form-field">
            <Switch
              checked={deviceForm.pullEnabled}
              label="Pull punches from this machine"
              onChange={(e) => {
                const checked = e.currentTarget.checked
                setDeviceForm((f) => ({ ...f, pullEnabled: checked }))
              }}
              disabled={savingDevice}
            />
            <p className="hint" style={{ marginTop: 6 }}>
              {deviceForm.pullEnabled
                ? 'The server will call this machine on the schedule set under Settings → Attendance machines.'
                : 'Off — the server never calls this machine. You can still use Test and Pull now by hand.'}
            </p>
          </div>
        </div>

        {deviceFormError && (
          <div className="alert alert--error" role="alert">
            {deviceFormError}
          </div>
        )}

        <div className="form-actions">
          <Button
            variant="default"
            onClick={() => setDevicePopupVisible(false)}
            disabled={savingDevice}
          >
            Cancel
          </Button>
          <Button onClick={() => void submitDevice()} disabled={savingDevice}>
            {savingDevice
              ? 'Saving…'
              : deviceForm.deviceId == null
                ? 'Add Device'
                : 'Save Changes'}
          </Button>
        </div>
      </Modal>

      <Modal
        opened={enrollmentPopupVisible}
        onClose={() => setEnrollmentPopupVisible(false)}
        title="Add Enrollment"
        size={480}
        centered
      >
        {/* An unfillable form must say why it cannot be filled. An empty dropdown with no
            explanation leaves the user with nothing to act on. */}
        {lookupError && (
          <div className="alert alert--error" role="alert">
            The employee list could not be loaded, so there is nobody to enrol. {lookupError}
          </div>
        )}
        {!lookupError && employees.length === 0 && (
          <div className="alert alert--error" role="alert">
            There are no employees on file. Add the person under HR → Employees first, then
            enrol their PIN here.
          </div>
        )}

        <div className="form-field">
          <label className="form-label" htmlFor="enrollment-employee">
            Employee
          </label>
          <Select
            id="enrollment-employee"
            // Two people can share a name; the branch is what tells them apart.
            data={employees.map((e) => ({
              value: String(e.employeeId),
              label: `${e.fullName} — ${e.branch}`,
            }))}
            value={
              enrollmentForm.employeeId != null ? String(enrollmentForm.employeeId) : null
            }
            onChange={(v) =>
              setEnrollmentForm((f) => ({
                ...f,
                employeeId: v != null ? Number(v) : null,
              }))
            }
            placeholder="Select an employee…"
            searchable
            nothingFoundMessage="No employee matches that name."
            disabled={savingEnrollment || employees.length === 0}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="enrollment-device">
            Device
          </label>
          <Select
            id="enrollment-device"
            data={devices.map((device) => ({
              value: String(device.deviceId),
              label: `${device.serialNumber} — ${device.branchName}`,
            }))}
            value={enrollmentForm.deviceId != null ? String(enrollmentForm.deviceId) : null}
            onChange={(v) =>
              setEnrollmentForm((f) => ({
                ...f,
                deviceId: v != null ? Number(v) : null,
              }))
            }
            placeholder="Select a device…"
            searchable
            disabled={savingEnrollment}
          />
          <p className="hint">
            One row per device. Somebody who covers shifts at two branches punches on
            two terminals and needs an enrollment on each.
          </p>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="enrollment-pin">
            PIN on this device
          </label>
          <TextInput
            id="enrollment-pin"
            value={enrollmentForm.enrollPin}
            onChange={(e) => {
              const value = e.currentTarget.value
              setEnrollmentForm((f) => ({ ...f, enrollPin: value }))
            }}
            disabled={savingEnrollment}
          />
          <p className="hint">
            Leading zeros matter. &apos;0042&apos; and &apos;42&apos; are different PINs
            to the device. Copy it exactly as the terminal shows it, or this person&apos;s
            punches will keep landing on nobody.
          </p>
        </div>

        {enrollmentFormError && (
          <div className="alert alert--error" role="alert">
            {enrollmentFormError}
          </div>
        )}

        <div className="form-actions">
          <Button
            variant="default"
            onClick={() => setEnrollmentPopupVisible(false)}
            disabled={savingEnrollment}
          >
            Cancel
          </Button>
          <Button onClick={() => void submitEnrollment()} disabled={savingEnrollment}>
            {savingEnrollment ? 'Saving…' : 'Add Enrollment'}
          </Button>
        </div>
      </Modal>

      {/* The "Device API key" dialog is gone with the button that opened it — it existed only to
          show a freshly issued key once, and nothing issues one from this page any more. */}

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
