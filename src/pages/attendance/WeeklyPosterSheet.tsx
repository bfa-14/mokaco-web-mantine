import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { BrandWordmark } from '../../components/Brand'
import { formatDayLabel } from './attendanceFormat'
import { clock12 } from './weeklyShifts'
import type { WeeklyPoster } from './weeklyShifts'
import './weeklyShifts.css'

/**
 * A4 with no margin, only while a poster is on screen: the stylesheets of other pages (reports, bookings, requests)
 * stay loaded once visited and give @page 14-15mm margins, which would frame the poster in white. A rule in a
 * stylesheet would outlive the page the same way, so it is a <style> the sheet renders and takes away.
 */
const PRINT_PAGE = '@page { size: A4 portrait; margin: 0 !important; }'

/** 'yyyy-MM-dd' -> ISO weekday 1..7, the keys of common.weekday. */
function isoWeekday(day: string): number {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

/**
 * THE WEEKLY SHIFTS POSTER: one column per shift, one row per day, OFF for a day nobody works. Drawn on screen as a
 * page-sized card and, for the printer, as a copy at the top of the document (outside the app layout) that
 * window.print() puts alone on one full-bleed A4 sheet. Used by Attendance > Weekly shifts (any branch, HR) and by
 * My branch's shifts (the employee's own branch).
 */
export function WeeklyPosterSheet({
  poster,
  branchName,
  from,
  to,
  isWeek,
  note,
}: {
  poster: WeeklyPoster
  branchName: string
  from: string
  to: string
  /** Monday to Sunday: titled "Weekly Shifts" and the rows carry no dates. */
  isWeek: boolean
  note: string
}) {
  const { t } = useTranslation()
  const dayCell = (date: string) => (
    <>
      {t(`common.weekday.${isoWeekday(date)}`)}
      {!isWeek && <span className="ws-date">{formatDayLabel(date)}</span>}
    </>
  )

  const sheet = (
    <div className="ws-poster">
      <header className="ws-head">
        <BrandWordmark className="ws-logo" />
        <span className="ws-branch">{branchName.toUpperCase().replace(/\s*-\s*/g, ' · ')}</span>
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
                      <td>{dayCell(row.date)}</td>
                      <td colSpan={poster.columns.length}>{t('attendance.weekly.off')}</td>
                    </tr>
                  ) : (
                    <tr key={row.date}>
                      <td className="ws-day">{dayCell(row.date)}</td>
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
  )

  return (
    <>
      <style>{PRINT_PAGE}</style>
      <div className="ws-print-root">{sheet}</div>
      {/* Printed from a copy at the top of the page, outside the app layout: one clean A4 sheet. */}
      {createPortal(<div className="ws-print-only">{sheet}</div>, document.body)}
    </>
  )
}
