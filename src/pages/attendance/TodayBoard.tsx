import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Loader } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { attendanceService, importService, rosterService } from '../../services/attendanceService'
import { useLive } from '../../live/useLive'
import { useLiveEnabled } from '../../live/useLiveSettings'
import { formatDayLabel, formatMinutes, formatTime } from './attendanceFormat'
import { companyToday } from './dayProgress'
import { buildTodayBoard, companyNow, TODAY_GROUPS } from './todayBoard'
import type { TodayBoard as Board, TodayGroup, TodayPerson } from './todayBoard'

/**
 * TODAY, ONE BRANCH (or all): the first question of every morning, "who is here and who is not", answered
 * without pairing punches in your head. Counters first, then one card per person, "not in yet" first.
 * The foot says when the last punch arrived, so "not yet" is not mistaken for "not collected yet".
 *
 * Every read is the caller's own (branch-scoped by the API), so a branch manager sees their branch.
 */
export function TodayBoard({
  branchId,
  reloadKey,
  onOpenDay,
}: {
  branchId: number | null
  /** Bumped by the page after a change (a decision, a correction) to read again. */
  reloadKey: number
  onOpenDay: (attendanceId: number) => void
}) {
  const { t } = useTranslation()
  const [board, setBoard] = useState<Board | null>(null)
  const [lastPunch, setLastPunch] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const today = companyToday()
    try {
      const [roster, records, leave, offRoster] = await Promise.all([
        rosterService.get(today, today, undefined, branchId ?? undefined),
        attendanceService.get(today, today, undefined, branchId ?? undefined),
        rosterService.leaveDays(today, today, branchId).catch(() => []),
        attendanceService.getUnrosteredDays(today, today, { branchId }).catch(() => []),
      ])
      setBoard(buildTodayBoard({ today, now: companyNow(), roster, records, leave, offRoster }))
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
    // The newest punch of the day, of this branch: the list comes newest first.
    importService
      .getPunches(today)
      .then((punches) => {
        const mine = branchId ? punches.filter((p) => p.branchId === branchId) : punches
        setLastPunch(mine[0]?.punchTimeUtc ?? null)
      })
      .catch(() => setLastPunch(null))
  }, [branchId])

  useEffect(() => {
    // A read on mount, on a branch change and after the page reloaded: the state is set when it answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, reloadKey])

  // A punch landing or a day being processed moves people between the lists.
  useLive(['attendance'], () => void load(), useLiveEnabled('attendance'))

  // "Shift started 25 min ago" ages by itself: read again every five minutes while the page is open.
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [load])

  if (loading && !board) {
    return (
      <div className="page-loading">
        <Loader size={40} />
      </div>
    )
  }

  return (
    <div className="today-board">
      {error && (
        <div className="alert alert--error" role="alert">
          {t('attendance.today.loadFailed', { error })}
        </div>
      )}
      {board && (
        <>
          <div className="today-head">
            <div className="today-title">{t('attendance.today.title', { date: formatDayLabel(companyToday()) })}</div>
            <Button
              variant="subtle"
              size="compact-sm"
              leftSection={<IconRefresh size={14} />}
              onClick={() => void load()}
            >
              {t('attendance.today.refresh')}
            </Button>
          </div>
          <div className="today-counters">
            <Counter value={board.arrived} label={t('attendance.today.counter.arrived')} tone="ok" />
            <Counter value={board.notYet} label={t('attendance.today.counter.notYet')} tone={board.notYet ? 'warn' : 'muted'} />
            <Counter value={board.off} label={t('attendance.today.counter.off')} tone="muted" />
            {board.offRoster > 0 && (
              <Counter value={board.offRoster} label={t('attendance.today.counter.offRoster')} tone="warn" />
            )}
          </div>

          {TODAY_GROUPS.every((g) => board.groups[g].length === 0) ? (
            <div className="card">
              <div className="empty-hint">
                <div className="empty-hint-main">{t('attendance.today.emptyTitle')}</div>
                {t('attendance.today.emptyText')}
              </div>
            </div>
          ) : (
            TODAY_GROUPS.filter((g) => board.groups[g].length > 0).map((group) => (
              <section key={group} className="card today-group">
                <div className="today-group-title">
                  {t(`attendance.today.group.${group}`)}{' '}
                  <span className="today-group-count">{board.groups[group].length}</span>
                </div>
                {group === 'offRoster' && <p className="hint">{t('attendance.today.offRosterHint')}</p>}
                <div className="today-list">
                  {board.groups[group].map((person) => (
                    <PersonCard key={`${group}-${person.employeeId}`} person={person} onOpenDay={onOpenDay} />
                  ))}
                </div>
              </section>
            ))
          )}

          <p className="hint today-foot">
            {lastPunch
              ? t('attendance.today.lastPunch', { time: formatTime(lastPunch) })
              : t('attendance.today.noPunchYet')}
          </p>
        </>
      )}
    </div>
  )
}

