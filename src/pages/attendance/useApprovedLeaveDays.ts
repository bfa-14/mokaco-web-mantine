import { useCallback, useEffect, useState } from 'react'
import { leaveLedgerService } from '../../services/hrService'
import type { LeaveDay } from '../../types/hr'

/**
 * THE SEAM between the roster and whatever the system believes "approved leave" is.
 *
 * WHY IT IS A HOOK AND NOT A CALL
 *   Leave has no proper home yet. workflow.LEAVE_REQUEST — a request with a real FromDate..ToDate
 *   to expand into days — belongs to the workflow stage and has NOT been built. Today the only
 *   source is hr.LEAVE_LEDGER: movement rows matched on a single EffectiveDate.
 *
 *   So the roster is deliberately NOT written against the ledger. It is written against this
 *   question — "which employee-days are on leave between these two dates?" — which stays true no
 *   matter what answers it. When LEAVE_REQUEST arrives, THIS FILE changes (and the stored
 *   procedure behind it). The roster page does not.
 *
 * KNOWN LIMITATION, INHERITED FROM THE LEDGER
 *   The ledger books leave as a movement on ONE date, with a number of days. A five-day holiday
 *   entered as a single row therefore reports as ONE leave day of 5.00 — not five days. This hook
 *   cannot fix that: the other four dates simply are not recorded anywhere. It is the single
 *   strongest argument for building LEAVE_REQUEST, and it is why `daysOnLeave` is surfaced rather
 *   than hidden — a caller can at least SEE that a day claims to be worth more than one.
 */
export interface ApprovedLeave {
  /** True when this employee is on approved leave that day. `date` may be 'yyyy-MM-dd' or a full timestamp. */
  isOnLeave: (employeeId: number, date: string) => boolean
  /** How much of the day is leave (1.00 whole, 0.50 half), or 0 when they are not on leave. */
  daysOnLeave: (employeeId: number, date: string) => number
  /** The raw rows, for a caller that wants to list them. */
  days: LeaveDay[]
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
 * Which employee-days are on approved leave between two dates.
 *
 * On failure this reports `error` and answers "nobody is on leave" — and that combination is
 * deliberate. Answering "everybody might be" would block the roster entirely; answering "nobody is"
 * silently would let somebody be scheduled over their holiday. So it fails OPEN but LOUDLY: the
 * caller is expected to show the error and let the user decide, not pretend leave was checked.
 */
export function useApprovedLeaveDays(
  fromDate: string,
  toDate: string,
): ApprovedLeave {
  const [days, setDays] = useState<LeaveDay[]>([])
  const [byKey, setByKey] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDays = useCallback(async (): Promise<{
    rows: LeaveDay[]
    failure: string | null
  }> => {
    try {
      return { rows: await leaveLedgerService.getLeaveDays(fromDate, toDate), failure: null }
    } catch (err) {
      return {
        rows: [],
        failure:
          err instanceof Error
            ? err.message
            : 'Approved leave could not be read.',
      }
    }
  }, [fromDate, toDate])

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
