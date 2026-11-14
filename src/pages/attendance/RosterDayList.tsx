import { ActionIcon, Button } from '@mantine/core'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { t } from '../../i18n/t'
import { useLanguage } from '../../i18n/useLanguage'
import { formatDayLabel } from './attendanceFormat'

export interface RosterDayCell {
  /** What the person is planned to do that day, in words ("Morning 08:00–16:00", "Rest day"). */
  label: string
  tone: 'work' | 'rest' | 'leave' | 'none'
  /** A small extra line: a public holiday, a draft not saved yet. */
  note?: string | null
}

/**
 * THE ROSTER BY DAY, for a phone: a strip to move between days of the month, then one large row per
 * person with that day's plan. A tap opens the same "set the day" dialog as a tap on the month grid,
 * so every rule (locks, approval, pins) stays where it is.
 */
export function RosterDayList({
  employees,
  days,
  date,
  today,
  onDateChange,
  cellOf,
  onPick,
  editable,
}: {
  employees: { employeeId: number; fullName: string }[]
  /** The month's days, 'yyyy-MM-dd'. */
  days: string[]
  date: string
  today: string
  onDateChange: (date: string) => void
  cellOf: (employeeId: number, date: string) => RosterDayCell
  onPick: (employeeId: number, date: string) => void
  editable: boolean
}) {
  const { isRtl } = useLanguage()
  const index = Math.max(0, days.indexOf(date))
  const prev = index > 0 ? days[index - 1] : null
  const next = index < days.length - 1 ? days[index + 1] : null
  const onDuty = employees.filter((e) => cellOf(e.employeeId, date).tone === 'work').length
  const Back = isRtl ? IconChevronRight : IconChevronLeft
  const Forward = isRtl ? IconChevronLeft : IconChevronRight

  return (
    <div className="card roster-day">
      <div className="roster-day-strip">
        <ActionIcon
          variant="default"
          size="lg"
          disabled={!prev}
          aria-label={t('attendance.rosterDay.previous')}
          onClick={() => prev && onDateChange(prev)}
        >
          <Back size={18} />
        </ActionIcon>
        <div className="roster-day-date">
          <span className="roster-day-date-label">{formatDayLabel(date)}</span>
          {date === today && <span className="badge badge--on">{t('attendance.daily.today')}</span>}
        </div>
        <ActionIcon
          variant="default"
          size="lg"
          disabled={!next}
          aria-label={t('attendance.rosterDay.next')}
          onClick={() => next && onDateChange(next)}
        >
          <Forward size={18} />
        </ActionIcon>
      </div>
      {days.includes(today) && date !== today && (
        <Button variant="subtle" size="compact-sm" onClick={() => onDateChange(today)}>
          {t('attendance.rosterDay.goToday')}
        </Button>
      )}

      <div className="roster-day-list">
        {employees.map((employee) => {
          const cell = cellOf(employee.employeeId, date)
          return (
            <button
              key={employee.employeeId}
              type="button"
              className={`roster-day-row roster-day-row--${cell.tone}`}
              disabled={!editable}
              onClick={() => onPick(employee.employeeId, date)}
            >
              <span className="roster-day-name">{employee.fullName}</span>
              <span className="roster-day-plan">{cell.label}</span>
              {cell.note && <span className="hint roster-day-note">{cell.note}</span>}
            </button>
          )
        })}
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>
        {t('attendance.rosterDay.onDuty', { count: onDuty, total: employees.length })}
        {editable ? ` ${t('attendance.rosterDay.tapHint')}` : ''}
      </p>
    </div>
  )
}
