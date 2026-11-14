import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Loader, MultiSelect, Select, TextInput } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconPrinter } from '@tabler/icons-react'
import { BrandWordmark } from '../../components/Brand'
import { DateRangeField } from '../../components/DateRangeField'
import { getErrorMessage } from '../../api/errorMessage'
import { rosterService } from '../../services/attendanceService'
import { branchesService } from '../../services/hrService'
import type { RosterLeaveDay, ShiftAssignment } from '../../types/attendance'
import type { Branch } from '../../types/hr'
import { useLanguage } from '../../i18n/useLanguage'
import { formatDayLabel } from './attendanceFormat'
import { companyToday } from './dayProgress'
import { buildWeeklyPoster, clock12, daysBetween, weekStart } from './weeklyShifts'
import './weeklyShifts.css'

const BRANCH_KEY = 'mokaco.weeklyShifts.branch'
const MAX_DAYS = 14
/**
 * A4 with no margin, only while this page is open: the stylesheets of other pages (reports, bookings, requests) stay
 * loaded once visited and give @page 14-15mm margins, which would frame the poster in white. A rule in a stylesheet
 * of this page would outlive it the same way, so it is a <style> the page renders and takes away.
 */
const PRINT_PAGE = '@page { size: A4 portrait; margin: 0 !important; }'

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 'yyyy-MM-dd' -> ISO weekday 1..7, the keys of common.weekday. */
function isoWeekday(day: string): number {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

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

  const posterView =
    poster && !tooLong ? (
    <div className="ws-poster">
      <header className="ws-head">
        <BrandWordmark className="ws-logo" />
        <span className="ws-branch">{(branch?.name ?? '').toUpperCase().replace(/\s*-\s*/g, ' · ')}</span>
      </header>
      <div className="ws-body">
        <div className="ws-eyebrow">
          <span className="ws-rule" /> {t('attendance.weekly.eyebrow')}
        </div>
        <h2 className="ws-title">{isWeek ? t('attendance.weekly.posterTitle') : t('attendance.weekly.posterTitlePeriod')}</h2>
        <div className="ws-dates">
          {formatDayLabel(from)} – {formatDayLabel(to)}
        </div>

        {poster.columns.length === 0 ? (
          <p className="ws-empty">{t('attendance.weekly.empty')}</p>
        ) : (
          <>
            <div className="ws-chips" style={{ gridTemplateColumns: `repeat(${poster.columns.length}, minmax(0, 1fr))` }}>
              {poster.columns.map((c, i) => (
                <div key={c.shiftId} className={i % 2 === 1 ? 'ws-chip ws-chip--dark' : 'ws-chip'}>
                  <b>{c.name.toUpperCase()}</b>
                  <span>
                    {clock12(c.start)} – {clock12(c.end)}
                  </span>
                </div>
              ))}
            </div>
            <table className="ws-table">
              <thead>
                <tr>
                  <th>{t('attendance.weekly.day')}</th>
                  {poster.columns.map((c) => (
                    <th key={c.shiftId}>
                      {c.name.toUpperCase()} · {clock12(c.start).replace(':00', '')} – {clock12(c.end).replace(':00', '')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {poster.rows.map((row) =>
                  row.off ? (
                    <tr key={row.date} className="ws-off">
                      <td>
                        {t(`common.weekday.${isoWeekday(row.date)}`)}
                        {!isWeek && <span className="ws-date">{formatDayLabel(row.date)}</span>}
                      </td>
                      <td colSpan={poster.columns.length}>{t('attendance.weekly.off')}</td>
                    </tr>
                  ) : (
                    <tr key={row.date}>
                      <td className="ws-day">
                        {t(`common.weekday.${isoWeekday(row.date)}`)}
                        {!isWeek && <span className="ws-date">{formatDayLabel(row.date)}</span>}
                      </td>
                      {poster.columns.map((c) => (
                        <td key={c.shiftId}>
                          {row.cells[c.shiftId].length === 0
                            ? '—'
                            : row.cells[c.shiftId].map((name) => <div key={name}>{name}</div>)}
                        </td>
                      ))}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </>
        )}

        <footer className="ws-foot">
          <div>
            <div className="ws-slogan">Grounded in History.</div>
            {note && <div className="ws-note">{note}</div>}
          </div>
          <div className="ws-contact">
            <div>mokanco.com.lb</div>
            <div>@mokacocoffee.lbn</div>
          </div>
        </footer>
      </div>
    </div>
    ) : null

  return (
    <div>
      <style>{PRINT_PAGE}</style>
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
        <>
          <div className="ws-print-root">{posterView}</div>
          {/* Printed from a copy at the top of the page, outside the app layout: one clean A4 sheet. */}
          {createPortal(<div className="ws-print-only">{posterView}</div>, document.body)}
        </>
      ) : null}
    </div>
  )
}
