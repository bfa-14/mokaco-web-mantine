import { useCallback, useEffect, useMemo, useState } from 'react'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Checkbox, Group, Loader, NumberInput, Pagination, Select, Table, TextInput } from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { TimePicker } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconRefresh, IconSearch } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { shiftsService } from '../../services/attendanceService'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import {
  formatMinutes,
} from './attendanceFormat'
import { useAuth } from '../../auth/useAuth'
import { PERMISSIONS } from '../../types/attendance'
import type { Shift } from '../../types/attendance'

interface ShiftFormState {
  name: string
  startTime: string
  endTime: string
  /** null = use the AttendanceToleranceMinutes setting. */
  graceMinutes: number | null
  breakMinutes: number
  crossesMidnight: boolean
  isActive: boolean
}

/**
 * A plain day shift with an hour for lunch. These are only the values a new shift OPENS with —
 * every one of them decides pay, so the user is expected to look at each before saving rather
 * than accept a blank form. Grace starts EMPTY: empty means the tolerance setting, which is the
 * one rule HR set for the whole company, and a shift only overrides it on purpose.
 */
const EMPTY_FORM: ShiftFormState = {
  name: '',
  startTime: '08:00:00',
  endTime: '16:00:00',
  graceMinutes: null,
  breakMinutes: 60,
  crossesMidnight: false,
  isActive: true,
}

/** The Grace cell: a number of minutes, or the words for "no override" — null is the tolerance setting, not zero. */
function graceText(minutes: number | null): string {
  return minutes == null ? 'Tolerance setting' : `${minutes} min`
}

/**
 * Shift times arrive as a bare time-of-day ('08:00:00'), not as a timestamp, so the shared
 * formatTime — which looks for the 'T' in an ISO instant — cannot read them.
 */
function formatClock(time: string | null | undefined): string {
  if (!time) return '—'
  return time.slice(0, 5)
}

/** Minutes since midnight, or null if the box is empty or unparseable. */
function minutesOfDay(time: string): number | null {
  const parts = time ? time.split(':') : []
  if (parts.length < 2) return null
  const hours = Number(parts[0])
  const mins = Number(parts[1])
  if (Number.isNaN(hours) || Number.isNaN(mins)) return null
  return hours * 60 + mins
}

/**
 * How long the shift runs, start to end. An overnight shift ends on the NEXT day, so its
 * end has to be pushed past midnight before the subtraction — otherwise 22:00 to 06:00
 * computes as minus sixteen hours.
 */
function shiftSpanMinutes(form: ShiftFormState): number | null {
  const start = minutesOfDay(form.startTime)
  const end = minutesOfDay(form.endTime)
  if (start === null || end === null) return null
  return form.crossesMidnight ? end + 1440 - start : end - start
}

/**
 * The time problems the user should never have to discover from a 400. The API rejects
 * these too, but by then they have already pressed Save and lost the thread of what they
 * were doing.
 */
function describeTimeProblem(form: ShiftFormState): string | null {
  const span = shiftSpanMinutes(form)
  if (span === null) return 'Enter a start time and an end time.'

  if (span < 0) {
    return "This shift ends before it starts. Tick 'crosses midnight' if it is an overnight shift."
  }
  if (span === 0) {
    return "This shift starts and ends at the same time, so it is zero hours long. Tick 'crosses midnight' if you meant a full 24-hour shift."
  }
  // A break at least as long as the shift leaves nothing to pay: a full day on this shift
  // would be worth zero minutes, and everyone rostered on it would look permanently short.
  if (form.breakMinutes >= span) {
    return `The break (${formatMinutes(form.breakMinutes)}) is as long as the shift itself (${formatMinutes(span)}), which would leave nothing to pay. Shorten the break or lengthen the shift.`
  }
  return null
}

/** What the shift is worth as a full day: its length minus the unpaid break. */
function fullDayMinutes(form: ShiftFormState): number | null {
  const span = shiftSpanMinutes(form)
  if (span === null || span <= 0) return null
  return span - form.breakMinutes
}

/** The words the Status and Crosses-midnight cells print — also their filter dropdowns' options. */
const ACTIVE_LABELS = ['Active', 'Inactive']
const activeText = (isActive: boolean) => (isActive ? 'Active' : 'Inactive')

const MIDNIGHT_LABELS = ['Overnight', '—']
const midnightText = (crosses: boolean) => (crosses ? 'Overnight' : '—')

