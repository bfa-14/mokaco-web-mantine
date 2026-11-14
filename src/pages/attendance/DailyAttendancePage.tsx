import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { ActionIcon, Button, Checkbox, Group, Loader, NumberInput, Pagination, SegmentedControl, Select, Table, Textarea, TextInput } from '@mantine/core'
import { Drawer, Modal } from '../../components/dialogs'
import { DateTimePicker } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { DateRangeField } from '../../components/DateRangeField'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconBriefcase, IconDownload, IconMessageReport, IconCalendar, IconCheck, IconChevronDown, IconChevronRight, IconClock, IconPencil, IconPlus, IconPrinter, IconRefresh, IconSearch, IconSquareX, IconX } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { dateTimeToPicker, secondsDateTimeFromPicker } from '../../components/date/pickerValue'
import { gridFilterFn, GridFilterRow } from '../../components/grid/GridFilterRow'
import { PageHelp } from '../../components/PageHelp'
import { GridHeaderContent } from '../../components/grid/GridHeaderFilter'
import { useLive } from '../../live/useLive'
import { useLiveEnabled } from '../../live/useLiveSettings'
import { ManualEntryForm } from './ManualEntryForm'
import { getErrorMessage } from '../../api/errorMessage'
import type { NumberInputValue } from '../../components/numeric'
import { parseBoundedDecimal } from '../../components/decimalInputs'
import {
  attendanceService,
  correctionsService,
  rosterService,
} from '../../services/attendanceService'
import { branchesService, employeesService } from '../../services/hrService'
import { PERMISSIONS } from '../../types/attendance'
import type {
  AttendanceDetail,
  AttendanceInterval,
  AttendanceRecord,
  ShiftAssignment,
  UnrosteredDay,
} from '../../types/attendance'
import type { Branch, EmployeeListItem } from '../../types/hr'
import { AnomalyIcon, DayFractionBar, StatusBadge } from './attendanceShared'
import { PunchesGrid } from './PunchesGrid'
import { NotOnRosterPanel } from './NotOnRosterPanel'
import { TodayBoard } from './TodayBoard'
import { MissingPunchDialog } from './MissingPunchDialog'
import { ReportDayDialog } from './DayReports'
import { missingSide } from './missingPunch'
import { applyQuickFilters, hhmmOf, periodShortcut, QUICK_FILTERS, quickFilterCounts, toCsv } from './dailyFilters'
import type { QuickFilter } from './dailyFilters'
import { DayPairsPanel } from './DayPairsPanel'
import type { PairsState } from './DayPairsPanel'
import {
  currentPeriod,
  describeAnomaly,
  formatDate,
  formatDayFraction,
  formatDayLabel,
  formatMinutes,
  formatTime,
  periodRange,
  statusText,
  toDateString,
} from './attendanceFormat'
import { companyToday, dayBefore, dayProgress, isOpenAnomaly } from './dayProgress'
import type { DayProgress } from './dayProgress'
import { alignEnd } from '../../i18n/physical'
import { t as translate } from '../../i18n/t'
import { useLanguage } from '../../i18n/useLanguage'

/** The four values ATTENDANCE_RECORD.status can hold. A correction may only move a day between these. */
const STATUS_OPTIONS = ['Present', 'Absent', 'RestDay', 'Leave']

/**
 * HR's three possible rulings on an exit that ran longer than what was authorised. Payroll
 * is blocked until one of them is chosen, so each states its consequence rather than its name.
 */
