/**
 * ONE STEP FOR A MISSING PUNCH. A day with an In and no Out (or an Out and no In) is the commonest fix
 * there is; Daily attendance offers "Enter the missing time" on the row itself. The time is stored as a
 * Correct ruling on the day's MissingPunch anomaly (the same path as Anomalies > Correct time: the original
 * punch is kept, the day is re-derived, the anomaly is closed).
 *
 * Pure, no imports: `npm test` reads this file directly.
 */

/** Which punch is missing on a day, or null when it is not a plain one-side gap (odd punches in the middle). */
export function missingSide(record: { firstInUtc: string | null; lastOutUtc: string | null; hasAnomaly: boolean }): 'in' | 'out' | null {
  if (!record.hasAnomaly) return null
  if (record.firstInUtc && !record.lastOutUtc) return 'out'
  if (!record.firstInUtc && record.lastOutUtc) return 'in'
  return null
}

export interface MissingPunchAnomaly {
  anomalyId: number
  attendanceId: number
  type: string
  decision: string | null
  shiftStart: string | null
  shiftEnd: string | null
  punchIn: string | null
  punchOut: string | null
}

/** The day's missing-punch anomaly that can still be corrected (a corrected one is final). */
export function findMissingAnomaly<T extends MissingPunchAnomaly>(anomalies: T[], attendanceId: number): T | null {
  return (
    anomalies.find((a) => a.attendanceId === attendanceId && a.type === 'MissingPunch' && a.decision !== 'Corrected') ??
    null
  )
}

/**
 * What the time field opens on: the shift's time for the missing side (the most likely answer, and on the
 * work date), else the punch that IS there, so the date part at least is right.
 */
export function prefillTime(anomaly: MissingPunchAnomaly, side: 'in' | 'out'): string | null {
  return side === 'in' ? (anomaly.shiftStart ?? anomaly.punchOut) : (anomaly.shiftEnd ?? anomaly.punchIn)
}
