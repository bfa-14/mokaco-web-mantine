import { useCallback, useEffect, useState } from 'react'
import { rosterService } from '../../services/attendanceService'
import type { RosterLeaveDay } from '../../types/attendance'

/**
 * THE SEAM between the roster and whatever the system believes "approved leave" is.
 *
 * WHY IT IS A HOOK AND NOT A CALL
 *   The roster is written against this question — "which employee-days are on approved leave between
 *   these two dates?" — and this file owns the answer. When the answer's source changed, only this
 *   file changed.
 *
 * WHERE THE ANSWER COMES FROM (QA3 ROS-4 / LEV-5)
 *   GET /api/roster/leave-days: the APPROVED leave requests, day by day — FromDate up to the day the
 *   approval covers (a partial approval keeps its first days), a half-day leave as 0.5 — for the
 *   branch each employee belonged to ON the day, and only the branches the caller may see. It used to
 *   be the leave LEDGER, which books a month of leave as one movement on one date ("one day worth
 *   5.00") and also holds the exit-permission minutes converted to leave, which are not days off.
 */
export interface ApprovedLeave {
  /** True when this employee is on approved leave that day. `date` may be 'yyyy-MM-dd' or a full timestamp. */
  isOnLeave: (employeeId: number, date: string) => boolean
  /** How much of the day is leave (1.00 whole, 0.50 half), or 0 when they are not on leave. */
  daysOnLeave: (employeeId: number, date: string) => number
  /** The raw rows, for a caller that wants to list them. */
  days: RosterLeaveDay[]
  loading: boolean
  /** Why leave could not be read, if it could not. NEVER swallowed — see below. */
  error: string | null
  reload: () => Promise<void>
}

/** Dates arrive as 'yyyy-MM-dd' from the calendar and '2026-06-02T00:00:00' from the API. One shape wins. */
function key(employeeId: number, date: string): string {
  return `${employeeId}|${date.slice(0, 10)}`
}

/**
 * Which employee-days are on approved leave between two dates — of one branch (`branchId`, by the
 * branch of the day) or of every branch the caller may see (null).
 *
 * On failure this reports `error` and answers "nobody is on leave" — and that combination is
 * deliberate. Answering "everybody might be" would block the roster entirely; answering "nobody is"
 * silently would hide that the overlay is missing. So it fails OPEN but LOUDLY: the caller is
 * expected to show the error, not pretend leave was read.
 */
export function useApprovedLeaveDays(
  fromDate: string,
  toDate: string,
  branchId: number | null = null,
): ApprovedLeave {
  const [days, setDays] = useState<RosterLeaveDay[]>([])
  const [byKey, setByKey] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDays = useCallback(async (): Promise<{
    rows: RosterLeaveDay[]
    failure: string | null
  }> => {
    try {
      return { rows: await rosterService.leaveDays(fromDate, toDate, branchId), failure: null }
    } catch (err) {
      return {
        rows: [],
        failure:
          err instanceof Error
            ? err.message
            : 'Approved leave could not be read.',
      }
    }
  }, [fromDate, toDate, branchId])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { rows, failure } = await fetchDays()
      if (cancelled) return

      setDays(rows)
      setByKey(new Map(rows.map((row) => [key(row.employeeId, row.date), row.daysOnLeave])))
      setError(failure)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [fetchDays])

  const reload = useCallback(async () => {
    const { rows, failure } = await fetchDays()
    setDays(rows)
    setByKey(new Map(rows.map((row) => [key(row.employeeId, row.date), row.daysOnLeave])))
    setError(failure)
  }, [fetchDays])

  return {
    isOnLeave: (employeeId, date) => byKey.has(key(employeeId, date)),
    daysOnLeave: (employeeId, date) => byKey.get(key(employeeId, date)) ?? 0,
    days,
    loading,
    error,
    reload,
  }
}
