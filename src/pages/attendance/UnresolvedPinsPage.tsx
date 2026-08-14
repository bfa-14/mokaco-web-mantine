import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Group, Loader, Modal, Pagination, Select, Table, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconRefresh, IconSearch } from '@tabler/icons-react'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { importService, devicesService } from '../../services/attendanceService'
import { employeesService } from '../../services/hrService'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { PERMISSIONS } from '../../types/attendance'
import type { RawLog } from '../../types/attendance'
import type { EmployeeListItem } from '../../types/hr'
import {
  formatDate,
  formatTime,
} from './attendanceFormat'

/**
 * One (device, PIN) pair and every punch waiting on it. The user does not think in
 * punches here — they think "who is PIN 9999 on the till device?". One decision claims
 * all of them at once, so the list is grouped rather than showing fourteen identical rows.
 */
interface PinGroup {
  key: string
  deviceId: number
  serialNumber: string
  enrollPin: string
  punchCount: number
  firstSeenUtc: string
  lastSeenUtc: string
}

/** What the last successful mapping recovered, kept so the page can say what happened next. */
interface Recovered {
  employeeName: string
  enrollPin: string
  punchesResolved: number
}

/** A punch stamp needs both parts: the date says WHICH day is missing, the time says whose shift it was. */
function formatStamp(value: string): string {
  return `${formatDate(value)} ${formatTime(value)}`
}

/**
 * A PIN is only unique within one device, so the same '9999' on two terminals is two
 * different unknowns. Grouping on deviceId AND enrollPin is what keeps them apart.
 */
function groupByDeviceAndPin(logs: RawLog[]): PinGroup[] {
  const groups = logs.reduce((map, log) => {
    const key = `${log.deviceId}::${log.enrollPin}`
    const existing = map.get(key)

    if (!existing) {
      map.set(key, {
        key,
        deviceId: log.deviceId,
        serialNumber: log.serialNumber,
        enrollPin: log.enrollPin,
        punchCount: 1,
        firstSeenUtc: log.punchTimeUtc,
        lastSeenUtc: log.punchTimeUtc,
      })
      return map
    }

    existing.punchCount += 1
    // The API's ordering is not guaranteed, so the span is widened from the data itself.
    if (log.punchTimeUtc < existing.firstSeenUtc) existing.firstSeenUtc = log.punchTimeUtc
    if (log.punchTimeUtc > existing.lastSeenUtc) existing.lastSeenUtc = log.punchTimeUtc
    return map
  }, new Map<string, PinGroup>())

  // Most punches first: the biggest pile of waiting days is the most worth fixing.
  return [...groups.values()].sort((a, b) => b.punchCount - a.punchCount)
}

/* PORT NOTE: the DevExtreme DataGrid is TanStack Table + Mantine Table per RequestsGrid.tsx;
   SearchPanel is the global search box, FilterRow the strip under the header, and
   HeaderFilter the funnel in each header cell — all three, as the original had them. */
const columnHelper = createColumnHelper<PinGroup>()

const PAGE_SIZES = ['15', '30', '50']

