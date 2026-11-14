import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Loader } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconPrinter } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { teamShiftsService } from '../../services/attendanceService'
import type { TeamShifts } from '../../types/attendance'
import { useLanguage } from '../../i18n/useLanguage'
import { companyToday } from './dayProgress'
import { addDays, buildWeeklyPoster, daysBetween, weekStart } from './weeklyShifts'
import { WeeklyPosterSheet } from './WeeklyPosterSheet'

/**
 * MY BRANCH'S SHIFTS — the Weekly shifts poster for an employee (SHIFTS_VIEW_BRANCH, script 112): their own branch
 * only, one week at a time, read-only. The API sends a name, a day and a shift and nothing else: no attendance, and
 * nobody on approved leave for the whole day.
 */
export default function MyShiftsPage() {
  const { t } = useTranslation()
  const { isRtl } = useLanguage()
  const thisWeek = weekStart(companyToday())
  const [from, setFrom] = useState(thisWeek)
  const to = addDays(from, 6)
  // `null` while a week is read; `undefined` once the API said the account has no employee.
  const [data, setData] = useState<TeamShifts | null | undefined>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // The old week goes while the next is read, so it is never printed by mistake.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null)
    teamShiftsService
      .get(from, to)
      .then((result) => {
        if (cancelled) return
        setData(result ?? undefined)
        setError(null)
      })
      .catch((err) => !cancelled && setError(getErrorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [from, to])

  const poster = useMemo(
    () =>
      data
        ? buildWeeklyPoster({
            days: daysBetween(from, to),
            assignments: data.shifts.map((s) => ({ ...s, isRestDay: false })),
            leave: [],
          })
        : null,
    [data, from, to],
  )
  const Back = isRtl ? IconChevronRight : IconChevronLeft
  const Forward = isRtl ? IconChevronLeft : IconChevronRight

  return (
    <div>
      <div className="page-head ws-no-print">
        <div>
          <h1 className="page-title">{t('attendance.myShifts.title')}</h1>
          <p className="page-subtitle">{t('attendance.myShifts.subtitle')}</p>
        </div>
        <div className="page-head-actions">
          <Button leftSection={<IconPrinter size={16} />} disabled={!poster} onClick={() => window.print()}>
            {t('attendance.weekly.print')}
          </Button>
        </div>
      </div>

      <div className="ws-week-nav ws-no-print">
        <Button variant="default" size="xs" onClick={() => setFrom(addDays(from, -7))} leftSection={<Back size={14} />}>
          {t('attendance.weekly.prevWeek')}
        </Button>
        <Button variant={from === thisWeek ? 'light' : 'subtle'} size="xs" onClick={() => setFrom(thisWeek)}>
          {t('attendance.weekly.thisWeek')}
        </Button>
        <Button variant="default" size="xs" onClick={() => setFrom(addDays(from, 7))} rightSection={<Forward size={14} />}>
          {t('attendance.weekly.nextWeek')}
        </Button>
      </div>

      {error && (
        <div className="alert alert--error ws-no-print" role="alert">
          {error}
        </div>
      )}

      {data === undefined ? (
        <div className="card ws-no-print">
          <div className="empty-hint">{t('attendance.myShifts.noEmployee')}</div>
        </div>
      ) : !poster ? (
        !error && (
          <div className="page-loading ws-no-print">
            <Loader size={36} />
          </div>
        )
      ) : (
        <WeeklyPosterSheet
          poster={poster}
          branchName={data?.branchName ?? ''}
          from={from}
          to={to}
          isWeek
          note={t('attendance.weekly.defaultNote')}
        />
      )}
    </div>
  )
}
