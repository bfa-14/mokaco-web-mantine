/**
 * THE FIXED ROTATION's setup, pure: the list the drawer edits, what it proposes for somebody new, what stops it
 * from being saved, and the rule's days off for one week (so the manager sees what a line means before planning).
 *
 * The rule itself is the server's (RotationRule.cs, docs/AUTO_ROSTER.md §9); `daysOffInWeek` repeats only its
 * "days off" half, to show - the plan is always the server's. Weekdays are 0 = Monday … 6 = Sunday.
 *
 * No imports beyond types: `npm test` reads this file directly.
 */
import type { RosterRotation, RosterRotationMember } from '../../types/attendance'

export interface RotationLine {
  employeeId: number
  fullName: string
  position?: string | null
  group: number
  singleRestDay: number
  pairRestDay: number
  leadSlot: 'L1' | 'L2' | null
  /** Not stored yet: the values are a proposal the manager should check. */
  isNew: boolean
}

export type RotationProblem = 'start' | 'notMonday' | 'shifts' | 'sameShift' | 'empty' | 'twoL1' | 'twoL2'

const DAY = 86400000

function parse(day: string): number {
  return Date.parse(`${day.slice(0, 10)}T00:00:00Z`)
}

function format(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(day: string): number {
  return (new Date(parse(day)).getUTCDay() + 6) % 7
}

/** The Monday on or before a day. */
export function mondayOnOrBefore(day: string): string {
  return format(parse(day) - weekdayOf(day) * DAY)
}

const mod = (value: number, modulus: number) => ((value % modulus) + modulus) % modulus

/**
 * What somebody new on the list is proposed: the groups alternate down the list (so half the team is on its
 * two-day week while the other half is on its one-day week), and the days off are spread over the week. The pair
 * never starts on a Sunday: the rule keeps both days inside one Monday-Sunday week, so that pair is Monday AND
 * Sunday of the same week - two days off that are not next to each other.
 */
export function proposeLine(index: number): Pick<RotationLine, 'group' | 'singleRestDay' | 'pairRestDay' | 'leadSlot'> {
  return { group: index % 2, singleRestDay: mod(index * 3, 7), pairRestDay: mod(index * 2 + 5, 6), leadSlot: null }
}

/**
 * The list as the drawer opens it: the stored lines in their order (people who are still staff), then everybody
 * else on rotation with a proposal. Somebody off rotation is not on the list.
 */
export function rotationLines(
  staff: { employeeId: number; fullName: string; position?: string | null }[],
  stored: RosterRotationMember[],
  offRotation: ReadonlySet<number>,
): RotationLine[] {
  const byId = new Map(staff.map((s) => [s.employeeId, s]))
  const lines: RotationLine[] = []
  for (const m of [...stored].sort((a, b) => a.sortOrder - b.sortOrder || a.employeeId - b.employeeId)) {
    const person = byId.get(m.employeeId)
    if (!person || offRotation.has(m.employeeId)) continue
    lines.push({
      employeeId: m.employeeId,
      fullName: person.fullName,
      position: person.position,
      group: m.group === 1 ? 1 : 0,
      singleRestDay: mod(m.singleRestDay, 7),
      pairRestDay: mod(m.pairRestDay, 7),
      leadSlot: m.leadSlot === 'L1' || m.leadSlot === 'L2' ? m.leadSlot : null,
      isNew: false,
    })
  }
  const listed = new Set(lines.map((l) => l.employeeId))
  for (const person of staff) {
    if (listed.has(person.employeeId) || offRotation.has(person.employeeId)) continue
    lines.push({
      employeeId: person.employeeId,
      fullName: person.fullName,
      position: person.position,
      ...proposeLine(lines.length),
      isNew: true,
    })
  }
  return lines
}

/** A line moved one place up (-1) or down (+1); the list unchanged at either end. */
export function moveLine(lines: RotationLine[], index: number, delta: -1 | 1): RotationLine[] {
  const target = index + delta
  if (index < 0 || index >= lines.length || target < 0 || target >= lines.length) return lines
  const next = [...lines]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/** What stops the rotation from being saved, or null. */
export function rotationProblem(
  startDate: string | null,
  morningShiftId: number | null,
  eveningShiftId: number | null,
  lines: RotationLine[],
): RotationProblem | null {
  if (!startDate) return 'start'
  if (weekdayOf(startDate) !== 0) return 'notMonday'
  if (morningShiftId == null || eveningShiftId == null) return 'shifts'
  if (morningShiftId === eveningShiftId) return 'sameShift'
  if (lines.length === 0) return 'empty'
  if (lines.filter((l) => l.leadSlot === 'L1').length > 1) return 'twoL1'
  if (lines.filter((l) => l.leadSlot === 'L2').length > 1) return 'twoL2'
  return null
}

/** The rotation as the API takes it; the order of the list is the order of the rotation. */
export function rotationToSave(
  branchId: number,
  startDate: string,
  morningShiftId: number,
  eveningShiftId: number,
  lines: RotationLine[],
): RosterRotation {
  return {
    branchId,
    startDate,
    morningShiftId,
    eveningShiftId,
    members: lines.map((l, i) => ({
      employeeId: l.employeeId,
      group: l.group,
      singleRestDay: l.singleRestDay,
      pairRestDay: l.pairRestDay,
      leadSlot: l.leadSlot,
      sortOrder: i + 1,
    })),
  }
}

/** Everything the save would write, as one string: two equal strings are the same rotation. */
export function rotationKey(
  startDate: string | null,
  morningShiftId: number | null,
  eveningShiftId: number | null,
  lines: RotationLine[],
): string {
  return JSON.stringify([
    startDate,
    morningShiftId,
    eveningShiftId,
    lines.map((l) => [l.employeeId, l.group, l.singleRestDay, l.pairRestDay, l.leadSlot]),
  ])
}

/**
 * The weekdays (0 = Monday) a line is off in the week of `anyDay`, by the rule: two days when (week + group) is
 * even, one when odd, both moved two weekdays later every two weeks since the start date.
 */
export function daysOffInWeek(
  startDate: string,
  line: Pick<RotationLine, 'group' | 'singleRestDay' | 'pairRestDay'>,
  anyDay: string,
): number[] {
  const week = Math.floor((parse(mondayOnOrBefore(anyDay)) - parse(startDate)) / (7 * DAY))
  const shift = mod(2 * Math.floor(week / 2), 7)
  if (mod(week + line.group, 2) === 0) {
    return [mod(line.pairRestDay + shift, 7), mod(line.pairRestDay + 1 + shift, 7)].sort((a, b) => a - b)
  }
  return [mod(line.singleRestDay + shift, 7)]
}
