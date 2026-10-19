/**
 * THE OVER-BALANCE WARNING SAYS WHAT THE SERVER WILL DO (QA3).
 *
 * usp_LeaveRequest_Create refuses a paid, accruing, non-discretionary leave beyond the balance LESS what the employee's
 * requests still waiting (Pending / On hold) were already promised -- unless the company allows a negative balance. The
 * form used to compare with the bare balance, so with a request already waiting it said nothing and the server then
 * refused. The working-days preview reports the promised days (pendingDays) and whether the rule applies to the type
 * (balanceEnforced); this decides the warning from them.
 *
 * Pure, no imports: run by `npm test` with nothing but Node.
 */
export interface OverBalanceInput {
  /** What the request will cost (the server's count), or null while the dates are incomplete. */
  days: number | null
  /** The all-time balance of the type, or null when it could not be read. */
  balance: number | null
  /** Days promised to requests of the type still waiting; null/absent from an older API = 0. */
  pendingDays?: number | null
  /** Whether the server refuses beyond the balance for this type; null/absent = not known, warn as before. */
  balanceEnforced?: boolean | null
}

export interface OverBalance {
  /** Show the warning. */
  over: boolean
  /** What is left once the pending requests are counted (null when the balance is unknown). */
  available: number | null
  /** The pending days counted (0 when none or unknown). */
  pending: number
}

/** Halves and tenths of days: keep the arithmetic exact enough to compare. */
const round2 = (n: number): number => Math.round(n * 100) / 100

export function overBalance(input: OverBalanceInput): OverBalance {
  const pending = Math.max(0, input.pendingDays ?? 0)
  if (input.days == null || input.balance == null) return { over: false, available: null, pending }
  const available = round2(input.balance - pending)
  if (input.balanceEnforced === false) return { over: false, available, pending }
  return { over: round2(input.days) > available, available, pending }
}
