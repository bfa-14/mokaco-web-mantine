/**
 * The small display pieces shared across the Attendance pages.
 *
 * Components only. The pure formatting helpers live in attendanceFormat.ts — a module that
 * exports both components and plain functions breaks Fast Refresh, so the two are kept apart.
 */

import { IconAlertTriangle } from '@tabler/icons-react'
import { t } from '../../i18n/t'
import { statusText } from './attendanceFormat'

/**
 * The day fraction as a bar, because 0.89 is not a number people read well — it is
 * "nearly a full day", and a bar says that instantly. The raw value is still shown beside
 * it for anyone who needs to reconcile against payroll.
 */
export function DayFractionBar({ value }: { value: number }) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100)

  return (
    <div className="frac" title={t('attendance.dayFractionTitle', { percent })}>
      <div className="frac-track">
        <div
          className={percent >= 100 ? 'frac-fill frac-fill--full' : 'frac-fill'}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="frac-value">{value.toFixed(2)}</span>
    </div>
  )
}

/** Present / Absent / RestDay / Leave, as a pill. */
export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'Present'
      ? 'badge--on'
      : status === 'Absent'
        ? 'badge--off'
        : 'badge--muted'

  return (
    <span className={`badge ${tone}`}>
      {/* An unknown status renders as its own code rather than as a missing-key placeholder.
          Shared with the grids' filter row via statusText, so the dropdown offers the same words. */}
      {statusText(status)}
    </span>
  )
}

/**
 * An anomaly marker. A warning ICON, not a red row: a screen where a quarter of the rows are
 * red stops meaning anything, and people learn to scroll straight past it.
 */
/**
 * @param reason Why this day was flagged, in words — "Punched in at 08:04, never punched out."
 *   Optional, and when it is given it REPLACES the generic tooltip rather than joining it: a
 *   reader hovering a warning wants the specific fault, not the category followed by the fault.
 *   Computed by the caller from row data it already holds, so this stays a pure presentation
 *   component and no grid row ever fetches anything to render its own flag.
 */
export function AnomalyIcon({ has, reason }: { has: boolean; reason?: string }) {
  if (!has) return null

  return (
    /* PORT: dx-icon-warning glyph → Tabler triangle; anomaly-icon class kept for the CSS color. */
    <IconAlertTriangle
      size={16}
      className="anomaly-icon"
      title={reason ?? t('attendance.anomalyTitle')}
      aria-label={reason ?? t('attendance.anomalyAria')}
    />
  )
}
