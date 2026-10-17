import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ActionIcon,
  Button,
  Checkbox,
  Loader,
  MultiSelect,
  Select,
  Tooltip,
} from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { DatePickerInput } from '@mantine/dates'
import { DateRangeField } from '../../components/DateRangeField'
import { t } from '../../i18n/t'
import { notifications } from '@mantine/notifications'
import {
  IconCalendar,
  IconCalendarEvent,
  IconCalendarRepeat,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconLock,
  IconPinFilled,
  IconPlus,
  IconRefresh,
  IconSettings,
} from '@tabler/icons-react'
import { rosterService, shiftsService } from '../../services/attendanceService'
import { autoRosterService } from '../../services/autoRosterService'
import { holidaysService } from '../../services/coreService'
import { branchesService, employeesService } from '../../services/hrService'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { useLive } from '../../live/useLive'
import { useLiveEnabled } from '../../live/useLiveSettings'
import { PageHelp } from '../../components/PageHelp'
import { PERMISSIONS } from '../../types/attendance'
import type {
  AutoRosterIssue,
  AutoRosterRequest,
  AutoRosterSetup,
  RosterCellInfo,
  RosterGap,
  Shift,
  ShiftAssignment,
  ShiftPatternUpsertRequest,
} from '../../types/attendance'
import type { Holiday } from '../../types/core'
import type { Branch, EmployeeListItem, LeaveDay } from '../../types/hr'
import {
  currentPeriod,
  daysInPeriod,
  formatDate,
  formatDayLabel,
  isWeekend,
  periodLabel,
  periodRange,
  previousPeriod,
  weekdayInitial,
} from './attendanceFormat'
import { useApprovedLeaveDays } from './useApprovedLeaveDays'
import { RosterApprovalBanner } from './RosterApprovalBanner'
import type { RosterEditState } from './RosterApprovalBanner'
import { chevronBack, chevronForward } from '../../i18n/physical'
import { referenceName } from '../../i18n/referenceName'
import { AutoRosterDrawer } from './AutoRosterDrawer'
import { AutoRosterPreviewCard } from './AutoRosterPreviewCard'
import { useRosterDraft } from './useRosterDraft'
import type { DraftCell } from './useRosterDraft'
import { daysMovedUnderDraft } from './rosterDraftCells'
import {
  employeeCounts,
  isMonday,
  onDutyByDay,
  onDutyUnderDraft,
  rosterWindow,
  staffingForDay,
  stripText,
  weekStartsBetween,
  weekStrip,
} from './rosterCounters'
import type { CounterCell, EmployeeCounts, StripWeek } from './rosterCounters'

/**
 * The roster matrix. Employees down the side, days across the top, one month at a time.
 *
 * This is deliberately a hand-rolled <table> and not a DataGrid: the whole point of the
 * screen is dragging across a run of cells to set a week at a time, and a DataGrid cannot
 * do a rectangular drag-selection across its cells.
 */

/**
 * A stable colour per shift, so "the green one" means the same thing on every row and in
 * the legend. Assigned by the shift's position in the list, not by its id, so the palette
 * stays contiguous even after shifts are deleted.
 */
const SHIFT_COLORS = [
  '#7d8f69',
  '#5b7c99',
  '#4a4a52',
  '#b07d4a',
  '#8a6f9e',
  '#6f8a86',
]

/** Monday first, because the weekday mask the API expects ('1111100' = Mon–Fri) is Monday first. */
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAY_FULL = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

/** Mon–Fri on, weekend off: the shape most coffee-shop rosters actually start from. */
const DEFAULT_WEEKDAYS = [true, true, true, true, true, false, false]

