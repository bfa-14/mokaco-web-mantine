import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Checkbox, Group, Loader, NumberInput, Pagination, SegmentedControl, Select, Table, Textarea, TextInput } from '@mantine/core'
import { Drawer, Modal } from '../../components/dialogs'
import { DatePickerInput, DateTimePicker } from '@mantine/dates'
import { DateRangeField } from '../../components/DateRangeField'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconBriefcase, IconCalendar, IconCheck, IconChevronDown, IconChevronRight, IconClock, IconPencil, IconPlus, IconPrinter, IconRefresh, IconSearch, IconSquareX, IconX } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { dateTimeToPicker, secondsDateTimeFromPicker } from '../../components/date/pickerValue'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { useLive } from '../../live/useLive'
import { useLiveEnabled } from '../../live/useLiveSettings'
import { ManualEntryForm } from './ManualEntryForm'
import { getErrorMessage } from '../../api/errorMessage'
import {
  attendanceService,
  correctionsService,
} from '../../services/attendanceService'
import { branchesService, employeesService } from '../../services/hrService'
import { PERMISSIONS } from '../../types/attendance'
import type {
  AttendanceDetail,
  AttendanceInterval,
  AttendanceRecord,
} from '../../types/attendance'
import type { Branch, EmployeeListItem } from '../../types/hr'
import { AnomalyIcon, DayFractionBar, StatusBadge } from './attendanceShared'
import { PunchesGrid } from './PunchesGrid'
import { DayPairsPanel } from './DayPairsPanel'
import type { PairsState } from './DayPairsPanel'
import {
  currentPeriod,
  describeAnomaly,
  formatDate,
  formatDayLabel,
  formatMinutes,
  formatTime,
  periodRange,
  statusText,
  toDateString,
} from './attendanceFormat'
import { alignEnd } from '../../i18n/physical'
import { useLanguage } from '../../i18n/useLanguage'

/** The four values ATTENDANCE_RECORD.status can hold. A correction may only move a day between these. */
const STATUS_OPTIONS = ['Present', 'Absent', 'RestDay', 'Leave']

/**
 * HR's three possible rulings on an exit that ran longer than what was authorised. Payroll
 * is blocked until one of them is chosen, so each states its consequence rather than its name.
 */
const DISPOSITIONS = [
  {
    value: 'UnpaidAbsence',
    title: 'Unpaid absence',
    consequence:
      'The extra minutes come off pay as unpaid time. Choose this when nobody authorised the time away and there is nothing to offset it against.',
  },
  {
    value: 'Overtime',
    title: 'Offset against overtime',
    consequence:
      'The extra minutes are cancelled against overtime detected on the same day. Nothing is deducted — and nothing is paid for that overtime either, because it was used up here.',
  },
  {
    value: 'Ignore',
    title: 'Ignore it',
    consequence:
      'Nothing is deducted and nothing is paid. The day is closed exactly as the punches left it. Choose this when the difference is too small to act on.',
  },
]

/** Today as 'yyyy-MM-dd' — where the Day control starts, because it is the day being worked on. */
function today(): string {
  return toDateString(new Date())
}

/** Yesterday as 'yyyy-MM-dd' — the day absentees are almost always being marked for. */
function yesterday(): string {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  return toDateString(date)
}

/* The two native-datetime-local adapters that used to live here are now the shared
   dateTimeToPicker / secondsDateTimeFromPicker in components/date/pickerValue.ts — same
   'yyyy-MM-ddTHH:mm:ss' contract, one definition. */

/**
 * A worked stretch or the gap after it, laid out proportionally. Widths come from minutes,
 * so a two-hour hole in the middle of the day LOOKS like a two-hour hole — which is the whole
 * point: worked time is the sum of the intervals, never first-in to last-out.
 */
interface Segment {
  kind: 'worked' | 'gap'
  minutes: number
  label: string
}

function buildSegments(intervals: AttendanceInterval[]): Segment[] {
  const segments: Segment[] = []
  for (const interval of intervals) {
    segments.push({
      kind: 'worked',
      minutes: interval.minutes,
      label: `${formatTime(interval.inTimeUtc)}–${formatTime(interval.outTimeUtc)}`,
    })
    if (interval.gapAfterMins > 0) {
      segments.push({
        kind: 'gap',
        minutes: interval.gapAfterMins,
        label: 'away',
      })
    }
  }
  return segments
}

/** The day drawn as it actually happened, with the numbers underneath and the rule behind each one on hover. */
function DayTimeline({ detail }: { detail: AttendanceDetail }) {
  const segments = buildSegments(detail.intervals)

  if (segments.length === 0) {
    return (
      <div className="day-empty">
        <div className="day-empty-main">Nothing to draw for this day.</div>
        {describeAnomaly(detail)} There is no complete in-and-out pair, so there are no
        worked intervals to show.{' '}
        {detail.status === 'Absent' || detail.status === 'RestDay'
          ? 'That is expected for a day nobody was due to work.'
          : 'Use “Edit this day” to state what happened, or “Request a correction” if the punches are simply wrong.'}
      </div>
    )
  }

  return (
    <div className="timeline">
      <div className="timeline-track">
        {segments.map((segment, index) => (
          <div
            key={index}
            className={
              segment.kind === 'worked'
                ? 'timeline-seg timeline-seg--worked'
                : 'timeline-seg timeline-seg--gap'
            }
            // A zero-minute segment would collapse to nothing and take its label with it.
            style={{ flexGrow: Math.max(segment.minutes, 1), flexBasis: 0 }}
          >
            {/* Both kinds are NAMED, not just coloured. A block and a hatched block are only
                obviously different if you already know the convention; "worked 2h" next to
                "gap 45m" needs no legend, and the whole point of the drawing is that the gap is
                NOT worked time. */}
            {segment.kind === 'worked'
              ? `worked ${formatMinutes(segment.minutes)}`
              : `gap ${formatMinutes(segment.minutes)}`}
          </div>
        ))}
      </div>

      <div className="timeline-labels">
        {segments.map((segment, index) => (
          <div
            key={index}
            className="timeline-label"
            style={{ flexGrow: Math.max(segment.minutes, 1), flexBasis: 0 }}
          >
            {segment.label}
          </div>
        ))}
      </div>

      <div className="timeline-summary">
        <span
          className="metric"
          title="The sum of the intervals actually clocked. Time away in the middle of the day is not worked time."
        >
          Worked {formatMinutes(detail.workedMinutes)}
        </span>
        <span className="sep">·</span>
        <span
          className="metric"
          title="The unpaid break, charged once. If they punched out for it, the gap already covers it."
        >
          break {formatMinutes(detail.breakApplied)} taken from the gap
        </span>
        <span className="sep">·</span>
        <span
          className="metric"
          title="Time away beyond the break. This is what needs an exit permission."
        >
          exit {formatMinutes(detail.exitActualMinutes)}
        </span>
        <span className="sep">·</span>
        <span
          className="metric"
          title="Worked divided by the standard day for this person on this date, capped at 1."
        >
          {detail.dayFraction.toFixed(2)} of a day
        </span>
      </div>
    </div>
  )
}

