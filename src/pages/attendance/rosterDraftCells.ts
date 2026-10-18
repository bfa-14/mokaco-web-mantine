/**
 * The auto-roster draft's cells, as pure functions: what a hand edit does to a day, which days a
 * save sends, and which days the saved roster has moved under since the preview.
 *
 * Kept apart from useRosterDraft (the React state around them) for the same reason rosterCounters
 * is: `npm test` runs them with nothing but Node, so no imports but types.
 */
import type { AutoRosterCellExpected, AutoRosterDraftCell } from '../../types/attendance'

/** The same key as RosterPage's cellKey: employee and 'yyyy-MM-dd', so a draft cell and a saved row meet. */
export function draftKey(employeeId: number, workDate: string): string {
  return `${employeeId}|${workDate.slice(0, 10)}`
}

/** One employee-day of the draft as the grid draws it. */
export interface DraftCell {
  employeeId: number
  /** 'yyyy-MM-dd'. */
  workDate: string
  /** work · rest · none. */
  state: string
  shiftId: number | null
  /** planned · fact · locked · pinned · leave · holiday · draft · ghost · outside. */
  origin: string
  /** insert · update · delete · unchanged · kept — against `expected`. */
  change: string
  reasonCode: string | null
  reasonArgs: string | null
  expected: AutoRosterCellExpected
  /** Set by the manager in this draft. */
  edited: boolean
  /** "Keep when regenerating" as edited here; null = as saved. */
  isPinned: boolean | null
  /**
   * The state the preview gave the day. The preview's on-duty count knows which leave is a half
   * day and the page does not, so the footer moves that count by the edits made since rather than
   * counting again.
   */
  previewState: string
  /** The shift the preview gave the day — the same, for the footer's count per shift (D16). */
  previewShiftId: number | null
}

/** What the Set-day dialog applies to the draft. */
export interface DraftEdit {
  shiftId: number | null
  isRestDay: boolean
  /** null = leave the pin as it stands: as saved, or as an earlier edit in this draft set it. */
  isPinned: boolean | null
}

/** A saved roster row, as far as the draft compares it. */
export interface SavedRow {
  shiftId: number | null
  isRestDay: boolean
}

/**
 * Cells the draft may not change: the server would refuse them (locked, pinned — unpin it first),
 * a row inside a leave is frozen (D5), and the window's days outside the month are never saved.
 */
const FROZEN_ORIGINS = new Set(['locked', 'pinned', 'leave', 'ghost', 'outside'])

export function isFrozenOrigin(origin: string): boolean {
  return FROZEN_ORIGINS.has(origin)
}

/** What saving a cell would do to the row the preview found. */
export function changeOf(expected: AutoRosterCellExpected, state: string, shiftId: number | null): string {
  if (state === 'none') return expected.exists ? 'delete' : 'unchanged'
  if (!expected.exists) return 'insert'
  const same =
    state === 'rest'
      ? expected.isRestDay === true
      : expected.isRestDay !== true && (expected.shiftId ?? null) === shiftId
  return same ? 'unchanged' : 'update'
}

export function editsToDraftCells(edits: Map<string, DraftEdit>): AutoRosterDraftCell[] {
  return [...edits.entries()].map(([key, edit]) => {
    const [employeeId, workDate] = key.split('|')
    return {
      employeeId: Number(employeeId),
      workDate,
      shiftId: edit.isRestDay ? null : edit.shiftId,
      isRestDay: edit.isRestDay,
      isPinned: edit.isPinned,
    }
  })
}

/**
 * The day after a hand edit. A null pin keeps the cell's: a multi-day selection opens with the pin
 * box untouched, and applying it must not silently drop a pin set on one of those days earlier.
 */
export function applyEditTo(cell: DraftCell, edit: DraftEdit): DraftCell {
  const state = edit.isRestDay ? 'rest' : 'work'
  const shiftId = edit.isRestDay ? null : edit.shiftId
  return {
    ...cell,
    state,
    shiftId,
    origin: 'draft',
    change: changeOf(cell.expected, state, shiftId),
    reasonCode: null,
    reasonArgs: null,
    edited: true,
    isPinned: edit.isPinned ?? cell.isPinned,
  }
}

/** A day's new edit over its earlier one in the same draft: the same rule for the pin as applyEditTo. */
export function mergeEdit(previous: DraftEdit | undefined, edit: DraftEdit): DraftEdit {
  return { ...edit, isPinned: edit.isPinned ?? previous?.isPinned ?? null }
}

/**
 * Whether Save sends this cell: a month day the plan may write. "kept" cells (facts, locked,
 * pinned, an existing row inside a leave) are not sent — unless the manager edited a fact, which
 * makes it theirs — and a day that stays without a row has nothing to send.
 */
export function isSentCell(cell: DraftCell, monthFrom: string, monthTo: string): boolean {
  if (cell.workDate < monthFrom || cell.workDate > monthTo) return false
  if (cell.change === 'kept' && !cell.edited) return false
  return !(cell.state === 'none' && !cell.expected.exists)
}

/** Whether a saved row (or its absence) is the row the preview expected. */
export function rowMatches(expected: AutoRosterCellExpected, row: SavedRow | undefined): boolean {
  if (!row) return !expected.exists
  if (!expected.exists) return false
  if (row.isRestDay) return expected.isRestDay === true
  return expected.isRestDay !== true && (expected.shiftId ?? null) === (row.shiftId ?? null)
}

function sameRow(a: SavedRow | undefined, b: SavedRow | undefined): boolean {
  if (!a || !b) return a === b
  return a.isRestDay === b.isRestDay && (a.isRestDay || (a.shiftId ?? null) === (b.shiftId ?? null))
}

/**
 * HOW MANY DAYS THE SAVED ROSTER MOVED UNDER THE DRAFT, as the page's re-reads show it.
 *
 * A day counts when the row read now is not the one the preview expected AND is not the one the
 * page held when the preview was asked for. The second half is what makes this a fact about the
 * roster rather than about the page: a re-read that only follows the page's own write (saving the
 * minimums notifies 'attendance' like any roster write) finds the same rows and counts nothing,
 * and a row the page had not re-read yet when the preview ran is not mistaken for one that moved
 * after it. A row the page cannot see (another branch's day under a branch filter) is absent both
 * times and never counts.
 *
 * A day the save would send that somebody pinned since counts too: the save is refused for it.
 */
export function daysMovedUnderDraft(
  cells: Iterable<DraftCell>,
  monthFrom: string,
  monthTo: string,
  rowNow: (key: string) => SavedRow | undefined,
  rowAtPreview: (key: string) => SavedRow | undefined,
  pinnedNow: (key: string) => boolean = () => false,
  pinnedAtPreview: (key: string) => boolean = () => false,
): number {
  let moved = 0
  for (const cell of cells) {
    const key = draftKey(cell.employeeId, cell.workDate)
    const now = rowNow(key)
    if (!rowMatches(cell.expected, now) && !sameRow(now, rowAtPreview(key))) {
      moved++
    } else if (
      cell.origin !== 'pinned' &&
      isSentCell(cell, monthFrom, monthTo) &&
      pinnedNow(key) &&
      !pinnedAtPreview(key)
    ) {
      moved++
    }
  }
  return moved
}
