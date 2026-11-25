import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { currentLocale } from '../../i18n'
import { formatMinutes } from './attendanceFormat'
import { changeLogDay, shiftChangeLine, shiftChangeNote } from './shiftChangeWords'
import type { ChangeLogWords } from './shiftChangeWords'
import type { ShiftChange } from '../../types/attendance'

/**
 * The change log of one shift (script 122), newest first: every change, who made it, the before and the after, in
 * plain words. Read-only — the log is written by the database and kept for good. Shown in the Edit dialog and in the
 * History window that people who can only read the shifts open.
 */
export function ShiftChangeLog({ changes, error }: { changes: ShiftChange[] | null; error: string | null }) {
  const { t } = useTranslation()
  const words = useMemo<ChangeLogWords>(() => {
    const locale = currentLocale()
    return {
      t: (key, options) => t(key, options ?? {}),
      day: (iso) => changeLogDay(iso, locale),
      minutes: (m) => formatMinutes(m),
    }
  }, [t])

  if (!changes && !error) return null
  return (
    <div className="form-field">
      <span className="form-label">{t('attendance.shiftsPage.changeLog.title')}</span>
      <p className="hint" style={{ marginTop: 0 }}>
        {t('attendance.shiftsPage.changeLog.hint')}
      </p>
      {error && <p className="hint">{error}</p>}
      {changes && changes.length === 0 && <p className="hint">{t('attendance.shiftsPage.changeLog.empty')}</p>}
      {changes && changes.length > 0 && (
        <ul className="shift-change-list">
          {changes.map((change) => {
            const note = shiftChangeNote(change, words)
            return (
              <li
                key={change.shiftChangeId}
                className={change.action === 'DaysNotRederived' ? 'shift-change-row shift-change-row--warn' : 'shift-change-row'}
              >
                <div>{shiftChangeLine(change, words)}</div>
                {note && <div className="shift-change-note">{note}</div>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