const DISPOSITION_VALUES = ['UnpaidAbsence', 'Overtime', 'Ignore'] as const
/** Read when drawn, so the words follow the language. */
const dispositions = () =>
  DISPOSITION_VALUES.map((value) => ({
    value,
    title: translate(`attendance.dailyPage.disposition.${value}.title`),
    consequence: translate(`attendance.dailyPage.disposition.${value}.consequence`),
  }))

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
        <div className="day-empty-main">{translate('attendance.dailyPage.timeline.empty')}</div>
        {describeAnomaly(detail)} {translate('attendance.dailyPage.timeline.noPair')}{' '}
        {detail.status === 'Absent' || detail.status === 'RestDay'
          ? translate('attendance.dailyPage.timeline.expected')
          : translate('attendance.dailyPage.timeline.useEdit')}
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
              ? translate('attendance.dailyPage.timeline.worked', { minutes: formatMinutes(segment.minutes) })
              : translate('attendance.dailyPage.timeline.gap', { minutes: formatMinutes(segment.minutes) })}
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
          title={translate('attendance.dailyPage.timeline.workedTitle')}
        >
          {translate('attendance.dailyPage.timeline.workedTotal', { minutes: formatMinutes(detail.workedMinutes) })}
        </span>
        <span className="sep">·</span>
        <span
          className="metric"
          title={translate('attendance.dailyPage.timeline.breakTitle')}
        >
          {translate('attendance.dailyPage.timeline.break', { minutes: formatMinutes(detail.breakApplied) })}
        </span>
        <span className="sep">·</span>
        <span
          className="metric"
          title={translate('attendance.dailyPage.timeline.exitTitle')}
        >
          {translate('attendance.dailyPage.timeline.exit', { minutes: formatMinutes(detail.exitActualMinutes) })}
        </span>
        <span className="sep">·</span>
        <span
          className="metric"
          title={translate('attendance.dailyPage.timeline.fractionTitle')}
        >
          {translate('attendance.dailyPage.timeline.fraction', { value: formatDayFraction(detail.dayFraction) })}
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
        label={translate('attendance.dailyPage.metric.worked')}
        value={formatMinutes(detail.workedMinutes)}
        rule={translate('attendance.dailyPage.metric.workedRule')}
      />
      <Metric
        label={translate('attendance.dailyPage.metric.standard')}
        value={formatMinutes(detail.standardMinutes)}
        rule={translate('attendance.dailyPage.metric.standardRule')}
      />
      <Metric
        label={translate('attendance.dailyPage.metric.fraction')}
        value={formatDayFraction(detail.dayFraction)}
        rule={translate('attendance.dailyPage.metric.fractionRule')}
      />
      <Metric
        label={translate('attendance.dailyPage.metric.late')}
        value={formatMinutes(detail.lateMinutes)}
        muted={detail.lateMinutes === 0}
        rule={translate('attendance.dailyPage.metric.lateRule')}
      />
      <Metric
        label={translate('attendance.dailyPage.metric.overtime')}
        value={formatMinutes(detail.overtimeMinutes)}
        muted={detail.overtimeMinutes === 0}
        rule={translate('attendance.dailyPage.metric.overtimeRule')}
      />
      <Metric
        label={translate('attendance.dailyPage.metric.exitActual')}
        value={formatMinutes(detail.exitActualMinutes)}
        muted={detail.exitActualMinutes === 0}
        rule={translate('attendance.dailyPage.metric.exitActualRule')}
      />
      <Metric
        label={translate('attendance.dailyPage.metric.exitApproved')}
        value={formatMinutes(detail.exitApprovedMinutes)}
        muted={detail.exitApprovedMinutes === 0}
        rule={translate('attendance.dailyPage.metric.exitApprovedRule')}
      />
      <Metric
        label={translate('attendance.dailyPage.metric.exitVariance')}
        value={
          detail.exitVarianceMinutes === 0
            ? '—'
            : detail.exitVarianceMinutes > 0
              ? translate('attendance.dailyPage.metric.more', { minutes: formatMinutes(detail.exitVarianceMinutes) })
              : translate('attendance.dailyPage.metric.less', { minutes: formatMinutes(Math.abs(detail.exitVarianceMinutes)) })
        }
        muted={detail.exitVarianceMinutes === 0}
        rule={translate('attendance.dailyPage.metric.exitVarianceRule')}
      />
      <Metric
        label={translate('attendance.dailyPage.metric.exitLeave')}
        value={formatMinutes(detail.exitLeaveMinutes)}
        muted={detail.exitLeaveMinutes === 0}
        rule={translate('attendance.dailyPage.metric.exitLeaveRule')}
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
        message: translate('attendance.dailyPage.exitForm.saved', { minutes: formatMinutes(minutes), name: detail.fullName }),
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
      <p className="hint">{translate('attendance.dailyPage.exitForm.intro')}</p>

      <div className="form-field">
        <label className="form-label" htmlFor="exit-approved-minutes">
          {translate('attendance.dailyPage.exitForm.minutes')}
        </label>
        <NumberInput
          id="exit-approved-minutes"
          value={minutes}
          min={0}
          disabled={saving}
          onChange={(v) => setMinutes(typeof v === 'number' ? v : 0)}
        />
        <p className="hint">
          {translate('attendance.dailyPage.exitForm.actual', { minutes: formatMinutes(detail.exitActualMinutes) })}
        </p>
      </div>

      <div className="form-field">
        <Checkbox
          checked={alsoSetActual}
          disabled={saving}
          label={translate('attendance.dailyPage.exitForm.alsoActual')}
          onChange={(e) => setAlsoSetActual(e.currentTarget.checked)}
        />
        <p className="hint">{translate('attendance.dailyPage.exitForm.alsoActualHint')}</p>
      </div>

      <div className="form-field">
        <label className="form-label" htmlFor="exit-approval-note">
          {translate('attendance.dailyPage.noteOptional')}
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
          {translate('common.cancel')}
        </Button>
        <Button onClick={() => void submit()} disabled={saving}>
          {saving ? translate('common.saving') : translate('attendance.dailyPage.exitForm.save')}
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
        message: translate('attendance.dailyPage.dispositionForm.saved', {
          name: detail.fullName,
          date: formatDate(detail.workDate),
          minutes: formatMinutes(detail.exitVarianceMinutes),
          title,
        }),
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
        {translate('attendance.dailyPage.dispositionForm.intro', {
          actual: formatMinutes(detail.exitActualMinutes),
          approved: formatMinutes(detail.exitApprovedMinutes),
          variance: formatMinutes(detail.exitVarianceMinutes),
          overtime: formatMinutes(detail.overtimeMinutes),
        })}
      </p>

      <div className="form-field">
        <label className="form-label" htmlFor="disposition-note">
          {translate('attendance.dailyPage.noteOptional')}
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
        {dispositions().map((option) => (
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
          {translate('common.cancel')}
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
  const { t } = useTranslation()
  const [workedMinutes, setWorkedMinutes] = useState<number | null>(null)
  /* TRAP 6 (QA3 WEB-5): the box's value AS RECEIVED. Mantine passes "0." as a string while a
     decimal is typed; writing null back for it emptied the box, so 0.5 was saved as 5, clamped to
     1 — a whole day paid. Read ONCE, at submit, through parseBoundedDecimal. */
  const [dayFractionRaw, setDayFractionRaw] = useState<NumberInputValue>('')
  const [fractionError, setFractionError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  /* PORT NOTE: DevExtreme RequiredRule → the same check and message, run in submit(). */
  const [noteError, setNoteError] = useState<string | null>(null)

  async function submit() {
    const dayFraction = parseBoundedDecimal(dayFractionRaw, 0, 1)
    if (dayFraction === 'invalid') {
      setFractionError(t('attendance.daily.fractionInvalid'))
      return
    }
    if (!note.trim()) {
      setNoteError(translate('attendance.dailyPage.adjustForm.noteRequired'))
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
        message: translate('attendance.dailyPage.adjustForm.saved', { name: detail.fullName, date: formatDate(detail.workDate) }),
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
      <p className="hint">{translate('attendance.dailyPage.adjustForm.intro')}</p>

      <div className="form-field">
        <label className="form-label" htmlFor="adjust-worked">
          {translate('attendance.dailyPage.adjustForm.worked')}
        </label>
        <NumberInput
          id="adjust-worked"
          value={workedMinutes ?? ''}
          min={0}
          disabled={saving}
          placeholder={translate('attendance.dailyPage.currently', { value: formatMinutes(detail.workedMinutes) })}
          onChange={(v) => setWorkedMinutes(typeof v === 'number' ? v : null)}
        />
      </div>

      <div className="form-field">
        <label className="form-label" htmlFor="adjust-fraction">
          {translate('attendance.dailyPage.metric.fraction')}
        </label>
        <NumberInput
          id="adjust-fraction"
          value={dayFractionRaw}
          min={0}
          max={1}
          step={0.05}
          disabled={saving}
          error={fractionError}
          placeholder={translate('attendance.dailyPage.currently', { value: formatDayFraction(detail.dayFraction) })}
          onChange={(v) => {
            setDayFractionRaw(v)
            setFractionError(null)
          }}
        />
      </div>

      <div className="form-field">
        <label className="form-label" htmlFor="adjust-note">
          {translate('attendance.dailyPage.whyRequired')}
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
          {translate('common.cancel')}
        </Button>
        <Button onClick={() => void submit()} disabled={saving}>
          {saving ? translate('common.saving') : translate('attendance.dailyPage.adjustForm.save')}
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
      setReasonError(translate('attendance.dailyPage.correction.reasonRequired'))
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
        message: translate('attendance.dailyPage.correction.saved'),
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

      <p className="hint">{translate('attendance.dailyPage.correction.intro')}</p>

      <div className="form-grid">
        <div className="form-field">
          <label className="form-label" htmlFor="correction-first-in">
            {translate('attendance.dailyPage.col.firstIn')}
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
            {translate('attendance.dailyPage.col.lastOut')}
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
            {translate('attendance.dailyPage.correction.exitMinutes')}
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
            {translate('attendance.dailyPage.col.status')}
          </label>
          <Select
            id="correction-status"
            data={STATUS_OPTIONS.map((value) => ({ value, label: statusText(value) }))}
            value={status}
            clearable
            disabled={saving}
            onChange={(v) => setStatus(v ?? null)}
          />
        </div>
      </div>

      <div className="form-field">
        <label className="form-label" htmlFor="correction-reason">
          {translate('attendance.dailyPage.whyRequired')}
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
          {translate('common.cancel')}
        </Button>
        <Button onClick={() => void submit()} disabled={saving}>
          {saving ? translate('common.saving') : translate('attendance.dailyPage.correction.save')}
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

/** The dialog title of each action, read when drawn so it follows the language. */
const actionTitle = (action: ActionKind) => translate(`attendance.dailyPage.action.${action}`)

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
  onEnterMissing,
  onReport,
}: {
  attendanceId: number
  /** Only needed by the manual-override form the drawer can open. */
  employees: EmployeeListItem[]
  branches: Branch[]
  onHiding: () => void
  onChanged: () => Promise<void>
  /** The one-step fix of a missing In or Out (the page opens its dialog). */
  onEnterMissing: (record: AttendanceRecord) => void
  /** "Something is wrong with this day" for somebody who cannot correct it. */
  onReport: (record: AttendanceRecord) => void
}) {
  const { hasPermission } = useAuth()
  const canCorrect = hasPermission(PERMISSIONS.correct)

  // The drawer is anchored to a physical edge and slides in from beyond it, and Mantine's Drawer
  // position vocabulary has no logical equivalent — so this is one of the few places that
  // genuinely has to know which way round the page is. See src/i18n/physical.ts.
  // PORT NOTE: the hand-written DevExtreme slide animation is gone; Mantine's Drawer animates itself.
  const { isRtl } = useLanguage()
  const edge = isRtl ? 'left' : 'right'

  const { t } = useTranslation()
  const [detail, setDetail] = useState<AttendanceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<ActionKind | null>(null)
  /** Today's open day is a shift in progress, not a fault (dayProgress.ts). */
  const progress = detail ? dayProgress(detail, companyToday()) : null

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
            <h2 className="day-drawer-title">{detail?.fullName ?? t('attendance.dailyPage.drawer.title')}</h2>
            <div className="day-drawer-sub">
              {detail && (
                <>
                  <span>{formatDate(detail.workDate)}</span>
                  <StatusBadge status={detail.status} />
                  {detail.isManual && (
                    <span
                      className="badge badge--muted"
                      title={t('attendance.dailyPage.drawer.manualTitle')}
                    >
                      {t('attendance.daily.quick.manual')}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          <ActionIcon
            variant="subtle"
            color="gray"
            title={t('common.close')}
            aria-label={t('common.close')}
            onClick={onHiding}
          >
            <IconX size={18} />
          </ActionIcon>
        </div>

        <PageHelp>{t('attendance.dailyPage.drawer.help')}</PageHelp>

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
            {detail.hasAnomaly && progress && (
              /* TODAY's open day: the person is at work. Said as that, with the correction still
                 one click away for the case it is really for - somebody who left without punching out. */
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="tab-toolbar">
                  <div>
                    <div className="empty-hint-main">
                      <IconClock size={16} className="day-progress-icon" aria-hidden="true" />{' '}
                      {progressText(progress)}
                    </div>
                    <p className="hint" style={{ marginTop: 4 }}>
                      {t('attendance.daily.inProgressCardText')}
                    </p>
                  </div>
                  {canCorrect && (
                    <div className="page-head-actions">
                      <Button
                        variant="default"
                        leftSection={<IconPencil size={16} />}
                        onClick={() => setAction('correction')}
                      >
                        {t('attendance.daily.inProgressFix')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {detail.hasAnomaly && !progress && (
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="tab-toolbar">
                  <div>
                    <div className="empty-hint-main">
                      <IconAlertTriangle
                        size={16}
                        className="anomaly-icon"
                        aria-hidden="true"
                      />{' '}
                      {t('attendance.dailyPage.drawer.anomalyTitle')}
                    </div>
                    <p className="hint" style={{ marginTop: 4 }}>
                      {describeAnomaly(detail)} {t('attendance.dailyPage.drawer.anomalyText')}
                    </p>
                  </div>
                  {canCorrect && (
                    <div className="page-head-actions">
                      {missingSide(detail) && (
                        <Button
                          leftSection={<IconClock size={16} />}
                          title={t('attendance.missingPunch.enterTitle')}
                          onClick={() => onEnterMissing(detail)}
                        >
                          {t(missingSide(detail) === 'in' ? 'attendance.missingPunch.enterIn' : 'attendance.missingPunch.enterOut')}
                        </Button>
                      )}
                      <Button
                        variant={missingSide(detail) ? 'default' : 'filled'}
                        leftSection={<IconPencil size={16} />}
                        onClick={() => setAction('correction')}
                      >
                        {t('attendance.dailyPage.drawer.fixThis')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!canCorrect && (
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="tab-toolbar">
                  <p className="hint" style={{ margin: 0 }}>{t('attendance.dayReport.drawerHint')}</p>
                  <Button variant="default" leftSection={<IconMessageReport size={16} />} onClick={() => onReport(detail)}>
                    {t('attendance.dayReport.reportToHr')}
                  </Button>
                </div>
              </div>
            )}

            <DayTimeline detail={detail} />

            <DayNumbers detail={detail} />

            {canCorrect && (
              <div className="day-actions">
                <p className="day-actions-title">{t('attendance.dailyPage.drawer.changeTitle')}</p>

                {/* Ordered by how far-reaching they are, not alphabetically. Each says what it does
                    rather than naming a database operation. */}
                <Button
                  leftSection={<IconPencil size={16} />}
                  title={t('attendance.dailyPage.drawer.editTitle')}
                  onClick={() => setAction('manual')}
                >
                  {t('attendance.dailyPage.drawer.edit')}
                </Button>

                {/* ONLY on an anomalous day. A correction is the tool for punches that do not add
                    up; offering it on a clean day invites somebody to open an approval workflow
                    when what they actually wanted was to edit the day. */}
                {detail.hasAnomaly && (
                  <Button
                    variant="default"
                    leftSection={<IconBriefcase size={16} />}
                    title={t('attendance.dailyPage.drawer.fixTitle')}
                    onClick={() => setAction('correction')}
                  >
                    {t('attendance.dailyPage.fix')}
                  </Button>
                )}

                <Button
                  variant="default"
                  leftSection={<IconClock size={16} />}
                  title={t('attendance.dailyPage.drawer.approvalTitle')}
                  onClick={() => setAction('approval')}
                >
                  {t('attendance.dailyPage.action.approval')}
                </Button>
                <Button
                  variant="default"
                  leftSection={<IconCheck size={16} />}
                  title={t('attendance.dailyPage.drawer.dispositionTitle')}
                  onClick={() => setAction('disposition')}
                >
                  {t('attendance.dailyPage.drawer.disposition')}
                </Button>
                <Button
                  variant="default"
                  leftSection={<IconSquareX size={16} />}
                  title={t('attendance.dailyPage.drawer.adjustTitle')}
                  onClick={() => setAction('adjust')}
                >
                  {t('attendance.dailyPage.drawer.adjust')}
                </Button>
              </div>
            )}

            {action && (
              <Modal
                opened
                onClose={() => setAction(null)}
                title={actionTitle(action)}
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

type DailyView = 'today' | 'days' | 'punches'

/**
 * ONE EMPLOYEE-DAY AS A CARD (phones): name, date and status first, then the times, small chips only when
 * there is something to say, and the reason in words (a phone shows no hover titles).
 */
function DayCard({
  record,
  shiftLabel,
  today,
  canCorrect,
  onView,
  onMissing,
  onFix,
  onEdit,
  onReport,
}: {
  record: AttendanceRecord
  shiftLabel: string | null
  today: string
  canCorrect: boolean
  onView: () => void
  onMissing: () => void
  onFix: () => void
  onEdit: () => void
  /** For somebody who cannot correct (a branch manager): send the real times to HR. */
  onReport: () => void
}) {
  const progress = dayProgress(record, today)
  const missing = progress ? null : missingSide(record)
  return (
    <div className="day-card">
      <div className="day-card-head">
        <div>
          <div className="day-card-name">{record.fullName}</div>
          <div className="hint" style={{ margin: 0 }}>
            {formatDayLabel(record.workDate)}
            {shiftLabel ? ` · ${shiftLabel}` : ''}
            {record.branchName ? ` · ${record.branchName}` : ''}
          </div>
        </div>
        <StatusBadge status={record.status} />
      </div>
      {(record.firstInUtc || record.lastOutUtc) && (
        <div className="day-card-times">
          {translate('attendance.daily.card.times', {
            in: formatTime(record.firstInUtc),
            out: progress?.kind === 'onShift' ? translate('attendance.daily.onShift') : formatTime(record.lastOutUtc),
            worked: formatMinutes(record.workedMinutes),
          })}
        </div>
      )}
      <div className="day-card-chips">
        {record.lateMinutes > 0 && (
          <span className="badge badge--late">{translate('attendance.daily.card.late', { minutes: formatMinutes(record.lateMinutes) })}</span>
        )}
        {!progress && record.status === 'Present' && !record.isFullDay && record.shortfallMinutes > 0 && (
          <span className="badge badge--late">{translate('attendance.daily.card.short', { minutes: formatMinutes(record.shortfallMinutes) })}</span>
        )}
        {record.overtimeMinutes > 0 && (
          <span className="badge badge--muted">{translate('attendance.daily.card.overtime', { minutes: formatMinutes(record.overtimeMinutes) })}</span>
        )}
        {record.exitActualMinutes > 0 && (
          <span className="badge badge--muted">
            {translate('attendance.daily.card.exit', {
              actual: formatMinutes(record.exitActualMinutes),
              approved: formatMinutes(record.exitApprovedMinutes),
            })}
          </span>
        )}
        {record.isManual && <span className="badge badge--muted">{translate('attendance.daily.quick.manual')}</span>}
      </div>
      {progress ? (
        <p className="hint day-card-reason">
          <IconClock size={14} className="day-progress-icon" aria-hidden="true" /> {progressText(progress)}
        </p>
      ) : record.hasAnomaly ? (
        <p className="hint day-card-reason">
          <IconAlertTriangle size={14} className="anomaly-icon" aria-hidden="true" /> {describeAnomaly(record)}
        </p>
      ) : null}
      {record.hrNote && <p className="hint day-card-reason">{record.hrNote}</p>}
      <div className="day-card-actions">
        <Button variant="default" leftSection={<IconSearch size={14} />} onClick={onView}>
          {translate('attendance.dailyPage.view')}
        </Button>
        {canCorrect && missing && (
          <Button leftSection={<IconClock size={14} />} onClick={onMissing}>
            {translate(missing === 'in' ? 'attendance.missingPunch.enterIn' : 'attendance.missingPunch.enterOut')}
          </Button>
        )}
        {!canCorrect && (
          <Button variant="default" leftSection={<IconMessageReport size={14} />} onClick={onReport}>
            {translate('attendance.dayReport.reportToHr')}
          </Button>
        )}
        {canCorrect && !missing && (
          <Button variant="default" leftSection={<IconPencil size={14} />} onClick={record.hasAnomaly ? onFix : onEdit}>
            {translate(record.hasAnomaly ? 'attendance.dailyPage.fix' : 'attendance.dailyPage.edit')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** Device / Excel / Manual / Pull, in the reader's language (the value itself is data). */
const sourceText = (source: string) => translate(`attendance.source.${source}`, { defaultValue: source })

/** The key of one employee-day, for the roster's shift of that day. */
const dayKey = (employeeId: number, workDate: string) => `${employeeId}|${workDate.slice(0, 10)}`

/** "Morning 08:00–16:00", "Rest day", or null when the roster has no row for the day. */
function shiftLabelOf(row: ShiftAssignment | undefined): string | null {
  if (!row) return null
  if (row.isRestDay || !row.shiftId) return translate('attendance.daily.shiftRest')
  return `${row.shiftName ?? ''} ${(row.startTime ?? '').slice(0, 5)}–${(row.endTime ?? '').slice(0, 5)}`.trim()
}

/** Saves a text as a file the browser downloads. */
function downloadText(fileName: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** A day still being worked, in words: "On shift since 08:04", or "Day in progress" once there are outs too. */
function progressText(progress: DayProgress): string {
  return progress.kind === 'onShift'
    ? translate('attendance.daily.onShiftSince', { time: formatTime(progress.since) })
    : translate('attendance.daily.dayInProgress')
}

/**
 * THE DAY CONTROL — one date, labelled, with the two days anybody actually wants one click away.
 *
 * Quick buttons rather than a second picker: "today" and "yesterday" are the overwhelming majority
 * of what gets chosen here, and each lights up when it IS the selected day, so the control also
 * answers "am I looking at today?" without the reader having to parse a date and compare it to one
 * they hold in their head. That question is the whole reason this control exists.
 */
function DaySelector({
  from,
  to,
  onChange,
  disabled,
}: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const todayValue = today()
  const yesterdayValue = yesterday()

  return (
    <div className="filter-bar">
      <div className="filter-field">
        <label className="filter-field-label" htmlFor="attendance-day">
          {t('attendance.daily.dayOrPeriod')}
        </label>
        {/* A day, or a period of up to 31 days. Never empty: every action beside it names these dates.
            The same day twice is one day. */}
        <DateRangeField
          id="attendance-day"
          w={230}
          from={from}
          to={to}
          defaultFrom={todayValue}
          defaultTo={todayValue}
          disabled={disabled}
          onChange={(nextFrom, nextTo) => {
            if (nextFrom && nextTo) onChange(nextFrom, nextTo)
          }}
        />
      </div>

      <Button
        size="xs"
        variant={from === todayValue && to === todayValue ? 'light' : 'subtle'}
        disabled={disabled}
        onClick={() => onChange(todayValue, todayValue)}
      >
        {t('attendance.daily.today')}
      </Button>
      <Button
        size="xs"
        variant={from === yesterdayValue && to === yesterdayValue ? 'light' : 'subtle'}
        disabled={disabled}
        onClick={() => onChange(yesterdayValue, yesterdayValue)}
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


  const navigate = useNavigate()
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  const [branchId, setBranchId] = useState<number | null>(null)
  /* Which question the page is answering: who is here today, the processor's days, or the machines'
     raw punches. A phone opens on Today (the question a manager on the floor has); a link can ask for a
     view with ?view=. */
  const [view, setView] = useState<DailyView>(() => {
    const asked = searchParams.get('view')
    if (asked === 'today' || asked === 'days' || asked === 'punches') return asked
    return typeof window !== 'undefined' && window.matchMedia?.('(max-width: 560px)').matches ? 'today' : 'days'
  })
  /** Phones get the days as cards (the 15-column grid is four screen-widths wide there). */
  const isCompact = useMediaQuery('(max-width: 560px)', false, { getInitialValueInEffect: false })
  /** Bumped after every reload of the page, so the Today board reads again with it. */
  const [reloadKey, setReloadKey] = useState(0)

  const [rows, setRows] = useState<AttendanceRecord[]>([])
  /** The roster's shift of each listed day (Shift column, export). A failed read leaves the column empty. */
  const [shiftByDay, setShiftByDay] = useState<Map<string, ShiftAssignment>>(() => new Map())
  /** The quick filters above the grid: days answering ANY of them. */
  const [quick, setQuick] = useState<QuickFilter[]>([])

  /**
   * THE DAYS THAT HAVE NO ROW BELOW, AND WHY. Somebody punched on a day the APPROVED roster of the
   * month does not know: no attendance day exists for it, so the day read can never return it and the
   * grid used to show nothing at all - the punches were simply "missing". They are read alongside the
   * days (same range, same filters, same moment) and shown above the grid, where they can be decided.
   * A failure of this read costs the panel its content, never the grid.
   */
  const [unrostered, setUnrostered] = useState<UnrosteredDay[] | null>(null)
  const [unrosteredError, setUnrosteredError] = useState<string | null>(null)

  /** The company's day (Beirut): today's unpaired day is a shift in progress, not a fault. */
  const companyDay = companyToday()
  /** How many days in the current range the machine could not read confidently. These block payroll.
      A day of TODAY that is still being worked is not one of them (see dayProgress.ts). */
  const anomalyCount = rows.filter((row) => isOpenAnomaly(row, companyDay)).length
  const inProgressCount = rows.filter((row) => dayProgress(row, companyDay) !== null).length
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
  /** The last day of the period the build buttons and the Punches view act on; equal to `day` = one day. */
  const [dayTo, setDayTo] = useState(today())
  const isPeriod = dayTo !== day
  /** The day or the period, in words, for the buttons and hints. */
  const dayLabel = isPeriod ? `${formatDayLabel(day)} – ${formatDayLabel(dayTo)}` : formatDayLabel(day)
  /** A period longer than the API accepts (31 days). */
  const periodTooLong = (new Date(`${dayTo}T00:00:00Z`).getTime() - new Date(`${day}T00:00:00Z`).getTime()) / 86400000 + 1 > 31
  function setDays(nextFrom: string, nextTo: string) {
    setDay(nextFrom)
    setDayTo(nextTo)
  }
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
    setDays(workDate.slice(0, 10), workDate.slice(0, 10))
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
  /** The one-step "enter the missing time" of a day with a plain missing In or Out. */
  const [missingRow, setMissingRow] = useState<AttendanceRecord | null>(null)
  /** "Something is wrong with this day", for somebody who cannot correct it (a branch manager). */
  const [reportRow, setReportRow] = useState<AttendanceRecord | null>(null)

  const loadShifts = useCallback((f: string, t2: string, emp: number | null, branch: number | null) => {
    rosterService
      .get(f, t2, emp ?? undefined, branch ?? undefined)
      .then((list) => setShiftByDay(new Map(list.map((r) => [dayKey(r.employeeId, r.workDate), r]))))
      .catch(() => setShiftByDay(new Map()))
  }, [])

  const load = useCallback(async () => {
    loadShifts(from, to, employeeId, branchId)
    const offRoster = attendanceService
      .getUnrosteredDays(from, to, { branchId, employeeId })
      .then((list) => {
        setUnrostered(list)
        setUnrosteredError(null)
      })
      .catch((err) => setUnrosteredError(getErrorMessage(err)))
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
    setReloadKey((key) => key + 1)
    await offRoster
  }, [from, to, employeeId, branchId, loadShifts])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      loadShifts(from, to, null, null)
      // Beside the days, not inside their try: the page opens even if this read fails.
      attendanceService
        .getUnrosteredDays(from, to)
        .then((list) => {
          if (!cancelled) {
            setUnrostered(list)
            setUnrosteredError(null)
          }
        })
        .catch((err) => {
          if (!cancelled) setUnrosteredError(getErrorMessage(err))
        })
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
        message: t('attendance.dailyPage.processed', { count: result.employeeDaysProcessed }),
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
      const result = isPeriod ? await attendanceService.reprocessRange(day, dayTo) : await attendanceService.reprocessDay(day)
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

  /**
   * Mark absentees writes an Absent day for everybody rostered who has no day yet. On a day that is
   * NOT OVER that includes everyone whose shift starts later, so the page asks first and offers the
   * day that is almost always meant: yesterday. A finished day runs at once, as before.
   */
  const [absentAsk, setAbsentAsk] = useState(false)
  const companyYesterday = dayBefore(companyDay)

  function askMarkAbsentees() {
    if (dayTo >= companyDay) setAbsentAsk(true)
    else void runMarkAbsentees(day, dayTo)
  }

  async function runMarkAbsentees(target: string, targetTo: string = target) {
    setRunning(true)
    try {
      const result =
        targetTo !== target
          ? await attendanceService.markAbsenteesRange(target, targetTo)
          : await attendanceService.markAbsentees(target)
      notifications.show({
        message: t('attendance.daily.absenteesDone', {
          count: result.absenteesMarked,
          date: targetTo !== target ? `${formatDayLabel(target)} – ${formatDayLabel(targetTo)}` : formatDayLabel(target),
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
      columnHelper.accessor('fullName', { header: () => t('attendance.dailyPage.col.employee') }),
      // The branch of the DAY (the employee may have moved since).
      columnHelper.accessor((row) => row.branchName ?? '', { id: 'branch', header: () => t('attendance.dailyPage.col.branch'), size: 120 }),
      // The API sends the day as '2026-08-14T00:00:00'; a day has no time, and the grid was printing the whole stamp.
      columnHelper.accessor((row) => formatDate(row.workDate), { id: 'workDate', header: () => t('attendance.dailyPage.col.date'), size: 110 }),
      // What the roster said for the day: the shift the lateness and the short day are measured against.
      columnHelper.accessor((row) => shiftLabelOf(shiftByDay.get(dayKey(row.employeeId, row.workDate))) ?? '—', {
        id: 'shift',
        header: () => t('attendance.dailyPage.col.shift'),
        size: 150,
      }),

      // Times and durations sort on the raw value and match on the rendered one — "08:05" is what
      // the user reads, and the timestamp behind it is not something anyone would type.
      columnHelper.accessor('firstInUtc', {
        header: () => t('attendance.dailyPage.col.firstIn'),
        size: 90,
        enableGlobalFilter: false,
        cell: (info) => formatTime(info.row.original.firstInUtc),
        meta: { filterText: formatTime },
      }),
      columnHelper.accessor('lastOutUtc', {
        header: () => t('attendance.dailyPage.col.lastOut'),
        size: 110,
        enableGlobalFilter: false,
        // A day of today that is still being worked has no last out yet. The words go HERE, beside
        // the first in, because this column is on screen at any width: the status column is the
        // first one a laptop scrolls off, and "on shift" is what today's list is opened for.
        cell: (info) => {
          const record = info.row.original
          const progress = dayProgress(record, companyDay)
          if (!progress) return formatTime(record.lastOutUtc)
          return progress.kind === 'onShift' ? (
            <span className="day-progress" title={progressText(progress)}>
              {t('attendance.daily.onShift')}
            </span>
          ) : (
            <>
              {formatTime(record.lastOutUtc)}
              <div className="day-progress">{progressText(progress)}</div>
            </>
          )
        },
        meta: { filterText: formatTime },
      }),

      columnHelper.accessor('workedMinutes', {
        header: () => t('attendance.dailyPage.col.worked'),
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
          <span title={t('attendance.dailyPage.colTitle.pairs')}>
            {t('attendance.dailyPage.col.pairs')}
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
          <span title={t('attendance.dailyPage.colTitle.fraction')}>
            {t('attendance.dailyPage.col.fraction')}
          </span>
        ),
        size: 150,
        enableGlobalFilter: false,
        cell: (info) => (
          <DayFractionBar value={info.row.original.dayFraction} />
        ),
        // The bar prints the same 2dp figure beside itself; that figure is what the filter takes.
        meta: { filterText: formatDayFraction },
      }),

      columnHelper.accessor('lateMinutes', {
        header: () => (
          <span title={t('attendance.dailyPage.colTitle.late')}>
            {t('attendance.dailyPage.col.late')}
          </span>
        ),
        size: 85,
        enableGlobalFilter: false,
        cell: (info) => formatMinutes(info.row.original.lateMinutes),
        meta: { filterText: formatMinutes },
      }),

      columnHelper.accessor('overtimeMinutes', {
        header: () => (
          <span title={t('attendance.dailyPage.colTitle.overtime')}>
            {t('attendance.dailyPage.col.overtime')}
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
          <span title={t('attendance.dailyPage.colTitle.exit')}>
            {t('attendance.dailyPage.col.exit')}
          </span>
        ),
        size: 150,
        cell: (info) => {
          const row = info.row.original
          return `${formatMinutes(row.exitActualMinutes)} / ${formatMinutes(row.exitApprovedMinutes)}`
        },
      }),

      columnHelper.accessor('status', {
        header: () => t('attendance.dailyPage.col.status'),
        size: 130,
        // A day in progress says so in the Last out column (always on screen); the badge stays as it is.
        cell: (info) => <StatusBadge status={info.row.original.status} />,
        meta: { filterText: statusText, filterOptions: STATUS_OPTIONS.map(statusText) },
      }),

      columnHelper.accessor('source', {
        header: () => (
          <span title={t('attendance.dailyPage.colTitle.source')}>
            {t('attendance.dailyPage.col.source')}
          </span>
        ),
        size: 95,
        cell: (info) => sourceText(info.row.original.source),
        meta: { filterText: (v) => sourceText(String(v)) },
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
        cell: (info) =>
          // Today's open day is a shift in progress: a clock, not a warning. From tomorrow the same
          // record is a missing punch and gets the triangle back.
          dayProgress(info.row.original, companyDay) ? (
            <IconClock
              size={16}
              className="day-progress-icon"
              title={t('attendance.daily.inProgressTitle')}
              aria-label={t('attendance.daily.inProgressTitle')}
            />
          ) : (
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
        header: () => t('attendance.dailyPage.col.actions'),
        size: canCorrect ? 190 : 170,
        cell: (info) => {
          const row = info.row.original

          // The row's own state picks the right tool, because they are NOT interchangeable:
          // an anomaly is a punch problem, which needs an auditable correction somebody
          // approves. Anything else is HR stating what happened, which is an immediate
          // manual override. Offering the wrong one invites the wrong kind of change.
          const anomaly = row.hasAnomaly
          const inProgress = dayProgress(row, companyDay) !== null
          // A plain missing In or Out of a finished day: filled in one step, on the row itself.
          const missing = !inProgress ? missingSide(row) : null

          return (
            <div className="grid-actions">
              {/* Read-only, so anyone who can see the page can see the punches behind a day. */}
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={<IconSearch size={14} />}
                title={t('attendance.dailyPage.viewTitle')}
                onClick={() => setOpenDayId(row.attendanceId)}
              >
                {t('attendance.dailyPage.view')}
              </Button>
              {!canCorrect && (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  leftSection={<IconMessageReport size={14} />}
                  title={t('attendance.dayReport.reportTitle')}
                  onClick={() => setReportRow(row)}
                >
                  {t('attendance.dayReport.report')}
                </Button>
              )}
              {canCorrect && missing && (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  leftSection={<IconClock size={14} />}
                  title={t('attendance.missingPunch.enterTitle')}
                  onClick={() => setMissingRow(row)}
                >
                  {t(missing === 'in' ? 'attendance.missingPunch.enterIn' : 'attendance.missingPunch.enterOut')}
                </Button>
              )}
              {canCorrect && !missing && (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  leftSection={
                    anomaly && !inProgress ? <IconAlertTriangle size={14} /> : <IconPencil size={14} />
                  }
                  title={
                    inProgress
                      ? t('attendance.daily.fixInProgressTitle')
                      : anomaly
                        ? t('attendance.dailyPage.rowFixTitle')
                        : t('attendance.dailyPage.rowEditTitle')
                  }
                  onClick={() =>
                    anomaly ? setCorrectionRow(row) : setManualRow(row)
                  }
                >
                  {t(anomaly ? 'attendance.dailyPage.fix' : 'attendance.dailyPage.edit')}
                </Button>
              )}
            </div>
          )
        },
      }),
    ],
    [canCorrect, companyDay, expandedIds, pairsById, shiftByDay, t],
  )

  const quickCounts = useMemo(() => quickFilterCounts(rows, companyDay), [rows, companyDay])
  const shownRows = useMemo(() => applyQuickFilters(rows, quick, companyDay), [rows, quick, companyDay])

  function toggleQuick(filter: QuickFilter) {
    setQuick((current) => (current.includes(filter) ? current.filter((f) => f !== filter) : [...current, filter]))
  }

  /** Every row that passes the filters on screen (all pages, in the grid's order), as a CSV for Excel. */
  function exportShown() {
    const header = [
      ...(['employee', 'branch', 'date', 'shift', 'firstIn', 'lastOut', 'workedMin', 'workedHm', 'fraction', 'lateMin',
        'shortMin', 'overtimeMin', 'exitActualMin', 'exitApprovedMin', 'status', 'source', 'manual', 'problem', 'hrNote'] as const)
        .map((key) => t(`attendance.dailyPage.csv.${key}`)),
    ]
    const data = table.getPrePaginationRowModel().rows.map(({ original: r }) => [
      r.fullName,
      r.branchName ?? '',
      r.workDate.slice(0, 10),
      shiftLabelOf(shiftByDay.get(dayKey(r.employeeId, r.workDate))) ?? '',
      r.firstInUtc ? formatTime(r.firstInUtc) : '',
      r.lastOutUtc ? formatTime(r.lastOutUtc) : '',
      r.workedMinutes,
      hhmmOf(r.workedMinutes),
      r.dayFraction,
      r.lateMinutes,
      r.shortfallMinutes,
      r.overtimeMinutes,
      r.exitActualMinutes,
      r.exitApprovedMinutes,
      statusText(r.status),
      sourceText(r.source),
      r.isManual ? t('common.yes') : '',
      dayProgress(r, companyDay) ? progressText(dayProgress(r, companyDay) as DayProgress) : r.hasAnomaly ? describeAnomaly(r) : '',
      r.hrNote ?? '',
    ])
    downloadText(`attendance_${from}_${to}.csv`, toCsv(header, data), 'text/csv;charset=utf-8')
  }

  /** A period shortcut: the range changes AND the days are read at once (no Apply needed). */
  const [pendingApply, setPendingApply] = useState(false)
  function applyShortcut(kind: 'today' | 'yesterday' | 'week' | 'month') {
    const range = periodShortcut(kind, companyDay)
    setRange(range)
    setPendingApply(true)
  }
  useEffect(() => {
    if (!pendingApply) return
    setPendingApply(false)
    setLoading(true)
    void load()
  }, [pendingApply, load])

  const table = useReactTable({
    data: shownRows,
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
          <h1 className="page-title">{t('attendance.dailyPage.title')}</h1>
          <p className="page-subtitle">{t('attendance.dailyPage.subtitle')}</p>
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
          {/* ATTENDANCE_CORRECT, NOT ATTENDANCE_MANAGE. This button, the drawer's "Edit day" and a
              row's "Edit" all post to the same endpoint — POST /api/attendance/manual — and the
              API gates that on ATTENDANCE_CORRECT, because a manual day is a pay-bearing statement
              of what happened whether or not the processor produced one first. It used to sit on
              ATTENDANCE_MANAGE here, which showed a roster manager a button that 403'd on save.
              Hidden rather than disabled: a button somebody can never use is noise. */}
          {canCorrect && (
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => setManualNewVisible(true)}
            >
              {t('attendance.dailyPage.addManual')}
            </Button>
          )}
        </div>
      </div>

      <PageHelp>{t('attendance.dailyPage.help')}</PageHelp>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {canManage && (
        <div className="card">
          <div className="card-title">{t('attendance.dailyPage.buildTitle')}</div>

          {/* The day first, the actions under it: two of the three buttons below NAME this date,
              so it has to be settled before either is a sensible thing to press. */}
          <DaySelector from={day} to={dayTo} onChange={setDays} disabled={running} />
          {periodTooLong && (
            <div className="alert alert--error" role="alert">
              {t('attendance.daily.periodTooLong')}
            </div>
          )}

          <div className="filter-bar">
            <Button
              leftSection={<IconRefresh size={16} />}
              disabled={running}
              onClick={() => void runProcessor()}
            >
              {t('attendance.dailyPage.runProcessor')}
            </Button>

            {/* Beside the processor because they look similar and are not: that one consumes what
                it has not seen, this one rebuilds a day it HAS seen, under whatever the punch
                direction and debounce settings say now. Default rather than filled — re-deriving
                a day is the rarer, more deliberate act of the two. */}
            <Button
              variant="default"
              disabled={running || periodTooLong}
              title={t('attendance.daily.reprocessTitle', { date: dayLabel })}
              onClick={() => void runReprocessDay()}
            >
              {t('attendance.daily.reprocess', { date: dayLabel })}
            </Button>

            <Button
              variant="default"
              disabled={running || periodTooLong}
              title={t('attendance.daily.absenteesTitle', { date: dayLabel })}
              onClick={askMarkAbsentees}
            >
              {t('attendance.daily.absentees', { date: dayLabel })}
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
            defaultFrom={initialRange.from}
            defaultTo={initialRange.to}
            // ONE write for the pair. The field only ever hands over a complete range (its half-picked state is its own).
            onChange={(nextFrom, nextTo) => {
              if (nextFrom && nextTo) setRange({ from: nextFrom, to: nextTo })
            }}
          />
          {/* The four ranges people actually want, applied at once (no Apply needed). The one that IS
              the current range is lit, so "am I looking at today?" is answered without reading dates. */}
          <div className="period-shortcuts">
            {(['today', 'yesterday', 'week', 'month'] as const).map((kind) => {
              const range = periodShortcut(kind, companyDay)
              const on = range.from === from && range.to === to
              return (
                <Button
                  key={kind}
                  size="compact-xs"
                  variant={on ? 'light' : 'subtle'}
                  aria-pressed={on}
                  onClick={() => applyShortcut(kind)}
                >
                  {t(`attendance.daily.shortcut.${kind}`)}
                </Button>
              )
            })}
          </div>
        </div>

        <div className="filter-field">
          <label className="filter-field-label" htmlFor="filter-employee">
            {t('attendance.dailyPage.col.employee')}
          </label>
          <Select
            id="filter-employee"
            data={employees.map((item) => ({
              value: String(item.employeeId),
              label: item.fullName,
            }))}
            value={employeeId != null ? String(employeeId) : null}
            placeholder={t('attendance.dailyPage.everyone')}
            w={220}
            searchable
            clearable
            onChange={(v) => setEmployeeId(v != null ? Number(v) : null)}
          />
        </div>

        <div className="filter-field">
          <label className="filter-field-label" htmlFor="filter-branch">
            {t('attendance.dailyPage.col.branch')}
          </label>
          <Select
            id="filter-branch"
            data={branches
              .filter((b) => b.isActive)
              .map((b) => ({ value: String(b.branchId), label: b.name }))}
            value={branchId != null ? String(branchId) : null}
            placeholder={t('attendance.dailyPage.allBranches')}
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
            {t('attendance.dailyPage.apply')}
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
                {t('attendance.dailyPage.anomalyBand', { count: anomalyCount })}
              </div>
              <p className="hint" style={{ marginTop: 4 }}>
                {t('attendance.dailyPage.anomalyBandText', { count: anomalyCount })}
              </p>
            </div>
            <div className="page-head-actions">
              <Button
                component={Link}
                variant="default"
                to={`/attendance/anomalies?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`}
              >
                {t('attendance.dailyPage.fixAnomalies')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* NOT ON ROSTER. Above the Days / Punches switch, in both views: a day that is waiting for a
          decision must not disappear because the reader went to look at the punches. */}
      <NotOnRosterPanel days={unrostered} error={unrosteredError} onChanged={load} />

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
          onChange={(value) => setView(value as DailyView)}
          data={[
            { value: 'today', label: t('attendance.daily.viewToday') },
            { value: 'days', label: t('attendance.dailyPage.viewDays') },
            { value: 'punches', label: t('attendance.dailyPage.viewPunches') },
          ]}
        />
        {view === 'punches' && (
          <span className="hint">
            {t('attendance.daily.punchesHint', { date: dayLabel })}
          </span>
        )}
        {view === 'days' && inProgressCount > 0 && (
          <span className="hint">
            <IconClock size={14} className="day-progress-icon" aria-hidden="true" />{' '}
            {t('attendance.daily.inProgressCount', { count: inProgressCount })}
          </span>
        )}
      </div>

      {/* Managers set the day in the card above. Everybody else can still READ the punches, so
          without the card they would have no way to move off today — the control comes with them
          rather than being duplicated for the people who already have one. */}
      {view === 'punches' && !canManage && (
        <div className="card">
          <DaySelector from={day} to={dayTo} onChange={setDays} />
        </div>
      )}

      {view === 'today' ? (
        <TodayBoard branchId={branchId} reloadKey={reloadKey} onOpenDay={setOpenDayId} />
      ) : view === 'punches' ? (
        <PunchesGrid
          date={day}
          to={periodTooLong ? day : dayTo}
          branchId={branchId}
          onGoToToday={day === today() && !isPeriod ? undefined : () => setDays(today(), today())}
        />
      ) : loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">
              {t('attendance.dailyPage.noDays', { from: formatDayLabel(from), to: formatDayLabel(to) })}
            </div>
            {/* With days listed above as "not on roster", "run the processor" would be the wrong
                advice: those punches WERE processed, and are waiting for a decision, not for a run. */}
            {(unrostered ?? []).some((day) => day.state === 'Open')
              ? t('attendance.unrostered.emptyDaysHint')
              : t('attendance.dailyPage.noDaysHint')}
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          {/* PORT NOTE: the DevExtreme FilterRow + HeaderFilter are approximated by one global
              search box; only the columns the original allowed filtering on take part in it. */}
          <Group justify="space-between" p="xs" gap="xs" wrap="wrap">
            {/* QUICK FILTERS, each with its count for the loaded period. A day shows when it answers ANY
                chosen chip; chips with nothing to show are left out unless chosen. */}
            <div className="quick-filters" role="group" aria-label={t('attendance.daily.quick.label')}>
              {QUICK_FILTERS.filter((f) => quickCounts[f] > 0 || quick.includes(f)).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={quick.includes(f) ? 'quick-chip quick-chip--on' : 'quick-chip'}
                  aria-pressed={quick.includes(f)}
                  title={t(`attendance.daily.quick.${f}Title`)}
                  onClick={() => toggleQuick(f)}
                >
                  {t(`attendance.daily.quick.${f}`)} <span className="quick-chip-count">{quickCounts[f]}</span>
                </button>
              ))}
              {quick.length > 0 && (
                <Button variant="subtle" size="compact-xs" onClick={() => setQuick([])}>
                  {t('attendance.daily.quick.clear')}
                </Button>
              )}
            </div>
            <Group gap="xs">
              <Button
                variant="default"
                size="xs"
                leftSection={<IconDownload size={14} />}
                title={t('attendance.daily.exportTitle')}
                disabled={total === 0}
                onClick={exportShown}
              >
                {t('attendance.daily.export')}
              </Button>
              <TextInput
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.currentTarget.value)}
                placeholder={t('common.search')}
                leftSection={<IconSearch size={14} />}
                w={200}
                size="xs"
              />
            </Group>
          </Group>

          {isCompact ? (
            <div className="day-cards">
              {table.getRowModel().rows.length === 0 ? (
                <div className="empty-hint">{t('attendance.dailyPage.noMatch')}</div>
              ) : (
                table.getRowModel().rows.map(({ original: record }) => (
                  <DayCard
                    key={record.attendanceId}
                    record={record}
                    shiftLabel={shiftLabelOf(shiftByDay.get(dayKey(record.employeeId, record.workDate)))}
                    today={companyDay}
                    canCorrect={canCorrect}
                    onView={() => setOpenDayId(record.attendanceId)}
                    onMissing={() => setMissingRow(record)}
                    onFix={() => setCorrectionRow(record)}
                    onEdit={() => setManualRow(record)}
                    onReport={() => setReportRow(record)}
                  />
                ))
              )}
            </div>
          ) : (
          <div className="table-scroll">
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
                        {t('attendance.dailyPage.noMatch')}
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
          </div>
          )}

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
      )}

      {/* MARK ABSENTEES ON A DAY THAT IS NOT OVER — asked, never silent. Yesterday is the filled
          button because it is the day this is almost always run for. */}
      {absentAsk && (
        <Modal
          opened
          onClose={() => setAbsentAsk(false)}
          title={t('attendance.daily.absenteesEarlyTitle', { date: dayLabel })}
          size={520}
          centered
        >
          <p className="hint" style={{ marginTop: 0 }}>
            {t('attendance.daily.absenteesEarlyText', { date: dayLabel })}
          </p>
          <div className="form-actions">
            <Button variant="default" onClick={() => setAbsentAsk(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="default"
              onClick={() => {
                setAbsentAsk(false)
                void runMarkAbsentees(day, dayTo)
              }}
            >
              {t('attendance.daily.absenteesEarlyAnyway', { date: dayLabel })}
            </Button>
            <Button
              onClick={() => {
                // The finished part of the period: from its start (or yesterday) up to yesterday.
                const upFrom = day <= companyYesterday ? day : companyYesterday
                setAbsentAsk(false)
                setDays(upFrom, companyYesterday)
                void runMarkAbsentees(upFrom, companyYesterday)
              }}
            >
              {t('attendance.daily.absentees', {
                date:
                  day < companyYesterday
                    ? `${formatDayLabel(day)} – ${formatDayLabel(companyYesterday)}`
                    : formatDayLabel(companyYesterday),
              })}
            </Button>
          </div>
        </Modal>
      )}

      {openDayId !== null && (
        <DayDetailPopup
          attendanceId={openDayId}
          employees={employees}
          branches={branches}
          onHiding={() => setOpenDayId(null)}
          onChanged={load}
          onEnterMissing={(record) => {
            setOpenDayId(null)
            setMissingRow(record)
          }}
          onReport={(record) => {
            setOpenDayId(null)
            setReportRow(record)
          }}
        />
      )}

      {reportRow !== null && (
        <ReportDayDialog
          employeeId={reportRow.employeeId}
          employeeName={reportRow.fullName}
          workDate={reportRow.workDate}
          currentIn={reportRow.firstInUtc}
          currentOut={reportRow.lastOutUtc}
          onClose={() => setReportRow(null)}
          onSent={() => undefined}
        />
      )}

      {missingRow !== null && (
        <MissingPunchDialog
          record={missingRow}
          onClose={() => setMissingRow(null)}
          onSaved={load}
          onUseCorrection={() => {
            setCorrectionRow(missingRow)
            setMissingRow(null)
          }}
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
              ? t('attendance.dailyPage.overrideTitle', { name: manualRow.fullName, date: formatDate(manualRow.workDate) })
              : t('attendance.dailyPage.addManual')
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
          title={t('attendance.dailyPage.fixTitle', { name: correctionRow.fullName, date: formatDate(correctionRow.workDate) })}
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
