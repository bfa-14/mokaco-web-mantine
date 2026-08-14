import { useEffect, useState } from 'react'
import { NumberInput, Textarea } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { overtimeService } from '../../services/workflowService'
import { rosterService } from '../../services/attendanceService'
import type { ShiftAssignment } from '../../types/attendance'
import type { RequestFormBody } from './newRequestShared'
import { t } from '../../i18n/t'

/** Today as yyyy-MM-dd, in LOCAL time — the earliest date overtime may be requested for. */
function todayYMD(): string {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

/** 90 → "1h 30m", 60 → "1h", 45 → "45m" — the human reading of the minutes figure. */
function minutesText(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return t('common.minutesOnly', { minutes: m })
  return t('common.hoursMinutes', { hours: h, minutes: m })
}

/** The procedure's own ceiling. Named so the form and its refusal message cannot drift. */
const MAX_MINUTES = 720

/**
 * The OVERTIME form body — pre-approved extra minutes for one day, at 150%.
 * The date input's `min` is a courtesy; the procedure's refusal of past dates is the rule. The
 * approval is a CAP; attendance supplies the actual and payroll pays the lesser. The roster hint
 * keeps the tagged-fetch pattern: keyed by person-and-date, stale hints vanish by derivation.
 */
export function useOvertimeForm(
  employeeId: number | null,
  employeeName: string | null,
  saving: boolean,
): RequestFormBody {
  const [workDate, setWorkDate] = useState<string | null>(null) // yyyy-MM-dd
  const [minutes, setMinutes] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [fetched, setFetched] = useState<{ key: string; row: ShiftAssignment | null } | null>(null)

  const dateYMD = workDate

  /* the day's roster, tagged with who-and-when it was read for */
  useEffect(() => {
    if (!employeeId || !dateYMD) return
    const key = `${employeeId}|${dateYMD}`
    let cancelled = false
    rosterService
      .forEmployee(employeeId, dateYMD, dateYMD)
      .then((rows) => {
        if (!cancelled) setFetched({ key, row: rows[0] ?? null })
      })
      .catch(() => {
        /* no roster read: the hint simply does not show */
      })
    return () => {
      cancelled = true
    }
  }, [employeeId, dateYMD])

  const assignment =
    employeeId && dateYMD && fetched?.key === `${employeeId}|${dateYMD}` ? fetched.row : null

  /* the roster hint, in words */
  const rosterHint = !dateYMD
    ? null
    : assignment == null
      ? null // nothing rostered / roster unreadable: say nothing rather than guess
      : assignment.isRestDay || !assignment.shiftId
        ? t('body.overtime.restDay')
        : t('body.overtime.rostered', {
            shift: assignment.shiftName,
            from: assignment.startTime?.slice(0, 5),
            to: assignment.endTime?.slice(0, 5),
          })

  // Mirrors usp_Overtime_Create's CONCAT exactly; null until everything it needs is present.
  const autoTitle =
    dateYMD && minutes != null && minutes > 0 && employeeName
      ? `Overtime ${dateYMD} - ${employeeName} (${minutes} min)`
      : null

  const missing = !workDate
    ? t('body.overtime.missingDate')
    : minutes == null || minutes <= 0
      ? t('body.overtime.missingMinutes')
      : minutes > MAX_MINUTES
        ? t('body.overtime.missingCap', { max: MAX_MINUTES })
        : null

  const node = (
    <>
      <div className="form-grid">
        <div className="form-field">
          {/* Required, so not clearable. The native input's `min` becomes `minDate`, which takes
              the same 'YYYY-MM-DD' string — overtime cannot be asked for retrospectively. */}
          <DatePickerInput
            label={t('common.date')}
            valueFormat="DD/MM/YYYY"
            leftSection={<IconCalendar size={14} />}
            minDate={todayYMD()}
            value={workDate}
            disabled={saving}
            onChange={(v) => setWorkDate(v || null)}
          />
          {rosterHint && <div className="hint">{rosterHint}</div>}
        </div>

        <div className="form-field">
          <NumberInput
            label={t('body.overtime.minutes')}
            value={minutes ?? ''}
            min={1}
            max={MAX_MINUTES}
            step={15}
            placeholder={t('body.overtime.minutesPlaceholder')}
            disabled={saving}
            onChange={(v) => setMinutes(typeof v === 'number' ? v : null)}
          />
          {minutes != null && minutes > 0 && (
            <div className="hint">
              {t('body.overtime.rateNote', { duration: minutesText(minutes) })}
            </div>
          )}
        </div>
      </div>

      <div className="form-field">
        <Textarea
          label={
            <>
              {t('common.reason')} <span className="form-optional">{t('common.optional')}</span>
            </>
          }
          value={reason}
          minRows={2}
          disabled={saving}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
      </div>
    </>
  )

  return {
    node,
    autoTitle,
    missing,
    async submit(empId, title) {
      if (empId == null || !dateYMD || minutes == null)
        throw new Error(t('common.formIncomplete'))
      const created = await overtimeService.create({
        employeeId: empId,
        workDate: dateYMD,
        requestedMinutes: minutes,
        reason: reason.trim() || null,
        title: title ?? undefined,
      })
      return {
        requestId: created.requestInstanceId,
        notice: created.isRestDayOrUnrostered ? t('body.overtime.noticeUnrostered') : null,
      }
    },
  }
}
