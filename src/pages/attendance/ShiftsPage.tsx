import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Checkbox, Group, Loader, NumberInput, Pagination, Select, Table, TextInput } from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { TimePicker } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconRefresh, IconSearch, IconX } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { shiftsService } from '../../services/attendanceService'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import {
  formatDayLabel,
  formatMinutes,
} from './attendanceFormat'
import { beirutToday } from '../../components/DateRangeField'
import { useAuth } from '../../auth/useAuth'
import { t as translate } from '../../i18n/t'
import { PERMISSIONS } from '../../types/attendance'
import type { Shift, ShiftChange, ShiftHours } from '../../types/attendance'
import { ShiftChangeLog } from './ShiftChangeLog'
import { changeLogDay, shiftHoursNote } from './shiftChangeWords'
import { currentLocale } from '../../i18n'

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
  return minutes == null ? translate('attendance.shiftsPage.values.toleranceSetting') : minutesText(minutes)
}

/** '30 min' — the Grace and Break cells (and their filters) say it the same way. */
function minutesText(minutes: number): string {
  return translate('attendance.shiftsPage.values.minutes', { minutes })
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
  if (span === null) return translate('attendance.shiftsPage.problems.noTimes')

  if (span < 0) {
    return translate('attendance.shiftsPage.problems.endsBefore')
  }
  if (span === 0) {
    return translate('attendance.shiftsPage.problems.zero')
  }
  // A break at least as long as the shift leaves nothing to pay: a full day on this shift
  // would be worth zero minutes, and everyone rostered on it would look permanently short.
  if (form.breakMinutes >= span) {
    return translate('attendance.shiftsPage.problems.breakTooLong', { break: formatMinutes(form.breakMinutes), span: formatMinutes(span) })
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
const activeText = (isActive: boolean) =>
  translate(isActive ? 'attendance.shiftsPage.values.active' : 'attendance.shiftsPage.values.inactive')
const activeLabels = () => [activeText(true), activeText(false)]

const midnightText = (crosses: boolean) => (crosses ? translate('attendance.shiftsPage.values.overnight') : translate('common.dash'))
const midnightLabels = () => [midnightText(true), midnightText(false)]

/** True when the form's hours are not the ones the shift has now: the change then needs the day it starts. */
function hoursDiffer(form: ShiftFormState, shift: Shift): boolean {
  return (
    form.startTime.slice(0, 5) !== shift.startTime.slice(0, 5) ||
    form.endTime.slice(0, 5) !== shift.endTime.slice(0, 5) ||
    form.breakMinutes !== shift.breakMinutes ||
    form.graceMinutes !== shift.graceMinutes ||
    form.crossesMidnight !== shift.crossesMidnight
  )
}

/** "From 01/12/2026 to 31/12/2026" for a row of the history; the first row has been there from the start. */
function periodText(row: ShiftHours): string {
  const from = row.isFirst
    ? translate('attendance.shiftsPage.hours.fromStart')
    : translate('attendance.shiftsPage.hours.from', { day: formatDayLabel(row.effectiveFrom) })
  if (row.effectiveTo) return translate('attendance.shiftsPage.hours.fromTo', { from, to: formatDayLabel(row.effectiveTo) })
  return row.isFirst ? translate('attendance.shiftsPage.hours.sinceStart') : translate('attendance.shiftsPage.hours.onwards', { from })
}

function ActiveCell({ isActive }: { isActive: boolean }) {
  return (
    <span className={isActive ? 'badge badge--on' : 'badge badge--off'}>
      {activeText(isActive)}
    </span>
  )
}

function MidnightCell({ crosses }: { crosses: boolean }) {
  if (!crosses) return <span>{midnightText(false)}</span>
  return <span className="badge badge--muted">{midnightText(true)}</span>
}

const columnHelper = createColumnHelper<Shift>()

const PAGE_SIZES = ['15', '30', '50']

export default function ShiftsPage() {
  const { t } = useTranslation()
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
  // New hours for a shift apply FROM A DAY (and, when an end is given, until a day - the hours before then come back).
  const [hoursFrom, setHoursFrom] = useState('')
  const [hoursTo, setHoursTo] = useState('')
  const [hoursNote, setHoursNote] = useState('')
  const [history, setHistory] = useState<ShiftHours[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null)
  const [removing, setRemoving] = useState(false)
  // The change log (script 122): every change to the shift, who made it, the before and the after.
  const [changes, setChanges] = useState<ShiftChange[] | null>(null)
  const [changesError, setChangesError] = useState<string | null>(null)
  // The History window: the hours over time and the change log, for people who may read the shifts but not edit them.
  const [historyFor, setHistoryFor] = useState<Shift | null>(null)

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

  /** The hours over time and the change log, each on its own: one failing does not hide the other. */
  const loadHistory = useCallback(async (shiftId: number) => {
    await Promise.all([
      (async () => {
        try {
          setHistory(await shiftsService.getHours(shiftId))
          setHistoryError(null)
        } catch (err) {
          setHistory(null)
          setHistoryError(getErrorMessage(err))
        }
      })(),
      (async () => {
        try {
          setChanges(await shiftsService.getChanges(shiftId))
          setChangesError(null)
        } catch (err) {
          setChanges(null)
          setChangesError(getErrorMessage(err))
        }
      })(),
    ])
  }, [])

  const openHistory = useCallback(
    (shift: Shift) => {
      setHistoryFor(shift)
      setHistory(null)
      setHistoryError(null)
      setChanges(null)
      setChangesError(null)
      void loadHistory(shift.shiftId)
    },
    [loadHistory],
  )

  const openEdit = useCallback(
    (shift: Shift) => {
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
      setHoursFrom(beirutToday())
      setHoursTo('')
      setHoursNote('')
      setHistory(null)
      setHistoryError(null)
      setChanges(null)
      setChangesError(null)
      setConfirmRemove(null)
      setFormError(null)
      setPopupVisible(true)
      void loadHistory(shift.shiftId)
    },
    [loadHistory],
  )

  /** Takes one change of hours back: the hours before it run on, and the days it covered are worked out again. */
  async function takeBack(row: ShiftHours) {
    if (!editing) return
    setRemoving(true)
    try {
      const result = await shiftsService.deleteHours(editing.shiftId, row.shiftHoursId)
      notifications.show({
        message:
          result.daysRederived > 0
            ? t('attendance.shiftsPage.notify.takenBackDays', { day: formatDayLabel(row.effectiveFrom), count: result.daysRederived })
            : t('attendance.shiftsPage.notify.takenBack', { day: formatDayLabel(row.effectiveFrom) }),
        color: 'green',
        autoClose: 3500,
      })
      setConfirmRemove(null)
      const fresh = await shiftsService.getAll()
      setShifts(fresh)
      const now = fresh.find((s) => s.shiftId === editing.shiftId)
      if (now) {
        setEditing(now)
        setForm((f) => ({
          ...f,
          startTime: now.startTime,
          endTime: now.endTime,
          graceMinutes: now.graceMinutes,
          breakMinutes: now.breakMinutes,
          crossesMidnight: now.crossesMidnight,
        }))
      }
      await loadHistory(editing.shiftId)
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 6000 })
    } finally {
      setRemoving(false)
    }
  }

  async function submitShift() {
    const name = form.name.trim()
    // The DX RequiredRule is gone with DevExtreme; the same rule, in the same words, is
    // enforced here through the dialog's own error slot.
    if (!name) {
      setFormError(t('attendance.shiftsPage.problems.needName'))
      return
    }

    const problem = describeTimeProblem(form)
    if (problem) {
      setFormError(problem)
      return
    }
    // New hours need the day they start; an end day, when given, is on or after it.
    const changesHours = editing != null && hoursDiffer(form, editing)
    if (changesHours && !hoursFrom) {
      setFormError(t('attendance.shiftsPage.problems.needFrom'))
      return
    }
    if (changesHours && hoursTo && hoursTo < hoursFrom) {
      setFormError(t('attendance.shiftsPage.problems.toBeforeFrom'))
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
          effectiveFrom: changesHours ? hoursFrom : null,
          effectiveTo: changesHours && hoursTo ? hoursTo : null,
          note: changesHours && hoursNote.trim() ? hoursNote.trim() : null,
        })
        notifications.show({
          message: !changesHours
            ? t('attendance.shiftsPage.notify.saved', { name })
            : hoursTo
              ? t('attendance.shiftsPage.notify.savedPeriod', {
                  name,
                  from: formatDayLabel(hoursFrom),
                  to: formatDayLabel(hoursTo),
                  minutes: formatMinutes(paid),
                })
              : t('attendance.shiftsPage.notify.savedFrom', { name, from: formatDayLabel(hoursFrom), minutes: formatMinutes(paid) }),
          color: 'green',
          autoClose: 4500,
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
          message: t('attendance.shiftsPage.notify.created', {
            name,
            hours: `${formatClock(form.startTime)}–${formatClock(form.endTime)}`,
            minutes: formatMinutes(paid),
          }),
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

  /** A shift's hours over time; the managers' Edit dialog can take a change back from it. */
  /* The database's own notes ("Back to the hours before the change of ...") in the reader's language. */
  const noteWords = { t: (key: string, options?: Record<string, unknown>) => t(key, options ?? {}), day: (iso: string) => changeLogDay(iso, currentLocale()) }
  const hoursList = (rows: ShiftHours[], withTakeBack: boolean) => (
    <ul className="shift-hours-list">
      {rows.map((row) => (
        <li key={row.shiftHoursId} className={row.isCurrent ? 'shift-hours-row shift-hours-row--now' : 'shift-hours-row'}>
          <div className="shift-hours-main">
            <span className="shift-hours-period">{periodText(row)}</span>
            <strong>
              {formatClock(row.startTime)}–{formatClock(row.endTime)}
            </strong>
            <span className="shift-hours-day">
              {t('attendance.shiftsPage.hours.perDay', { minutes: formatMinutes(row.standardMinutes) })}
              {row.breakMinutes > 0 ? t('attendance.shiftsPage.hours.withBreak', { minutes: formatMinutes(row.breakMinutes) }) : ''}
            </span>
            {row.isCurrent && <span className="shift-hours-now">{t('attendance.shiftsPage.hours.now')}</span>}
          </div>
          {(row.note || row.createdBy) && !row.isFirst && (
            <div className="shift-hours-note">
              {shiftHoursNote(row.note, noteWords)}
              {shiftHoursNote(row.note, noteWords) && row.createdBy ? ' · ' : ''}
              {row.createdBy ? t('attendance.shiftsPage.hours.by', { name: row.createdBy }) : ''}
            </div>
          )}
          {withTakeBack &&
            !row.isFirst &&
            (confirmRemove === row.shiftHoursId ? (
              <div className="shift-hours-confirm">
                <span>{t('attendance.shiftsPage.hours.confirm')}</span>
                <Button size="compact-xs" color="red" onClick={() => void takeBack(row)} disabled={removing || saving}>
                  {removing ? t('attendance.shiftsPage.hours.takingBack') : t('attendance.shiftsPage.hours.yesTakeBack')}
                </Button>
                <Button size="compact-xs" variant="default" onClick={() => setConfirmRemove(null)} disabled={removing}>
                  {t('common.no')}
                </Button>
              </div>
            ) : (
              <ActionIcon
                className="shift-hours-remove"
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={t('attendance.shiftsPage.hours.takeBackAria', { day: formatDayLabel(row.effectiveFrom) })}
                title={t('attendance.shiftsPage.hours.takeBackTitle')}
                disabled={saving || removing}
                onClick={() => setConfirmRemove(row.shiftHoursId)}
              >
                <IconX size={14} />
              </ActionIcon>
            ))}
        </li>
      ))}
    </ul>
  )

  /* PORT NOTE: the DX SearchPanel is the global-search box below and the FilterRow is the strip
     under the header; the explicit start alignment on the Grace/Break columns is the plain
     table's natural alignment. */
  const columns = useMemo(
    () => [
      columnHelper.accessor('name', { header: t('attendance.shiftsPage.col.shift') }),
      // 'HH:mm:ss' underneath, 'HH:mm' on screen — the filter takes the shorter one.
      columnHelper.accessor('startTime', {
        header: t('attendance.shiftsPage.col.start'),
        cell: (info) => <span>{formatClock(info.row.original.startTime)}</span>,
        meta: { filterText: formatClock },
      }),
      columnHelper.accessor('endTime', {
        header: t('attendance.shiftsPage.col.end'),
        cell: (info) => <span>{formatClock(info.row.original.endTime)}</span>,
        meta: { filterText: formatClock },
      }),
      columnHelper.accessor('graceMinutes', {
        header: t('attendance.shiftsPage.col.grace'),
        cell: (info) => (
          <span title={t('attendance.shiftsPage.col.graceTitle')}>
            {graceText(info.row.original.graceMinutes)}
          </span>
        ),
        meta: { filterText: graceText },
      }),
      columnHelper.accessor('breakMinutes', {
        header: t('attendance.shiftsPage.col.break'),
        cell: (info) => (
          <span title={t('attendance.shiftsPage.col.breakTitle')}>
            {minutesText(info.row.original.breakMinutes)}
          </span>
        ),
        meta: { filterText: (v) => minutesText(Number(v)) },
      }),
      columnHelper.accessor('crossesMidnight', {
        header: t('attendance.shiftsPage.col.crossesMidnight'),
        cell: (info) => <MidnightCell crosses={info.row.original.crossesMidnight} />,
        meta: { filterText: midnightText, filterOptions: midnightLabels() },
      }),
      columnHelper.accessor('isActive', {
        header: t('attendance.shiftsPage.col.status'),
        cell: (info) => <ActiveCell isActive={info.row.original.isActive} />,
        meta: { filterText: activeText, filterOptions: activeLabels() },
      }),
      // Managers open Edit (the history and the change log are inside it); everyone else opens the History window.
      columnHelper.display({
        id: 'actions',
        header: t('attendance.shiftsPage.col.actions'),
        cell: (info) => (
          <div className="grid-actions">
            {canManage ? (
              <Button
                variant="subtle"
                size="compact-sm"
                onClick={() => openEdit(info.row.original)}
              >
                {t('attendance.shiftsPage.edit')}
              </Button>
            ) : (
              <Button variant="subtle" size="compact-sm" onClick={() => openHistory(info.row.original)}>
                {t('attendance.shiftsPage.history.button')}
              </Button>
            )}
          </div>
        ),
      }),
    ],
    [canManage, openEdit, openHistory, t],
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
  const changesHours = editing != null && hoursDiffer(form, editing)
  const timeProblem = describeTimeProblem(form)
  const previewMinutes = timeProblem ? null : fullDayMinutes(form)

  const num = (v: number | string) => (typeof v === 'number' ? v : 0)

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('attendance.shiftsPage.title')}</h1>
          <p className="page-subtitle">{t('attendance.shiftsPage.subtitle')}</p>
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
          {canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
              {t('attendance.shiftsPage.newShift')}
            </Button>
          )}
        </div>
      </div>

      <PageHelp>{t('attendance.shiftsPage.help')}</PageHelp>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <div className="card">
        <p className="hint">{t('attendance.shiftsPage.noRosterHint')}</p>
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
              placeholder={t('attendance.shiftsPage.search')}
              leftSection={<IconSearch size={14} />}
              w={240}
              size="xs"
            />
          </Group>

          <div className="table-scroll">
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
                        {t('attendance.shiftsPage.noMatch')}
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
          </div>

          <Group justify="space-between" p="xs">
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
      ) : (
        // Nothing to show. If the load FAILED, the alert above already explains why, and
        // the page must not ALSO claim there are no shifts — an empty list and an unread
        // list are different things, and only one of them is the user's to fix.
        !error && (
          <div className="card">
            <div className="empty-hint">
              <div className="empty-hint-main">{t('attendance.shiftsPage.emptyTitle')}</div>
              {canManage ? t('attendance.shiftsPage.emptyManage') : t('attendance.shiftsPage.emptyRead')}
            </div>
          </div>
        )
      )}

      <Modal
        opened={popupVisible}
        onClose={() => setPopupVisible(false)}
        title={editing ? t('attendance.shiftsPage.editTitle', { name: editing.name }) : t('attendance.shiftsPage.newShift')}
        size={520}
        centered
      >
        {formError && (
          <div className="alert alert--error" role="alert">
            {formError}
          </div>
        )}

        <div className="form-field">
          <label className="form-label" htmlFor="shift-name">
            {t('attendance.shiftsPage.form.name')}
          </label>
          <TextInput
            id="shift-name"
            value={form.name}
            onChange={(e) => {
              const value = e.currentTarget.value
              setForm((f) => ({ ...f, name: value }))
            }}
            placeholder={t('attendance.shiftsPage.form.namePlaceholder')}
            disabled={saving}
          />
        </div>

        <div className="form-grid">
          <div className="form-field">
            <label className="form-label" htmlFor="shift-start">
              {t('attendance.shiftsPage.form.start')}
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
              {t('attendance.shiftsPage.form.end')}
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
            {t('attendance.shiftsPage.form.grace')}
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
            placeholder={t('attendance.shiftsPage.values.toleranceSetting')}
            disabled={saving}
          />
          <p className="hint">{t('attendance.shiftsPage.form.graceHint')}</p>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="shift-break">
            {t('attendance.shiftsPage.form.break')}
          </label>
          <NumberInput
            id="shift-break"
            value={form.breakMinutes}
            onChange={(v) => setForm((f) => ({ ...f, breakMinutes: num(v) }))}
            min={0}
            disabled={saving}
          />
          <p className="hint">{t('attendance.shiftsPage.form.breakHint')}</p>
        </div>

        <div className="form-field">
          <Checkbox
            checked={form.crossesMidnight}
            onChange={(e) => {
              const checked = e.currentTarget.checked
              setForm((f) => ({ ...f, crossesMidnight: checked }))
            }}
            label={t('attendance.shiftsPage.form.crossesMidnight')}
            disabled={saving}
          />
          <p className="hint">{t('attendance.shiftsPage.form.crossesMidnightHint')}</p>
        </div>

        {editing && (
          <div className="form-field">
            <Checkbox
              checked={form.isActive}
              onChange={(e) => {
                const checked = e.currentTarget.checked
                setForm((f) => ({ ...f, isActive: checked }))
              }}
              label={t('attendance.shiftsPage.form.active')}
              disabled={saving}
            />
            <p className="hint">{t('attendance.shiftsPage.form.activeHint')}</p>
          </div>
        )}

        {editing && changesHours && (
          <div className="form-section shift-hours-when">
            <h3 className="form-section-title">{t('attendance.shiftsPage.form.whenTitle')}</h3>
            <div className="form-grid">
              <div className="form-field">
                <label className="form-label" htmlFor="shift-hours-from">
                  {t('attendance.shiftsPage.form.from')}
                </label>
                <TextInput
                  id="shift-hours-from"
                  type="date"
                  value={hoursFrom}
                  onChange={(e) => setHoursFrom(e.currentTarget.value)}
                  disabled={saving}
                />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="shift-hours-to">
                  {t('attendance.shiftsPage.form.until')}
                </label>
                <TextInput
                  id="shift-hours-to"
                  type="date"
                  value={hoursTo}
                  min={hoursFrom || undefined}
                  onChange={(e) => setHoursTo(e.currentTarget.value)}
                  disabled={saving}
                />
              </div>
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="shift-hours-note">
                {t('attendance.shiftsPage.form.reason')}
              </label>
              <TextInput
                id="shift-hours-note"
                value={hoursNote}
                maxLength={200}
                onChange={(e) => setHoursNote(e.currentTarget.value)}
                placeholder={t('attendance.shiftsPage.form.reasonPlaceholder')}
                disabled={saving}
              />
            </div>
            <p className="hint">
              {hoursTo
                ? t('attendance.shiftsPage.form.whenPeriod', {
                    from: formatDayLabel(hoursFrom),
                    to: formatDayLabel(hoursTo),
                    hours: `${formatClock(editing.startTime)}–${formatClock(editing.endTime)}`,
                  })
                : t('attendance.shiftsPage.form.whenOpen', { from: formatDayLabel(hoursFrom) })}{' '}
              {t('attendance.shiftsPage.form.whenAfter')}
            </p>
          </div>
        )}

        {editing && (history || historyError) && (
          <div className="form-field">
            <span className="form-label">{t('attendance.shiftsPage.history.hoursTitle')}</span>
            {historyError && <p className="hint">{historyError}</p>}
            {history && hoursList(history, canManage)}
          </div>
        )}

        {editing && <ShiftChangeLog changes={changes} error={changesError} />}

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
                {t('attendance.shiftsPage.form.previewLead')} <strong>{formatMinutes(previewMinutes)}</strong>{' '}
                {t('attendance.shiftsPage.form.previewRest', {
                  start: formatClock(form.startTime),
                  end: formatClock(form.endTime),
                  nextMorning: form.crossesMidnight ? t('attendance.shiftsPage.form.nextMorning') : '',
                  break: formatMinutes(form.breakMinutes),
                })}
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
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submitShift()} disabled={saving}>
            {saving ? t('common.saving') : editing ? t('attendance.shiftsPage.form.save') : t('attendance.shiftsPage.form.create')}
          </Button>
        </div>
      </Modal>

      <Modal
        opened={historyFor != null}
        onClose={() => setHistoryFor(null)}
        title={historyFor ? t('attendance.shiftsPage.history.title', { name: historyFor.name }) : ''}
        size={520}
        centered
      >
        {(history || historyError) && (
          <div className="form-field">
            <span className="form-label">{t('attendance.shiftsPage.history.hoursTitle')}</span>
            {historyError && <p className="hint">{historyError}</p>}
            {history && hoursList(history, false)}
          </div>
        )}
        {!history && !historyError && !changes && !changesError && (
          <div className="page-loading">
            <Loader size={28} />
          </div>
        )}
        <ShiftChangeLog changes={changes} error={changesError} />
        <div className="form-actions">
          <Button variant="default" onClick={() => setHistoryFor(null)}>
            {t('common.close')}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
