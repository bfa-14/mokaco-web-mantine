/**
 * THE TODAY BOARD: who is at work, who has not arrived yet, who is off, and who punched without being
 * on today's roster. One list per question, built from four reads the page already makes (today's
 * roster rows, today's attendance days, today's approved leave, today's days that are not on the roster).
 *
 * Times are the terminal's wall clock (Beirut), like every punch, and "now" is Beirut's wall clock too,
 * so "shift started 25 min ago" means the same thing on the server, the machine and the phone.
 *
 * Pure, no imports: `npm test` reads this file directly.
 */

export type TodayGroup = 'notYet' | 'in' | 'left' | 'leave' | 'rest' | 'offRoster'

/** The order the lists are shown in: what needs a look first. */
export const TODAY_GROUPS: TodayGroup[] = ['notYet', 'in', 'left', 'offRoster', 'leave', 'rest']

export interface TodayRosterRow {
  employeeId: number
  fullName: string
  workDate: string
  isRestDay: boolean
  shiftName: string | null
  /** 'HH:mm:ss' */
  startTime: string | null
  endTime: string | null
}

export interface TodayRecord {
  attendanceId: number
  employeeId: number
  fullName: string
  workDate: string
  firstInUtc: string | null
  lastOutUtc: string | null
  hasAnomaly: boolean
  lateMinutes: number
  workedMinutes: number
  status: string
}

export interface TodayLeave {
  employeeId: number
  date: string
  daysOnLeave: number
}

export interface TodayOffRoster {
  employeeId: number
  employeeName: string
  workDate: string
  firstPunch: string
  lastPunch: string
  punchCount: number
  state: string
}

export interface TodayPerson {
  employeeId: number
  name: string
  group: TodayGroup
  shiftName: string | null
  /** 'HH:mm' */
  shiftStart: string | null
  shiftEnd: string | null
  firstIn: string | null
  lastOut: string | null
  lateMinutes: number
  workedMinutes: number
  /** Not yet: minutes since the shift started (positive) or until it starts (negative). */
  minutesFromStart: number | null
  /** Not yet, and the shift is already over. */
  shiftOver: boolean
  /** On leave for half of the day only. */
  halfDay: boolean
  /** Punched although the roster says rest day. */
  onRestDay: boolean
  punchCount: number
  attendanceId: number | null
}

export interface TodayBoard {
  groups: Record<TodayGroup, TodayPerson[]>
  arrived: number
  notYet: number
  off: number
  offRoster: number
}