function Counter({ value, label, tone }: { value: number; label: string; tone: 'ok' | 'warn' | 'muted' }) {
  return (
    <div className={`today-counter today-counter--${tone}`}>
      <span className="today-counter-value">{value}</span>
      <span className="today-counter-label">{label}</span>
    </div>
  )
}

function shiftText(person: TodayPerson, t: (key: string, options?: Record<string, unknown>) => string) {
  if (!person.shiftStart) return null
  return t('attendance.today.shift', {
    name: person.shiftName ?? '',
    start: person.shiftStart,
    end: person.shiftEnd ?? '',
  })
}

function stateChip(person: TodayPerson, t: (key: string, options?: Record<string, unknown>) => string) {
  const group: TodayGroup = person.group
  switch (group) {
    case 'in':
      return {
        tone: 'on',
        text: person.lastOut
          ? t('attendance.today.state.backIn', { time: formatTime(person.firstIn) })
          : t('attendance.today.state.in', { time: formatTime(person.firstIn) }),
      }
    case 'left':
      return {
        tone: 'muted',
        text: t('attendance.today.state.left', {
          from: formatTime(person.firstIn),
          to: formatTime(person.lastOut),
          worked: formatMinutes(person.workedMinutes),
        }),
      }
    case 'notYet': {
      const minutes = person.minutesFromStart ?? 0
      if (person.shiftOver) return { tone: 'late', text: t('attendance.today.state.shiftOver') }
      return minutes >= 0
        ? { tone: 'late', text: t('attendance.today.state.started', { minutes: formatMinutes(minutes) }) }
        : { tone: 'muted', text: t('attendance.today.state.startsAt', { time: person.shiftStart }) }
    }
    case 'leave':
      return { tone: 'muted', text: t(person.halfDay ? 'attendance.today.state.halfLeave' : 'attendance.today.state.leave') }
    case 'rest':
      return { tone: 'muted', text: t('attendance.today.state.rest') }
    case 'offRoster':
      return {
        tone: 'late',
        text: person.lastOut
          ? t('attendance.today.state.offRosterRange', { from: formatTime(person.firstIn), to: formatTime(person.lastOut) })
          : t('attendance.today.state.offRosterSince', { time: formatTime(person.firstIn) }),
      }
  }
}

function PersonCard({ person, onOpenDay }: { person: TodayPerson; onOpenDay: (attendanceId: number) => void }) {
  const { t } = useTranslation()
  const chip = stateChip(person, t)
  const shift = shiftText(person, t)
  return (
    <div className="today-person">
      <div className="today-person-main">
        <span className="today-person-name">{person.name}</span>
        {shift && <span className="hint today-person-shift">{shift}</span>}
      </div>
      <div className="today-person-state">
        <span className={`badge badge--${chip.tone}`}>{chip.text}</span>
        {person.lateMinutes > 0 && (
          <span className="badge badge--late">{t('attendance.today.late', { minutes: formatMinutes(person.lateMinutes) })}</span>
        )}
        {person.onRestDay && <span className="badge badge--muted">{t('attendance.today.onRestDay')}</span>}
        {person.attendanceId !== null && (person.group === 'in' || person.group === 'left') && (
          <Button variant="subtle" size="compact-sm" onClick={() => onOpenDay(person.attendanceId as number)}>
            {t('attendance.today.view')}
          </Button>
        )}
      </div>
    </div>
  )
}
