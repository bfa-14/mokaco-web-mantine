/**
 * WHICH BRANCH A MONTH-WIDE ROSTER ACTION WORKS ON (QA3 ROS-3, ROS-8, REL-16).
 *
 * "Copy previous month", "Apply weekly patterns" and "Re-derive month" write a whole branch-month. They
 * used to be sent with no branch at all and wrote every branch's month at once — a manager of one
 * branch overwriting the others'. The server now refuses them without a branch, so the page works out
 * the one branch here and switches the buttons off under "All branches".
 *
 * The gap banner counts the gaps of the branch on screen: the server answers for one branch by the
 * branch each employee belonged to ON the day (a transfer splits a month), and each gap says which.
 *
 * No imports but types, no Date: run by `npm test` with nothing but Node.
 */
import type { RosterGap } from '../../types/attendance'

export interface BranchChoice {
  branchId: number
  isActive: boolean
}

/**
 * The branch the month-wide actions work on: the branch filter; else, when there is only ONE active
 * branch (the filter is not even offered then), that branch; else none — "All branches".
 */
export function oneBranchOf(
  branchFilter: number | null,
  branches: readonly BranchChoice[],
): number | null {
  if (branchFilter != null) return branchFilter
  const active = branches.filter((b) => b.isActive)
  return active.length === 1 ? active[0].branchId : null
}

/**
 * The gaps the banner counts. Under "All branches", all of them. Under a branch filter, the gaps of
 * that branch's days — by the gap's own branch (the branch of the day). A gap from an older API that
 * does not say its branch falls back to the people on the grid, the page's earlier rule.
 */
export function gapsOfBranch(
  gaps: readonly RosterGap[],
  branchFilter: number | null,
  employeesOnGrid: ReadonlySet<number>,
): RosterGap[] {
  if (branchFilter == null) return [...gaps]
  return gaps.filter((gap) =>
    gap.branchId != null ? gap.branchId === branchFilter : employeesOnGrid.has(gap.employeeId),
  )
}

/**
 * Why "Re-derive month" is off, when it is. It derives the month's COMPLETED days — the 1st to
 * yesterday — so a month whose 1st is today or later has nothing to derive yet. `today` and the
 * period are 'yyyy-MM-dd' and 'yyyy-MM'; the server keeps Beirut's calendar either way.
 */
export function rederiveBlocked(
  branchId: number | null,
  period: string,
  today: string,
): 'branch' | 'notStarted' | null {
  if (branchId == null) return 'branch'
  if (`${period}-01` >= today.slice(0, 10)) return 'notStarted'
  return null
}
