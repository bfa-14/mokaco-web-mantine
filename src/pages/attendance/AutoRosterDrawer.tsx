import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Loader, NumberInput, SegmentedControl, Select } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconDeviceFloppy } from '@tabler/icons-react'
import { Drawer } from '../../components/dialogs'
import { getErrorMessage } from '../../api/errorMessage'
import { autoRosterService } from '../../services/autoRosterService'
import type {
  AutoRosterMode,
  AutoRosterRequest,
  AutoRosterRhythmStart,
  AutoRosterSetup,
  StaffingRequirementDto,
} from '../../types/attendance'
import { formatDayLabel, periodLabel, periodRange } from './attendanceFormat'
import { mondayOf } from './rosterCounters'

/** One weekday's minimum/target as typed — '' is "not set", which is different from 0. */
interface StaffingDay {
  min: number | ''
  target: number | ''
}

const MODES: AutoRosterMode[] = ['FillEmpty', 'ReplanAuto', 'ReplanAll']

/**
 * The weekday rows the drawer edits: day-level rows only (no shift). A weekday row wins over an
 * every-day row, so an every-day row shows as the value of each day that has none of its own.
 */
function staffingDays(rows: StaffingRequirementDto[]): StaffingDay[] {
  const dayRows = rows.filter((r) => r.shiftId == null)
  const everyDay = dayRows.find((r) => r.dayOfWeek == null)
  return [1, 2, 3, 4, 5, 6, 7].map((dow) => {
    const row = dayRows.find((r) => r.dayOfWeek === dow) ?? everyDay
    return { min: row ? row.minOnDuty : '', target: row?.targetOnDuty ?? '' }
  })
}

/**
 * THE AUTO-ROSTER'S OPTIONS for one branch and month — everything Preview sends, nothing saved by it
 * except the branch's minimums (they belong to the branch, not to the run).
 *
 * Opens on the branch's last saved run (setup.lastParams), or on the draft on screen when reopened
 * from it with "Options…", so a second look changes one thing rather than re-entering everything.
 * The mode starts on "Fill empty days" for a branch that has never run it and on "Re-plan generated
 * days" afterwards (D11); "Re-plan everything" re-plans days somebody set by hand, so it asks first.
 */
