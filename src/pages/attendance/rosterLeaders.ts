/**
 * THE SHIFT LEADERS of a branch, pure: who the drawer's picker offers, whether the picker differs from what is stored,
 * and the rotation list's leads that count as leaders anyway (script 123). The planner keeps every leader on a
 * different shift of the day - the branch's own list and the rotation's Lead 1 / Lead 2 alike.
 *
 * No imports beyond types: `npm test` reads this file directly.
 */
import type { RosterLeader } from '../../types/attendance'

export interface LeaderOption {
  value: string
  label: string
}

/**
 * What the picker offers: the people of the month on screen, in their order, then anybody already on the branch's
 * list who is not among them (moved to another branch, say), so a stored leader is always shown and can be removed.
 */
export function leaderOptions(
  staff: { employeeId: number; fullName: string }[],
  leaders: RosterLeader[],
): LeaderOption[] {
  const options = staff.map((s) => ({ value: String(s.employeeId), label: s.fullName }))
  const listed = new Set(staff.map((s) => s.employeeId))
  for (const leader of leaders) {
    if (leader.isStored && !listed.has(leader.employeeId)) {
      options.push({ value: String(leader.employeeId), label: leader.fullName })
      listed.add(leader.employeeId)
    }
  }
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

/** The rotation list's leads, Lead 1 first: they are leaders whatever the picker says. */
export function rotationLeads(leaders: RosterLeader[]): RosterLeader[] {
  return leaders
    .filter((l) => l.leadSlot === 'L1' || l.leadSlot === 'L2')
    .sort((a, b) => (a.leadSlot ?? '').localeCompare(b.leadSlot ?? '') || a.fullName.localeCompare(b.fullName))
}