/** Beirut's wall clock now, 'yyyy-MM-ddTHH:mm'. */
export function companyNow(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Beirut',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

const hhmm = (time: string | null) => (time ? time.slice(0, 5) : null)

/** Minutes from midnight of a 'HH:mm' or of the time part of 'yyyy-MM-ddTHH:mm[:ss]'. */
function minuteOfDay(value: string): number {
  const time = value.length > 8 ? value.slice(11, 16) : value.slice(0, 5)
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function blank(employeeId: number, name: string, group: TodayGroup): TodayPerson {
  return {
    employeeId,
    name,
    group,
    shiftName: null,
    shiftStart: null,
    shiftEnd: null,
    firstIn: null,
    lastOut: null,
    lateMinutes: 0,
    workedMinutes: 0,
    minutesFromStart: null,
    shiftOver: false,
    halfDay: false,
    onRestDay: false,
    punchCount: 0,
    attendanceId: null,
  }
}

/**
 * At work or gone: an In and no Out, or Ins and Outs that do not pair yet (back from a break), is "in";
 * a day that pairs up is "left".
 */
function presence(record: TodayRecord): 'in' | 'left' {
  if (!record.lastOutUtc) return 'in'
  return record.hasAnomaly ? 'in' : 'left'
}

export function buildTodayBoard(input: {
  today: string
  /** Beirut wall clock, 'yyyy-MM-ddTHH:mm' (companyNow()). */
  now: string
  roster: TodayRosterRow[]
  records: TodayRecord[]
  leave: TodayLeave[]
  offRoster: TodayOffRoster[]
}): TodayBoard {
  const { today, now } = input
  const isToday = (date: string) => date.slice(0, 10) === today
  const roster = input.roster.filter((r) => isToday(r.workDate))
  const records = new Map(input.records.filter((r) => isToday(r.workDate)).map((r) => [r.employeeId, r]))
  const leave = new Map<number, number>()
  for (const l of input.leave) if (isToday(l.date) && l.daysOnLeave > 0) leave.set(l.employeeId, l.daysOnLeave)

  const people: TodayPerson[] = []
  const seen = new Set<number>()
  const nowMinute = now.slice(0, 10) === today ? minuteOfDay(now) : now.slice(0, 10) > today ? 24 * 60 : 0

  for (const row of roster) {
    if (seen.has(row.employeeId)) continue
    seen.add(row.employeeId)
    const record = records.get(row.employeeId)
    const shiftStart = hhmm(row.startTime)
    const shiftEnd = hhmm(row.endTime)

    if (record?.firstInUtc) {
      const person = blank(row.employeeId, row.fullName, presence(record))
      Object.assign(person, {
        shiftName: row.shiftName,
        shiftStart,
        shiftEnd,
        firstIn: record.firstInUtc,
        lastOut: record.lastOutUtc,
        lateMinutes: record.lateMinutes,
        workedMinutes: record.workedMinutes,
        onRestDay: row.isRestDay,
        attendanceId: record.attendanceId,
      })
      people.push(person)
      continue
    }

    const days = leave.get(row.employeeId)
    if (days !== undefined) {
      const person = blank(row.employeeId, row.fullName, 'leave')
      person.halfDay = days < 1
      person.shiftName = row.shiftName
      person.shiftStart = shiftStart
      person.shiftEnd = shiftEnd
      people.push(person)
      continue
    }

    if (row.isRestDay || !shiftStart) {
      people.push(blank(row.employeeId, row.fullName, 'rest'))
      continue
    }

    const person = blank(row.employeeId, row.fullName, 'notYet')
    person.shiftName = row.shiftName
    person.shiftStart = shiftStart
    person.shiftEnd = shiftEnd
    person.attendanceId = record?.attendanceId ?? null
    person.minutesFromStart = nowMinute - minuteOfDay(shiftStart)
    if (shiftEnd) {
      const end = minuteOfDay(shiftEnd)
      const start = minuteOfDay(shiftStart)
      // An overnight shift ends tomorrow: it is never over today.
      person.shiftOver = end > start && nowMinute >= end
    }
    people.push(person)
  }

  // Days with punches and no roster row of today (a month that is not approved yet has days like that).
  for (const record of records.values()) {
    if (seen.has(record.employeeId) || !record.firstInUtc) continue
    seen.add(record.employeeId)
    const person = blank(record.employeeId, record.fullName, presence(record))
    person.firstIn = record.firstInUtc
    person.lastOut = record.lastOutUtc
    person.lateMinutes = record.lateMinutes
    person.workedMinutes = record.workedMinutes
    person.attendanceId = record.attendanceId
    people.push(person)
  }

  for (const day of input.offRoster) {
    if (!isToday(day.workDate) || day.state !== 'Open' || seen.has(day.employeeId)) continue
    seen.add(day.employeeId)
    const person = blank(day.employeeId, day.employeeName, 'offRoster')
    person.firstIn = day.firstPunch
    person.lastOut = day.punchCount > 1 ? day.lastPunch : null
    person.punchCount = day.punchCount
    people.push(person)
  }

  const groups = Object.fromEntries(TODAY_GROUPS.map((g) => [g, [] as TodayPerson[]])) as Record<
    TodayGroup,
    TodayPerson[]
  >
  for (const person of people) groups[person.group].push(person)

  const byName = (a: TodayPerson, b: TodayPerson) => a.name.localeCompare(b.name)
  // Not yet: the longest overdue first, then the next to start.
  groups.notYet.sort((a, b) => (b.minutesFromStart ?? 0) - (a.minutesFromStart ?? 0) || byName(a, b))
  groups.in.sort((a, b) => (a.firstIn ?? '').localeCompare(b.firstIn ?? '') || byName(a, b))
  groups.left.sort((a, b) => (b.lastOut ?? '').localeCompare(a.lastOut ?? '') || byName(a, b))
  groups.offRoster.sort((a, b) => (a.firstIn ?? '').localeCompare(b.firstIn ?? '') || byName(a, b))
  groups.leave.sort(byName)
  groups.rest.sort(byName)

  return {
    groups,
    arrived: groups.in.length + groups.left.length,
    notYet: groups.notYet.length,
    off: groups.leave.length + groups.rest.length,
    offRoster: groups.offRoster.length,
  }
}
