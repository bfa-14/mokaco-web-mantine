/**
 * DAILY ATTENDANCE, FASTER: the quick filters above the Days grid, the period shortcuts, and the export of
 * what is on screen. Pure: `npm test` reads this file directly.
 */
import { dayProgress, isOpenAnomaly } from './dayProgress.ts'

export interface FilterableDay {
  workDate: string
  firstInUtc: string | null
  lastOutUtc: string | null
  hasAnomaly: boolean
  status: string
  lateMinutes: number
  shortfallMinutes: number
  isFullDay: boolean
  overtimeMinutes: number
  isManual: boolean
}

export type QuickFilter = 'late' | 'short' | 'absent' | 'missing' | 'inProgress' | 'overtime' | 'manual' | 'off'

export const QUICK_FILTERS: QuickFilter[] = ['late', 'short', 'absent', 'missing', 'inProgress', 'overtime', 'manual', 'off']

/** Does a day answer this question? `today` is the company's day: today's open day is in progress, not missing. */
export function matchesQuickFilter(day: FilterableDay, filter: QuickFilter, today: string): boolean {
  const inProgress = dayProgress(day, today) !== null
  switch (filter) {
    case 'late':
      return day.lateMinutes > 0
    case 'short':
      return day.status === 'Present' && !day.isFullDay && day.shortfallMinutes > 0 && !inProgress
    case 'absent':
      return day.status === 'Absent'
    case 'missing':
      return isOpenAnomaly(day, today)
    case 'inProgress':
      return inProgress
    case 'overtime':
      return day.overtimeMinutes > 0
    case 'manual':
      return day.isManual
    case 'off':
      return day.status === 'RestDay' || day.status === 'Leave' || day.status === 'Holiday'
  }
}

/** The days that answer ANY of the chosen questions; no choice = every day. */
export function applyQuickFilters<T extends FilterableDay>(days: T[], chosen: QuickFilter[], today: string): T[] {
  if (chosen.length === 0) return days
  return days.filter((day) => chosen.some((filter) => matchesQuickFilter(day, filter, today)))
}

/** How many days of the loaded period answer each question (the number on each chip). */
export function quickFilterCounts(days: FilterableDay[], today: string): Record<QuickFilter, number> {
  const counts = Object.fromEntries(QUICK_FILTERS.map((f) => [f, 0])) as Record<QuickFilter, number>
  for (const day of days) for (const f of QUICK_FILTERS) if (matchesQuickFilter(day, f, today)) counts[f]++
  return counts
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const at = (day: string) => new Date(`${day}T00:00:00Z`)

/** The period shortcuts, from the company's today ('yyyy-MM-dd'). A week starts on Monday, as on the roster. */
export function periodShortcut(kind: 'today' | 'yesterday' | 'week' | 'month', today: string): { from: string; to: string } {
  const d = at(today)
  switch (kind) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      d.setUTCDate(d.getUTCDate() - 1)
      return { from: iso(d), to: iso(d) }
    }
    case 'week': {
      const back = (d.getUTCDay() + 6) % 7
      const start = at(today)
      start.setUTCDate(start.getUTCDate() - back)
      return { from: iso(start), to: today }
    }
    case 'month': {
      const start = `${today.slice(0, 8)}01`
      const end = at(start)
      end.setUTCMonth(end.getUTCMonth() + 1)
      end.setUTCDate(0)
      return { from: start, to: iso(end) }
    }
  }
}

/**
 * A CSV that Excel opens correctly: a byte-order mark (Arabic names), CRLF line ends, every text field
 * quoted, numbers left as numbers.
 */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return ''
    if (typeof value === 'number') return String(value)
    return `"${value.replace(/"/g, '""')}"`
  }
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** Minutes as h:mm, for the column beside the plain number. */
export function hhmmOf(minutes: number): string {
  const sign = minutes < 0 ? '-' : ''
  const m = Math.abs(Math.round(minutes))
  return `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}
