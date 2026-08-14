import { useCallback, useEffect, useMemo, useState } from 'react'
import { Select, Switch, Textarea } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { availabilityService } from '../../services/workflowService'
import { rosterService, shiftsService } from '../../services/attendanceService'
import type { Shift } from '../../types/attendance'
import type { RequestFormBody } from './newRequestShared'
import { t } from '../../i18n/t'

const NO_SHIFTS: Shift[] = []

/**
 * ISO days, matching EMPLOYEE_SHIFT_PATTERN: 1 = Monday … 7 = Sunday.
 * NUMBERS ONLY — the name is looked up at render through common.weekday. (Unchanged.)
 */
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const

/** The day's name in the current language. */
const dayName = (day: number) => t(`common.weekday.${day}`)

interface DayState {
  isAvailable: boolean
  shiftId: number | null
}

function todayYMD(): string {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

/**
 * The AVAILABILITY CHANGE form body — a standing change to the weekly template.
 * Starts from the CURRENT pattern and submits only the days that DIFFER — the procedure touches
 * only the days it is sent, so sending untouched days would silently reassert them. (Unchanged.)
 */
export function useAvailabilityChangeForm(employeeId: number | null, saving: boolean): RequestFormBody {
  const [shifts, setShifts] = useState<Shift[]>([])
  const [effectiveFrom, setEffectiveFrom] = useState<string | null>(null) // yyyy-MM-dd
  const [reason, setReason] = useState('')
  const [current, setCurrent] = useState<{ key: number; days: Record<number, DayState> } | null>(null)
  const [edited, setEdited] = useState<Record<number, DayState>>({})

  useEffect(() => {
    let cancelled = false
    shiftsService
      .getAll()
      .then((s) => {
        if (!cancelled) setShifts(s.filter((x) => x.isActive !== false))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  /* the employee's current template, tagged with who it was read for */
  useEffect(() => {
    if (!employeeId) return
    let cancelled = false
    rosterService
      .patternForEmployee(employeeId)
      .then((rows) => {
        if (cancelled) return
        const days: Record<number, DayState> = {}
        for (const r of rows) days[r.dayOfWeek] = { isAvailable: r.isAvailable, shiftId: r.shiftId ?? null }
        setCurrent({ key: employeeId, days })
        setEdited({})
      })
      .catch(() => {
        if (!cancelled) setCurrent({ key: employeeId, days: {} })
      })
    return () => {
      cancelled = true
    }
  }, [employeeId])

  const baseline = useMemo(
    () => (employeeId && current?.key === employeeId ? current.days : null),
    [current, employeeId],
  )

  /** What each row shows: the edit if one was made, else the current pattern, else available. */
  const rowState = useCallback(
    (day: number): DayState =>
      edited[day] ?? baseline?.[day] ?? { isAvailable: true, shiftId: null },
    [edited, baseline],
  )

  /** Only genuinely different days travel to the API. */
  const changedDays = useMemo(() => {
    if (!baseline) return []
    return DAYS.filter((day) => {
      const e = edited[day]
      if (!e) return false
      const b = baseline[day] ?? { isAvailable: true, shiftId: null }
      return e.isAvailable !== b.isAvailable || (e.isAvailable && e.shiftId !== b.shiftId)
    }).map((day) => ({ dayOfWeek: day, ...rowState(day) }))
  }, [edited, baseline, rowState])

  const setAvailable = useCallback((day: number, value: boolean) => {
    setEdited((prev) =>
      prev[day]?.isAvailable === value
        ? prev
        : { ...prev, [day]: { isAvailable: value, shiftId: value ? (prev[day]?.shiftId ?? null) : null } },
    )
  }, [])

  const setShift = useCallback((day: number, shiftId: number | null) => {
    setEdited((prev) =>
      prev[day]?.shiftId === shiftId
        ? prev
        : { ...prev, [day]: { isAvailable: prev[day]?.isAvailable ?? true, shiftId } },
    )
  }, [])

  const fromYMD = effectiveFrom
  const allUnavailable = changedDays.length === 7 && changedDays.every((d) => !d.isAvailable)

  const summary = useMemo(() => {
    const off = changedDays.filter((d) => !d.isAvailable).map((d) => dayName(d.dayOfWeek))
    const on = changedDays.filter((d) => d.isAvailable).map((d) => dayName(d.dayOfWeek))
    const parts: string[] = []
    if (off.length) parts.push(t('body.availability.summaryNoLonger', { days: off.join('، ') }))
    if (on.length) parts.push(t('body.availability.summaryAvailable', { days: on.join('، ') }))
    return parts.length ? parts.join('; ') : null
  }, [changedDays])

  const autoTitle = null // the procedure composes the title from the days it receives

  const missing = !fromYMD
    ? t('body.availability.missingFrom')
    : changedDays.length === 0
      ? t('body.availability.missingChange')
      : allUnavailable
        ? t('body.availability.missingWorkingDay')
        : null

  const node = (
    <>
      <div className="form-field">
        <DatePickerInput
          label={t('body.availability.startsFrom')}
          valueFormat="DD/MM/YYYY"
          leftSection={<IconCalendar size={14} />}
          minDate={todayYMD()}
          value={effectiveFrom}
          disabled={saving}
          onChange={(v) => setEffectiveFrom(v || null)}
        />
        <div className="hint">{t('body.availability.startsHint')}</div>
      </div>

      <div className="form-field">
        <label className="form-label">{t('body.availability.weekly')}</label>
        {DAYS.map((day) => {
          const st = rowState(day)
          const isChanged = changedDays.some((c) => c.dayOfWeek === day)
          return (
            <div key={day} className={`wf-avail-row${isChanged ? ' wf-avail-changed' : ''}`}>
              <span className="wf-avail-day">{dayName(day)}</span>
              <Switch
                checked={st.isAvailable}
                onLabel={t('body.availability.available')}
                offLabel={t('body.availability.notAvailable')}
                size="lg"
                disabled={saving || !baseline}
                onChange={(e) => setAvailable(day, e.currentTarget.checked)}
              />
              <Select
                data={(st.isAvailable ? shifts : NO_SHIFTS).map((s) => ({
                  value: String(s.shiftId),
                  label: s.name,
                }))}
                value={st.shiftId != null ? String(st.shiftId) : null}
                placeholder={st.isAvailable ? t('body.availability.anyShift') : t('common.dash')}
                clearable
                w={180}
                disabled={saving || !st.isAvailable || !baseline}
                onChange={(v) => setShift(day, v != null ? Number(v) : null)}
              />
            </div>
          )
        })}
        {!baseline && <div className="hint">{t('body.availability.loadPattern')}</div>}
        {summary && <div className="hint">{t('body.availability.asking', { summary })}</div>}
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
          placeholder={t('body.availability.reasonPlaceholder')}
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
      // empId is nullable on RequestFormBody; the incomplete-form guard narrows it back.
      if (empId == null || !fromYMD || changedDays.length === 0)
        throw new Error(t('common.formIncomplete'))
      const created = await availabilityService.create({
        employeeId: empId,
        effectiveFrom: fromYMD,
        days: changedDays,
        reason: reason.trim() || null,
        title: title ?? undefined,
      })
      return {
        requestId: created.requestInstanceId,
        notice:
          created.futureConflicts > 0
            ? t('body.availability.noticeConflicts', { count: created.futureConflicts })
            : null,
      }
    },
  }
}
