import type { QuarantineDismissRequest, QuarantinedDeviceUser } from '../../types/attendance'

/** The note is stored on every punch set aside (attendance.RAW_DEVICE_LOG.DismissNote, NVARCHAR(300)). */
export const DISMISS_NOTE_MAX = 300

/**
 * "Set aside" needs a REASON - whose PIN it is, or why it belongs to nobody - because the punches leave the queue that
 * payroll readiness counts. A blank or whitespace-only note sends nothing (null); a long one is cut to what is stored,
 * so the server never refuses the length.
 */
export function dismissRequestFor(row: Pick<QuarantinedDeviceUser, 'deviceId' | 'enrollPin'>, note: string): QuarantineDismissRequest | null {
  const reason = note.trim()
  if (!reason) return null
  return { deviceId: row.deviceId, enrollPin: row.enrollPin, note: reason.slice(0, DISMISS_NOTE_MAX) }
}