/** One number, with the rule that produced it on hover. The rule is the point — the number alone is trivia. */
function Metric({
  label,
  value,
  rule,
  muted,
}: {
  label: string
  value: string
  rule: string
  muted?: boolean
}) {
  return (
    <div className="detail">
      <span className="detail-label metric" title={rule}>
        {label}
      </span>
      <span
        className="detail-value"
        style={muted ? { color: 'var(--ink-muted)' } : undefined}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * Everything the record carries, with the rule behind each figure.
 *
 * Every one of these is a claim about somebody's pay, and none of them is self-explanatory — "0.97
 * of a day" and "exit variance 75m" mean nothing without the rule that produced them. The tooltips
 * are not decoration; they are the difference between a number a person can act on and a number
 * they have to take on faith.
 */
function DayNumbers({ detail }: { detail: AttendanceDetail }) {
  return (
    <div className="day-numbers">
      <Metric
        label="Worked"
        value={formatMinutes(detail.workedMinutes)}
        rule="The sum of the intervals actually clocked, minus any break not already taken as a gap. NOT first-in to last-out — time away in the middle of the day is not worked time."
      />
      <Metric
        label="Standard"
        value={formatMinutes(detail.standardMinutes)}
        rule="What a full day means for this person on this date: their rostered shift's length minus its break, or the configured standard day when nothing was rostered."
      />
      <Metric
        label="Day fraction"
        value={detail.dayFraction.toFixed(2)}
        rule="Worked divided by standard, capped at 1.00. Payroll sums these, so somebody who left two hours early counts 0.75 of a day, not 1."
      />
      <Metric
        label="Late"
        value={formatMinutes(detail.lateMinutes)}
        muted={detail.lateMinutes === 0}
        rule="Minutes past the shift's start plus its grace period. Zero when no shift was rostered — you cannot be late for a shift nobody assigned."
      />
      <Metric
        label="Overtime"
        value={formatMinutes(detail.overtimeMinutes)}
        muted={detail.overtimeMinutes === 0}
        rule="Minutes over the standard day. DETECTED ONLY — attendance never pays this. Pay only what an approved overtime request authorises."
      />
      <Metric
        label="Exit actual"
        value={formatMinutes(detail.exitActualMinutes)}
        muted={detail.exitActualMinutes === 0}
        rule="What the punches SHOW they were away for, beyond their break. An observed fact."
      />
      <Metric
        label="Exit approved"
        value={formatMinutes(detail.exitApprovedMinutes)}
        muted={detail.exitApprovedMinutes === 0}
        rule="What was AUTHORISED. Independent of the actual — neither one ever overwrites the other."
      />
      <Metric
        label="Exit variance"
        value={
          detail.exitVarianceMinutes === 0
            ? '—'
            : detail.exitVarianceMinutes > 0
              ? `${formatMinutes(detail.exitVarianceMinutes)} more`
              : `${formatMinutes(Math.abs(detail.exitVarianceMinutes))} less`
        }
        muted={detail.exitVarianceMinutes === 0}
        rule="Actual minus approved. MORE means they were away longer than allowed; LESS means they came back early. Payroll is blocked until HR rules on it."
      />
      <Metric
        label="Exit leave"
        value={formatMinutes(detail.exitLeaveMinutes)}
        muted={detail.exitLeaveMinutes === 0}
        rule="What comes off the leave balance for the mid-day absence. By default the time actually taken, which the Settings page can change."
      />
    </div>
  )
}

/**
 * Records what was AUTHORISED. It deliberately does not touch what the punches observed —
 * approved and actual minutes are two separate facts, and payroll needs both.
 */
function ExitApprovalForm({
  detail,
  onDone,
  onCancel,
}: {
  detail: AttendanceDetail
  onDone: () => Promise<void>
  onCancel: () => void
}) {
  const [minutes, setMinutes] = useState<number>(detail.exitApprovedMinutes)
  const [alsoSetActual, setAlsoSetActual] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    setSaving(true)
    try {
      await attendanceService.setExitApproval(detail.attendanceId, {
        exitApprovedMinutes: minutes,
        exitPermissionId: null,
        alsoSetActual,
        hrNote: note.trim() || null,
      })
      notifications.show({
        message: `Approved exit set to ${formatMinutes(minutes)} for ${detail.fullName}.`,
        color: 'green',
        autoClose: 2500,
      })
      await onDone()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="hint">
        This records what was AUTHORISED. It does not change what the punches
        observed — the two are kept apart on purpose.
      </p>

      <div className="form-field">
        <label className="form-label" htmlFor="exit-approved-minutes">
          Approved exit minutes
        </label>
        <NumberInput
          id="exit-approved-minutes"
          value={minutes}
          min={0}
          disabled={saving}
          onChange={(v) => setMinutes(typeof v === 'number' ? v : 0)}
        />
        <p className="hint">
          The punches show {formatMinutes(detail.exitActualMinutes)} of exit time
          actually taken.
        </p>
      </div>

      <div className="form-field">
        <Checkbox
          checked={alsoSetActual}
          disabled={saving}
          label="Also count this as actually taken"
          onChange={(e) => setAlsoSetActual(e.currentTarget.checked)}
        />
        <p className="hint">
          The exit was approved but they never punched for it, so attendance sees no
          gap. Tick this to count the approved time as actually taken.
        </p>
      </div>

      <div className="form-field">
        <label className="form-label" htmlFor="exit-approval-note">
          Note (optional)
        </label>
        <Textarea
          id="exit-approval-note"
          value={note}
          minRows={3}
          disabled={saving}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
      </div>

      <div className="form-actions">
        <Button variant="default" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={saving}>
          {saving ? 'Saving…' : 'Save approval'}
        </Button>
      </div>
    </div>
  )
}

/** HR's ruling on the difference between what was taken and what was allowed. Payroll is blocked until it exists. */
function DispositionForm({
  detail,
  onDone,
  onCancel,
}: {
  detail: AttendanceDetail
  onDone: () => Promise<void>
  onCancel: () => void
}) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function choose(disposition: string, title: string) {
    setSaving(true)
    try {
      await attendanceService.setExitDisposition(detail.attendanceId, {
        disposition,
        exitLeaveMinutesOverride: null,
        hrNote: note.trim() || null,
      })
      notifications.show({
        message: `${detail.fullName}, ${formatDate(detail.workDate)}: variance of ${formatMinutes(detail.exitVarianceMinutes)} ruled “${title}”.`,
        color: 'green',
        autoClose: 2500,
      })
      await onDone()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="hint">
        They were away {formatMinutes(detail.exitActualMinutes)} and{' '}
        {formatMinutes(detail.exitApprovedMinutes)} was approved — a difference of{' '}
        {formatMinutes(detail.exitVarianceMinutes)}. Overtime detected the same day:{' '}
        {formatMinutes(detail.overtimeMinutes)}. Pick what should happen to that
        difference.
      </p>

      <div className="form-field">
        <label className="form-label" htmlFor="disposition-note">
          Note (optional)
        </label>
        <Textarea
          id="disposition-note"
          value={note}
          minRows={2}
          disabled={saving}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
      </div>

      <div className="disposition-actions">
        {DISPOSITIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="disposition-choice"
            disabled={saving}
            onClick={() => void choose(option.value, option.title)}
          >
            <span>
              <span className="disposition-choice-title">{option.title}</span>
              <span className="disposition-choice-consequence">
                {option.consequence}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="form-actions">
        <Button variant="default" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** Overrides the computed day outright. This is the one action that changes pay directly, so the note is mandatory. */
function AdjustDayForm({
  detail,
  onDone,
  onCancel,
}: {
  detail: AttendanceDetail
  onDone: () => Promise<void>
  onCancel: () => void
}) {
  const [workedMinutes, setWorkedMinutes] = useState<number | null>(null)
  const [dayFraction, setDayFraction] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  /* PORT NOTE: DevExtreme RequiredRule → the same check and message, run in submit(). */
  const [noteError, setNoteError] = useState<string | null>(null)

  async function submit() {
    if (!note.trim()) {
      setNoteError("A reason is required — this changes somebody's pay.")
      return
    }

    setSaving(true)
    try {
      await attendanceService.adjustDay(detail.attendanceId, {
        workedMinutes,
        dayFraction,
        status: null,
        hrNote: note.trim(),
      })
      notifications.show({
        message: `${detail.fullName}, ${formatDate(detail.workDate)} adjusted. The processor will not touch this day again.`,
        color: 'green',
        autoClose: 2500,
      })
      await onDone()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="hint">
        This changes what this person is paid for the day. The note is required and is
        kept forever. Set worked minutes OR the day fraction — leave the other blank
        and the system keeps what it computed.
      </p>

      <div className="form-field">
        <label className="form-label" htmlFor="adjust-worked">
          Worked minutes
        </label>
        <NumberInput
          id="adjust-worked"
          value={workedMinutes ?? ''}
          min={0}
          disabled={saving}
          placeholder={`Currently ${formatMinutes(detail.workedMinutes)}`}
          onChange={(v) => setWorkedMinutes(typeof v === 'number' ? v : null)}
        />
      </div>

      <div className="form-field">
        <label className="form-label" htmlFor="adjust-fraction">
          Day fraction
        </label>
        <NumberInput
          id="adjust-fraction"
          value={dayFraction ?? ''}
          min={0}
          max={1}
          step={0.05}
          disabled={saving}
          placeholder={`Currently ${detail.dayFraction.toFixed(2)}`}
          onChange={(v) => setDayFraction(typeof v === 'number' ? v : null)}
        />
      </div>

      <div className="form-field">
        <label className="form-label" htmlFor="adjust-note">
          Why (required)
        </label>
        <Textarea
          id="adjust-note"
          value={note}
          minRows={3}
          disabled={saving}
          error={noteError}
          onChange={(e) => {
            setNote(e.currentTarget.value)
            setNoteError(null)
          }}
        />
      </div>

      <div className="form-actions">
        <Button variant="default" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={saving}>
          {saving ? 'Saving…' : 'Adjust day'}
        </Button>
      </div>
    </div>
  )
}

/** A LOGGED change: old and new side by side, with a reason. The raw punches from the machine are never overwritten. */
/**
 * A CORRECTION: a logged request to change a processed day.
 *
 * Takes AttendanceRecord, not AttendanceDetail, so the SAME form serves both callers — the row's
 * "Fix" button (which only has the grid row) and the drawer (which has the full detail). It never
 * needed the intervals, and duplicating a form that changes pay to serve two callers would mean
 * two places for the rules to drift apart.
 */
function CorrectionForm({
  detail,
  onDone,
  onCancel,
}: {
  detail: AttendanceRecord
  onDone: () => Promise<void>
  onCancel: () => void
}) {
  const [firstIn, setFirstIn] = useState<string | null>(detail.firstInUtc)
  const [lastOut, setLastOut] = useState<string | null>(detail.lastOutUtc)
  const [exitMinutes, setExitMinutes] = useState<number | null>(
    detail.exitActualMinutes,
  )
  const [status, setStatus] = useState<string | null>(detail.status)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  /* PORT NOTE: DevExtreme RequiredRule → the same check and message, run in submit(). */
  const [reasonError, setReasonError] = useState<string | null>(null)

  async function submit() {
    if (!reason.trim()) {
      setReasonError(
        "A reason is required — a correction without one is an unexplained change to somebody's pay.",
      )
      return
    }

    setSaving(true)
    try {
      await correctionsService.create({
        attendanceId: detail.attendanceId,
        newFirstInUtc: firstIn,
        newLastOutUtc: lastOut,
        newExitMinutes: exitMinutes,
        newStatus: status,
        reason: reason.trim(),
      })
      // A correction does NOT take effect on submission — it waits for approval. Saying so is
      // what stops somebody raising one, seeing the day unchanged, and raising it again.
      notifications.show({
        message: 'Correction raised. It will apply once approved on the Corrections page.',
        color: 'green',
        autoClose: 4000,
      })
      await onDone()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {/* WHAT IS BROKEN, in words, before the fields. Somebody correcting a day should not have
          to remember why it was flagged while they are retyping its times. */}
      {detail.hasAnomaly && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="empty-hint-main">
            {detail.fullName} — {formatDate(detail.workDate)}
          </div>
          <p className="hint" style={{ marginTop: 4 }}>
            {describeAnomaly(detail)}
          </p>
        </div>
      )}

      <p className="hint">
        This records what you changed and why. The original punches from the machine
        are never overwritten.
      </p>

      <div className="form-grid">
        <div className="form-field">
          <label className="form-label" htmlFor="correction-first-in">
            First in
          </label>
          {/* A correction may deliberately blank a punch, so both are clearable and clearing
              stores null. The state keeps its 'yyyy-MM-ddTHH:mm:ss' shape. */}
          <DateTimePicker
            id="correction-first-in"
            valueFormat="DD/MM/YYYY HH:mm"
            leftSection={<IconCalendar size={14} />}
            clearable
            value={dateTimeToPicker(firstIn)}
            disabled={saving}
            onChange={(v) => setFirstIn(secondsDateTimeFromPicker(v))}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="correction-last-out">
            Last out
          </label>
          <DateTimePicker
            id="correction-last-out"
            valueFormat="DD/MM/YYYY HH:mm"
            leftSection={<IconCalendar size={14} />}
            clearable
            value={dateTimeToPicker(lastOut)}
            disabled={saving}
            onChange={(v) => setLastOut(secondsDateTimeFromPicker(v))}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="correction-exit">
            Exit minutes
          </label>
          <NumberInput
            id="correction-exit"
            value={exitMinutes ?? ''}
            min={0}
            disabled={saving}
            onChange={(v) => setExitMinutes(typeof v === 'number' ? v : null)}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="correction-status">
            Status
          </label>
          <Select
            id="correction-status"
            data={STATUS_OPTIONS}
            value={status}
            clearable
            disabled={saving}
            onChange={(v) => setStatus(v ?? null)}
          />
        </div>
      </div>

      <div className="form-field">
        <label className="form-label" htmlFor="correction-reason">
          Why (required)
        </label>
        <Textarea
          id="correction-reason"
          value={reason}
          minRows={3}
          disabled={saving}
          error={reasonError}
          onChange={(e) => {
            setReason(e.currentTarget.value)
            setReasonError(null)
          }}
        />
      </div>

      <div className="form-actions">
        <Button variant="default" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={saving}>
          {saving ? 'Saving…' : 'Request correction'}
        </Button>
      </div>
    </div>
  )
}

type ActionKind =
  | 'approval'
  | 'disposition'
  | 'adjust'
  | 'correction'
  | 'manual'

const ACTION_TITLES: Record<ActionKind, string> = {
  approval: 'Set exit approval',
  disposition: 'Dispose the exit variance',
  adjust: 'Adjust the day',
  correction: 'Request a correction',
  manual: 'Edit / override this day',
}

/**
 * The day-detail drawer: what the punches actually say, drawn rather than tabulated, plus
 * the HR actions that can change it. Everything in here is HR territory, so the actions are
 * gated on ATTENDANCE_CORRECT and simply do not render for anybody else.
 */
function DayDetailPopup({
  attendanceId,
  employees,
  branches,
  onHiding,
  onChanged,
}: {
  attendanceId: number
  /** Only needed by the manual-override form the drawer can open. */
  employees: EmployeeListItem[]
  branches: Branch[]
  onHiding: () => void
  onChanged: () => Promise<void>
}) {
  const { hasPermission } = useAuth()
  const canCorrect = hasPermission(PERMISSIONS.correct)

  // The drawer is anchored to a physical edge and slides in from beyond it, and Mantine's Drawer
  // position vocabulary has no logical equivalent — so this is one of the few places that
  // genuinely has to know which way round the page is. See src/i18n/physical.ts.
  // PORT NOTE: the hand-written DevExtreme slide animation is gone; Mantine's Drawer animates itself.
  const { isRtl } = useLanguage()
  const edge = isRtl ? 'left' : 'right'

  const [detail, setDetail] = useState<AttendanceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<ActionKind | null>(null)

  const loadDetail = useCallback(async () => {
    try {
      setDetail(await attendanceService.getById(attendanceId))
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [attendanceId])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      try {
        const data = await attendanceService.getById(attendanceId)
        if (!cancelled) {
          setDetail(data)
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
  }, [attendanceId])

  /** Every HR action changes both this day and its row in the grid behind, so both are reloaded. */
  async function afterAction() {
    setAction(null)
    await loadDetail()
    await onChanged()
  }

  return (
    <Drawer
      opened
      onClose={onHiding}
      // AN EDGE DRAWER, not a centred dialog. The day sits alongside the grid it came from, so the
      // user keeps their place in the list instead of having it covered over. Which edge follows
      // the reading direction: the trailing one, so it never lands on top of where the eye starts.
      className="day-drawer"
      position={edge}
      size={560}
      padding={0}
      // The header is custom (name + date + status badge), so the Drawer's own title bar is off.
      withCloseButton={false}
      styles={{ content: { maxWidth: '96vw' } }}
      transitionProps={{ duration: 180 }}
    >
      <div style={{ padding: '0 22px 22px' }}>
        {/* The header travels with the panel rather than scrolling away with the content: it is the
            only thing saying WHOSE day this is, and the numbers below are meaningless without it. */}
        <div className="day-drawer-head">
          <div>
            <h2 className="day-drawer-title">{detail?.fullName ?? 'Day detail'}</h2>
            <div className="day-drawer-sub">
              {detail && (
                <>
                  <span>{formatDate(detail.workDate)}</span>
                  <StatusBadge status={detail.status} />
                  {detail.isManual && (
                    <span
                      className="badge badge--muted"
                      title="HR entered or corrected this day by hand. The processor will not touch it again."
                    >
                      Manual
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          <ActionIcon
            variant="subtle"
            color="gray"
            title="Close"
            aria-label="Close"
            onClick={onHiding}
          >
            <IconX size={18} />
          </ActionIcon>
        </div>

        <PageHelp>
          The timeline shows what the punches actually say. The break is taken out of
          the first gap; anything beyond that is time away that needs an exit
          permission.
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
        ) : detail ? (
          <div>
            {/* An anomaly found while BROWSING needs the same one-click way out as the Anomalies
                page itself. Burying "Request correction" as the fourth of four equal buttons makes
                the user hunt for the fix to a problem the drawer has just told them about — and
                these days block payroll, so the way out has to be obvious.
                Shown for ANY anomalous day, including one that still has a timeline (a sensor
                double-tap leaves a valid interval AND an unmatched punch). */}
            {detail.hasAnomaly && (
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="tab-toolbar">
                  <div>
                    <div className="empty-hint-main">
                      <IconAlertTriangle
                        size={16}
                        className="anomaly-icon"
                        aria-hidden="true"
                      />{' '}
                      This day could not be read confidently
                    </div>
                    <p className="hint" style={{ marginTop: 4 }}>
                      {describeAnomaly(detail)} The hours on it are not trustworthy, and it
                      blocks payroll until it is fixed.
                    </p>
                  </div>
                  {canCorrect && (
                    <div className="page-head-actions">
                      <Button
                        leftSection={<IconPencil size={16} />}
                        onClick={() => setAction('correction')}
                      >
                        Fix this
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <DayTimeline detail={detail} />

            <DayNumbers detail={detail} />

            {canCorrect && (
              <div className="day-actions">
                <p className="day-actions-title">Change this day</p>

                {/* Ordered by how far-reaching they are, not alphabetically. Each says what it does
                    rather than naming a database operation. */}
                <Button
                  leftSection={<IconPencil size={16} />}
                  title="State what happened, by hand. Takes effect immediately and stops the processor touching this day."
                  onClick={() => setAction('manual')}
                >
                  Edit day
                </Button>

                {/* ONLY on an anomalous day. A correction is the tool for punches that do not add
                    up; offering it on a clean day invites somebody to open an approval workflow
                    when what they actually wanted was to edit the day. */}
                {detail.hasAnomaly && (
                  <Button
                    variant="default"
                    leftSection={<IconBriefcase size={16} />}
                    title="The punches do not add up. Raise a correction — logged, with an old-to-new trail, and it changes nothing until somebody approves it."
                    onClick={() => setAction('correction')}
                  >
                    Fix
                  </Button>
                )}

                <Button
                  variant="default"
                  leftSection={<IconClock size={16} />}
                  title="Record how many minutes of the mid-day absence were authorised."
                  onClick={() => setAction('approval')}
                >
                  Set exit approval
                </Button>
                <Button
                  variant="default"
                  leftSection={<IconCheck size={16} />}
                  title="Rule on the difference between the exit that was approved and the one the punches show."
                  onClick={() => setAction('disposition')}
                >
                  Dispose variance
                </Button>
                <Button
                  variant="default"
                  leftSection={<IconSquareX size={16} />}
                  title="Add or remove worked time on this day, with a mandatory note."
                  onClick={() => setAction('adjust')}
                >
                  Adjust hours
                </Button>
              </div>
            )}

            {action && (
              <Modal
                opened
                onClose={() => setAction(null)}
                title={ACTION_TITLES[action]}
                // The manual form is a two-column grid of nine fields; the others are three fields.
                // Both are fluid with a ceiling — a fixed pixel width is wider than a phone, and the
                // manual form grows again once its computed result appears.
                size={action === 'manual' ? 640 : 480}
                centered
              >
                {action === 'approval' && (
                  <ExitApprovalForm
                    detail={detail}
                    onDone={afterAction}
                    onCancel={() => setAction(null)}
                  />
                )}
                {action === 'disposition' && (
                  <DispositionForm
                    detail={detail}
                    onDone={afterAction}
                    onCancel={() => setAction(null)}
                  />
                )}
                {action === 'adjust' && (
                  <AdjustDayForm
                    detail={detail}
                    onDone={afterAction}
                    onCancel={() => setAction(null)}
                  />
                )}
                {action === 'correction' && (
                  <CorrectionForm
                    detail={detail}
                    onDone={afterAction}
                    onCancel={() => setAction(null)}
                  />
                )}
                {action === 'manual' && (
                  // The SAME form as the toolbar's "Add manual entry", pre-filled with this day.
                  // One form, one set of rules — the entry point should not change the behaviour.
                  <ManualEntryForm
                    employees={employees}
                    branches={branches}
                    existing={detail}
                    // The day being overridden is the day on screen, so the "this replaces the
                    // punch-based record" warning is about the record we already hold.
                    conflictsWith={() => detail}
                    onSaved={afterAction}
                    onCancel={() => setAction(null)}
                  />
                )}
              </Modal>
            )}
          </div>
        ) : null}
      </div>
    </Drawer>
  )
}

const columnHelper = createColumnHelper<AttendanceRecord>()

const PAGE_SIZES = ['15', '30', '50']

/**
 * THE DAY CONTROL — one date, labelled, with the two days anybody actually wants one click away.
 *
 * Quick buttons rather than a second picker: "today" and "yesterday" are the overwhelming majority
 * of what gets chosen here, and each lights up when it IS the selected day, so the control also
 * answers "am I looking at today?" without the reader having to parse a date and compare it to one
 * they hold in their head. That question is the whole reason this control exists.
 */
function DaySelector({
  day,
  onChange,
  disabled,
}: {
  day: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const todayValue = today()
  const yesterdayValue = yesterday()

  return (
    <div className="filter-bar">
      <div className="filter-field">
        <label className="filter-field-label" htmlFor="attendance-day">
          {t('attendance.daily.day')}
        </label>
        {/* Never empty: every action beside it names this date, so clearing keeps the day already
            chosen rather than leaving three buttons pointing at nothing. */}
        <DatePickerInput
          id="attendance-day"
          valueFormat="DD/MM/YYYY"
          leftSection={<IconCalendar size={14} />}
          value={day}
          w={160}
          disabled={disabled}
          onChange={(v) => onChange(v || day)}
        />
      </div>

      <Button
        size="xs"
        variant={day === todayValue ? 'light' : 'subtle'}
        disabled={disabled}
        onClick={() => onChange(todayValue)}
      >
        {t('attendance.daily.today')}
      </Button>
      <Button
        size="xs"
        variant={day === yesterdayValue ? 'light' : 'subtle'}
        disabled={disabled}
        onClick={() => onChange(yesterdayValue)}
      >
        {t('attendance.daily.yesterday')}
      </Button>
    </div>
  )
}

export default function DailyAttendancePage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSIONS.manage)
  // HR only. Both edit paths — the correction and the manual override — change what somebody is
  // paid, so they are held apart from merely running the processor.
  const canCorrect = hasPermission(PERMISSIONS.correct)

  /**
   * The date range lives in the URL, so a link can carry it here — the payroll-readiness tiles on
   * the Overview open this page for the period they were counting, and a range that silently
   * reset to "this month" would show a different set of days than the number the user just clicked.
   */
  const [searchParams, setSearchParams] = useSearchParams()
  const initialRange = periodRange(currentPeriod())

  const from = searchParams.get('from') ?? initialRange.from
  const to = searchParams.get('to') ?? initialRange.to

  function setRange(next: { from?: string; to?: string }) {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current)
        params.set('from', next.from ?? from)
        params.set('to', next.to ?? to)
        return params
      },
      // Replace, not push: nudging a date picker should not bury the page the user came from.
      { replace: true },
    )
  }

  const setFrom = (value: string) => setRange({ from: value })
  const setTo = (value: string) => setRange({ to: value })

  const navigate = useNavigate()
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  const [branchId, setBranchId] = useState<number | null>(null)
  /* Which question the page is answering: the processor's days, or the machines' raw punches. */
  const [view, setView] = useState<'days' | 'punches'>('days')

  const [rows, setRows] = useState<AttendanceRecord[]>([])

  /** How many days in the current range the machine could not read confidently. These block payroll. */
  const anomalyCount = rows.filter((row) => row.hasAnomaly).length
  const [employees, setEmployees] = useState<EmployeeListItem[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /**
   * THE DAY — the single answer to "which day am I working on".
   *
   * Everything day-scoped reads this one value: the Punches view, Re-process day, and Mark
   * absentees. It used to be three different dates — the range's From for the punches, a separate
   * picker for absentees, and nothing at all naming the punches day — so the page opened on a
   * month range and quietly showed the punches of the 1st, which reads as "no punches today"
   * rather than "you are looking at the wrong day".
   *
   * Defaults to TODAY because that is the day somebody has come to check on. The From/To range
   * below is a different question — which employee-days to LIST — and deliberately does not
   * follow this one.
   */
  const [day, setDay] = useState(today())
  const [running, setRunning] = useState(false)

  const [openDayId, setOpenDayId] = useState<number | null>(null)

  /**
   * THE EXPANDED ROWS and the intervals behind them.
   *
   * Two pieces of state rather than one because they answer different questions: which rows the
   * user has OPEN, and which days we have already FETCHED. Collapsing a row keeps its intervals,
   * so re-opening it is instant and a day is fetched at most once while the grid stays mounted —
   * `getById` is the only source of intervals and it takes one day at a time, so the cheapest
   * request is the one not made twice.
   */
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set())
  const [pairsById, setPairsById] = useState<Record<number, PairsState>>({})

  const loadPairs = useCallback(async (attendanceId: number) => {
    setPairsById((current) => ({ ...current, [attendanceId]: { status: 'loading' } }))
    try {
      const detail = await attendanceService.getById(attendanceId)
      setPairsById((current) => ({ ...current, [attendanceId]: { status: 'ready', detail } }))
    } catch (err) {
      setPairsById((current) => ({
        ...current,
        [attendanceId]: { status: 'error', message: getErrorMessage(err) },
      }))
    }
  }, [])

  function toggleExpanded(attendanceId: number) {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(attendanceId)) next.delete(attendanceId)
      else next.add(attendanceId)
      return next
    })
  }

  /**
   * The cache belongs to the rows it was read alongside — re-processing a day REWRITES its
   * intervals, so a cache that outlived the day list would show an expanded row the pairs it had
   * before the run that just changed them. Dropping it here and refilling below is what keeps the
   * panel honest after Re-process day, a correction, or any other reload.
   */
  useEffect(() => {
    setPairsById({})
  }, [rows])

  /**
   * Fetch the pairs for any row that is open and has none. Doing it here rather than in the click
   * means one rule covers both ways a row ends up needing them — the user opened it, or the list
   * reloaded underneath it while it was already open — and a day is still fetched at most once per
   * list, since anything already loading or loaded fails the guard.
   */
  useEffect(() => {
    for (const id of expandedIds) {
      if (!pairsById[id]) void loadPairs(id)
    }
  }, [expandedIds, pairsById, loadPairs])

  /** Jump from a day to the raw punches behind it: same page, other tab, that day selected. */
  function showPunchesFor(workDate: string) {
    setDay(workDate.slice(0, 10))
    setView('punches')
  }

  /**
   * The two edit paths, kept apart on purpose — see the Actions column.
   *   manualRow     : HR states what happened. Immediate, marks the day manual.
   *                   `null` inside the dialog means a brand-new day from the toolbar.
   *   correctionRow : a logged REQUEST against a punch problem. Approved before it counts.
   */
  const [manualRow, setManualRow] = useState<AttendanceRecord | null>(null)
  const [manualNewVisible, setManualNewVisible] = useState(false)
  const [correctionRow, setCorrectionRow] = useState<AttendanceRecord | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(
        await attendanceService.get(
          from,
          to,
          employeeId ?? undefined,
          branchId ?? undefined,
        ),
      )
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [from, to, employeeId, branchId])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      try {
        // The employee and branch filters are part of the page, so they load with the data.
        const [records, employeeList, branchList] = await Promise.all([
          attendanceService.get(from, to),
          employeesService.getAll().catch(() => [] as EmployeeListItem[]),
          branchesService.getAll().catch(() => [] as Branch[]),
        ])
        if (!cancelled) {
          setRows(records)
          setEmployees(employeeList)
          setBranches(branchList)
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
    // Runs once on mount. Changing a filter afterwards is an explicit act — the user presses
    // Apply — so the grid never reloads under them while they are still choosing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // LIVE: a correction approved or the processor run elsewhere rewrites the rows on screen.
  // Silent — no spinner — because nobody on this page asked for this refetch.
  useLive(['attendance'], () => void load(), useLiveEnabled('attendance'))

  function refresh() {
    setLoading(true)
    void load()
  }

  async function runProcessor() {
    setRunning(true)
    try {
      const result = await attendanceService.process()
      notifications.show({
        message: `Processed ${result.employeeDaysProcessed} employee-day(s).`,
        color: 'green',
        autoClose: 2500,
      })
      await load()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setRunning(false)
    }
  }

  /**
   * Re-derive the From date under the CURRENT punch-interpretation settings.
   *
   * Distinct from the processor beside it, which only ever consumes punches it has not seen — so
   * after switching punch direction to Alternate, or changing the debounce, the processor would
   * leave every already-built day exactly as it was. This is what makes that change reach a day
   * that has already been processed. The punches themselves are not touched, and a day somebody
   * has corrected by hand stays corrected.
   */
  async function runReprocessDay() {
    setRunning(true)
    try {
      const result = await attendanceService.reprocessDay(day)
      notifications.show({
        message: t('attendance.daily.reprocessDone', { count: result.employeeDaysProcessed }),
        color: 'green',
        autoClose: 3000,
      })
      await load()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setRunning(false)
    }
  }

  async function runMarkAbsentees() {
    setRunning(true)
    try {
      const result = await attendanceService.markAbsentees(day)
      notifications.show({
        message: t('attendance.daily.absenteesDone', {
          count: result.absenteesMarked,
          date: formatDayLabel(day),
        }),
        color: 'green',
        autoClose: 2500,
      })
      await load()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setRunning(false)
    }
  }

  /* ── The grid, DevExtreme DataGrid → TanStack Table + Mantine Table ── */

  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const columns = useMemo(
    () => [
      /* THE CHEVRON. First, narrow, and unlabelled — it is a disclosure control, not data, and a
         header over it would read as a column somebody could sort or filter by. */
      columnHelper.display({
        id: 'expand',
        size: 40,
        header: () => null,
        cell: (info) => {
          const id = info.row.original.attendanceId
          const open = expandedIds.has(id)
          return (
            <button
              type="button"
              className="pairs-toggle"
              aria-expanded={open}
              aria-label={t(open ? 'attendance.pairs.collapse' : 'attendance.pairs.expand')}
              title={t(open ? 'attendance.pairs.collapse' : 'attendance.pairs.expand')}
              onClick={() => toggleExpanded(id)}
            >
              {open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            </button>
          )
        },
      }),
      columnHelper.accessor('fullName', { header: 'Employee' }),
      columnHelper.accessor('workDate', { header: 'Date', size: 110 }),

      // Times and durations sort on the raw value and match on the rendered one — "08:05" is what
      // the user reads, and the timestamp behind it is not something anyone would type.
      columnHelper.accessor('firstInUtc', {
        header: 'First in',
        size: 90,
        enableGlobalFilter: false,
        cell: (info) => formatTime(info.row.original.firstInUtc),
        meta: { filterText: formatTime },
      }),
      columnHelper.accessor('lastOutUtc', {
        header: 'Last out',
        size: 90,
        enableGlobalFilter: false,
        cell: (info) => formatTime(info.row.original.lastOutUtc),
        meta: { filterText: formatTime },
      }),

      columnHelper.accessor('workedMinutes', {
        header: 'Worked',
        size: 95,
        enableGlobalFilter: false,
        cell: (info) => formatMinutes(info.row.original.workedMinutes),
        meta: { filterText: formatMinutes },
      }),

      /* PAIRS — how many in→out stretches make up the Worked cell beside it.
         Sorts numerically on punchPairs, which the list row already carries, so the column costs
         nothing to show. The TIMES, though, only exist in the per-day detail, and there is no
         endpoint that returns intervals for a range — so a short day shows its pairs inline where
         they are known for certain, and falls back to the count where they are not:
           · 1 pair on a clean day — firstIn/lastOut ARE that pair, exactly, with nothing fetched;
           · any day already expanded — the real intervals, from the cache;
           · everything else — the count, until the row is opened.
         The alternative was a request per row on every page render, which is a poor trade for a
         detail the chevron reveals in full. */
      columnHelper.accessor('punchPairs', {
        header: () => (
          <span title="Complete in→out stretches. Worked time is the sum of these — expand the row to see them.">
            Pairs
          </span>
        ),
        size: 160,
        enableGlobalFilter: false,
        cell: (info) => {
          const record = info.row.original
          const cached = pairsById[record.attendanceId]
          const intervals = cached?.status === 'ready' ? cached.detail.intervals : null

          if (record.punchPairs === 0) return <span className="pairs-gap">{t('common.dash')}</span>

          if (intervals && intervals.length > 0 && intervals.length <= 3) {
            return (
              <span className="pairs-inline">
                {intervals.map((interval, index) => (
                  <span key={interval.intervalId}>
                    {index > 0 && <span className="sep">·</span>}
                    {formatTime(interval.inTimeUtc)}–{formatTime(interval.outTimeUtc)}
                  </span>
                ))}
              </span>
            )
          }

          // The one pair a clean day has is bounded by its own first in and last out. Anomalous
          // days are excluded: a leftover punch can move either end away from the pair.
          if (record.punchPairs === 1 && !record.hasAnomaly && record.firstInUtc && record.lastOutUtc) {
            return (
              <span className="pairs-inline">
                {formatTime(record.firstInUtc)}–{formatTime(record.lastOutUtc)}
              </span>
            )
          }

          return <span>{record.punchPairs}</span>
        },
        meta: { filterText: (v) => String(v) },
      }),

      columnHelper.accessor('dayFraction', {
        header: () => (
          <span title="How much of a full day was earned. Worked time divided by the standard day, capped at 1.">
            Day fraction
          </span>
        ),
        size: 150,
        enableGlobalFilter: false,
        cell: (info) => (
          <DayFractionBar value={info.row.original.dayFraction} />
        ),
        // The bar prints the same 2dp figure beside itself; that figure is what the filter takes.
        meta: { filterText: (v) => v.toFixed(2) },
      }),

      columnHelper.accessor('lateMinutes', {
        header: () => (
          <span title="Minutes past the shift start plus its grace period.">
            Late
          </span>
        ),
        size: 85,
        enableGlobalFilter: false,
        cell: (info) => formatMinutes(info.row.original.lateMinutes),
        meta: { filterText: formatMinutes },
      }),

      columnHelper.accessor('overtimeMinutes', {
        header: () => (
          <span title="Detected only. Attendance never pays this — pay only what an approved overtime request authorises.">
            Overtime
          </span>
        ),
        size: 95,
        enableGlobalFilter: false,
        cell: (info) => formatMinutes(info.row.original.overtimeMinutes),
        meta: { filterText: formatMinutes },
      }),

      columnHelper.display({
        id: 'exitActualApproved',
        header: () => (
          <span title="Actual is what the punches show. Approved is what was authorised. They are independent.">
            Exit actual / approved
          </span>
        ),
        size: 150,
        cell: (info) => {
          const row = info.row.original
          return `${formatMinutes(row.exitActualMinutes)} / ${formatMinutes(row.exitApprovedMinutes)}`
        },
      }),

      columnHelper.accessor('status', {
        header: 'Status',
        size: 110,
        cell: (info) => (
          <StatusBadge status={info.row.original.status} />
        ),
        meta: { filterText: statusText, filterOptions: STATUS_OPTIONS.map(statusText) },
      }),

      columnHelper.accessor('source', {
        header: () => (
          <span title="Device, Excel, or Manual — how this day's data arrived.">
            Source
          </span>
        ),
        size: 95,
      }),

      // A 44px unlabelled icon strip: there is no room for a control and nothing to type. The
      // anomaly banner above the grid, and the Anomalies page it links to, are the way in.
      columnHelper.accessor('hasAnomaly', {
        header: '',
        size: 44,
        enableSorting: false,
        enableGlobalFilter: false,
        // The REASON, not just the flag. describeAnomaly reads firstIn/lastOut/punchPairs, all of
        // which are already on the row — so hovering says "punched in at 08:04, never punched out"
        // without the grid fetching anything per row to find out.
        cell: (info) => (
          <AnomalyIcon
            has={info.row.original.hasAnomaly}
            reason={
              info.row.original.hasAnomaly ? describeAnomaly(info.row.original) : undefined
            }
          />
        ),
        meta: { noFilter: true },
      }),

      /* Every route off this row, named. Nothing here is reachable by clicking the row
          itself — including "View", because a detail drawer that opens on a stray click is
          how somebody ends up one button away from editing a day they never meant to open. */
      columnHelper.display({
        id: 'actions',
        header: 'Actions',
        size: canCorrect ? 150 : 88,
        cell: (info) => {
          const row = info.row.original

          // The row's own state picks the right tool, because they are NOT interchangeable:
          // an anomaly is a punch problem, which needs an auditable correction somebody
          // approves. Anything else is HR stating what happened, which is an immediate
          // manual override. Offering the wrong one invites the wrong kind of change.
          const anomaly = row.hasAnomaly

          return (
            <div className="grid-actions">
              {/* Read-only, so anyone who can see the page can see the punches behind a day. */}
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={<IconSearch size={14} />}
                title="See the punches behind this day."
                onClick={() => setOpenDayId(row.attendanceId)}
              >
                View
              </Button>
              {canCorrect && (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  leftSection={
                    anomaly ? <IconAlertTriangle size={14} /> : <IconPencil size={14} />
                  }
                  title={
                    anomaly
                      ? 'The punches on this day do not add up. Raise a correction — it is logged and takes effect once approved.'
                      : 'Enter or override this day by hand. Takes effect immediately and stops the processor touching it.'
                  }
                  onClick={() =>
                    anomaly ? setCorrectionRow(row) : setManualRow(row)
                  }
                >
                  {anomaly ? 'Fix' : 'Edit'}
                </Button>
              )}
            </div>
          )
        },
      }),
    ],
    [canCorrect, expandedIds, pairsById, t],
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
    // Multi-column sort on shift-click, as the original's Sorting mode="multiple" allowed.
    enableMultiSort: true,
    initialState: { pagination: { pageSize: 15 } },
    getRowId: (r) => String(r.attendanceId),
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const total = table.getFilteredRowModel().rows.length

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Daily attendance</h1>
          <p className="page-subtitle">
            One row per employee per day. Use View to see the punches behind a day.
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
          {/* Deep-link to the printable Daily Attendance REPORT, pre-filled with THIS view's date
              and branch. It only navigates — it does not re-fetch or re-implement the report; the
              report page reads the same parameters from the URL and runs itself.

              A daily sheet is ONE day, so it takes the Day control's day. It used to take the
              range's start, which meant printing on the 14th handed you the sheet for the 1st. */}
          <Button
            variant="default"
            leftSection={<IconPrinter size={16} />}
            title={t('attendance.daily.printTitle', { date: formatDayLabel(day) })}
            onClick={() =>
              navigate(
                `/reports/daily-attendance?workDate=${encodeURIComponent(day)}` +
                  (branchId ? `&branchId=${branchId}` : ''),
              )
            }
          >
            {t('attendance.daily.print', { date: formatDayLabel(day) })}
          </Button>
          {/* ATTENDANCE_MANAGE — "enter attendance manually" is what that code is for, and this is
              the toolbar's ENTER path: a day the processor never produced. The drawer's "Edit day"
              is the other thing and keeps ATTENDANCE_CORRECT, because overriding a day the system
              already derived is the act that changes what somebody is paid.
              Hidden rather than disabled: a button somebody can never use is noise. */}
          {canManage && (
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => setManualNewVisible(true)}
            >
              Add manual entry
            </Button>
          )}
        </div>
      </div>

      <PageHelp>
        One row per employee per day. Worked time is the sum of the intervals actually
        clocked — if someone leaves for two hours and comes back, those two hours are
        not worked time. &lsquo;Day fraction&rsquo; is how much of a full day they
        earned.
      </PageHelp>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {canManage && (
        <div className="card">
          <div className="card-title">Build the days</div>

          {/* The day first, the actions under it: two of the three buttons below NAME this date,
              so it has to be settled before either is a sensible thing to press. */}
          <DaySelector day={day} onChange={setDay} disabled={running} />

          <div className="filter-bar">
            <Button
              leftSection={<IconRefresh size={16} />}
              disabled={running}
              onClick={() => void runProcessor()}
            >
              Run processor (all unprocessed punches)
            </Button>

            {/* Beside the processor because they look similar and are not: that one consumes what
                it has not seen, this one rebuilds a day it HAS seen, under whatever the punch
                direction and debounce settings say now. Default rather than filled — re-deriving
                a day is the rarer, more deliberate act of the two. */}
            <Button
              variant="default"
              disabled={running}
              title={t('attendance.daily.reprocessTitle', { date: formatDayLabel(day) })}
              onClick={() => void runReprocessDay()}
            >
              {t('attendance.daily.reprocess', { date: formatDayLabel(day) })}
            </Button>

            <Button
              variant="default"
              disabled={running}
              title={t('attendance.daily.absenteesTitle', { date: formatDayLabel(day) })}
              onClick={() => void runMarkAbsentees()}
            >
              {t('attendance.daily.absentees', { date: formatDayLabel(day) })}
            </Button>
          </div>
          <p className="hint">
            {t('attendance.daily.buildHint')}
          </p>
        </div>
      )}

      <div className="filter-bar">
        <div className="filter-field">
          <label className="filter-field-label" htmlFor="filter-period">
            {t('common.period')}
          </label>
          {/* NOT CLEARABLE — the range travels in the URL and the day read requires both ends. */}
          <DateRangeField
            id="filter-period"
            w={230}
            from={from}
            to={to}
            onChange={(nextFrom, nextTo) => {
              if (nextFrom && nextTo) {
                setFrom(nextFrom)
                setTo(nextTo)
              }
            }}
          />
        </div>

        <div className="filter-field">
          <label className="filter-field-label" htmlFor="filter-employee">
            Employee
          </label>
          <Select
            id="filter-employee"
            data={employees.map((item) => ({
              value: String(item.employeeId),
              label: item.fullName,
            }))}
            value={employeeId != null ? String(employeeId) : null}
            placeholder="Everyone"
            w={220}
            searchable
            clearable
            onChange={(v) => setEmployeeId(v != null ? Number(v) : null)}
          />
        </div>

        <div className="filter-field">
          <label className="filter-field-label" htmlFor="filter-branch">
            Branch
          </label>
          <Select
            id="filter-branch"
            data={branches.map((b) => ({ value: String(b.branchId), label: b.name }))}
            value={branchId != null ? String(branchId) : null}
            placeholder="All branches"
            w={200}
            clearable
            onChange={(v) => setBranchId(v != null ? Number(v) : null)}
          />
        </div>

        <div className="filter-spacer">
          <Button
            variant="default"
            leftSection={<IconSearch size={16} />}
            onClick={refresh}
          >
            Apply
          </Button>
        </div>
      </div>

      {/* Anomalies block payroll, so a range that contains them must offer the way out from here
          — not leave the user to find the Anomalies page and then re-enter the same dates.
          The range travels in the URL, so the page they land on shows exactly the days they were
          just looking at. Landing on a different range would show a different set of problems, or
          none at all, and "nothing is wrong" is the most dangerous thing that page can say. */}
      {anomalyCount > 0 && (
        <div className="card">
          <div className="tab-toolbar">
            <div>
              <div className="empty-hint-main">
                <IconAlertTriangle
                  size={16}
                  className="anomaly-icon"
                  aria-hidden="true"
                />{' '}
                {anomalyCount} day{anomalyCount === 1 ? '' : 's'} in this range could
                not be read confidently
              </div>
              <p className="hint" style={{ marginTop: 4 }}>
                The hours on {anomalyCount === 1 ? 'it' : 'them'} are not trustworthy,
                and the month cannot be paid while any are left open. Fix them with a
                correction — the original punches are never edited.
              </p>
            </div>
            <div className="page-head-actions">
              <Button
                component={Link}
                variant="default"
                to={`/attendance/anomalies?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`}
              >
                Fix these anomalies
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* DAYS vs PUNCHES — the processor's interpretation, or what the machines actually said.
          They answer different questions and the second one had no home in the app at all: a day
          that looks wrong sends you to the punches behind it, and a punch missing from there is a
          machine problem rather than a processing one. The Punches view reads ONE day — the Day
          control's — because the raw log is per-punch and a month of it is not a screen anybody
          reads. It used to read the RANGE'S FROM DATE, which on a page opening at the start of a
          month meant the punches of the 1st under a heading nobody read as "the 1st". */}
      <div className="tab-toolbar">
        <SegmentedControl
          value={view}
          onChange={(value) => setView(value as 'days' | 'punches')}
          data={[
            { value: 'days', label: 'Days' },
            { value: 'punches', label: 'Punches' },
          ]}
        />
        {view === 'punches' && (
          <span className="hint">
            {t('attendance.daily.punchesHint', { date: formatDayLabel(day) })}
          </span>
        )}
      </div>

      {/* Managers set the day in the card above. Everybody else can still READ the punches, so
          without the card they would have no way to move off today — the control comes with them
          rather than being duplicated for the people who already have one. */}
      {view === 'punches' && !canManage && (
        <div className="card">
          <DaySelector day={day} onChange={setDay} />
        </div>
      )}

      {view === 'punches' ? (
        <PunchesGrid
          date={day}
          branchId={branchId}
          onGoToToday={day === today() ? undefined : () => setDay(today())}
        />
      ) : loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">
              No attendance days between {from} and {to}.
            </div>
            Punches only become days once the processor has run. Widen the dates, or
            run the processor above and then mark absentees for the days that are
            finished.
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          {/* PORT NOTE: the DevExtreme FilterRow + HeaderFilter are approximated by one global
              search box; only the columns the original allowed filtering on take part in it. */}
          <Group justify="flex-end" p="xs">
            <TextInput
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.currentTarget.value)}
              placeholder="Search"
              leftSection={<IconSearch size={14} />}
              w={240}
              size="xs"
            />
          </Group>

          <Table striped withColumnBorders={false} verticalSpacing="xs" fz="sm">
            <Table.Thead>
              {table.getHeaderGroups().map((hg) => (
                <Table.Tr key={hg.id}>
                  {hg.headers.map((header) => {
                    const canSort = header.column.getCanSort()
                    return (
                      <Table.Th
                        key={header.id}
                        style={{
                          width: header.column.columnDef.size,
                          whiteSpace: 'nowrap',
                          userSelect: 'none',
                          cursor: canSort ? 'pointer' : undefined,
                          textAlign:
                            header.column.id === 'actions' ? alignEnd() : undefined,
                        }}
                        onClick={
                          canSort ? header.column.getToggleSortingHandler() : undefined
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
                    <div className="empty-hint" style={{ padding: 16 }}>
                      No attendance days match these filters.
                    </div>
                  </Table.Td>
                </Table.Tr>
              ) : (
                table.getRowModel().rows.map((row) => {
                  const id = row.original.attendanceId
                  const pairs = pairsById[id]

                  return (
                    // NO row click, deliberately. Nothing on this page happens because a click
                    // landed somewhere vague — every action, including merely opening a day, is an
                    // aimed click on its own named button. The chevron is one of those.
                    <Fragment key={row.id}>
                      <Table.Tr>
                        {row.getVisibleCells().map((cell) => (
                          <Table.Td
                            key={cell.id}
                            style={
                              cell.column.id === 'actions'
                                ? { textAlign: alignEnd() }
                                : undefined
                            }
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </Table.Td>
                        ))}
                      </Table.Tr>

                      {/* The pairs, in a row of their own spanning the full width. Rendered only
                          while open, and only once the first fetch has been started — an expanded
                          row with no state yet would flash an empty panel. */}
                      {expandedIds.has(id) && pairs && (
                        <Table.Tr>
                          <Table.Td colSpan={row.getVisibleCells().length} style={{ padding: 0 }}>
                            <DayPairsPanel
                              record={row.original}
                              state={pairs}
                              onRetry={() => void loadPairs(id)}
                              onSeePunches={() => showPunchesFor(row.original.workDate)}
                            />
                          </Table.Td>
                        </Table.Tr>
                      )}
                    </Fragment>
                  )
                })
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
      )}

      {openDayId !== null && (
        <DayDetailPopup
          attendanceId={openDayId}
          employees={employees}
          branches={branches}
          onHiding={() => setOpenDayId(null)}
          onChanged={load}
        />
      )}

      {/* MANUAL OVERRIDE — immediate, marks the day manual. From the toolbar (a new day) or from
          a row's Edit button (that day, pre-filled). The Modal is mounted conditionally so the
          form inside is created fresh each time it opens — ManualEntryForm seeds its state once,
          on mount, and relies on that. */}
      {(manualNewVisible || manualRow !== null) && (
        <Modal
          opened
          onClose={() => {
            setManualNewVisible(false)
            setManualRow(null)
          }}
          title={
            manualRow
              ? `Override ${manualRow.fullName} — ${formatDate(manualRow.workDate)}`
              : 'Add manual entry'
          }
          // Fluid, with 640 as a CEILING rather than a fixed size: 640px is wider than a phone,
          // and this form also GROWS after saving when the computed result appears. Mantine's
          // Modal caps itself to the viewport and scrolls its content, so the buttons stay
          // reachable.
          size={640}
          centered
        >
          <ManualEntryForm
            employees={employees}
            branches={branches}
            existing={manualRow}
            conflictsWith={(employeeId: number, workDate: string) =>
              // Only the days currently loaded can be checked — the warning is best-effort, which
              // is exactly why it warns rather than blocks. The upsert is safe either way.
              rows.find(
                (row) =>
                  row.employeeId === employeeId &&
                  row.workDate.slice(0, 10) === workDate.slice(0, 10),
              )
            }
            onSaved={load}
            onCancel={() => {
              setManualNewVisible(false)
              setManualRow(null)
            }}
          />
        </Modal>
      )}

      {/* CORRECTION — a logged request that changes nothing until it is approved. Only ever
          offered for a day whose punches do not add up. */}
      {correctionRow !== null && (
        <Modal
          opened
          onClose={() => setCorrectionRow(null)}
          title={`Fix ${correctionRow.fullName} — ${formatDate(correctionRow.workDate)}`}
          size={560}
          centered
        >
          <CorrectionForm
            detail={correctionRow}
            onDone={async () => {
              setCorrectionRow(null)
              await load()
            }}
            onCancel={() => setCorrectionRow(null)}
          />
        </Modal>
      )}
    </div>
  )
}