/** The month after a 'yyyy-MM' period — the other half of the previous/next pair. */
function nextPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number)
  const date = new Date(year, month, 1)
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`
}

/** A shift's start/end as 'HH:mm'. The API sends '08:00:00'; the seconds are noise here. */
function clockTime(value: string | null): string {
  return value ? value.slice(0, 5) : '—'
}

/**
 * The direction-aware "previous"/"next" chevrons. chevronBack() still speaks DevExtreme's icon
 * vocabulary ('chevronleft'/'chevronright') so it keeps working for both directions; here it is
 * mapped onto the Tabler glyphs.
 */
function BackChevron() {
  return chevronBack() === 'chevronleft' ? (
    <IconChevronLeft size={16} />
  ) : (
    <IconChevronRight size={16} />
  )
}

function ForwardChevron() {
  return chevronForward() === 'chevronleft' ? (
    <IconChevronLeft size={16} />
  ) : (
    <IconChevronRight size={16} />
  )
}

/**
 * One employee-day: the key of both the assignment lookup and the drag selection.
 *
 * The date is TRUNCATED TO 'yyyy-MM-dd' here, and that is the whole point of this function.
 * The two sides of the lookup arrive in different shapes: the API serialises WorkDate (a SQL
 * DATE) as a full .NET timestamp — "2026-06-02T00:00:00" — while the matrix's columns come from
 * daysInPeriod(), which yields "2026-06-02". Keying on the raw strings means every lookup misses,
 * every cell renders as an empty hole, and a roster that saved perfectly well looks like it never
 * saved at all. Normalising in ONE place is what stops the two shapes ever meeting.
 */
function cellKey(employeeId: number, workDate: string): string {
  return `${employeeId}|${workDate.slice(0, 10)}`
}

/** Always yields a plain 'yyyy-MM-dd' workDate, because cellKey only ever stores one. */
function parseCellKey(key: string): { employeeId: number; workDate: string } {
  const [employeeId, workDate] = key.split('|')
  return { employeeId: Number(employeeId), workDate }
}

/** The date number shown in the column header: '2026-06-03' → '3'. */
function dayNumber(date: string): string {
  return String(Number(date.slice(8, 10)))
}

interface SetDayFormState {
  shiftId: number | null
  isRestDay: boolean
  /** "Keep when regenerating". Only sent when the box was touched — see pinTouched. */
  isPinned: boolean
}

/**
 * A cell as the grid draws it, whichever side it comes from: the draft (a preview is open) or the
 * saved row. Normalised here so the drawing, the counters and the dialog read one shape.
 */
interface ShownCell {
  state: 'work' | 'rest' | 'none'
  shiftId: number | null
  /** The saved row, when the cell is not a draft cell — it carries the shift's name and times. */
  saved?: ShiftAssignment
  draft?: DraftCell
}

function shownFromSaved(saved: ShiftAssignment | undefined): ShownCell | undefined {
  if (!saved) return undefined
  return {
    state: saved.isRestDay ? 'rest' : saved.shiftId != null ? 'work' : 'none',
    shiftId: saved.isRestDay ? null : saved.shiftId,
    saved,
  }
}

function shownFromDraft(cell: DraftCell): ShownCell {
  const state = cell.state === 'work' || cell.state === 'rest' ? cell.state : 'none'
  return { state, shiftId: state === 'work' ? cell.shiftId : null, draft: cell }
}

/** A reason code with its figures, in words: 'Rest: owed a weekend day off · owed 0.9'. */
function reasonText(code: string | null, args: string | null): string {
  if (!code) return ''
  let text = t(`attendance.roster.auto.reason.${code}`, { defaultValue: code })
  if (args) {
    try {
      const parsed = JSON.parse(args) as Record<string, unknown>
      const parts = Object.entries(parsed)
        .filter(([key, value]) => value != null && key !== 'holiday')
        .map(([key, value]) =>
          t(`attendance.roster.auto.reasonArgs.${key}`, {
            value: typeof value === 'number' ? Math.round(value * 100) / 100 : String(value),
            defaultValue: `${key} ${String(value)}`,
          }),
        )
      if (typeof parsed.holiday === 'string') text = `${text} — ${parsed.holiday}`
      if (parts.length > 0) text = `${text} · ${parts.join(' · ')}`
    } catch {
      /* not JSON: the code alone still says why */
    }
  }
  return text
}

/** One week of the strip, in words, for its tooltip. */
function stripWeekTitle(week: StripWeek): string {
  const parts = [t('attendance.roster.auto.strip.week', { count: week.rests, date: formatDayLabel(week.weekStart) })]
  if (week.type != null) parts.push(t('attendance.roster.auto.strip.type', { type: week.type }))
  if (week.ok === false) {
    parts.push(
      week.quota != null
        ? t('attendance.roster.auto.strip.should', { quota: week.quota })
        : t('attendance.roster.auto.strip.broken'),
    )
  }
  if (week.ok === null) parts.push(t('attendance.roster.auto.strip.unjudged'))
  return parts.join(' · ')
}

/** The trailing summary column of one row: Work · Rest · Sat · Sun · the 6·5 strip. */
function SummaryCells({
  counts,
  strip,
  owed,
}: {
  counts: EmployeeCounts
  strip: StripWeek[]
  owed: { sat: number; sun: number } | null
}) {
  return (
    <div className="roster-sum-grid">
      <span title={t('attendance.roster.auto.sum.workTitle')}>{counts.workDays}</span>
      <span title={t('attendance.roster.auto.sum.restTitle')}>{counts.restDays}</span>
      <span
        title={
          owed
            ? t('attendance.roster.auto.sum.owed', { sat: owed.sat.toFixed(1), sun: owed.sun.toFixed(1) })
            : t('attendance.roster.auto.sum.satTitle')
        }
      >
        {counts.saturdaysOff}
      </span>
      <span
        title={
          owed
            ? t('attendance.roster.auto.sum.owed', { sat: owed.sat.toFixed(1), sun: owed.sun.toFixed(1) })
            : t('attendance.roster.auto.sum.sunTitle')
        }
      >
        {counts.sundaysOff}
      </span>
      <span className="roster-strip" aria-label={stripText(strip)}>
        {strip.map((week) => (
          <span
            key={week.weekStart}
            className={
              week.ok === false
                ? 'roster-strip-week roster-strip-week--bad'
                : week.ok === null
                  ? 'roster-strip-week roster-strip-week--na'
                  : 'roster-strip-week'
            }
            title={stripWeekTitle(week)}
          >
            {week.type ?? '–'}
          </span>
        ))}
      </span>
    </div>
  )
}

interface GenerateFormState {
  employeeIds: number[]
  fromDate: string
  toDate: string
  shiftId: number | null
  weekdays: boolean[]
  overwrite: boolean
}

interface PatternRow {
  dayOfWeek: number
  shiftId: number | null
  isRestDay: boolean
}

/**
 * The sentence that has to appear under every "Overwrite existing" tick box. Overwriting is
 * the one action on this page that can silently destroy work HR already did by hand.
 */
/**
 * What a generation is about to do to people's approved leave, BEFORE it runs.
 *
 * The user is told, and then allowed to proceed — deliberately. Silently skipping the days would
 * be the same screen either way, and somebody who genuinely wants to roster over a cancelled
 * holiday would have no way to tell whether the system had understood them. Naming the days is
 * what makes it a decision rather than a surprise.
 */
function LeavePreflight({
  days,
  employeeName,
  error,
}: {
  days: LeaveDay[]
  employeeName: (employeeId: number) => string
  error: string | null
}) {
  // Leave could not be read. Say so loudly: proceeding might roster somebody over their holiday,
  // and pretending the check passed would be the one genuinely dishonest option here.
  if (error) {
    return (
      <div className="alert alert--error" role="alert">
        Approved leave could not be checked, so this may schedule somebody over their
        holiday. {error}
      </div>
    )
  }

  if (days.length === 0) return null

  return (
    <div className="card" style={{ marginBottom: 14, borderInlineStart: '4px solid #2e7d4f' }}>
      <div className="empty-hint-main">
        {days.length} of these days fall on approved leave and will be left as leave, not
        scheduled.
      </div>
      <ul className="hint" style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
        {days.map((day) => (
          <li key={`${day.employeeId}|${day.date}`}>
            {employeeName(day.employeeId)} — {formatDate(day.date)}
            {day.daysOnLeave !== 1 && ` (${day.daysOnLeave} days booked on this date)`}
          </li>
        ))}
      </ul>
    </div>
  )
}

function OverwriteField({
  value,
  onChange,
  disabled,
}: {
  value: boolean
  onChange: (value: boolean) => void
  disabled: boolean
}) {
  return (
    <div className="form-field">
      <Checkbox
        label="Overwrite existing"
        checked={value}
        onChange={(e) => onChange(e.currentTarget.checked)}
        disabled={disabled}
      />
      <div className="hint">
        Leave this off to keep manual changes you have already made.
      </div>
    </div>
  )
}

export default function RosterPage() {
  const { hasPermission, user } = useAuth()
  // Rostering is an ATTENDANCE_MANAGE job. A viewer sees the month but no way to change it.
  const canManage = hasPermission(PERMISSIONS.manage)

  /* ?period=yyyy-MM opens the page ON that month — the "Worked without roster" list links here for the month the
     unrostered day is in. Read once: after that the picker owns the month. */
  const [searchParams] = useSearchParams()
  const [period, setPeriod] = useState(() => {
    const asked = searchParams.get('period')
    return asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : currentPeriod()
  })
  /* THE BRANCH FILTER. "All branches" by default. One branch = the roster rows of the people who belonged to it ON
     each work date (the API decides that, from the branch history), so a transferred employee's earlier days stay with
     the branch they were in. Remembered per user, in this browser: a branch manager opens the page on their branch. */
  const branchKey = `mokaco.roster.branch.${user?.username ?? ''}`
  const [branchFilter, setBranchFilter] = useState<number | null>(() => {
    try {
      return Number(localStorage.getItem(branchKey)) || null
    } catch {
      return null
    }
  })
  const [branches, setBranches] = useState<Branch[]>([])
  useEffect(() => {
    // Without EMP_VIEW the list is refused: no filter is offered, and the page works as before.
    branchesService
      .getAll()
      .then(setBranches)
      .catch(() => setBranches([]))
  }, [])
  function chooseBranch(next: number | null) {
    try {
      if (next == null) localStorage.removeItem(branchKey)
      else localStorage.setItem(branchKey, String(next))
    } catch {
      /* private window: the filter still works, it is just not remembered */
    }
    setLoading(true)
    clearSelection()
    setBranchFilter(next)
  }

  const [allEmployees, setEmployees] = useState<EmployeeListItem[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [allGaps, setGaps] = useState<RosterGap[]>([])
  const [loading, setLoading] = useState(true)

  /** The auto-roster's draft, drawn over the grid while a preview is open. Nothing in it is saved until Save. */
  const draft = useRosterDraft()

  /* WHO IS ON THE GRID under a branch filter: the people in that branch today, plus anybody with a roster row the API
     attributed to it this month (someone transferred out since still shows on the days that were this branch's), plus
     anybody the open draft plans a day for (someone transferring IN later this month has no row here yet).
     Everything below — the grid, the gaps banner, the pickers in the dialogs — reads these filtered lists.
     `assignments` covers the whole Monday–Sunday window; only the month's rows decide who is shown. */
  const employees = useMemo(() => {
    if (branchFilter == null) return allEmployees
    const branchName = branches.find((b) => b.branchId === branchFilter)?.name
    const { from, to } = periodRange(period)
    const rostered = new Set(
      assignments
        .filter((a) => a.workDate.slice(0, 10) >= from && a.workDate.slice(0, 10) <= to)
        .map((a) => a.employeeId),
    )
    for (const cell of draft.cells.values()) {
      if (cell.workDate >= from && cell.workDate <= to) rostered.add(cell.employeeId)
    }
    return allEmployees.filter((e) => e.branch === branchName || rostered.has(e.employeeId))
  }, [allEmployees, assignments, branches, branchFilter, period, draft.cells])
  const gaps = useMemo(() => {
    if (branchFilter == null) return allGaps
    const visible = new Set(employees.map((e) => e.employeeId))
    return allGaps.filter((g) => visible.has(g.employeeId))
  }, [allGaps, employees, branchFilter])
  const [error, setError] = useState<string | null>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const selectedRef = useRef<Set<string>>(new Set())
  const draggingRef = useRef(false)
  const anchorRef = useRef<{ row: number; col: number } | null>(null)

  /* WHETHER THE MONTH MAY BE EDITED, as the approval banner reports it. Read-only while a request
     is open on the month: the server refuses every cell edit then, so the grid stops offering them
     rather than collecting the 409 per click. Starts editable — a banner that cannot answer (no
     branch chosen, older API) leaves the server's refusal as the rule, exactly as before. */
  const [editState, setEditState] = useState<RosterEditState>({
    readOnly: false,
    openRequestId: null,
    changedSinceApproval: false,
  })
  const editable = canManage && !editState.readOnly
  /** Bumped after every roster write, so the banner re-reads the month's status. */
  const [rosterVersion, setRosterVersion] = useState(0)

  const [setDayVisible, setSetDayVisible] = useState(false)
  /** The server's refusal of a set-day, kept IN the dialog the person is looking at. */
  const [setDayError, setSetDayError] = useState<string | null>(null)
  const [setDayForm, setSetDayForm] = useState<SetDayFormState>({
    shiftId: null,
    isRestDay: false,
    isPinned: false,
  })
  /* A pin is only sent when the box was touched: a multi-day selection starts unticked, and saving
     that untouched would silently unpin every pinned day in it. */
  const [pinTouched, setPinTouched] = useState(false)
  /** One selected cell's pin as it was when the dialog opened (null = none known). */
  const [pinInitial, setPinInitial] = useState<boolean | null>(null)
  const [generateVisible, setGenerateVisible] = useState(false)
  const [generateForm, setGenerateForm] = useState<GenerateFormState>({
    employeeIds: [],
    fromDate: periodRange(currentPeriod()).from,
    toDate: periodRange(currentPeriod()).to,
    shiftId: null,
    weekdays: DEFAULT_WEEKDAYS,
    overwrite: false,
  })
  const [copyVisible, setCopyVisible] = useState(false)
  const [copyOverwrite, setCopyOverwrite] = useState(false)
  const [applyVisible, setApplyVisible] = useState(false)
  const [applyOverwrite, setApplyOverwrite] = useState(false)
  const [patternsVisible, setPatternsVisible] = useState(false)
  const [patternEmployeeId, setPatternEmployeeId] = useState<number | null>(
    null,
  )
  const [patternRows, setPatternRows] = useState<PatternRow[]>([])
  const [patternsLoading, setPatternsLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const days = useMemo(() => daysInPeriod(period), [period])

  /**
   * Who is on approved leave this month.
   *
   * Deliberately fetched through a hook rather than inline: leave has no proper home yet
   * (workflow.LEAVE_REQUEST does not exist), so the roster asks the QUESTION and lets one file own
   * the answer. See useApprovedLeaveDays.
   *
   * Read over the WINDOW (whole Monday–Sunday weeks around the month), not the month: the 6·5 strip
   * judges the first and last weeks too, and a leave day there is what excuses a short week. Every
   * dialog below still filters to the month (leaveRange) before it names or rewrites a day.
   */
  const leaveRange = useMemo(() => periodRange(period), [period])
  const windowRange = useMemo(() => rosterWindow(leaveRange.from, leaveRange.to), [leaveRange])
  const leave = useApprovedLeaveDays(windowRange.from, windowRange.to)

  /* ── AUTO-ROSTER (docs/AUTO_ROSTER.md §5) ── */

  const [autoOpen, setAutoOpen] = useState(false)
  /**
   * The saved rows and pins the page held when the draft's preview was asked for. Measured against
   * the rows read since, they tell a roster that moved under the draft from a re-read that changed
   * nothing — see daysMovedUnderDraft.
   */
  const [draftBase, setDraftBase] = useState<{
    rows: Map<string, ShiftAssignment>
    pins: Map<string, RosterCellInfo> | null
  } | null>(null)

  /* THE BRANCH THE AUTO-ROSTER PLANS. It plans one branch-month, so "All branches" has none — unless
     there is only one active branch, when the filter is not even offered and "all" IS that branch. */
  const activeBranches = useMemo(() => branches.filter((b) => b.isActive), [branches])
  const autoBranchId =
    branchFilter ?? (activeBranches.length === 1 ? activeBranches[0].branchId : null)
  const autoBranchName = branches.find((b) => b.branchId === autoBranchId)?.name ?? ''

  /* The branch-month's auto-roster setup: the drawer opens on it, and outside a preview the footer
     measures the day against its minimums. An API without the endpoint simply has neither. */
  const [setup, setSetup] = useState<AutoRosterSetup | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [setupVersion, setSetupVersion] = useState(0)
  useEffect(() => {
    let cancelled = false
    setSetup(null)
    setSetupError(null)
    if (autoBranchId == null) return
    autoRosterService
      .setup(autoBranchId, period)
      .then((result) => {
        if (!cancelled) setSetup(result)
      })
      .catch((err) => {
        if (!cancelled) setSetupError(getErrorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [autoBranchId, period, setupVersion])

  /** Public holidays: shaded columns, and a day with no row on one is a day off rather than a hole. */
  const [holidays, setHolidays] = useState<Holiday[]>([])
  useEffect(() => {
    let cancelled = false
    holidaysService
      .getAll(Number(period.slice(0, 4)), autoBranchId)
      .then((list) => {
        if (!cancelled) setHolidays(list)
      })
      .catch(() => {
        // Without them the grid is the grid it always was; the auto-roster reads holidays server side.
        if (!cancelled) setHolidays([])
      })
    return () => {
      cancelled = true
    }
  }, [period, autoBranchId])
  /** Date → holiday. A branch's own holidays only show under that branch; "all branches" shows the company's. */
  const holidayByDate = useMemo(() => {
    const map = new Map<string, Holiday>()
    for (const h of holidays) {
      if (h.branchId != null && h.branchId !== autoBranchId) continue
      map.set(h.holidayDate.slice(0, 10), h)
    }
    return map
  }, [holidays, autoBranchId])

  /**
   * The same question again, for the Generate dialog's OWN range — which the user can set outside
   * the month on screen (a new hire starting mid-June, covered into July). Asking the month's hook
   * would silently under-report leave for exactly the days it was not fetched for, and a pre-flight
   * that under-reports is worse than none: it tells the user their holiday is safe when it is not.
   */
  const generateLeave = useApprovedLeaveDays(
    generateForm.fromDate,
    generateForm.toDate,
  )

  /** Employee-day → what they were supposed to work. A missing key is a HOLE, not a rest day. */
  const lookup = useMemo(() => {
    const map = new Map<string, ShiftAssignment>()
    for (const assignment of assignments) {
      map.set(cellKey(assignment.employeeId, assignment.workDate), assignment)
    }
    return map
  }, [assignments])

  const shiftColor = useMemo(() => {
    const map = new Map<number, string>()
    shifts.forEach((shift, index) => {
      map.set(shift.shiftId, SHIFT_COLORS[index % SHIFT_COLORS.length])
    })
    return map
  }, [shifts])

  /**
   * The pre-flight names people, because "employee 10 is on leave" is not something anybody can act
   * on. Falls back to the id only if the employee list failed to load, which is still better than
   * hiding the day.
   */
  const employeeName = useCallback(
    (employeeId: number) =>
      employees.find((e) => e.employeeId === employeeId)?.fullName ??
      `Employee ${employeeId}`,
    [employees],
  )

  const shiftById = useMemo(() => {
    const map = new Map<number, Shift>()
    for (const shift of shifts) map.set(shift.shiftId, shift)
    return map
  }, [shifts])

  /* PINS AND "SET BY THE AUTO-ROSTER" MARKERS of the saved days (ROSTER_CELL), for the branch the
     auto-roster plans. Re-read with every load. An API without the endpoint leaves the map empty,
     and the pin box stays hidden outside a preview. */
  const [cellInfo, setCellInfo] = useState<Map<string, RosterCellInfo> | null>(null)
  useEffect(() => {
    let cancelled = false
    if (autoBranchId == null) {
      setCellInfo(null)
      return
    }
    const { from, to } = periodRange(period)
    autoRosterService
      .cells(autoBranchId, from, to)
      .then((rows) => {
        if (!cancelled) setCellInfo(new Map(rows.map((r) => [cellKey(r.employeeId, r.workDate), r])))
      })
      .catch(() => {
        if (!cancelled) setCellInfo(null)
      })
    return () => {
      cancelled = true
    }
  }, [autoBranchId, period, rosterVersion])

  /** What a cell shows: the draft's day while a preview is open, else the saved row (draft ?? lookup). */
  const shownCell = useCallback(
    (key: string): ShownCell | undefined => {
      const planned = draft.active ? draft.cells.get(key) : undefined
      return planned ? shownFromDraft(planned) : shownFromSaved(lookup.get(key))
    },
    [draft.active, draft.cells, lookup],
  )
  // The window-level mouseup handler below is registered once, so it cannot see the current cells
  // through a closure. It reads them from here instead.
  const shownCellRef = useRef(shownCell)
  const cellInfoRef = useRef(cellInfo)
  // The preview reads the rows as the page holds them when it is asked for, not as a closure saw them.
  const lookupRef = useRef(lookup)
  useEffect(() => {
    shownCellRef.current = shownCell
    cellInfoRef.current = cellInfo
    lookupRef.current = lookup
  }, [shownCell, cellInfo, lookup])

  /* The roster rows are read over the WINDOW — the whole Monday–Sunday weeks around the month — so
     the 6·5 strip can judge the first and last weeks; the grid still draws only the month's days. */
  const load = useCallback(async () => {
    const { from, to } = periodRange(period)
    const span = rosterWindow(from, to)
    try {
      const [employeeList, shiftList, assignmentList, gapList] =
        await Promise.all([
          employeesService.getAll(),
          shiftsService.getAll(),
          rosterService.get(span.from, span.to, undefined, branchFilter ?? undefined),
          rosterService.getGaps(from, to),
        ])
      setEmployees(employeeList)
      setShifts(shiftList)
      setAssignments(assignmentList)
      setGaps(gapList)
      setError(null)
      // Every reload follows a write (or a Refresh), so the banner re-reads the month with it.
      setRosterVersion((v) => v + 1)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [period, branchFilter])

  useEffect(() => {
    let cancelled = false
    const { from, to } = periodRange(period)
    const span = rosterWindow(from, to)
    async function initialLoad() {
      try {
        const [employeeList, shiftList, assignmentList, gapList] =
          await Promise.all([
            employeesService.getAll(),
            shiftsService.getAll(),
            rosterService.get(span.from, span.to, undefined, branchFilter ?? undefined),
            rosterService.getGaps(from, to),
          ])
        if (!cancelled) {
          setEmployees(employeeList)
          setShifts(shiftList)
          setAssignments(assignmentList)
          setGaps(gapList)
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
  }, [period, branchFilter])

  function refresh() {
    setLoading(true)
    void load()
  }

  /* LIVE. A roster changes under this page from elsewhere — a shift swap applied, a colleague's edit — and its APPROVAL
     always does: the last approver signs on the Requests page. 'workflow' is the topic a decision raises, 'attendance'
     the one a roster write raises; either re-reads the month, and the banner re-reads its status with it. */
  useLive(['attendance', 'workflow'], () => void load(), useLiveEnabled('attendance'))

  /** Moving month re-fetches everything, so show the spinner rather than a stale grid. */
  function goToPeriod(next: string) {
    setLoading(true)
    clearSelection()
    setPeriod(next)
  }

  function applySelection(next: Set<string>) {
    selectedRef.current = next
    setSelected(next)
  }

  function clearSelection() {
    applySelection(new Set())
  }

  const openSetDayForSelection = useCallback(() => {
    const keys = [...selectedRef.current]
    if (keys.length === 0) return
    // One cell selected: show what it is now, so the popup edits rather than blanks it. With a draft
    // open that is the draft's day, not the saved row underneath it.
    if (keys.length === 1) {
      const existing = shownCellRef.current(keys[0])
      const pinned =
        existing?.draft != null
          ? (existing.draft.isPinned ?? existing.draft.origin === 'pinned')
          : (cellInfoRef.current?.get(keys[0])?.isPinned ?? false)
      setSetDayForm({
        shiftId: existing?.shiftId ?? null,
        isRestDay: existing?.state === 'rest',
        isPinned: pinned,
      })
      setPinInitial(existing?.draft != null ? existing.draft.isPinned : pinned)
    } else {
      setSetDayForm({ shiftId: null, isRestDay: false, isPinned: false })
      setPinInitial(null)
    }
    setPinTouched(false)
    setSetDayError(null)
    setSetDayVisible(true)
  }, [])

  // The drag can end anywhere — off the table, off the window — so the end of it is a
  // window-level event, not a cell event. Registered once and cleaned up on unmount.
  useEffect(() => {
    function endDrag() {
      if (!draggingRef.current) return
      draggingRef.current = false
      anchorRef.current = null
      openSetDayForSelection()
    }
    window.addEventListener('mouseup', endDrag)
    return () => {
      window.removeEventListener('mouseup', endDrag)
    }
  }, [openSetDayForSelection])

  /* A Regenerate or Save in flight answers with the cells it started from, so the grid takes no edit
     until it is back: one made meanwhile would vanish without a word, or be dropped by the save. */
  const draftBusy = draft.busy != null

  function startDrag(row: number, col: number) {
    if (!editable || draftBusy) return
    draggingRef.current = true
    anchorRef.current = { row, col }
    applySelection(new Set([cellKey(employees[row].employeeId, days[col])]))
  }

  function extendDrag(row: number, col: number) {
    const anchor = anchorRef.current
    if (!draggingRef.current || !anchor) return
    const firstRow = Math.min(anchor.row, row)
    const lastRow = Math.max(anchor.row, row)
    const firstCol = Math.min(anchor.col, col)
    const lastCol = Math.max(anchor.col, col)
    const next = new Set<string>()
    for (let r = firstRow; r <= lastRow; r++) {
      for (let c = firstCol; c <= lastCol; c++) {
        next.add(cellKey(employees[r].employeeId, days[c]))
      }
    }
    applySelection(next)
  }

  async function submitSetDay() {
    const keys = [...selectedRef.current]
    if (keys.length === 0) return
    if (!setDayForm.isRestDay && setDayForm.shiftId == null) {
      notifications.show({
        message: 'Pick a shift, or tick "Rest day".',
        color: 'red',
        autoClose: 4000,
      })
      return
    }

    // WITH A DRAFT OPEN, THE DIALOG EDITS THE DRAFT. No server call: the day is saved with the rest
    // of the draft, or thrown away with it.
    if (draft.active) {
      if (!draftBusy) applyToDraft(keys)
      return
    }

    setSaving(true)
    setSetDayError(null)
    let written = 0
    try {
      for (const key of keys) {
        const { employeeId, workDate } = parseCellKey(key)
        // Only pinning a day that already says this: re-writing the identical row would gain nothing
        // and could mark an approved month as changed.
        const current = lookup.get(key)
        const same =
          current != null &&
          (setDayForm.isRestDay
            ? current.isRestDay
            : !current.isRestDay && current.shiftId === setDayForm.shiftId)
        if (pinTouched && same) {
          written++
          continue
        }
        await rosterService.setDay({
          employeeId,
          workDate,
          // A rest day is an assignment with NO shift — not the absence of an assignment.
          shiftId: setDayForm.isRestDay ? null : setDayForm.shiftId,
          isRestDay: setDayForm.isRestDay,
        })
        written++
      }
      // The pin goes on after the day is written: only a saved day can be pinned. It changes no
      // roster row, so a refusal here leaves the days set and says so.
      if (pinTouched && cellInfo != null) {
        try {
          for (const key of keys) {
            const { employeeId, workDate } = parseCellKey(key)
            await autoRosterService.setPin({ employeeId, workDate, isPinned: setDayForm.isPinned })
          }
        } catch (err) {
          notifications.show({
            message: t('attendance.roster.auto.pin.failed', { error: getErrorMessage(err) }),
            color: 'red',
            autoClose: 6000,
          })
        }
      }
      notifications.show({
        message: `Set ${keys.length} day(s).`,
        color: 'green',
        autoClose: 2500,
      })
      setSetDayVisible(false)
      clearSelection()
      await load()
    } catch (err) {
      /* THE SERVER'S SENTENCE, IN THE DIALOG. A locked past day ("already in an approved roster
         and attendance was recorded — correct the attendance record instead") or an open request
         ("Waiting for approval — request #N …") is a 409 whose whole value is its wording, so it
         stays in front of the person with the cells still selected, rather than fading as a toast
         over a dialog that closed. A run that got part-way says how far, because those days ARE
         written. */
      const message = getErrorMessage(err)
      setSetDayError(
        written > 0 ? `${message} (${written} of ${keys.length} day(s) were set before this.)` : message,
      )
      notifications.show({ message, color: 'red', autoClose: 5000 })
      if (written > 0) await load()
    } finally {
      setSaving(false)
    }
  }

  /** The Set-day dialog during a preview: the selected days change in the draft only. */
  function applyToDraft(keys: string[]) {
    // Refused here rather than at Save: a holiday off is a day with NO row (D4), and a rest row on it
    // would hide the holiday from attendance (REST_ON_HOLIDAY).
    const onHoliday = keys.some((key) => {
      const { workDate } = parseCellKey(key)
      return holidayByDate.has(workDate) || draft.cells.get(key)?.origin === 'holiday'
    })
    if (setDayForm.isRestDay && onHoliday) {
      setSetDayError(t('attendance.roster.auto.edit.restOnHoliday'))
      return
    }

    /* A RETIRED SHIFT IS NEVER WRITTEN BY THE DRAFT. The dialog only offers one when it is the day's
       own (so the day still shows what it is), and the save checks every day it sends against the
       active shifts — an untouched day sent back with it would refuse the whole draft. So the day is
       left as it stands: nothing to do when only Set was pressed, and no way to pin it here. */
    const chosen = setDayForm.isRestDay || setDayForm.shiftId == null ? undefined : shiftById.get(setDayForm.shiftId)
    if (chosen && !chosen.isActive) {
      const pinChanged = pinTouched && setDayForm.isPinned !== (pinInitial ?? false)
      if (pinChanged) {
        setSetDayError(t('attendance.roster.auto.edit.inactivePin', { name: chosen.name }))
        return
      }
      notifications.show({
        message: t('attendance.roster.auto.edit.inactiveKept', { name: chosen.name }),
        color: 'gray',
        autoClose: 4000,
      })
      setSetDayVisible(false)
      clearSelection()
      return
    }
    const { applied, skipped } = draft.applyEdit(keys, {
      shiftId: setDayForm.isRestDay ? null : setDayForm.shiftId,
      isRestDay: setDayForm.isRestDay,
      isPinned: pinTouched ? setDayForm.isPinned : pinInitial,
    })
    if (applied === 0) {
      setSetDayError(t('attendance.roster.auto.edit.nothing'))
      return
    }
    notifications.show({
      message:
        t('attendance.roster.auto.edit.applied', { count: applied }) +
        (skipped > 0 ? ` ${t('attendance.roster.auto.edit.skipped', { count: skipped })}` : ''),
      color: skipped > 0 ? 'yellow' : 'green',
      autoClose: skipped > 0 ? 6000 : 2500,
    })
    setSetDayVisible(false)
    clearSelection()
  }

  /* ------------------------------------------------------------------------ *
   * LEAVE-AWARE GENERATION — A CLIENT-SIDE WORKAROUND. REMOVE WHEN SQL CATCHES UP.
   *
   * The stored generators (usp_ShiftAssignment_GenerateRange_Bulk / _CopyPeriod /
   * _ApplyPattern) know nothing about leave: they will happily put a working shift on
   * somebody's approved holiday. Teaching them is a schema-contract change, so until then
   * the page does it as a POST-STEP — generate first, then rewrite the leave days to rest.
   *
   * WHAT THIS COSTS, said plainly: it is not atomic. Between the generator returning and the
   * overwrite finishing, those days ARE rostered as working. Nothing reads the roster in that
   * window except a human refreshing the page, so the risk is cosmetic rather than payroll-
   * affecting — but it is real, and it is why this belongs in SQL.
   *
   * TO REMOVE: delete leaveDaysAffecting() and overwriteLeaveDays(), delete the three
   * `await overwriteLeaveDays(...)` calls in submitGenerate/submitCopy/submitApply, and drop
   * the pre-flight <LeavePreflight> from the three dialogs. Nothing else knows about this.
   * ------------------------------------------------------------------------ */

  /**
   * The leave days a generation is about to run over — the exact set the post-step will rewrite,
   * so what the pre-flight promises and what happens cannot drift apart.
   */
  function leaveDaysAffecting(
    source: LeaveDay[],
    employeeIds: number[] | null,
    fromDate: string,
    toDate: string,
    weekdayMask?: boolean[],
  ): LeaveDay[] {
    return source.filter((day) => {
      const date = day.date.slice(0, 10)
      if (date < fromDate || date > toDate) return false
      if (employeeIds !== null && !employeeIds.includes(day.employeeId)) return false

      // A generator only touches the weekdays it was asked for; days outside the mask are written
      // as rest anyway, so they are not a conflict worth reporting.
      if (weekdayMask) {
        // getDay(): 0 = Sunday. The mask is Monday-first, matching the API's '1111100'.
        const dow = new Date(`${date}T00:00:00`).getDay()
        const mondayFirst = dow === 0 ? 6 : dow - 1
        if (!weekdayMask[mondayFirst]) return false
      }

      return true
    })
  }

  /**
   * Rewrites each leave day to a rest day, so a generation cannot leave somebody rostered to work
   * their holiday. Uses the ordinary per-day endpoint — no special path, nothing the roster cannot
   * already do by hand.
   */
  async function overwriteLeaveDays(affected: LeaveDay[]): Promise<number> {
    for (const day of affected) {
      await rosterService.setDay({
        employeeId: day.employeeId,
        workDate: day.date.slice(0, 10),
        // A leave day is an assignment with NO shift. It is not an empty day — the roster still
        // has to state that this person was not expected to work.
        shiftId: null,
        isRestDay: true,
      })
    }
    return affected.length
  }

  function openGenerate(employeeIds: number[] = []) {
    const range = periodRange(period)
    setGenerateForm({
      employeeIds,
      fromDate: range.from,
      toDate: range.to,
      shiftId: shifts.length === 1 ? shifts[0].shiftId : null,
      weekdays: DEFAULT_WEEKDAYS,
      overwrite: false,
    })
    setGenerateVisible(true)
  }

  /** "Fix these" on the gap banner: same dialog, but aimed at the people who actually have holes. */
  function openGenerateForGaps() {
    openGenerate([...new Set(gaps.map((gap) => gap.employeeId))])
  }

  async function submitGenerate() {
    if (generateForm.employeeIds.length === 0 || generateForm.shiftId == null) {
      notifications.show({
        message: 'Pick at least one employee and a shift.',
        color: 'red',
        autoClose: 4000,
      })
      return
    }

    setSaving(true)
    try {
      const outcome = await rosterService.generateBulk({
        employeeIds: generateForm.employeeIds,
        fromDate: generateForm.fromDate,
        toDate: generateForm.toDate,
        shiftId: generateForm.shiftId,
        weekdays: generateForm.weekdays.map((on) => (on ? '1' : '0')).join(''),
        overwrite: generateForm.overwrite,
      })

      // Post-step: the SQL generator does not know about leave, so it has just rostered any
      // holiday in this range as a working day. Put those back. See the block comment above.
      const rewritten = await overwriteLeaveDays(
        leaveDaysAffecting(
          generateLeave.days,
          generateForm.employeeIds,
          generateForm.fromDate,
          generateForm.toDate,
          generateForm.weekdays,
        ),
      )

      notifications.show({
        message:
          `${outcome.employeesProcessed} employee(s) rostered.` +
          (rewritten > 0
            ? ` ${rewritten} approved-leave day(s) were left as leave, not scheduled.`
            : ''),
        color: 'green',
        autoClose: 3500,
      })
      setGenerateVisible(false)
      await Promise.all([load(), leave.reload()])
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSaving(false)
    }
  }

  async function submitCopy() {
    setSaving(true)
    try {
      const outcome = await rosterService.copyPeriod({
        sourceYearMonth: previousPeriod(period),
        targetYearMonth: period,
        employeeId: null,
        overwrite: copyOverwrite,
      })

      // Post-step: SQL does not know about leave. See the block comment above overwriteLeaveDays.
      const rewritten = await overwriteLeaveDays(
        leaveDaysAffecting(leave.days, null, leaveRange.from, leaveRange.to),
      )

      notifications.show({
        message:
          `Rostered ${outcome.rowsInserted} day(s).` +
          (rewritten > 0
            ? ` ${rewritten} approved-leave day(s) were left as leave, not scheduled.`
            : ''),
        color: 'green',
        autoClose: 3500,
      })
      setCopyVisible(false)
      await Promise.all([load(), leave.reload()])
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSaving(false)
    }
  }

  async function submitApplyPatterns() {
    setSaving(true)
    try {
      const outcome = await rosterService.applyPattern({
        yearMonth: period,
        employeeId: null,
        overwrite: applyOverwrite,
      })

      // Post-step: SQL does not know about leave. See the block comment above overwriteLeaveDays.
      const rewritten = await overwriteLeaveDays(
        leaveDaysAffecting(leave.days, null, leaveRange.from, leaveRange.to),
      )

      notifications.show({
        message:
          `Rostered ${outcome.rowsInserted} day(s).` +
          (rewritten > 0
            ? ` ${rewritten} approved-leave day(s) were left as leave, not scheduled.`
            : ''),
        color: 'green',
        autoClose: 3500,
      })
      setApplyVisible(false)
      await Promise.all([load(), leave.reload()])
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSaving(false)
    }
  }

  function openPatterns() {
    setPatternEmployeeId(null)
    setPatternRows([])
    setPatternsVisible(true)
  }

  async function loadPatterns(employeeId: number) {
    setPatternEmployeeId(employeeId)
    setPatternsLoading(true)
    try {
      const saved = await rosterService.getPatterns(employeeId)
      // The editor always shows all seven days, whether or not the employee has a row for
      // each: a default week with gaps in it is what put holes in the roster to begin with.
      setPatternRows(
        [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => {
          const match = saved.find((row) => row.dayOfWeek === dayOfWeek)
          return {
            dayOfWeek,
            shiftId: match?.shiftId ?? null,
            isRestDay: match?.isRestDay ?? false,
          }
        }),
      )
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
      setPatternRows([])
    } finally {
      setPatternsLoading(false)
    }
  }

  async function submitPatterns() {
    if (patternEmployeeId == null) return
    setSaving(true)
    try {
      const payload: ShiftPatternUpsertRequest[] = patternRows.map((row) => ({
        dayOfWeek: row.dayOfWeek,
        shiftId: row.isRestDay ? null : row.shiftId,
        isRestDay: row.isRestDay,
      }))
      await rosterService.savePatterns(patternEmployeeId, payload)
      notifications.show({
        message: 'Default week saved. Use "Apply weekly patterns" to write it onto a month.',
        color: 'green',
        autoClose: 3000,
      })
      setPatternsVisible(false)
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSaving(false)
    }
  }

  /* ── AUTO-ROSTER: the drawer, the draft, and the grid's counters ── */

  function openAuto() {
    // The setup was read with the branch-month and is re-read after every save — the only writes that
    // move the stored rhythms and the last run the drawer starts from.
    draft.clearError()
    setAutoOpen(true)
  }

  /* The rows the page holds are taken BEFORE the request: a re-read landing while it runs (the live
     signal of the drawer's own staffing save) then reads as nothing moved, while a row that really
     changed after the preview read it still differs from both. */
  async function runPreview(request: AutoRosterRequest) {
    const base = { rows: lookupRef.current, pins: cellInfoRef.current }
    const ok = await draft.start(request)
    if (ok) {
      setDraftBase(base)
      setAutoOpen(false)
      clearSelection()
    }
  }

  async function regenerateDraft() {
    const base = { rows: lookupRef.current, pins: cellInfoRef.current }
    const ok = await draft.regenerate()
    if (ok) setDraftBase(base)
  }

  async function saveDraft() {
    const result = await draft.commit(setup)
    if (!result) return
    notifications.show({
      message: t('attendance.roster.auto.card.saved', {
        inserted: result.rowsInserted,
        updated: result.rowsUpdated,
        deleted: result.rowsDeleted,
      }),
      color: 'green',
      autoClose: 6000,
    })
    // The stored rhythms changed with the save; the next drawer starts from them.
    setSetupVersion((v) => v + 1)
    await load()
  }

  /** An issue is about a day: scroll the grid to it and flash it, so "too many days in a row" points at the row. */
  function focusIssue(issue: AutoRosterIssue) {
    const date = issue.date ? issue.date.slice(0, 10) : null
    const inMonth = date != null && date >= leaveRange.from && date <= leaveRange.to
    const selector =
      issue.employeeId != null && inMonth
        ? `[data-cell="${cellKey(issue.employeeId, date)}"]`
        : issue.employeeId != null
          ? `[data-emp="${issue.employeeId}"]`
          : inMonth
            ? `[data-duty="${date}"]`
            : null
    const target = selector ? document.querySelector<HTMLElement>(selector) : null
    if (!target) return
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
    // Straight on the element: React leaves a class it did not set alone, and nothing re-renders for it.
    target.classList.add('roster-flash')
    window.setTimeout(() => target.classList.remove('roster-flash'), 1800)
  }

  /* DAYS THE SAVED ROSTER MOVED UNDER THE DRAFT — counted from the rows, not from the number of
     re-reads. Every 'attendance' signal re-reads the month, the page's own staffing save included,
     and a re-read that finds the same rows is no reason to Regenerate. */
  const draftMoved = useMemo(() => {
    if (!draft.active || !draftBase) return 0
    return daysMovedUnderDraft(
      draft.cells.values(),
      leaveRange.from,
      leaveRange.to,
      (key) => lookup.get(key),
      (key) => draftBase.rows.get(key),
      (key) => cellInfo?.get(key)?.isPinned === true,
      (key) => draftBase.pins?.get(key)?.isPinned === true,
    )
  }, [draft.active, draft.cells, draftBase, lookup, cellInfo, leaveRange])

  /**
   * One employee-day as the counters see it. UNDEFINED — not judged — outside their employment (a
   * hire's first week is not a broken week) and on a day with no row at all: a gap is a decision
   * nobody has made, and an unrostered month would otherwise read as a wall of broken weeks. A day
   * with no row on a public holiday is a holiday off, which is a known day.
   *
   * LEAVE AS THE PLANNER READS IT (D5): a rest row on ANY leave day, half included, is not a rest
   * day; only a FULL-day leave takes the person off duty. The approved ledger says how much of a
   * day is leave. A draft day of origin 'leave' is a leave the ledger may not hold (Pending,
   * OnHold) and may be a half day, so it is known as leave but not as a full day — which is why the
   * footer takes its on-duty count from the preview while a draft is open.
   */
  const counterCell = useCallback(
    (employee: EmployeeListItem, date: string): CounterCell | undefined => {
      if (employee.hireDate && date < employee.hireDate.slice(0, 10)) return undefined
      if (employee.terminationDate && date > employee.terminationDate.slice(0, 10)) return undefined
      const shown = shownCell(cellKey(employee.employeeId, date))
      const booked = leave.daysOnLeave(employee.employeeId, date)
      const onLeave = booked > 0 || shown?.draft?.origin === 'leave'
      if (!shown && !onLeave && !holidayByDate.has(date)) return undefined
      return { state: shown?.state ?? 'none', onLeave, fullDayLeave: booked >= 1 }
    },
    [shownCell, leave, holidayByDate],
  )

  const monthWeeks = useMemo(() => weekStartsBetween(leaveRange.from, leaveRange.to), [leaveRange])
  const serverCounters = useMemo(
    () => new Map((draft.preview?.perEmployee ?? []).map((p) => [p.employeeId, p])),
    [draft.preview],
  )

  /** Work · Rest · Sat · Sun · 6·5 for every row, counted from what the grid shows. */
  const rowCounters = useMemo(() => {
    const map = new Map<
      number,
      { counts: EmployeeCounts; strip: StripWeek[]; owed: { sat: number; sun: number } | null }
    >()
    for (const employee of employees) {
      const cellOf = (date: string) => counterCell(employee, date)
      const server = serverCounters.get(employee.employeeId)
      map.set(employee.employeeId, {
        counts: employeeCounts(days, cellOf),
        strip: weekStrip(monthWeeks, cellOf, server?.weeks),
        owed: server ? { sat: server.owedSaturday, sun: server.owedSunday } : null,
      })
    }
    return map
  }, [employees, days, monthWeeks, counterCell, serverCounters])

  /* The minimum a day is measured against: the preview's (which knows each holiday's cover), else the
     branch's staffing rows — except on a holiday, whose cover only a preview knows. */
  const previewDays = useMemo(
    () => new Map((draft.preview?.perDay ?? []).map((d) => [d.date.slice(0, 10), d])),
    [draft.preview],
  )

  /* THE FOOTER: on duty per day. On a saved month, counted from the grid. Under a draft, the
     preview's own count moved by the days edited since: the planner knows which leave is a half day
     (a half day is on duty) and the page does not for a leave still waiting for approval. An edited
     day is never a leave day (those are frozen), so its move is plain work or not. */
  const dutyByDay = useMemo(() => {
    const byId = new Map(employees.map((e) => [e.employeeId, e]))
    const counted = onDutyByDay(days, [...byId.keys()], (employeeId, date) => {
      const employee = byId.get(employeeId)
      return employee ? counterCell(employee, date) : undefined
    })
    if (!draft.active) return counted
    const moves: { date: string; was: boolean; now: boolean }[] = []
    for (const cell of draft.cells.values()) {
      if (!cell.edited) continue
      const away = leave.daysOnLeave(cell.employeeId, cell.workDate) >= 1
      moves.push({
        date: cell.workDate,
        was: cell.previewState === 'work' && !away,
        now: cell.state === 'work' && !away,
      })
    }
    const fromPreview = new Map([...previewDays].map(([date, d]) => [date, d.onDuty]))
    return onDutyUnderDraft(counted, fromPreview, moves)
  }, [employees, days, counterCell, draft.active, draft.cells, previewDays, leave])
  function dayMinimum(date: string): number | null {
    if (draft.active) return previewDays.get(date)?.min ?? null
    if (!setup || holidayByDate.has(date)) return null
    return staffingForDay(setup.staffing ?? [], date).min
  }

  /** Why the auto-roster button is off, when it is. Read-only means a request is open on the month. */
  const autoBlockedReason =
    autoBranchId == null
      ? t('attendance.roster.auto.disabled.allBranches')
      : editState.readOnly
        ? t('attendance.roster.auto.disabled.readOnly', { id: editState.openRequestId ?? '' })
        : null

  const selectedCount = selected.size

  /** The shift dropdown's rows, shared by the Set-day and Generate dialogs (same displayExpr). */
  const shiftOptions = shifts.map((shift) => ({
    value: String(shift.shiftId),
    label: `${shift.name} (${clockTime(shift.startTime)}–${clockTime(shift.endTime)})`,
  }))
  /* With a draft open the Set-day dialog offers ACTIVE shifts only — the save refuses an inactive one
     ("Shift … is not active.") — plus the day's own shift, so a single cell still shows what it is. */
  const setDayShiftOptions = draft.active
    ? shifts
        .filter((shift) => shift.isActive || shift.shiftId === setDayForm.shiftId)
        .map((shift) => ({
          value: String(shift.shiftId),
          label: shift.isActive
            ? `${shift.name} (${clockTime(shift.startTime)}–${clockTime(shift.endTime)})`
            : t('common.inactiveOption', { name: shift.name }),
        }))
    : shiftOptions
  /** The pin box: always with a draft open; outside one, only where saved days can be pinned. */
  const pinAvailable = draft.active || cellInfo != null

  /** A day column's classes, shared by the header, the cells and the footer: weekend, holiday, week start. */
  function dayColumnClass(date: string, extra?: string): string | undefined {
    const classes = [
      isWeekend(date) ? 'roster-weekend' : '',
      holidayByDate.has(date) ? 'roster-holiday' : '',
      // A rule before every Monday, so the 6- and 5-day weeks read as weeks.
      isMonday(date) ? 'roster-week-start' : '',
      extra ?? '',
    ].filter(Boolean)
    return classes.length > 0 ? classes.join(' ') : undefined
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Roster</h1>
          <p className="page-subtitle">
            Who was supposed to work which shift, day by day.
          </p>
        </div>
        {/* The generation tools all live together on the month toolbar below, ranked by how often
            they are the right answer. A second, competing primary button up here would undo that
            ranking — "Generate" was never the default; expanding the weekly patterns is. */}
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
        </div>
      </div>

      <PageHelp>
        The roster tells attendance what each person was SUPPOSED to work —
        without it, the system cannot tell late from early, or absent from off.
        Generate it, don&apos;t type it.
      </PageHelp>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <div className="filter-bar">
        <ActionIcon
          variant="default"
          size="lg"
          title={draft.active ? t('attendance.roster.auto.disabled.draftOpen') : 'Previous month'}
          aria-label="Previous month"
          onClick={() => goToPeriod(previousPeriod(period))}
          // The draft is one branch-month: moving away would leave it drawn over the wrong grid.
          disabled={draft.active}
        >
          <BackChevron />
        </ActionIcon>
        <div className="filter-field">
          <span className="filter-field-label">Month</span>
          <strong>{periodLabel(period)}</strong>
        </div>
        <ActionIcon
          variant="default"
          size="lg"
          title={draft.active ? t('attendance.roster.auto.disabled.draftOpen') : 'Next month'}
          aria-label="Next month"
          onClick={() => goToPeriod(nextPeriod(period))}
          disabled={draft.active}
        >
          <ForwardChevron />
        </ActionIcon>

        {branches.length > 1 && (
          <div className="filter-field">
            <span className="filter-field-label">Branch</span>
            <Select
              aria-label="Branch filter"
              w={200}
              data={[
                { value: 'all', label: 'All branches' },
                ...branches
                  .filter((b) => b.isActive || b.branchId === branchFilter)
                  .map((b) => ({ value: String(b.branchId), label: b.name })),
              ]}
              value={branchFilter != null ? String(branchFilter) : 'all'}
              allowDeselect={false}
              onChange={(v) => chooseBranch(v == null || v === 'all' ? null : Number(v))}
              disabled={draft.active}
            />
          </div>
        )}

        {canManage && (
          <div className="filter-spacer">
            {/* PRIMARY. A weekly pattern is the stable, recurring truth — "Rami works Mon–Fri
                Morning" — so expanding it produces a clean month. It is the accent-coloured,
                first-listed default because it is the right answer nearly every time. */}
            <Button
              leftSection={<IconCalendarEvent size={16} />}
              onClick={() => {
                setApplyOverwrite(false)
                setApplyVisible(true)
              }}
              // The generators below write rows straight away; under an open draft they would move the
              // rows the draft was planned against, and its save would be refused.
              disabled={draft.active}
            >
              Apply weekly patterns
            </Button>
            {/* The 6/5 rotation for one branch-month: previewed on the grid, saved in one call. A
                secondary button — expanding the weekly patterns stays the default. */}
            <Tooltip
              label={draft.active ? t('attendance.roster.auto.disabled.draftOpen') : autoBlockedReason}
              disabled={autoBlockedReason == null && !draft.active}
              withArrow
              multiline
              w={280}
            >
              {/* A span so the tooltip still fires over a disabled button. */}
              <span>
                <Button
                  variant="default"
                  leftSection={<IconCalendarRepeat size={16} />}
                  onClick={openAuto}
                  disabled={autoBlockedReason != null || draft.active}
                >
                  {t('attendance.roster.auto.button')}
                </Button>
              </span>
            </Tooltip>
            {/* Secondary: ad-hoc fills — a new hire mid-month, temporary cover. */}
            <Button
              variant="default"
              leftSection={<IconPlus size={16} />}
              onClick={() => openGenerate()}
              disabled={draft.active}
            >
              Generate roster…
            </Button>
            {/* Secondary: the seasonal case — a temporary rota that repeats month to month.
                DEMOTED from the default because copying a month copies that month's NOISE too:
                the swaps, the corrections, the one-off days off that applied to June and have no
                business in July. A pattern carries the schedule; a copy carries the history. */}
            <Button
              variant="default"
              leftSection={<IconCopy size={16} />}
              onClick={() => {
                setCopyOverwrite(false)
                setCopyVisible(true)
              }}
              disabled={draft.active}
            >
              Copy previous month
            </Button>
            {/* The editor for the thing the primary action expands. */}
            <Button
              variant="default"
              leftSection={<IconSettings size={16} />}
              onClick={openPatterns}
            >
              Weekly patterns…
            </Button>
          </div>
        )}
      </div>

      {/* Whether this month has been SIGNED FOR, and the one button that asks for it. Above the
          gaps banner deliberately: the gaps are what stop the month being worth approving. */}
      <RosterApprovalBanner
        period={period}
        branchId={branchFilter}
        canManage={canManage}
        onCleared={refresh}
        onApproved={() => void load()}
        onEditState={setEditState}
        refreshToken={rosterVersion}
        // Clearing or submitting the month would move or freeze the rows the draft was planned on,
        // exactly like the generators that are held off above; its save would then be refused.
        heldReason={draft.active ? t('attendance.roster.auto.disabled.draftOpen') : null}
      />

      {/* The draft's panel, above the grid it is drawn on. Sticky, so Save and the issues stay in
          reach while the person scrolls the month. */}
      {draft.active && autoBranchId != null && (
        <AutoRosterPreviewCard
          draft={draft}
          monthLabel={periodLabel(period)}
          branchName={autoBranchName}
          employeeName={employeeName}
          stale={draftMoved}
          onSave={() => void saveDraft()}
          onRegenerate={() => void regenerateDraft()}
          onOptions={() => {
            draft.clearError()
            setAutoOpen(true)
          }}
          onIssue={focusIssue}
        />
      )}

      {/* Hidden under a draft: the draft fills those days, and "Fix these" would write rows under it. */}
      {!loading && !draft.active && gaps.length > 0 && (
        // Amber, not red: a gap is not a failure, it is a decision nobody has made yet.
        <div
          className="card"
          style={{ marginBottom: 16, borderInlineStart: '4px solid #c9922b' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <strong>
                {gaps.length} employee-days have no shift assigned.
              </strong>
              <div className="hint">
                Attendance cannot judge late or absent without one.
              </div>
            </div>
            {canManage && (
              <Button
                variant="default"
                leftSection={<IconPlus size={16} />}
                onClick={openGenerateForGaps}
              >
                Fix these
              </Button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : error ? // The load FAILED, so we do not know who exists or what shifts there are. The
      // alert above already says why. Saying "there is nobody to roster" here would be a
      // different claim, and a false one — an empty list and an unread list are not the same.
      null : employees.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">
              There is nobody to roster yet.
            </div>
            Add employees under HR &rsaquo; Employees first — the roster is a
            grid of people against days, and it needs the people.
          </div>
        </div>
      ) : shifts.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">No shifts have been defined.</div>
            Create at least one shift under Attendance &rsaquo; Shifts. A shift
            is what tells the system when the day starts, so it can tell late
            from on time.
          </div>
        </div>
      ) : (
        <>
          <div className="roster-scroll">
            <table className="roster-table" aria-busy={draftBusy || undefined}>
              <thead>
                <tr>
                  <th className="roster-emp">Employee</th>
                  {days.map((date) => {
                    const holiday = holidayByDate.get(date)
                    return (
                      <th
                        key={date}
                        className={dayColumnClass(date)}
                        title={
                          holiday
                            ? t('attendance.roster.auto.holidayHeader', { name: referenceName(holiday) })
                            : undefined
                        }
                      >
                        {dayNumber(date)}
                        <div className="roster-dow">{weekdayInitial(date)}</div>
                      </th>
                    )
                  })}
                  <th className="roster-sum">
                    <div className="roster-sum-grid">
                      <span title={t('attendance.roster.auto.sum.workTitle')}>{t('attendance.roster.auto.sum.work')}</span>
                      <span title={t('attendance.roster.auto.sum.restTitle')}>{t('attendance.roster.auto.sum.rest')}</span>
                      <span title={t('attendance.roster.auto.sum.satTitle')}>{t('attendance.roster.auto.sum.sat')}</span>
                      <span title={t('attendance.roster.auto.sum.sunTitle')}>{t('attendance.roster.auto.sum.sun')}</span>
                      <span title={t('attendance.roster.auto.sum.weeksTitle')}>{t('attendance.roster.auto.sum.weeks')}</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee, row) => {
                  const counters = rowCounters.get(employee.employeeId)
                  return (
                  <tr key={employee.employeeId}>
                    <td className="roster-emp" data-emp={employee.employeeId}>{employee.fullName}</td>
                    {days.map((date, col) => {
                      const key = cellKey(employee.employeeId, date)
                      // draft.get(key) ?? lookup.get(key): the draft's day while a preview is open.
                      const shown = shownCell(key)
                      const planned = shown?.draft
                      const info = cellInfo?.get(key)
                      const holiday = holidayByDate.get(date)
                      const isSelected = selected.has(key)

                      let cellClass = 'roster-cell'
                      let label = ''
                      let title: string
                      let background: string | undefined

                      const shift = shown?.shiftId != null ? shiftById.get(shown.shiftId) : undefined
                      const shiftName = shift?.name ?? shown?.saved?.shiftName ?? ''

                      // LEAVE IS CHECKED FIRST, and that ordering is the feature: a leave day reads as
                      // leave whatever the roster holds under it. A WORKING ROW UNDER LEAVE IS THE
                      // NORMAL STATE now, not a conflict — a leave is priced on the rostered working
                      // days (rest days cost nothing), so the auto-roster keeps the day's shift under
                      // it and the payroll's unpaid-leave deduction does not move. The tooltip names
                      // the shift instead of asking anyone to undo it.
                      const onLeave =
                        leave.isOnLeave(employee.employeeId, date) || planned?.origin === 'leave'

                      if (onLeave) {
                        const amount = leave.daysOnLeave(employee.employeeId, date)
                        cellClass += ' roster-cell--leave'
                        label = 'Lve'
                        title = `${employee.fullName} — ${date}: approved leave${
                          amount && amount !== 1 ? ` (${amount} days booked on this date)` : ''
                        }.${
                          shown?.state === 'work' && shiftName
                            ? ` ${t('attendance.roster.auto.cell.leaveWork', { shift: shiftName })}`
                            : ''
                        }`
                      } else if (shown?.state === 'rest') {
                        cellClass += ' roster-cell--rest'
                        label = 'Rest'
                        title = `${employee.fullName} — ${date}: rest day.`
                      } else if (shown?.state === 'work' && shown.shiftId != null) {
                        label = shiftName.slice(0, 3)
                        background = shiftColor.get(shown.shiftId)
                        title = `${employee.fullName} — ${date}: ${shiftName} ${clockTime(
                          shift?.startTime ?? shown.saved?.startTime ?? null,
                        )}–${clockTime(shift?.endTime ?? shown.saved?.endTime ?? null)}`
                      } else if (holiday || planned?.origin === 'holiday') {
                        // A holiday off is a day with NO row (D4) — the right state, not a hole.
                        cellClass += ' roster-cell--holiday'
                        label = t('attendance.roster.auto.cell.holidayOff')
                        title = t('attendance.roster.auto.cell.holidayOffTitle', {
                          name: holiday ? referenceName(holiday) : '',
                          date: formatDayLabel(date),
                        })
                      } else {
                        cellClass += ' roster-cell--empty'
                        title =
                          'No shift assigned. Attendance cannot judge late or absent without one.'
                      }

                      /* THE DRAFT'S MARKS: dashed = planned by the generator, accent = your edit, a
                         lock where the server will not let the day change. The tooltip says where the
                         day came from and why. */
                      const pinned = planned
                        ? (planned.isPinned ?? planned.origin === 'pinned')
                        : info?.isPinned === true
                      if (planned) {
                        // Dashed: what the generator decided — every planned day, and a holiday or leave
                        // day the save will actually write (a cover shift, a working row under leave).
                        const writes = ['insert', 'update', 'delete'].includes(planned.change)
                        if (planned.edited || planned.origin === 'draft') cellClass += ' roster-cell--edited'
                        else if (planned.origin === 'planned' || writes) cellClass += ' roster-cell--draft'
                        if (planned.origin === 'locked') cellClass += ' roster-cell--locked'
                        const why = [
                          t(`attendance.roster.auto.origin.${planned.origin}`, { defaultValue: planned.origin }),
                          planned.change !== 'kept'
                            ? t(`attendance.roster.auto.change.${planned.change}`, { defaultValue: planned.change })
                            : '',
                          reasonText(planned.reasonCode, planned.reasonArgs),
                        ].filter(Boolean)
                        title += ` — ${why.join(' · ')}`
                      } else if (info && shown) {
                        title += ` — ${
                          info.isAuto
                            ? [t('attendance.roster.auto.cell.auto'), reasonText(info.reasonCode ?? null, null)]
                                .filter(Boolean)
                                .join(': ')
                            : t('attendance.roster.auto.cell.setByHand')
                        }`
                      }
                      if (pinned) {
                        cellClass += ' roster-cell--pinned'
                        if (planned?.origin !== 'pinned') title += ` · ${t('attendance.roster.auto.origin.pinned')}`
                      }

                      if (isSelected) cellClass += ' roster-cell--selected'

                      const glyphs = (
                        <>
                          {pinned && <IconPinFilled size={9} className="roster-glyph roster-glyph--pin" aria-hidden />}
                          {planned?.origin === 'locked' && (
                            <IconLock size={9} className="roster-glyph roster-glyph--lock" aria-hidden />
                          )}
                        </>
                      )

                      return (
                        <td key={key} className={dayColumnClass(date)} data-cell={key}>
                          {editable ? (
                            <button
                              type="button"
                              className={cellClass}
                              style={background ? { background } : undefined}
                              title={title}
                              aria-label={title}
                              onMouseDown={(e) => {
                                // Stops the browser text-selecting across the table mid-drag.
                                e.preventDefault()
                                startDrag(row, col)
                              }}
                              onMouseEnter={() => extendDrag(row, col)}
                              onClick={(e) => {
                                // Enter or Space on a focused cell arrives as a click with no mouse
                                // behind it (detail 0): the keyboard's way to set one day.
                                if (e.detail !== 0 || draftBusy) return
                                applySelection(new Set([key]))
                                openSetDayForSelection()
                              }}
                            >
                              {label}
                              {glyphs}
                            </button>
                          ) : (
                            <span
                              className={cellClass}
                              style={background ? { background } : undefined}
                              title={title}
                            >
                              {label}
                              {glyphs}
                            </span>
                          )}
                        </td>
                      )
                    })}
                    <td className="roster-sum">
                      {counters && (
                        <SummaryCells counts={counters.counts} strip={counters.strip} owed={counters.owed} />
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
              {/* ON DUTY PER DAY, against the minimum: red under it. Rest days beat staffing, so a
                  short day is reported, not fixed by taking someone's rest day away. */}
              <tfoot>
                <tr>
                  <th className="roster-emp" scope="row">
                    {t('attendance.roster.auto.foot.onDuty')}
                  </th>
                  {days.map((date) => {
                    const count = dutyByDay.get(date) ?? 0
                    const min = dayMinimum(date)
                    const short = min != null && count < min
                    return (
                      <td
                        key={date}
                        data-duty={date}
                        className={dayColumnClass(date, short ? 'roster-duty roster-duty--short' : 'roster-duty')}
                        title={
                          min == null
                            ? t('attendance.roster.auto.foot.title', { count })
                            : short
                              ? t('attendance.roster.auto.foot.short', { count, min })
                              : t('attendance.roster.auto.foot.min', { count, min })
                        }
                      >
                        {count}
                        {min != null && <div className="roster-duty-min">{min}</div>}
                      </td>
                    )
                  })}
                  <td className="roster-sum" />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="roster-legend">
            {shifts.map((shift) => (
              <span className="roster-legend-item" key={shift.shiftId}>
                <span
                  className="roster-swatch"
                  style={{ background: shiftColor.get(shift.shiftId) }}
                />
                {shift.name} ({clockTime(shift.startTime)}–
                {clockTime(shift.endTime)})
              </span>
            ))}
            <span className="roster-legend-item">
              <span
                className="roster-swatch"
                style={{ background: '#e6e3dc' }}
              />
              Rest day (rostered off)
            </span>
            <span className="roster-legend-item">
              <span
                className="roster-swatch"
                style={{ background: '#dfeee4' }}
              />
              Approved leave (outranks any shift)
            </span>
            <span className="roster-legend-item">
              <span
                className="roster-swatch"
                style={{
                  background:
                    'repeating-linear-gradient(45deg,#fff,#fff 4px,#f4e6d6 4px,#f4e6d6 8px)',
                  border: '1px solid var(--border)',
                }}
              />
              Nothing assigned (the system cannot judge this day)
            </span>
            {holidayByDate.size > 0 && (
              <span className="roster-legend-item">
                <span className="roster-swatch roster-swatch--holiday" />
                {t('attendance.roster.auto.legend.holiday')}
              </span>
            )}
            {draft.active && (
              <>
                <span className="roster-legend-item">
                  <span className="roster-swatch roster-swatch--draft" />
                  {t('attendance.roster.auto.legend.draft')}
                </span>
                <span className="roster-legend-item">
                  <span className="roster-swatch roster-swatch--edited" />
                  {t('attendance.roster.auto.legend.edited')}
                </span>
                <span className="roster-legend-item">
                  <IconLock size={12} />
                  {t('attendance.roster.auto.legend.locked')}
                </span>
              </>
            )}
            {pinAvailable && (
              <span className="roster-legend-item">
                <IconPinFilled size={12} />
                {t('attendance.roster.auto.legend.pinned')}
              </span>
            )}
            <span className="roster-legend-item">
              <span className="roster-swatch roster-swatch--week" />
              {t('attendance.roster.auto.legend.weekStart')}
            </span>
            {editable && (
              <span className="roster-legend-item">
                Click a cell to set it. Drag across cells to set many at once.
              </span>
            )}
            {canManage && editState.readOnly && editState.openRequestId != null && (
              <span className="roster-legend-item">
                {t('attendance.rosterApproval.readOnly', { id: editState.openRequestId })}
              </span>
            )}
          </div>
        </>
      )}

      <Modal
        opened={setDayVisible}
        onClose={() => {
          setSetDayVisible(false)
          clearSelection()
        }}
        title={selectedCount === 1 ? 'Set 1 day' : `Set ${selectedCount} days`}
        size={480}
        centered
      >
        {setDayError && (
          <div className="alert alert--error" role="alert">
            {setDayError}
          </div>
        )}

        <div className="form-field">
          <label className="form-label" htmlFor="roster-day-shift">
            Shift
          </label>
          <Select
            id="roster-day-shift"
            data={setDayShiftOptions}
            value={setDayForm.shiftId != null ? String(setDayForm.shiftId) : null}
            onChange={(v) =>
              setSetDayForm((f) => ({
                ...f,
                shiftId: v != null ? Number(v) : null,
              }))
            }
            placeholder="Pick a shift…"
            allowDeselect={false}
            disabled={saving || setDayForm.isRestDay}
          />
          {/* NO required-field validator here — and the DevExtreme crash it used to cause is gone
              with DevExtreme. The rule it enforced is not lost: submitSetDay() checks the same
              thing and says the same sentence, and it stays true for the rest-day case too, which
              a required rule on a disabled field never could. */}
        </div>

        <div className="form-field">
          <Checkbox
            label="Rest day"
            checked={setDayForm.isRestDay}
            onChange={(e) => {
              const checked = e.currentTarget.checked
              setSetDayForm((f) => ({
                ...f,
                isRestDay: checked,
                shiftId: checked ? null : f.shiftId,
              }))
            }}
            disabled={saving}
          />
          <div className="hint">
            A rest day is still rostered — it says “this person was off”,
            which is not the same as saying nothing at all.
          </div>
        </div>

        {pinAvailable && (
          <div className="form-field">
            <Checkbox
              label={t('attendance.roster.auto.pin.label')}
              checked={setDayForm.isPinned}
              onChange={(e) => {
                const checked = e.currentTarget.checked
                setSetDayForm((f) => ({ ...f, isPinned: checked }))
                setPinTouched(true)
              }}
              disabled={saving}
            />
            <div className="hint">
              {draft.active ? t('attendance.roster.auto.pin.hintDraft') : t('attendance.roster.auto.pin.hintSaved')}
            </div>
          </div>
        )}

        <div className="form-actions">
          <Button
            variant="default"
            onClick={() => {
              setSetDayVisible(false)
              clearSelection()
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={() => void submitSetDay()} disabled={saving || (draft.active && draftBusy)}>
            {saving ? 'Saving…' : `Set ${selectedCount} day(s)`}
          </Button>
        </div>
      </Modal>

      <Modal
        opened={generateVisible}
        onClose={() => setGenerateVisible(false)}
        title="Generate roster"
        size={560}
        centered
      >
        <div className="form-field">
          <label className="form-label" htmlFor="roster-gen-employees">
            Employees
          </label>
          {/* PORT NOTE: the inline RequiredRule is gone with DevExtreme; submitGenerate() keeps
              the same gate ("Pick at least one employee and a shift."). */}
          <MultiSelect
            id="roster-gen-employees"
            data={employees.map((employee) => ({
              value: String(employee.employeeId),
              label: employee.fullName,
            }))}
            value={generateForm.employeeIds.map(String)}
            onChange={(values) =>
              setGenerateForm((f) => ({
                ...f,
                employeeIds: values.map(Number),
              }))
            }
            placeholder="Select employees…"
            searchable
            disabled={saving}
          />
        </div>

        <div className="form-grid">
          <div className="form-field">
            <label className="form-label" htmlFor="roster-gen-period">
              {t('common.period')}
            </label>
            {/* NOT CLEARABLE: generating a roster over "no period" is not a thing to ask for, so
                the standing range is kept until a complete one replaces it. */}
            <DateRangeField
              id="roster-gen-period"
              presets={false}
              from={generateForm.fromDate}
              to={generateForm.toDate}
              onChange={(nextFrom, nextTo) => {
                if (nextFrom && nextTo) {
                  setGenerateForm((f) => ({ ...f, fromDate: nextFrom, toDate: nextTo }))
                }
              }}
              disabled={saving}
            />
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="roster-gen-to">
              To
            </label>
            <DatePickerInput
              id="roster-gen-to"
              valueFormat="DD/MM/YYYY"
              leftSection={<IconCalendar size={14} />}
              value={generateForm.toDate}
              onChange={(v) => {
                setGenerateForm((f) => ({ ...f, toDate: v || f.toDate }))
              }}
              disabled={saving}
            />
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="roster-gen-shift">
            Shift
          </label>
          <Select
            id="roster-gen-shift"
            data={shiftOptions}
            value={generateForm.shiftId != null ? String(generateForm.shiftId) : null}
            onChange={(v) =>
              setGenerateForm((f) => ({
                ...f,
                shiftId: v != null ? Number(v) : null,
              }))
            }
            placeholder="Pick a shift…"
            allowDeselect={false}
            disabled={saving}
          />
        </div>

        <div className="form-field">
          <span className="form-label">Working days</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {WEEKDAY_LABELS.map((label, index) => (
              <Checkbox
                key={label}
                label={label}
                checked={generateForm.weekdays[index]}
                onChange={(e) => {
                  const checked = e.currentTarget.checked
                  setGenerateForm((f) => ({
                    ...f,
                    weekdays: f.weekdays.map((on, i) =>
                      i === index ? checked : on,
                    ),
                  }))
                }}
                disabled={saving}
              />
            ))}
          </div>
          <div className="hint">
            Days you do not tick are written as REST DAYS, so the roster comes
            out complete. A blank day is the one thing the system cannot read.
          </div>
        </div>

        <LeavePreflight
          days={leaveDaysAffecting(
            generateLeave.days,
            generateForm.employeeIds,
            generateForm.fromDate,
            generateForm.toDate,
            generateForm.weekdays,
          )}
          employeeName={employeeName}
          error={generateLeave.error}
        />

        <OverwriteField
          value={generateForm.overwrite}
          onChange={(value) =>
            setGenerateForm((f) => ({ ...f, overwrite: value }))
          }
          disabled={saving}
        />

        <div className="form-actions">
          <Button
            variant="default"
            onClick={() => setGenerateVisible(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={() => void submitGenerate()} disabled={saving}>
            {saving ? 'Saving…' : 'Generate'}
          </Button>
        </div>
      </Modal>

      <Modal
        opened={copyVisible}
        onClose={() => setCopyVisible(false)}
        title="Copy previous month"
        size={480}
        centered
      >
        <div className="form-field">
          <p style={{ margin: 0 }}>
            Copy <strong>{periodLabel(previousPeriod(period))}</strong> onto{' '}
            <strong>{periodLabel(period)}</strong>. Shifts are matched by
            WEEKDAY, so a Monday shift lands on a Monday — not on the same date
            number.
          </p>
          {/* Said out loud, because this is the reason it is no longer the default. */}
          <p className="hint" style={{ marginBottom: 0 }}>
            A copy brings last month&rsquo;s exceptions with it — the swaps, the one-off
            days off, the cover that has already ended. If this month follows the usual
            schedule, <strong>Apply weekly patterns</strong> gives a cleaner result.
          </p>
        </div>

        <LeavePreflight
          days={leaveDaysAffecting(leave.days, null, leaveRange.from, leaveRange.to)}
          employeeName={employeeName}
          error={leave.error}
        />

        <OverwriteField
          value={copyOverwrite}
          onChange={setCopyOverwrite}
          disabled={saving}
        />

        <div className="form-actions">
          <Button
            variant="default"
            onClick={() => setCopyVisible(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={() => void submitCopy()} disabled={saving}>
            {saving ? 'Copying…' : 'Copy month'}
          </Button>
        </div>
      </Modal>

      <Modal
        opened={applyVisible}
        onClose={() => setApplyVisible(false)}
        title="Apply weekly patterns"
        size={480}
        centered
      >
        <div className="form-field">
          <p style={{ margin: 0 }}>
            Every employee who has a saved default week has it expanded into
            real days across <strong>{periodLabel(period)}</strong>. Employees
            with no saved pattern are left alone.
          </p>
          <p className="hint" style={{ marginBottom: 0 }}>
            This is the usual way to fill a month: a pattern carries the schedule people
            actually work, without last month&rsquo;s one-off exceptions coming along with it.
          </p>
        </div>

        <LeavePreflight
          days={leaveDaysAffecting(leave.days, null, leaveRange.from, leaveRange.to)}
          employeeName={employeeName}
          error={leave.error}
        />

        <OverwriteField
          value={applyOverwrite}
          onChange={setApplyOverwrite}
          disabled={saving}
        />

        <div className="form-actions">
          <Button
            variant="default"
            onClick={() => setApplyVisible(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={() => void submitApplyPatterns()} disabled={saving}>
            {saving ? 'Applying…' : 'Apply patterns'}
          </Button>
        </div>
      </Modal>

      <Modal
        opened={patternsVisible}
        onClose={() => setPatternsVisible(false)}
        title="Weekly patterns"
        size={560}
        centered
      >
        <div className="form-field">
          <label className="form-label" htmlFor="roster-pattern-employee">
            Employee
          </label>
          <Select
            id="roster-pattern-employee"
            data={employees.map((employee) => ({
              value: String(employee.employeeId),
              label: employee.fullName,
            }))}
            value={patternEmployeeId != null ? String(patternEmployeeId) : null}
            onChange={(v) => {
              if (v != null) void loadPatterns(Number(v))
            }}
            placeholder="Pick an employee…"
            searchable
            allowDeselect={false}
            disabled={saving}
          />
          <div className="hint">
            This is the employee&apos;s DEFAULT WEEK — a template with no dates.
            It changes nothing on its own; “Apply weekly patterns” is what
            expands it into a real month.
          </div>
        </div>

        {patternsLoading ? (
          <div className="page-loading">
            <Loader size={32} />
          </div>
        ) : (
          patternEmployeeId != null &&
          patternRows.map((row, index) => (
            <div
              className="form-field"
              key={row.dayOfWeek}
              style={{
                display: 'grid',
                gridTemplateColumns: '96px 1fr 90px',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span className="form-label" style={{ margin: 0 }}>
                {WEEKDAY_FULL[index]}
              </span>
              <Select
                data={shifts.map((shift) => ({
                  value: String(shift.shiftId),
                  label: shift.name,
                }))}
                value={row.shiftId != null ? String(row.shiftId) : null}
                onChange={(v) =>
                  setPatternRows((rows) =>
                    rows.map((r) =>
                      r.dayOfWeek === row.dayOfWeek
                        ? { ...r, shiftId: v != null ? Number(v) : null }
                        : r,
                    ),
                  )
                }
                placeholder="No shift"
                clearable
                disabled={saving || row.isRestDay}
              />
              <Checkbox
                label="Rest"
                checked={row.isRestDay}
                onChange={(e) => {
                  const checked = e.currentTarget.checked
                  setPatternRows((rows) =>
                    rows.map((r) =>
                      r.dayOfWeek === row.dayOfWeek
                        ? {
                            ...r,
                            isRestDay: checked,
                            shiftId: checked ? null : r.shiftId,
                          }
                        : r,
                    ),
                  )
                }}
                disabled={saving}
              />
            </div>
          ))
        )}

        <div className="form-actions">
          <Button
            variant="default"
            onClick={() => setPatternsVisible(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submitPatterns()}
            disabled={saving || patternEmployeeId == null}
          >
            {saving ? 'Saving…' : 'Save default week'}
          </Button>
        </div>
      </Modal>

      {canManage && autoBranchId != null && (
        <AutoRosterDrawer
          opened={autoOpen}
          onClose={() => setAutoOpen(false)}
          branchId={autoBranchId}
          branchName={autoBranchName}
          period={period}
          setup={setup}
          setupError={setupError}
          current={draft.request}
          busy={draft.busy === 'preview'}
          error={autoOpen ? draft.error : null}
          onPreview={(request) => void runPreview(request)}
          onStaffingSaved={(rows) => setSetup((current) => (current ? { ...current, staffing: rows } : current))}
        />
      )}
    </div>
  )
}