function PinGroupsGrid({
  rows,
  canMap,
  onMap,
}: {
  rows: PinGroup[]
  canMap: boolean
  onMap: (group: PinGroup) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      columnHelper.accessor('enrollPin', { header: 'PIN' }),
      columnHelper.accessor('serialNumber', { header: 'Device' }),
      /* PORT NOTE: alignment={alignStart()} dropped — Mantine cells already start-align. */
      columnHelper.accessor('punchCount', { header: 'Punches waiting' }),
      // The original set allowHeaderFiltering={false} on both of these, and it was right: a
      // timestamp to the minute is distinct per row, so the funnel's list would be as long as
      // the grid. The filter-row box still narrows them by date.
      columnHelper.accessor('firstSeenUtc', {
        header: 'First seen',
        cell: (info) => formatStamp(info.getValue()),
        meta: { filterText: formatStamp, noHeaderFilter: true },
      }),
      columnHelper.accessor('lastSeenUtc', {
        header: 'Last seen',
        cell: (info) => formatStamp(info.getValue()),
        meta: { filterText: formatStamp, noHeaderFilter: true },
      }),
      ...(canMap
        ? [
            columnHelper.display({
              id: 'actions',
              header: 'Actions',
              cell: (info) => (
                <div className="grid-actions">
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={() => onMap(info.row.original)}
                  >
                    Map to employee
                  </Button>
                </div>
              ),
            }),
          ]
        : []),
    ],
    [canMap, onMap],
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
    // A PIN's leading zeros are part of it, so matching on the printed text is also the only
    // correct match here.
    defaultColumn: { filterFn: gridFilterFn },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // Multi-column sort on shift-click, as the original's Sorting mode="multiple" allowed.
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 15 } },
    getRowId: (r) => r.key,
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <Group justify="flex-end" p="xs">
        <TextInput
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.currentTarget.value)}
          placeholder="Search…"
          leftSection={<IconSearch size={14} />}
          w={240}
          size="xs"
        />
      </Group>

      <Table striped verticalSpacing="xs" fz="sm">
        <Table.Thead>
          {table.getHeaderGroups().map((hg) => (
            <Table.Tr key={hg.id}>
              {hg.headers.map((header) => (
                <Table.Th
                  key={header.id}
                  style={{
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
                  Nothing matches the search.
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

      <Group justify="space-between" p="xs">
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

export default function UnresolvedPinsPage() {
  const { hasPermission } = useAuth()
  // The mapping endpoint itself is DEVICE_MANAGE, so anyone without it cannot complete
  // the action — the button does not render rather than render and fail.
  const canMap = hasPermission(PERMISSIONS.devices)

  const [logs, setLogs] = useState<RawLog[]>([])
  const [employees, setEmployees] = useState<EmployeeListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /**
   * Why the employee list could not be loaded, if it could not.
   *
   * This used to be swallowed (`.catch(() => [])`), which produced the worst possible outcome:
   * the mapping form opened with an EMPTY employee dropdown and no explanation, so the user was
   * staring at a form they could not complete and could not diagnose. An unusable form must say
   * why it is unusable.
   */
  const [employeesError, setEmployeesError] = useState<string | null>(null)

  const [target, setTarget] = useState<PinGroup | null>(null)
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [recovered, setRecovered] = useState<Recovered | null>(null)
  /** PORT NOTE: Validator/RequiredRule → the same required check, held as an inline error. */
  const [employeeError, setEmployeeError] = useState<string | null>(null)

  const groups = useMemo(() => groupByDeviceAndPin(logs), [logs])

  const load = useCallback(async () => {
    try {
      setLogs(await importService.getUnresolved())
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * The employee list feeds the mapping form, so a failure here does NOT hide the punches — the
   * user still needs to see what is waiting. But it is recorded rather than discarded, so the
   * form can explain itself instead of presenting an empty dropdown.
   */
  const loadEmployees = useCallback(async () => {
    try {
      setEmployees(await employeesService.getAll())
      setEmployeesError(null)
    } catch (err) {
      setEmployees([])
      setEmployeesError(getErrorMessage(err))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      // Settled, not all: a failure to load the employee list must not hide the punches. The
      // user still needs to see what is waiting, even if they cannot map it this second.
      const [unresolvedResult, employeeResult] = await Promise.allSettled([
        importService.getUnresolved(),
        employeesService.getAll(),
      ])

      if (cancelled) return

      if (unresolvedResult.status === 'fulfilled') {
        setLogs(unresolvedResult.value)
        setError(null)
      } else {
        setError(getErrorMessage(unresolvedResult.reason))
      }

      if (employeeResult.status === 'fulfilled') {
        setEmployees(employeeResult.value)
        setEmployeesError(null)
      } else {
        // Recorded, NOT swallowed — the mapping form will say this out loud rather than
        // opening with an empty dropdown the user cannot explain.
        setEmployees([])
        setEmployeesError(getErrorMessage(employeeResult.reason))
      }

      setLoading(false)
    }
    void initialLoad()
    return () => {
      cancelled = true
    }
  }, [])

  function refresh() {
    setLoading(true)
    void load()
    // Retry the employee list too: if it failed on the way in, Refresh is the button the user
    // will reach for, and it should fix the form rather than only the grid.
    void loadEmployees()
  }

  function openMap(group: PinGroup) {
    setTarget(group)
    setEmployeeId(null)
    setSaving(false)
    setEmployeeError(null)
  }

  async function submitMap() {
    if (!target) return

    if (employeeId == null) {
      setEmployeeError('Choose an employee')
      return
    }

    const employee = employees.find((item) => item.employeeId === employeeId)
    if (!employee) return

    setSaving(true)
    try {
      const mapResult = await devicesService.mapEnrollment({
        employeeId: employee.employeeId,
        deviceId: target.deviceId,
        enrollPin: target.enrollPin,
      })

      // A fix that reports nothing feels like it did nothing. The count is the proof that
      // punches which had been parked for days have just been attributed to a person.
      notifications.show({
        message: `Mapped PIN ${target.enrollPin} to ${employee.fullName}. ${mapResult.orphanPunchesResolved} punch(es) that were waiting have now been claimed.`,
        color: 'green',
        autoClose: 4000,
      })
      setRecovered({
        employeeName: employee.fullName,
        enrollPin: target.enrollPin,
        punchesResolved: mapResult.orphanPunchesResolved,
      })
      setTarget(null)
      await load()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Unresolved PINs</h1>
          <p className="page-subtitle">
            Punches from a PIN nobody is enrolled on. They are waiting, not lost.
          </p>
        </div>
        <div className="page-head-actions">
          <ActionIcon
            variant="default"
            size="lg"
            title="Refresh"
            aria-label="Refresh"
            onClick={refresh}
          >
            <IconRefresh size={18} />
          </ActionIcon>
        </div>
      </div>

      <PageHelp>
        These punches came from a PIN the system doesn&apos;t recognise. They have been
        kept, not deleted. Map the PIN to a person and they will be counted automatically.
      </PageHelp>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {/*
        Mapping attributes the punches but does NOT compute the days they belong to — that
        is the processor's job. Without this line the user believes they are finished, and
        the month stays quietly short of hours.
      */}
      {recovered && (
        <div className="card">
          <div className="card-title">
            {recovered.punchesResolved} punch(es) claimed for {recovered.employeeName}
          </div>
          <p className="hint">
            PIN {recovered.enrollPin} now belongs to {recovered.employeeName}, so those
            punches have a name on them. They are still <strong>unprocessed</strong>: the
            days they belong to will not exist until the processor runs. Go to{' '}
            <Link to="/attendance/daily">Daily Attendance</Link> and run it.
          </p>
        </div>
      )}

      {loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : groups.length === 0 ? (
        // An empty list after a FAILED load is not good news, and saying "nothing is
        // waiting" there would be a lie about payroll. When the fetch failed the alert
        // above is the whole story; the all-clear is only shown when it was really read.
        error ? null : (
          <div className="card">
            <div className="empty-hint">
              <div className="empty-hint-main">No unresolved PINs.</div>
              Every punch that has arrived belongs to somebody, so nothing is waiting here.
              Punches land on this page when a device sends a PIN nobody is enrolled on —
              if you are expecting somebody&apos;s hours and cannot find them, check the
              enrollments on <Link to="/attendance/devices">Devices &amp; Enrollment</Link>.
            </div>
          </div>
        )
      ) : (
        <PinGroupsGrid rows={groups} canMap={canMap} onMap={openMap} />
      )}

      {/* Mounted only once `target` exists — its children are always inside the dialog from the
          first render. (The original's long caveat about devextreme-react capturing Popup children
          as a content template, and fields spilling into the page otherwise, does not apply to
          Mantine's Modal.) */}
      {target && (
        <Modal
          opened
          onClose={() => setTarget(null)}
          title="Map PIN to employee"
          size={480}
          centered
          closeOnClickOutside={!saving}
        >
          <div>
            <div className="form-field">
              <span className="form-label">PIN</span>
              <div className="metric">{target.enrollPin}</div>
            </div>

            <div className="form-field">
              <span className="form-label">Device</span>
              <div className="metric">{target.serialNumber}</div>
            </div>

            {/* A form that cannot be completed must say WHY. An empty dropdown with no
                explanation is the one thing worse than an error message. */}
            {employeesError ? (
              <div className="alert alert--error" role="alert">
                The list of employees could not be loaded, so there is nobody to map this PIN
                to yet. {employeesError}
              </div>
            ) : employees.length === 0 ? (
              <div className="alert alert--error" role="alert">
                There are no employees on file, so there is nobody to map this PIN to. Add the
                person under HR → Employees first, then come back — the punches will still be
                waiting.
              </div>
            ) : (
              <div className="form-field">
                <label className="form-label" htmlFor="map-pin-employee">
                  Employee
                </label>
                <Select
                  id="map-pin-employee"
                  // Two people can share a first name; the branch is what tells them apart.
                  data={employees.map((item) => ({
                    value: String(item.employeeId),
                    label: `${item.fullName} — ${item.branch}`,
                  }))}
                  value={employeeId != null ? String(employeeId) : null}
                  onChange={(v) => {
                    setEmployeeId(v != null ? Number(v) : null)
                    if (employeeError) setEmployeeError(null)
                  }}
                  placeholder="Choose the person this PIN belongs to…"
                  searchable
                  allowDeselect={false}
                  nothingFoundMessage="No employee matches that name."
                  disabled={saving}
                  error={employeeError}
                />
              </div>
            )}

            <p className="hint">
              A PIN is only unique within one device. Mapping it here claims every punch
              that has been waiting on it — nothing is lost.
            </p>

            <div className="form-actions">
              <Button
                variant="default"
                onClick={() => setTarget(null)}
                disabled={saving}
              >
                Cancel
              </Button>
              {employeesError ? (
                // The failure may be transient (a dropped connection, a restarted API), so offer
                // the fix rather than making the user close the popup and reload the page.
                <Button
                  variant="default"
                  onClick={() => void loadEmployees()}
                >
                  Try loading employees again
                </Button>
              ) : (
                <Button
                  onClick={() => void submitMap()}
                  loading={saving}
                  disabled={saving || employees.length === 0}
                >
                  {saving ? 'Saving…' : 'Map PIN'}
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