function ActiveCell({ isActive }: { isActive: boolean }) {
  return (
    <span className={isActive ? 'badge badge--on' : 'badge badge--off'}>
      {activeText(isActive)}
    </span>
  )
}

function MidnightCell({ crosses }: { crosses: boolean }) {
  if (!crosses) return <span>—</span>
  return <span className="badge badge--muted">Overnight</span>
}

const columnHelper = createColumnHelper<Shift>()

const PAGE_SIZES = ['15', '30', '50']

export default function ShiftsPage() {
  const { hasPermission } = useAuth()
  // Shifts define what "late" and "a full day" mean, so editing them is ATTENDANCE_MANAGE.
  const canManage = hasPermission(PERMISSIONS.manage)

  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [popupVisible, setPopupVisible] = useState(false)
  const [editing, setEditing] = useState<Shift | null>(null)
  const [form, setForm] = useState<ShiftFormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const load = useCallback(async () => {
    try {
      setShifts(await shiftsService.getAll())
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      try {
        const data = await shiftsService.getAll()
        if (!cancelled) {
          setShifts(data)
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
  }, [])

  function refresh() {
    setLoading(true)
    void load()
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setPopupVisible(true)
  }

  const openEdit = useCallback((shift: Shift) => {
    setEditing(shift)
    setForm({
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      graceMinutes: shift.graceMinutes,
      breakMinutes: shift.breakMinutes,
      crossesMidnight: shift.crossesMidnight,
      isActive: shift.isActive,
    })
    setFormError(null)
    setPopupVisible(true)
  }, [])

  async function submitShift() {
    const name = form.name.trim()
    // The DX RequiredRule is gone with DevExtreme; the same rule, in the same words, is
    // enforced here through the dialog's own error slot.
    if (!name) {
      setFormError('A shift needs a name people will recognise on the roster')
      return
    }

    const problem = describeTimeProblem(form)
    if (problem) {
      setFormError(problem)
      return
    }
    setFormError(null)

    const paid = fullDayMinutes(form)
    setSaving(true)
    try {
      if (editing) {
        await shiftsService.update(editing.shiftId, {
          name,
          startTime: form.startTime,
          endTime: form.endTime,
          graceMinutes: form.graceMinutes,
          breakMinutes: form.breakMinutes,
          crossesMidnight: form.crossesMidnight,
          isActive: form.isActive,
        })
        notifications.show({
          message: `"${name}" saved. A full day on it is now ${formatMinutes(paid)}. Days already processed keep the hours they were given.`,
          color: 'green',
          autoClose: 2500,
        })
      } else {
        await shiftsService.create({
          name,
          startTime: form.startTime,
          endTime: form.endTime,
          graceMinutes: form.graceMinutes,
          breakMinutes: form.breakMinutes,
          crossesMidnight: form.crossesMidnight,
        })
        notifications.show({
          message: `"${name}" created: ${formatClock(form.startTime)}–${formatClock(form.endTime)}, a full day of ${formatMinutes(paid)}. Roster somebody onto it to use it.`,
          color: 'green',
          autoClose: 2500,
        })
      }
      setPopupVisible(false)
      await load()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSaving(false)
    }
  }

  /* PORT NOTE: the DX SearchPanel is the global-search box below and the FilterRow is the strip
     under the header; the explicit start alignment on the Grace/Break columns is the plain
     table's natural alignment. */
  const columns = useMemo(
    () => [
      columnHelper.accessor('name', { header: 'Shift' }),
      // 'HH:mm:ss' underneath, 'HH:mm' on screen — the filter takes the shorter one.
      columnHelper.accessor('startTime', {
        header: 'Start',
        cell: (info) => <span>{formatClock(info.row.original.startTime)}</span>,
        meta: { filterText: formatClock },
      }),
      columnHelper.accessor('endTime', {
        header: 'End',
        cell: (info) => <span>{formatClock(info.row.original.endTime)}</span>,
        meta: { filterText: formatClock },
      }),
      columnHelper.accessor('graceMinutes', {
        header: 'Grace',
        cell: (info) => (
          <span title="Arriving within this many minutes of the start is not late at all. Empty uses the Attendance tolerance setting.">
            {graceText(info.row.original.graceMinutes)}
          </span>
        ),
        meta: { filterText: graceText },
      }),
      columnHelper.accessor('breakMinutes', {
        header: 'Break',
        cell: (info) => (
          <span title="Unpaid, and charged once against the day.">
            {info.row.original.breakMinutes} min
          </span>
        ),
        meta: { filterText: (v) => `${v} min` },
      }),
      columnHelper.accessor('crossesMidnight', {
        header: 'Crosses midnight',
        cell: (info) => <MidnightCell crosses={info.row.original.crossesMidnight} />,
        meta: { filterText: midnightText, filterOptions: MIDNIGHT_LABELS },
      }),
      columnHelper.accessor('isActive', {
        header: 'Status',
        cell: (info) => <ActiveCell isActive={info.row.original.isActive} />,
        meta: { filterText: activeText, filterOptions: ACTIVE_LABELS },
      }),
      ...(canManage
        ? [
            columnHelper.display({
              id: 'actions',
              header: 'Actions',
              cell: (info) => (
                <div className="grid-actions">
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={() => openEdit(info.row.original)}
                  >
                    Edit
                  </Button>
                </div>
              ),
            }),
          ]
        : []),
    ],
    [canManage, openEdit],
  )

  const table = useReactTable({
    data: shifts,
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
    // Multi-column sort on shift-click, as the original's Sorting mode="multiple" allowed.
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 15 } },
    getRowId: (r) => String(r.shiftId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  // Checked live, not just on Save: a break longer than the shift makes the "full day"
  // preview go NEGATIVE, and a number like "-30m" presented as somebody's paid day is
  // worse than no preview at all. When the times do not make sense, say so instead.
  const timeProblem = describeTimeProblem(form)
  const previewMinutes = timeProblem ? null : fullDayMinutes(form)

  const num = (v: number | string) => (typeof v === 'number' ? v : 0)

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Shifts</h1>
          <p className="page-subtitle">
            The definitions that give “late”, “a full day” and “overtime” a meaning.
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
            <IconRefresh size={16} />
          </ActionIcon>
          {canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
              New Shift
            </Button>
          )}
        </div>
      </div>

      <PageHelp>
        A shift is what makes “late” and “a full day” mean something: without one, there is
        no start time to be late against and no target for the hours to fall short of.
        Changing a shift changes how days are judged from here on — it does not re-judge the
        days that have already been processed.
      </PageHelp>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <div className="card">
        <p className="hint">
          Somebody with no rostered shift is not judged against nothing — they fall back to
          the standard working day in Settings. They still earn a day fraction, but they
          cannot be late: there is no start time to be late against.
        </p>
      </div>

      {loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : shifts.length > 0 ? (
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

          <Table
            striped
            highlightOnHover
            withColumnBorders={false}
            verticalSpacing="xs"
            fz="sm"
          >
            <Table.Thead>
              {table.getHeaderGroups().map((hg) => (
                <Table.Tr key={hg.id}>
                  {hg.headers.map((header) => {
                    const canSort = header.column.getCanSort()
                    return (
                      <Table.Th
                        key={header.id}
                        style={{
                          cursor: canSort ? 'pointer' : undefined,
                          whiteSpace: 'nowrap',
                          userSelect: 'none',
                        }}
                        onClick={
                          canSort
                            ? header.column.getToggleSortingHandler()
                            : undefined
                        }
                      >
                        <GridHeaderContent header={header} table={table} />
                      </Table.Th>
                    )
                  })}
                </Table.Tr>
              ))}
              <GridFilterRow table={table} />
            </Table.Thead>
            <Table.Tbody>
              {table.getRowModel().rows.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={columns.length}>
                    {/* The grid only renders when shifts EXIST, so the only way to see no rows
                        here is to have filtered them all out. Saying "no shifts are defined" at
                        that point would be a lie, and would send somebody off to create one that
                        already exists. */}
                    <div className="empty-hint" style={{ padding: 16 }}>
                      No shifts match the filter. Clear it to see the rest.
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
      ) : (
        // Nothing to show. If the load FAILED, the alert above already explains why, and
        // the page must not ALSO claim there are no shifts — an empty list and an unread
        // list are different things, and only one of them is the user's to fix.
        !error && (
          <div className="card">
            <div className="empty-hint">
              <div className="empty-hint-main">No shifts are defined yet.</div>
              {canManage
                ? 'Add the shifts people actually work — the morning, the evening, the overnight. Until one exists there is nothing to roster anybody onto, and every day falls back to the standard working day in Settings.'
                : 'Until somebody with roster rights adds one, every day falls back to the standard working day in Settings.'}
            </div>
          </div>
        )
      )}

      <Modal
        opened={popupVisible}
        onClose={() => setPopupVisible(false)}
        title={editing ? `Edit ${editing.name}` : 'New Shift'}
        size={480}
        centered
      >
        {formError && (
          <div className="alert alert--error" role="alert">
            {formError}
          </div>
        )}

        <div className="form-field">
          <label className="form-label" htmlFor="shift-name">
            Name
          </label>
          <TextInput
            id="shift-name"
            value={form.name}
            onChange={(e) => {
              const value = e.currentTarget.value
              setForm((f) => ({ ...f, name: value }))
            }}
            placeholder="Morning, Evening, Overnight…"
            disabled={saving}
          />
        </div>

        <div className="form-grid">
          <div className="form-field">
            <label className="form-label" htmlFor="shift-start">
              Start
            </label>
            <TimePicker
              id="shift-start"
              format="24h"
              withDropdown
              value={form.startTime ? form.startTime.slice(0, 5) : ''}
              onChange={(value) => {
                // TimePicker (withSeconds off) speaks 'HH:mm'; the API wants 'HH:mm:ss', so the
                // ':00' is appended here exactly where the native input appended it.
                setForm((f) => ({ ...f, startTime: value ? `${value}:00` : '' }))
              }}
              disabled={saving}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="shift-end">
              End
            </label>
            <TimePicker
              id="shift-end"
              format="24h"
              withDropdown
              value={form.endTime ? form.endTime.slice(0, 5) : ''}
              onChange={(value) => {
                setForm((f) => ({ ...f, endTime: value ? `${value}:00` : '' }))
              }}
              disabled={saving}
            />
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="shift-grace">
            Grace (minutes)
          </label>
          {/* OPTIONAL, unlike the break: a blank box is null, and null tells the processor to use
              the company-wide AttendanceToleranceMinutes setting. A settled number overrides it
              for this shift alone. */}
          <NumberInput
            id="shift-grace"
            value={form.graceMinutes ?? ''}
            onChange={(v) =>
              setForm((f) => ({ ...f, graceMinutes: typeof v === 'number' ? v : null }))
            }
            min={0}
            placeholder="Tolerance setting"
            disabled={saving}
          />
          <p className="hint">
            Arriving within this many minutes of the start is not late at all. Empty = use the
            tolerance setting (Settings → Attendance).
          </p>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="shift-break">
            Break (minutes)
          </label>
          <NumberInput
            id="shift-break"
            value={form.breakMinutes}
            onChange={(v) => setForm((f) => ({ ...f, breakMinutes: num(v) }))}
            min={0}
            disabled={saving}
          />
          <p className="hint">
            Unpaid, and charged once. If they punch out for it, the mid-day gap already
            covers it; if they don’t, it comes off their worked time. Punching out for
            lunch is never worse for them.
          </p>
        </div>

        <div className="form-field">
          <Checkbox
            checked={form.crossesMidnight}
            onChange={(e) => {
              const checked = e.currentTarget.checked
              setForm((f) => ({ ...f, crossesMidnight: checked }))
            }}
            label="Crosses midnight"
            disabled={saving}
          />
          <p className="hint">
            Tick this for an overnight shift like 22:00–06:00. The shift belongs to the
            day it STARTS on. Without this, its length computes as negative.
          </p>
        </div>

        {editing && (
          <div className="form-field">
            <Checkbox
              checked={form.isActive}
              onChange={(e) => {
                const checked = e.currentTarget.checked
                setForm((f) => ({ ...f, isActive: checked }))
              }}
              label="Active"
              disabled={saving}
            />
            <p className="hint">
              Turning a shift off stops it being rostered from now on. Days already
              worked on it keep the hours they were given.
            </p>
          </div>
        )}

        {timeProblem ? (
          <div className="form-field">
            <p className="hint">
              <strong>{timeProblem}</strong>
            </p>
          </div>
        ) : (
          previewMinutes !== null && (
            <div className="form-field">
              <p className="hint">
                A full day on this shift is{' '}
                <strong>{formatMinutes(previewMinutes)}</strong> —{' '}
                {formatClock(form.startTime)} to {formatClock(form.endTime)}
                {form.crossesMidnight ? ' the next morning' : ''}, minus the{' '}
                {formatMinutes(form.breakMinutes)} break. That is the target their hours
                are measured against.
              </p>
            </div>
          )
        )}

        <div className="form-actions">
          <Button
            variant="default"
            onClick={() => setPopupVisible(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={() => void submitShift()} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Shift' : 'Create Shift'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
