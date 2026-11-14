import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Loader, MultiSelect, Select, TextInput } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconPrinter } from '@tabler/icons-react'
import { DateRangeField } from '../../components/DateRangeField'
import { getErrorMessage } from '../../api/errorMessage'
import { rosterService } from '../../services/attendanceService'
import { branchesService } from '../../services/hrService'
import type { RosterLeaveDay, ShiftAssignment } from '../../types/attendance'
import type { Branch } from '../../types/hr'
import { useLanguage } from '../../i18n/useLanguage'
import { companyToday } from './dayProgress'
import { addDays, buildWeeklyPoster, daysBetween, weekStart } from './weeklyShifts'
import { WeeklyPosterSheet } from './WeeklyPosterSheet'
import './weeklyShifts.css'

const BRANCH_KEY = 'mokaco.weeklyShifts.branch'
const MAX_DAYS = 14

/**
 * WEEKLY SHIFTS — the roster of one branch as a poster to pin up or send: one column per shift, one row per day,
 * who works each shift in the cell, OFF for a day nobody works. Built live from the roster (approved leave left
 * out), for the week or any period up to two weeks, the shifts and names chosen on screen; Print gives the poster
 * alone on an A4 page (or a PDF).
 */
export default function WeeklyShiftsPage() {
  const { t } = useTranslation()
  const { isRtl } = useLanguage()
  const today = companyToday()
  const [from, setFrom] = useState(() => weekStart(today))
  const [to, setTo] = useState(() => addDays(weekStart(today), 6))
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchId] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(BRANCH_KEY)
      return v ? Number(v) : null
    } catch {
      return null
    }
  })
  const [assignments, setAssignments] = useState<ShiftAssignment[] | null>(null)
  const [leave, setLeave] = useState<RosterLeaveDay[]>([])
  const [error, setError] = useState<string | null>(null)
  const [onlyShifts, setOnlyShifts] = useState<string[]>([])
  const [firstNames, setFirstNames] = useState(false)
  const [note, setNote] = useState(() => t('attendance.weekly.defaultNote'))

  useEffect(() => {
    branchesService
      .getAll()
      .then((list) => {
        const active = list.filter((b) => b.isActive)
        setBranches(active)
        setBranchId((current) => (current && active.some((b) => b.branchId === current) ? current : (active[0]?.branchId ?? null)))
      })
      .catch((err) => setError(getErrorMessage(err)))
  }, [])

  useEffect(() => {
    if (!branchId) return
    try {
      localStorage.setItem(BRANCH_KEY, String(branchId))
    } catch {
      /* a convenience only */
    }
    let cancelled = false
    // The old poster goes while the new branch or period is read, so it is never printed by mistake.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAssignments(null)
    Promise.all([rosterService.get(from, to, undefined, branchId), rosterService.leaveDays(from, to, branchId).catch(() => [])])
      .then(([rows, leaves]) => {
        if (cancelled) return
        setAssignments(rows)
        setLeave(leaves)
        setError(null)
      })
      .catch((err) => !cancelled && setError(getErrorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [branchId, from, to])

  const days = useMemo(() => daysBetween(from, to), [from, to])
  const all = useMemo(
    () => (assignments ? buildWeeklyPoster({ days, assignments, leave, firstNames }) : null),
    [assignments, days, leave, firstNames],
  )
  const poster = useMemo(
    () =>
      assignments
        ? buildWeeklyPoster({ days, assignments, leave, firstNames, onlyShifts: onlyShifts.map(Number) })
        : null,
    [assignments, days, leave, firstNames, onlyShifts],
  )
  const branch = branches.find((b) => b.branchId === branchId)
  const isWeek = from === weekStart(from) && to === addDays(from, 6)
  const Back = isRtl ? IconChevronRight : IconChevronLeft
  const Forward = isRtl ? IconChevronLeft : IconChevronRight
  const tooLong = days.length > MAX_DAYS

  function moveWeek(n: number) {
    const start = addDays(weekStart(from), 7 * n)
    setFrom(start)
    setTo(addDays(start, 6))
  }

  return (
    <div>
      <div className="page-head ws-no-print">
        <div>
          <h1 className="page-title">{t('attendance.weekly.title')}</h1>
          <p className="page-subtitle">{t('attendance.weekly.subtitle')}</p>
        </div>
        <div className="page-head-actions">
          <Button leftSection={<IconPrinter size={16} />} disabled={!poster || tooLong} onClick={() => window.print()}>
            {t('attendance.weekly.print')}
          </Button>
        </div>
      </div>

      <div className="card ws-no-print">
        <div className="filter-bar">
          <div className="filter-field">
            <label className="filter-field-label" htmlFor="ws-branch">
              {t('attendance.dailyPage.col.branch')}
            </label>
            <Select
              id="ws-branch"
              w={220}
              data={branches.map((b) => ({ value: String(b.branchId), label: b.name }))}
              value={branchId ? String(branchId) : null}
              onChange={(v) => v && setBranchId(Number(v))}
              allowDeselect={false}
            />
          </div>
          <div className="filter-field">
            <label className="filter-field-label" htmlFor="ws-period">
              {t('attendance.weekly.period')}
            </label>
            <DateRangeField
              id="ws-period"
              w={230}
              from={from}
              to={to}
              defaultFrom={weekStart(today)}
              defaultTo={addDays(weekStart(today), 6)}
              onChange={(f, tt) => {
                if (f && tt) {
                  setFrom(f)
                  setTo(tt)
                }
              }}
            />
          </div>
          <div className="ws-week-nav">
            <Button variant="default" size="xs" onClick={() => moveWeek(-1)} leftSection={<Back size={14} />}>
              {t('attendance.weekly.prevWeek')}
            </Button>
            <Button
              variant={from === weekStart(today) && to === addDays(weekStart(today), 6) ? 'light' : 'subtle'}
              size="xs"
              onClick={() => {
                setFrom(weekStart(today))
                setTo(addDays(weekStart(today), 6))
              }}
            >
              {t('attendance.weekly.thisWeek')}
            </Button>
            <Button variant="default" size="xs" onClick={() => moveWeek(1)} rightSection={<Forward size={14} />}>
              {t('attendance.weekly.nextWeek')}
            </Button>
          </div>
        </div>
        <div className="filter-bar">
          <div className="filter-field">
            <label className="filter-field-label" htmlFor="ws-shifts">
              {t('attendance.weekly.shifts')}
            </label>
            <MultiSelect
              id="ws-shifts"
              w={320}
              placeholder={t('attendance.weekly.allShifts')}
              data={(all?.columns ?? []).map((c) => ({ value: String(c.shiftId), label: `${c.name} (${c.start}–${c.end})` }))}
              value={onlyShifts}
              onChange={setOnlyShifts}
              clearable
            />
          </div>
          <div className="filter-field ws-note-field">
            <label className="filter-field-label" htmlFor="ws-note">
              {t('attendance.weekly.note')}
            </label>
            <TextInput id="ws-note" value={note} maxLength={120} onChange={(e) => setNote(e.currentTarget.value)} />
          </div>
          <Checkbox
            label={t('attendance.weekly.firstNames')}
            checked={firstNames}
            onChange={(e) => setFirstNames(e.currentTarget.checked)}
          />
        </div>
        {tooLong && (
          <div className="alert alert--error" role="alert">
            {t('attendance.weekly.tooLong', { max: MAX_DAYS })}
          </div>
        )}
      </div>

      {error && (
        <div className="alert alert--error ws-no-print" role="alert">
          {error}
        </div>
      )}

      {!poster && !error ? (
        <div className="page-loading ws-no-print">
          <Loader size={36} />
        </div>
      ) : poster && !tooLong ? (
        <WeeklyPosterSheet poster={poster} branchName={branch?.name ?? ''} from={from} to={to} isWeek={isWeek} note={note} />
      ) : null}
    </div>
  )
}
