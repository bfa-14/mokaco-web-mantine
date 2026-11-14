import { useState } from 'react'
import { Button, NumberInput, Select, Textarea } from '@mantine/core'
import { DatePickerInput, DateTimePicker } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import {
  dateTimeToPicker,
  secondsDateTimeFromPicker,
} from '../../components/date/pickerValue'
import { attendanceService } from '../../services/attendanceService'
import { getErrorMessage } from '../../api/errorMessage'
import type { AttendanceRecord } from '../../types/attendance'
import type { Branch, EmployeeListItem } from '../../types/hr'
import { branchOptions } from '../../hr/assignableOptions'
import { formatDate, formatDayFraction, formatMinutes, statusText } from './attendanceFormat'
import { t as translate } from '../../i18n/t'

/** Present / Absent / Leave / RestDay — the four states a day can be told to be. */
const STATUS_VALUES = ['Present', 'Absent', 'Leave', 'RestDay']
/** Read when drawn, so the words follow the language. */
const statusOptions = () => STATUS_VALUES.map((value) => ({ value, label: statusText(value) }))

interface FormState {
  employeeId: number | null
  workDate: string | null
  firstInUtc: string | null
  lastOutUtc: string | null
  exitMinutes: number
  exitApprovedMins: number
  status: string | null
  branchId: number | null
  hrNote: string
}

const EMPTY_FORM: FormState = {
  employeeId: null,
  workDate: null,
  firstInUtc: null,
  lastOutUtc: null,
  exitMinutes: 0,
  exitApprovedMins: 0,
  status: null,
  branchId: null,
  hrNote: '',
}

/* The two native-datetime-local adapters that used to live here are now the shared
   dateTimeToPicker / secondsDateTimeFromPicker in components/date/pickerValue.ts — the same
   'yyyy-MM-ddTHH:mm:ss' contract, kept in one place because three attendance forms hold it. */

/** What the upsert computed, shown back so HR sees the EFFECT rather than trusting the save. */
function ComputedResult({ record }: { record: AttendanceRecord }) {
  return (
    <div className="card" style={{ marginTop: 14, borderInlineStart: '4px solid #2e7d4f' }}>
      <div className="empty-hint-main">{translate('attendance.manualEntry.savedTitle')}</div>
      <div className="result-row" style={{ marginTop: 10, marginBottom: 0 }}>
        <div className="result-tile">
          <div className="result-tile-value">
            {formatMinutes(record.workedMinutes)}
          </div>
          <div className="result-tile-label">{translate('attendance.dailyPage.metric.worked')}</div>
        </div>
        <div className="result-tile">
          <div className="result-tile-value">{formatDayFraction(record.dayFraction)}</div>
          <div className="result-tile-label">{translate('attendance.manualEntry.ofDay')}</div>
        </div>
        <div className="result-tile">
          <div className="result-tile-value">
            {formatMinutes(record.lateMinutes)}
          </div>
          <div className="result-tile-label">{translate('attendance.dailyPage.metric.late')}</div>
        </div>
      </div>
      <p className="hint" style={{ marginBottom: 0, marginTop: 10 }}>
        {translate('attendance.manualEntry.measured', { name: record.fullName })}
      </p>
    </div>
  )
}

/**
 * HR entering or overriding a day BY HAND — the machine was down, or somebody never punched.
 *
 * This is NOT a correction, and the difference matters:
 *   - a MANUAL OVERRIDE (this form) takes effect IMMEDIATELY and marks the day IsManual, which
 *     permanently locks the processor out of it. Use it when HR is authoritatively stating what
 *     happened.
 *   - a CORRECTION is a logged REQUEST that changes nothing until somebody approves it, and keeps
 *     an old→new trail. Use it for a genuine punch problem.
 * Merging them would hide the fact that one needs approval and the other does not.
 *
 * Used from two places against the same endpoint: the Daily toolbar (a brand-new day) and the day
 * drawer (overriding the day already open). `existing` is what tells them apart.
 */
