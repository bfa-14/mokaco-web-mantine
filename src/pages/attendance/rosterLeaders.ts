/**
 * THE SHIFT LEADERS of a branch, pure: who the drawer's picker offers, whether the picker differs from what is stored,
 * and the rotation list's leads that count as leaders anyway (script 123). The planner keeps every leader on a
 * different shift of the day - the branch's own list and the rotation's Lead 1 / Lead 2 alike.
 *
 * No imports beyond types: `npm test` reads this file directly.
 */
import type { RosterLeader, RosterLeaderCandidate } from '../../types/attendance'

export interface LeaderOption {
  value: string
  label: string
}

/**
 * What the picker offers: the people who may be ADDED - the API's candidates, the branch's people today who still work
 * here, exactly whom a save accepts - the month's people first in their order, then the other candidates; then anybody
 * already on the branch's list who is not among them (moved to another branch, say), so a stored leader is always
 * shown and can be removed. Somebody who worked here earlier in the month and has moved, or who only joins later in
 * it, is not offered: the save would refuse them. An older API sends no candidates: the month's people stand in.
 */
export function leaderOptions(
  staff: { employeeId: number; fullName: string }[],
  leaders: RosterLeader[],
  candidates?: RosterLeaderCandidate[] | null,
): LeaderOption[] {
  const pool = candidates ?? staff
  const mayAdd = new Set(pool.map((c) => c.employeeId))
  const options: LeaderOption[] = []
  const listed = new Set<number>()
  const add = (employeeId: number, fullName: string) => {
    if (listed.has(employeeId)) return
    options.push({ value: String(employeeId), label: fullName })
    listed.add(employeeId)
  }
  for (const s of staff) if (mayAdd.has(s.employeeId)) add(s.employeeId, s.fullName)
  for (const c of pool) add(c.employeeId, c.fullName)
  for (const leader of leaders) if (leader.isStored) add(leader.employeeId, leader.fullName)
  return options
}

/** The picker's value as the ids to send: each person once, in the order picked. */
export function leaderIds(values: string[]): number[] {
  const ids: number[] = []
  for (const value of values) {
    const id = Number(value)
    if (Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/** The same people, whatever the order: a pick taken back is no change. */
export function sameLeaders(a: number[], b: number[]): boolean {
  const left = new Set(a)
  const right = new Set(b)
  return left.size === right.size && [...left].every((id) => right.has(id))
}

/**
 * The code the API sends beside its 503 while the shift leaders list is not there yet (the update that adds it is still
 * to be applied on the server). A 503 alone is not enough: the database being too slow to answer is one as well.
 */
export const LEADERS_NOT_READY = 'leaders_not_ready'

/**
 * Whether a refused leaders call is that answer, from the body the API sent (ApiError.data), so the section says it in
 * the reader's language instead of printing the server's English sentence.
 */
export function leadersNotReady(body: unknown): boolean {
  return body != null && typeof body === 'object' && (body as { code?: unknown }).code === LEADERS_NOT_READY
}

/** The code the API sends beside a save refused because somebody on the list is not one of the branch's people today. */
export const LEADER_NOT_IN_BRANCH = 'leader_not_in_branch'

/**
 * The person a refused save names as not in the branch, from the body the API sent (ApiError.data), so the section says
 * it in the reader's language; null for any other answer.
 */
export function leaderNotInBranch(body: unknown): string | null {
  if (body == null || typeof body !== 'object') return null
  const { code, name } = body as { code?: unknown; name?: unknown }
  return code === LEADER_NOT_IN_BRANCH && typeof name === 'string' && name.trim() !== '' ? name : null
}

/** The rotation list's leads, Lead 1 first: they are leaders whatever the picker says. */
export function rotationLeads(leaders: RosterLeader[]): RosterLeader[] {
  return leaders
    .filter((l) => l.leadSlot === 'L1' || l.leadSlot === 'L2')
    .sort((a, b) => (a.leadSlot ?? '').localeCompare(b.leadSlot ?? '') || a.fullName.localeCompare(b.fullName))
}