export function AutoRosterDrawer({
  opened,
  onClose,
  branchId,
  branchName,
  period,
  setup,
  setupError,
  current,
  busy,
  error,
  onPreview,
  onStaffingSaved,
}: {
  opened: boolean
  onClose: () => void
  branchId: number
  branchName: string
  /** 'yyyy-MM'. */
  period: string
  setup: AutoRosterSetup | null
  /** Why the setup could not be read. */
  setupError: string | null
  /** The draft on screen, when the drawer is reopened from it. */
  current: AutoRosterRequest | null
  busy: boolean
  /** The preview's refusal, verbatim, in the drawer the person is looking at. */
  error: string | null
  onPreview: (request: AutoRosterRequest) => void
  /** The minimums were saved: the page's footer measures the days against them from now on. */
  onStaffingSaved: (rows: StaffingRequirementDto[]) => void
}) {
  const { t } = useTranslation()
  const monthLabel = periodLabel(period)
  const monthFrom = periodRange(period).from
  const firstMonday = mondayOf(monthFrom)

  const [mode, setMode] = useState<AutoRosterMode>('FillEmpty')
  const [confirmAll, setConfirmAll] = useState(false)
  const [rhythmStart, setRhythmStart] = useState<AutoRosterRhythmStart>('Aligned')
  const [defaultShiftId, setDefaultShiftId] = useState<number | null>(null)
  const [offRotation, setOffRotation] = useState<Set<number>>(new Set())
  /**
   * The first week's type the manager PICKED, per person. Every pick is sent as an override, also one
   * equal to what the column showed: the shown value can be the planner's guess under other options
   * (see firstWeekKnown), and only an override holds it to what the manager saw.
   */
  const [firstWeek, setFirstWeek] = useState<Map<number, number>>(new Map())
  const [cover, setCover] = useState<Map<string, number>>(new Map())
  const [staffing, setStaffing] = useState<StaffingDay[]>(() => staffingDays([]))
  const [staffingDirty, setStaffingDirty] = useState(false)
  const [savingStaffing, setSavingStaffing] = useState(false)
  const [staffingError, setStaffingError] = useState<string | null>(null)

  /* FILLED ONCE EACH TIME IT OPENS, from the draft on screen, else the last saved run, else the
     settings. Not on every setup change while open: saving the minimums updates the setup, and a
     refill then would undo the mode and the staff choices the person had already made. */
  const [filled, setFilled] = useState(false)
  useEffect(() => {
    if (!opened) setFilled(false)
  }, [opened])
  useEffect(() => {
    if (!opened || !setup || filled) return
    setFilled(true)
    const last = current ?? setup.lastParams ?? null
    const activeShifts = new Set(setup.shifts.map((s) => s.shiftId))

    setMode(current?.mode ?? (setup.lastParams ? 'ReplanAuto' : 'FillEmpty'))
    setConfirmAll(current?.mode === 'ReplanAll')
    const start = last?.rhythmStart ?? setup.settings?.rosterRhythmStart
    setRhythmStart(start === 'Staggered' ? 'Staggered' : 'Aligned')
    setDefaultShiftId(
      last?.defaultShiftId != null && activeShifts.has(last.defaultShiftId) ? last.defaultShiftId : null,
    )
    // The stored flags are the truth; only a draft on screen overrides them.
    setOffRotation(
      new Set(current?.offRotationEmployeeIds ?? setup.staff.filter((s) => !s.onRotation).map((s) => s.employeeId)),
    )
    const weeks = new Map<number, number>()
    for (const o of current?.rhythmOverrides ?? []) {
      if (mondayOf(o.weekStart) === firstMonday) weeks.set(o.employeeId, o.workDays)
    }
    setFirstWeek(weeks)
    const covers = new Map<string, number>()
    for (const h of setup.holidays) {
      const date = h.date.slice(0, 10)
      if (date.slice(0, 7) !== period) continue
      covers.set(date, last?.holidayCover?.find((c) => c.date.slice(0, 10) === date)?.count ?? 0)
    }
    setCover(covers)
    setStaffing(staffingDays(setup.staffing ?? []))
    setStaffingDirty(false)
    setStaffingError(null)
  }, [opened, setup, filled, current, firstMonday, period])

  /** The month's holidays only — the setup may carry the ones the planner looked back over. */
  const holidays = useMemo(
    () => (setup?.holidays ?? []).filter((h) => h.date.slice(0, 7) === period),
    [setup, period],
  )

  const perShiftRows = useMemo(
    () => (setup?.staffing ?? []).filter((r) => r.shiftId != null),
    [setup],
  )

  /**
   * WHAT THE SETUP'S "FIRST WEEK" CAN BE TRUSTED FOR. The setup resolved it under the branch's stored
   * rhythm start, with everyone on rotation. A stored rhythm does not depend on either. Someone
   * without one is anchored by the rhythm start: Aligned decides each person alone, so the setup
   * holds when the drawer keeps the setting; Staggered balances the whole team, so it holds only
   * while nobody's week was picked by hand and nobody is off rotation. Otherwise the planner decides
   * at preview, and the column says so instead of showing a number it may not keep.
   */
  const settingStart: AutoRosterRhythmStart =
    setup?.settings?.rosterRhythmStart === 'Staggered' ? 'Staggered' : 'Aligned'
  const setupWeeksHold =
    rhythmStart === settingStart &&
    (rhythmStart === 'Aligned' || (firstWeek.size === 0 && offRotation.size === 0))
  function firstWeekKnown(staff: { anchorWeekStart?: string | null }): boolean {
    return staff.anchorWeekStart != null || setupWeeksHold
  }

  /** The rows a save writes: the seven weekdays as typed, and the per-shift rows untouched. */
  function staffingRows(): StaffingRequirementDto[] | string {
    const rows: StaffingRequirementDto[] = []
    for (let i = 0; i < 7; i++) {
      const { min, target } = staffing[i]
      // A target alone would be dropped with its day — said here rather than lost on save.
      if (min === '' && target !== '') {
        return t('attendance.roster.auto.staffing.targetWithoutMin', { day: t(`common.weekday.${i + 1}`) })
      }
      if (min === '') continue
      if (target !== '' && target < min) {
        return t('attendance.roster.auto.staffing.targetBelowMin', { day: t(`common.weekday.${i + 1}`) })
      }
      rows.push({ dayOfWeek: i + 1, shiftId: null, minOnDuty: min, targetOnDuty: target === '' ? null : target })
    }
    return [...rows, ...perShiftRows]
  }

  async function saveStaffing(): Promise<boolean> {
    const rows = staffingRows()
    if (typeof rows === 'string') {
      setStaffingError(rows)
      return false
    }
    setSavingStaffing(true)
    setStaffingError(null)
    try {
      await autoRosterService.saveStaffing(branchId, rows)
      setStaffingDirty(false)
      onStaffingSaved(rows)
      return true
    } catch (err) {
      setStaffingError(getErrorMessage(err))
      return false
    } finally {
      setSavingStaffing(false)
    }
  }

  async function preview() {
    if (!setup) return
    // The planner reads the minimums from the database, so unsaved ones would be planned without.
    if (staffingDirty && !(await saveStaffing())) return
    const rhythmOverrides = setup.staff
      .filter((s) => firstWeek.has(s.employeeId) && !offRotation.has(s.employeeId))
      .map((s) => ({
        employeeId: s.employeeId,
        weekStart: firstMonday,
        workDays: firstWeek.get(s.employeeId) ?? s.firstWeekWorkDays,
      }))
    onPreview({
      branchId,
      month: period,
      mode,
      rhythmStart,
      defaultShiftId,
      holidayCover: [...cover.entries()].map(([date, count]) => ({ date, count })),
      offRotationEmployeeIds: [...offRotation],
      rhythmOverrides,
      draftCells: [],
    })
  }

  const waiting = setup?.openRequestId != null
  const canPreview = setup != null && !waiting && !busy && !savingStaffing && (mode !== 'ReplanAll' || confirmAll)
  const onRotationCount = setup ? setup.staff.filter((s) => !offRotation.has(s.employeeId)).length : 0
  const anyWeekUnknown = setup
    ? setup.staff.some((s) => !offRotation.has(s.employeeId) && !firstWeek.has(s.employeeId) && !firstWeekKnown(s))
    : false

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      // The trailing edge, so the panel never covers where the eye starts (the names). Mantine lays the
      // drawer out with flexbox and slides it by the document's direction, so "right" is already the
      // left edge in Arabic; swapping it here put the panel over the names.
      position="right"
      size={580}
      title={<strong>{t('attendance.roster.auto.drawer.title')}</strong>}
    >
      <p className="hint" style={{ marginBottom: 14 }}>
        {t('attendance.roster.auto.drawer.intro')}
      </p>

      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="form-field">
          <span className="form-label">{t('attendance.roster.auto.drawer.month')}</span>
          <strong>{monthLabel}</strong>
        </div>
        <div className="form-field">
          <span className="form-label">{t('attendance.roster.auto.drawer.branch')}</span>
          <strong>{branchName}</strong>
        </div>
      </div>

      {setupError && (
        <div className="alert alert--error" role="alert">
          {t('attendance.roster.auto.drawer.loadFailed', { error: setupError })}
        </div>
      )}

      {!setup && !setupError && (
        <div className="page-loading" style={{ flexDirection: 'column', gap: 8 }}>
          <Loader size={28} />
          <span className="hint">{t('attendance.roster.auto.drawer.loading')}</span>
        </div>
      )}

      {setup && (
        <>
          {waiting && (
            <div className="alert alert--warning" role="alert">
              {t('attendance.roster.auto.drawer.waiting', { id: setup.openRequestId })}
            </div>
          )}

          <div className="form-field">
            <span className="form-label">{t('attendance.roster.auto.mode.label')}</span>
            <SegmentedControl
              fullWidth
              value={mode}
              onChange={(v) => {
                setMode(v as AutoRosterMode)
                setConfirmAll(false)
              }}
              data={MODES.map((m) => ({ value: m, label: t(`attendance.roster.auto.mode.${m}`) }))}
              disabled={busy}
            />
            <div className="hint" style={{ marginTop: 6 }}>
              {t(`attendance.roster.auto.mode.${mode}Hint`)}
            </div>
            {mode === 'ReplanAll' && (
              <Checkbox
                mt={8}
                color="red"
                label={t('attendance.roster.auto.mode.confirmAll')}
                checked={confirmAll}
                onChange={(e) => setConfirmAll(e.currentTarget.checked)}
                disabled={busy}
              />
            )}
          </div>

          <div className="form-grid">
            <div className="form-field">
              <span className="form-label">{t('attendance.roster.auto.rhythm.label')}</span>
              <SegmentedControl
                fullWidth
                value={rhythmStart}
                onChange={(v) => setRhythmStart(v as AutoRosterRhythmStart)}
                data={[
                  { value: 'Aligned', label: t('attendance.roster.auto.rhythm.Aligned') },
                  { value: 'Staggered', label: t('attendance.roster.auto.rhythm.Staggered') },
                ]}
                disabled={busy}
              />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="auto-roster-default-shift">
                {t('attendance.roster.auto.defaultShift.label')}
              </label>
              <Select
                id="auto-roster-default-shift"
                data={setup.shifts.map((s) => ({ value: String(s.shiftId), label: s.name }))}
                value={defaultShiftId != null ? String(defaultShiftId) : null}
                onChange={(v) => setDefaultShiftId(v != null ? Number(v) : null)}
                placeholder={t('attendance.roster.auto.defaultShift.placeholder')}
                clearable
                disabled={busy}
              />
            </div>
            <div className="hint full" style={{ marginTop: -8, marginBottom: 12 }}>
              {t(`attendance.roster.auto.rhythm.${rhythmStart}Hint`)}{' '}
              {t('attendance.roster.auto.rhythm.storedNote')}{' '}
              {t('attendance.roster.auto.defaultShift.hint')}
            </div>
          </div>

          {/* ── staff ── */}
          <div className="form-section">
            <h3 className="form-section-title">
              {t('attendance.roster.auto.staff.title')} ·{' '}
              {t('attendance.roster.auto.staff.count', { count: onRotationCount })}
            </h3>
            {setup.staff.length === 0 ? (
              <div className="hint">{t('attendance.roster.auto.staff.none', { month: monthLabel })}</div>
            ) : (
              <>
                <table className="auto-roster-table">
                  <thead>
                    <tr>
                      <th>{t('attendance.roster.auto.staff.name')}</th>
                      <th>{t('attendance.roster.auto.staff.onRotation')}</th>
                      <th>{t('attendance.roster.auto.staff.firstWeek')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {setup.staff.map((s) => {
                      const on = !offRotation.has(s.employeeId)
                      const picked = firstWeek.get(s.employeeId)
                      const known = firstWeekKnown(s)
                      // '' selects neither segment: the planner decides at preview.
                      const week = picked != null ? String(picked) : known ? String(s.firstWeekWorkDays) : ''
                      const flipped = picked != null && known && picked !== s.firstWeekWorkDays
                      return (
                        <tr key={s.employeeId} className={on ? undefined : 'auto-roster-off'}>
                          <td>
                            <div className="auto-roster-name">{s.fullName}</div>
                            {s.position && <div className="auto-roster-sub">{s.position}</div>}
                          </td>
                          <td>
                            <Checkbox
                              aria-label={`${t('attendance.roster.auto.staff.onRotation')}: ${s.fullName}`}
                              checked={on}
                              onChange={(e) => {
                                const checked = e.currentTarget.checked
                                setOffRotation((prev) => {
                                  const next = new Set(prev)
                                  if (checked) next.delete(s.employeeId)
                                  else next.add(s.employeeId)
                                  return next
                                })
                              }}
                              disabled={busy}
                            />
                          </td>
                          <td>
                            <SegmentedControl
                              size="xs"
                              value={week}
                              onChange={(v) =>
                                setFirstWeek((prev) => new Map(prev).set(s.employeeId, Number(v)))
                              }
                              data={[
                                { value: '6', label: '6' },
                                { value: '5', label: '5' },
                              ]}
                              disabled={busy || !on}
                              aria-label={`${t('attendance.roster.auto.staff.firstWeek')}: ${s.fullName}`}
                            />
                            {flipped && (
                              <span className="auto-roster-flag">{t('attendance.roster.auto.staff.flipped')}</span>
                            )}
                            {week === '' && on && (
                              <span className="auto-roster-sub">{t('attendance.roster.auto.staff.firstWeekAuto')}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="hint" style={{ marginTop: 6 }}>
                  {t('attendance.roster.auto.staff.firstWeekHint', { date: formatDayLabel(firstMonday) })}{' '}
                  {anyWeekUnknown && (
                    <>
                      {t('attendance.roster.auto.staff.firstWeekAutoHint', {
                        start: t(`attendance.roster.auto.rhythm.${rhythmStart}`),
                      })}{' '}
                    </>
                  )}
                  {t('attendance.roster.auto.staff.offHint')}
                </div>
              </>
            )}
          </div>

          {/* ── public holidays ── */}
          <div className="form-section">
            <h3 className="form-section-title">{t('attendance.roster.auto.holidays.title')}</h3>
            {holidays.length === 0 ? (
              <div className="hint">{t('attendance.roster.auto.holidays.none', { month: monthLabel })}</div>
            ) : (
              <>
                <table className="auto-roster-table">
                  <tbody>
                    {holidays.map((h) => {
                      const date = h.date.slice(0, 10)
                      const count = cover.get(date) ?? 0
                      return (
                        <tr key={date}>
                          <td>
                            <div className="auto-roster-name">{h.name}</div>
                            <div className="auto-roster-sub">
                              {formatDayLabel(date)} ·{' '}
                              {h.isPaid
                                ? t('attendance.roster.auto.holidays.paid')
                                : t('attendance.roster.auto.holidays.unpaid')}
                            </div>
                            {!h.isPaid && count > 0 && (
                              <div className="form-error">{t('attendance.roster.auto.holidays.unpaidWarn')}</div>
                            )}
                          </td>
                          <td style={{ width: 120 }}>
                            <NumberInput
                              aria-label={`${t('attendance.roster.auto.holidays.cover')}: ${h.name}`}
                              size="xs"
                              min={0}
                              max={setup.staff.length}
                              allowDecimal={false}
                              value={count}
                              onChange={(v) =>
                                setCover((prev) => new Map(prev).set(date, typeof v === 'number' ? v : 0))
                              }
                              disabled={busy}
                              leftSection={<span className="auto-roster-sub">{t('attendance.roster.auto.holidays.cover')}</span>}
                              leftSectionWidth={64}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="hint" style={{ marginTop: 6 }}>
                  {t('attendance.roster.auto.holidays.coverHint')}
                </div>
              </>
            )}
          </div>

          {/* ── minimum on duty ── */}
          <div className="form-section">
            <h3 className="form-section-title">{t('attendance.roster.auto.staffing.title')}</h3>
            <table className="auto-roster-table auto-roster-staffing">
              <thead>
                <tr>
                  <th>{t('attendance.roster.auto.staffing.day')}</th>
                  <th>{t('attendance.roster.auto.staffing.min')}</th>
                  <th>{t('attendance.roster.auto.staffing.target')}</th>
                </tr>
              </thead>
              <tbody>
                {staffing.map((day, i) => (
                  <tr key={i}>
                    <td>{t(`common.weekday.${i + 1}`)}</td>
                    {(['min', 'target'] as const).map((field) => (
                      <td key={field}>
                        <NumberInput
                          aria-label={`${t(`attendance.roster.auto.staffing.${field}`)}: ${t(`common.weekday.${i + 1}`)}`}
                          size="xs"
                          min={0}
                          allowDecimal={false}
                          value={day[field]}
                          onChange={(v) => {
                            setStaffing((rows) =>
                              rows.map((r, j) => (j === i ? { ...r, [field]: typeof v === 'number' ? v : '' } : r)),
                            )
                            setStaffingDirty(true)
                          }}
                          disabled={busy || savingStaffing}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hint" style={{ marginTop: 6 }}>
              {t('attendance.roster.auto.staffing.hint')}
              {perShiftRows.length > 0 && (
                <> {t('attendance.roster.auto.staffing.perShift', { count: perShiftRows.length })}</>
              )}
            </div>
            {staffingError && <div className="form-error">{staffingError}</div>}
            <div className="form-actions" style={{ justifyContent: 'flex-start', alignItems: 'center' }}>
              <Button
                variant="default"
                size="xs"
                leftSection={<IconDeviceFloppy size={14} />}
                loading={savingStaffing}
                disabled={!staffingDirty || busy || waiting}
                onClick={() => {
                  void saveStaffing().then((ok) => {
                    if (ok) {
                      notifications.show({
                        message: t('attendance.roster.auto.staffing.saved'),
                        color: 'green',
                        autoClose: 2500,
                      })
                    }
                  })
                }}
              >
                {t('attendance.roster.auto.staffing.save')}
              </Button>
              {staffingDirty && <span className="hint">{t('attendance.roster.auto.staffing.unsaved')}</span>}
            </div>
          </div>
        </>
      )}

      {error && (
        <div className="alert alert--error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      <div className="form-actions auto-roster-actions">
        <Button variant="default" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void preview()} disabled={!canPreview} loading={busy}>
          {busy ? t('attendance.roster.auto.drawer.previewing') : t('attendance.roster.auto.drawer.preview')}
        </Button>
      </div>
    </Drawer>
  )
}