export function ManualEntryForm({
  employees,
  branches,
  existing,
  conflictsWith,
  onSaved,
  onCancel,
}: {
  employees: EmployeeListItem[]
  branches: Branch[]
  /** The day being overridden, or null when adding a fresh one. */
  existing: AttendanceRecord | null
  /**
   * Looks for a machine-read record already on this employee-day. Used to WARN — never to block:
   * replacing a punch-based day is a legitimate thing to do, it just should not be a surprise.
   */
  conflictsWith: (employeeId: number, workDate: string) => AttendanceRecord | undefined
  onSaved: () => Promise<void>
  onCancel: () => void
}) {
  /**
   * Seeded once, from the day being overridden.
   *
   * No effect is needed to keep this in step: the modal that hosts this form is MOUNTED
   * conditionally, so the form is created fresh every time it opens and `existing` never changes
   * underneath it. Syncing it in an effect would be re-deriving state that cannot drift.
   *
   * The note starts BLANK even when overriding: the last reason somebody gave is not a reason for
   * this change, and pre-filling it invites a rubber-stamped audit trail.
   */
  const [form, setForm] = useState<FormState>(() =>
    existing
      ? {
          employeeId: existing.employeeId,
          workDate: existing.workDate.slice(0, 10),
          firstInUtc: existing.firstInUtc,
          lastOutUtc: existing.lastOutUtc,
          exitMinutes: existing.exitActualMinutes,
          exitApprovedMins: existing.exitApprovedMinutes,
          status: existing.status,
          branchId: existing.branchId,
          hrNote: '',
        }
      : EMPTY_FORM,
  )
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<AttendanceRecord | null>(null)

  /* PORT NOTE: DevExtreme ValidationGroup/RequiredRule → the same three required checks, message
     for message, run in submit() and shown as field-level errors. */
  const [fieldErrors, setFieldErrors] = useState<{
    employeeId?: string
    workDate?: string
    hrNote?: string
  }>({})

  // The record this entry would replace, if any. A day HR already entered is not a conflict —
  // overwriting your own manual entry is just editing it.
  const conflict =
    form.employeeId != null && form.workDate
      ? conflictsWith(form.employeeId, form.workDate)
      : undefined
  const replacesPunches = conflict != null && !conflict.isManual

  async function submit() {
    const errors: { employeeId?: string; workDate?: string; hrNote?: string } = {}
    if (form.employeeId == null) errors.employeeId = translate('attendance.manualEntry.chooseEmployee')
    if (!form.workDate) errors.workDate = translate('attendance.manualEntry.chooseDate')
    if (!form.hrNote.trim()) {
      errors.hrNote = 'A reason is required — this sets what somebody is paid.'
    }
    setFieldErrors(errors)
    if (errors.employeeId || errors.workDate || errors.hrNote) return

    if (form.employeeId == null || !form.workDate) return

    setSaving(true)
    try {
      const saved = await attendanceService.manual({
        employeeId: form.employeeId,
        workDate: form.workDate,
        firstInUtc: form.firstInUtc,
        lastOutUtc: form.lastOutUtc,
        exitMinutes: form.exitMinutes,
        exitApprovedMins: form.exitApprovedMins,
        status: form.status,
        branchId: form.branchId,
        hrNote: form.hrNote.trim() || null,
      })

      // Show the EFFECT rather than a bare "saved" — the whole reason the endpoint returns the
      // recomputed day is so HR can see what their entry actually did to it.
      setResult(saved)
      notifications.show({
        message: translate('attendance.manualEntry.saved'),
        color: 'green',
        autoClose: 3000,
      })
      await onSaved()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        {translate('attendance.manualEntry.intro')}
      </p>

      {/* WARN, never block. Replacing a punch-based day is legitimate — HR may know something the
          machine does not — but it must not happen by accident. */}
      {replacesPunches && (
        <div className="card" style={{ marginBottom: 14, borderInlineStart: '4px solid #c9821f' }}>
          <div className="empty-hint-main">
            {translate('attendance.manualEntry.replaceTitle')}
          </div>
          <p className="hint" style={{ marginBottom: 0, marginTop: 4 }}>
            {translate('attendance.manualEntry.replaceText', {
              name: conflict?.fullName ?? '',
              source: conflict?.source ?? '',
              date: formatDate(conflict?.workDate ?? ''),
              worked: formatMinutes(conflict?.workedMinutes ?? 0),
            })}
          </p>
        </div>
      )}

      <div className="form-grid">
        <div className="form-field">
          <label className="form-label" htmlFor="manual-employee">
            {translate('attendance.dailyPage.col.employee')}
          </label>
          <Select
            id="manual-employee"
            data={employees.map((item) => ({
              value: String(item.employeeId),
              label: `${item.fullName} — ${item.branch}`,
            }))}
            value={form.employeeId != null ? String(form.employeeId) : null}
            onChange={(v) => {
              setForm((f) => ({ ...f, employeeId: v != null ? Number(v) : null }))
              setFieldErrors((fe) => ({ ...fe, employeeId: undefined }))
            }}
            placeholder={translate('attendance.manualEntry.whose')}
            searchable
            nothingFoundMessage={translate('attendance.manualEntry.noEmployee')}
            error={fieldErrors.employeeId}
            // Changing WHO a day belongs to would silently create a second day rather than edit
            // this one, so the person is fixed once the record exists.
            disabled={saving || existing !== null}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="manual-date">
            {translate('attendance.manualEntry.workDate')}
          </label>
          {/* Required ("Choose the date"), so not clearable. State stays 'yyyy-MM-dd'. */}
          <DatePickerInput
            id="manual-date"
            valueFormat="DD/MM/YYYY"
            leftSection={<IconCalendar size={14} />}
            value={form.workDate}
            onChange={(v) => {
              setForm((f) => ({ ...f, workDate: v || null }))
              setFieldErrors((fe) => ({ ...fe, workDate: undefined }))
            }}
            error={fieldErrors.workDate}
            disabled={saving || existing !== null}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="manual-first-in">
            {translate('attendance.dailyPage.col.firstIn')}
          </label>
          {/* Both punch times are OPTIONAL — "leave blank if unknown" is a real answer here — so
              both are clearable, and clearing puts back the null the API expects. The state keeps
              its 'yyyy-MM-ddTHH:mm:ss' shape; the ':00' the old input re-appended is now
              secondsDateTimeFromPicker's job. */}
          <DateTimePicker
            id="manual-first-in"
            valueFormat="DD/MM/YYYY HH:mm"
            leftSection={<IconCalendar size={14} />}
            clearable
            value={dateTimeToPicker(form.firstInUtc)}
            onChange={(v) => {
              const value = secondsDateTimeFromPicker(v)
              setForm((f) => ({ ...f, firstInUtc: value }))
            }}
            placeholder={translate('attendance.manualEntry.blankIfUnknown')}
            disabled={saving}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="manual-last-out">
            {translate('attendance.dailyPage.col.lastOut')}
          </label>
          <DateTimePicker
            id="manual-last-out"
            valueFormat="DD/MM/YYYY HH:mm"
            leftSection={<IconCalendar size={14} />}
            clearable
            value={dateTimeToPicker(form.lastOutUtc)}
            onChange={(v) => {
              const value = secondsDateTimeFromPicker(v)
              setForm((f) => ({ ...f, lastOutUtc: value }))
            }}
            placeholder={translate('attendance.manualEntry.blankIfUnknown')}
            disabled={saving}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="manual-exit">
            {translate('attendance.manualEntry.away')}
          </label>
          <NumberInput
            id="manual-exit"
            value={form.exitMinutes}
            onChange={(v) =>
              setForm((f) => ({ ...f, exitMinutes: typeof v === 'number' ? v : 0 }))
            }
            min={0}
            disabled={saving}
          />
          <div className="hint">{translate('attendance.manualEntry.awayHint')}</div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="manual-exit-approved">
            {translate('attendance.manualEntry.approved')}
          </label>
          <NumberInput
            id="manual-exit-approved"
            value={form.exitApprovedMins}
            onChange={(v) =>
              setForm((f) => ({ ...f, exitApprovedMins: typeof v === 'number' ? v : 0 }))
            }
            min={0}
            disabled={saving}
          />
          <div className="hint">
            {translate('attendance.manualEntry.approvedHint')}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="manual-status">
            {translate('attendance.dailyPage.col.status')}
          </label>
          <Select
            id="manual-status"
            data={statusOptions()}
            value={form.status}
            onChange={(v) => setForm((f) => ({ ...f, status: v ?? null }))}
            placeholder={translate('attendance.manualEntry.statusPlaceholder')}
            clearable
            disabled={saving}
          />
          <div className="hint">
            {translate('attendance.manualEntry.statusHint')}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="manual-branch">
            {translate('attendance.dailyPage.col.branch')}
          </label>
          <Select
            id="manual-branch"
            /* Stamps the branch onto the day, so it assigns rather than filters — active only,
               keeping whatever an already-stamped day carries. */
            data={branchOptions(branches, form.branchId)}
            value={form.branchId != null ? String(form.branchId) : null}
            onChange={(v) =>
              setForm((f) => ({ ...f, branchId: v != null ? Number(v) : null }))
            }
            placeholder={translate('attendance.manualEntry.homeBranch')}
            clearable
            disabled={saving}
          />
          <div className="hint">{translate('attendance.manualEntry.branchHint')}</div>
        </div>

        <div className="form-field full">
          <label className="form-label" htmlFor="manual-note">
            {translate('attendance.manualEntry.why')}
          </label>
          <Textarea
            id="manual-note"
            value={form.hrNote}
            onChange={(e) => {
              const value = e.currentTarget.value
              setForm((f) => ({ ...f, hrNote: value }))
              setFieldErrors((fe) => ({ ...fe, hrNote: undefined }))
            }}
            minRows={3}
            error={fieldErrors.hrNote}
            disabled={saving}
          />
          <div className="hint">
            {translate('attendance.manualEntry.whyHint')}
          </div>
        </div>
      </div>

      {result && <ComputedResult record={result} />}

      <div className="form-actions">
        <Button variant="default" onClick={onCancel} disabled={saving}>
          {translate(result ? 'common.close' : 'common.cancel')}
        </Button>
        {!result && (
          <Button onClick={() => void submit()} disabled={saving}>
            {saving
              ? translate('common.saving')
              : translate(existing ? 'attendance.manualEntry.override' : 'attendance.manualEntry.save')}
          </Button>
        )}
      </div>
    </div>
  )
}
