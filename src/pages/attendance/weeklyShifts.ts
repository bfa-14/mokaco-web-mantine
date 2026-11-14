/**
 * THE WEEKLY SHIFTS POSTER: the roster of a branch over a few days, one column per shift and one row per day, the
 * names of who works each shift in the cell. Built from the roster rows the page already reads; approved leave
 * outranks the shift (as on the roster grid), so somebody on leave is not printed as working. A day nobody works is
 * an OFF row.
 *
 * Pure, no imports: `npm test` reads this file directly.
 */

export interface WeeklyAssignment {
  employeeId: number
  fullName: string
  workDate: string
  isRestDay: boolean
  shiftId: number | null
  shiftName: string | null
  /** 'HH:mm:ss' */
  startTime: string | null
  endTime: string | null
}

export interface WeeklyLeave {
  employeeId: number
  date: string
  daysOnLeave: number
}

export interface WeeklyColumn {
  shiftId: number
  name: string
  /** 'HH:mm' */
  start: string
  end: string
}

export interface WeeklyRow {
  /** 'yyyy-MM-dd' */
  date: string
  /** shiftId -> names, in the order they are printed */
  cells: Record<number, string[]>
  /** Nobody works this day (in the shifts shown). */
  off: boolean
}

export interface WeeklyPoster {
  columns: WeeklyColumn[]
  rows: WeeklyRow[]
}

/** Every day from `from` to `to` ('yyyy-MM-dd'), in order. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (d <= end && out.length < 62) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/** The Monday of the week holding `day`. */
export function weekStart(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** '07:00:00' -> '7:00 AM'; '14:00' -> '2:00 PM'. */
export function clock12(time: string | null | undefined): string {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

/**
 * The poster. `onlyShifts` = the shift ids to show (empty = every shift somebody works in the period).
 * `firstNames` prints "Rami" instead of "Rami Abi Haydar" (when two people share a first name, both keep the
 * full name so the poster stays unambiguous).
 */
export function buildWeeklyPoster(input: {
  days: string[]
  assignments: WeeklyAssignment[]
  leave: WeeklyLeave[]
  onlyShifts?: number[]
  firstNames?: boolean
}): WeeklyPoster {
  const onLeave = new Set(input.leave.filter((l) => l.daysOnLeave >= 1).map((l) => `${l.employeeId}|${l.date.slice(0, 10)}`))
  const inPeriod = new Set(input.days)
  const working = input.assignments.filter(
    (a) =>
      !a.isRestDay &&
      a.shiftId != null &&
      inPeriod.has(a.workDate.slice(0, 10)) &&
      !onLeave.has(`${a.employeeId}|${a.workDate.slice(0, 10)}`),
  )

  const byShift = new Map<number, WeeklyColumn>()
  for (const a of working) {
    if (a.shiftId == null || byShift.has(a.shiftId)) continue
    byShift.set(a.shiftId, {
      shiftId: a.shiftId,
      name: a.shiftName ?? '',
      start: (a.startTime ?? '').slice(0, 5),
      end: (a.endTime ?? '').slice(0, 5),
    })
  }
  const wanted = input.onlyShifts && input.onlyShifts.length > 0 ? new Set(input.onlyShifts) : null
  const columns = [...byShift.values()]
    .filter((c) => !wanted || wanted.has(c.shiftId))
    .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name))

  // First names, unless two different people share one.
  const firstOf = (name: string) => name.trim().split(/\s+/)[0]
  const firstCount = new Map<string, Set<number>>()
  for (const a of working) {
    const f = firstOf(a.fullName)
    firstCount.set(f, (firstCount.get(f) ?? new Set()).add(a.employeeId))
  }
  const label = (a: WeeklyAssignment) =>
    input.firstNames && (firstCount.get(firstOf(a.fullName))?.size ?? 0) === 1 ? firstOf(a.fullName) : a.fullName

  const rows = input.days.map((date) => {
    const cells: Record<number, string[]> = {}
    for (const c of columns) {
      cells[c.shiftId] = working
        .filter((a) => a.shiftId === c.shiftId && a.workDate.slice(0, 10) === date)
        .sort((x, y) => x.fullName.localeCompare(y.fullName))
        .map(label)
    }
    return { date, cells, off: columns.every((c) => cells[c.shiftId].length === 0) }
  })
  return { columns, rows }
}
