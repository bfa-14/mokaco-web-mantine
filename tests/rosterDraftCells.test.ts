/**
 * THE DRAFT'S DAYS: WHAT AN EDIT KEEPS, WHAT A SAVE SENDS, WHAT COUNTS AS MOVED UNDER IT.
 *
 * The auto-roster draft is edited on the grid without a server call, so the rules that decide what
 * Save sends and when the card asks for a Regenerate live in the browser. These pin the ones a
 * review found broken: a multi-day edit dropping a pin set earlier in the draft, and a re-read that
 * changed no row (the page's own staffing save) marking the draft stale. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyEditTo,
  daysMovedUnderDraft,
  draftKey,
  isSentCell,
  mergeEdit,
  rowMatches,
} from '../src/pages/attendance/rosterDraftCells.ts'
import type { DraftCell, SavedRow } from '../src/pages/attendance/rosterDraftCells.ts'

const MONTH = { from: '2026-12-01', to: '2026-12-31' }

function cell(overrides: Partial<DraftCell> & { employeeId: number; workDate: string }): DraftCell {
  return {
    state: 'work',
    shiftId: 1,
    origin: 'planned',
    change: 'insert',
    reasonCode: null,
    reasonArgs: null,
    expected: { exists: false },
    edited: false,
    isPinned: null,
    previewState: overrides.state ?? 'work',
    previewShiftId: overrides.shiftId === undefined ? 1 : overrides.shiftId,
    ...overrides,
  }
}

test('an edit that leaves the pin untouched keeps the pin an earlier edit set', () => {
  const day = cell({ employeeId: 1, workDate: '2026-12-07' })
  const pinned = applyEditTo(day, { shiftId: 1, isRestDay: false, isPinned: true })
  assert.equal(pinned.isPinned, true)
  // The same day, inside a multi-day selection whose pin box was never touched.
  const again = applyEditTo(pinned, { shiftId: 2, isRestDay: false, isPinned: null })
  assert.equal(again.isPinned, true)
  assert.equal(again.shiftId, 2)
  assert.equal(again.origin, 'draft')
  // An explicit untick still unpins.
  assert.equal(applyEditTo(pinned, { shiftId: 1, isRestDay: false, isPinned: false }).isPinned, false)
})

test('the stored edit keeps its pin too, so Regenerate sends it back', () => {
  const first = { shiftId: 1, isRestDay: false, isPinned: true }
  assert.deepEqual(mergeEdit(first, { shiftId: null, isRestDay: true, isPinned: null }), {
    shiftId: null,
    isRestDay: true,
    isPinned: true,
  })
  assert.equal(mergeEdit(undefined, { shiftId: 1, isRestDay: false, isPinned: null }).isPinned, null)
  assert.equal(mergeEdit(first, { shiftId: 1, isRestDay: false, isPinned: false }).isPinned, false)
})

test('an edit keeps the state the preview gave the day, for the footer', () => {
  const day = cell({ employeeId: 1, workDate: '2026-12-07', state: 'work', previewState: 'work' })
  const edited = applyEditTo(day, { shiftId: null, isRestDay: true, isPinned: null })
  assert.equal(edited.state, 'rest')
  assert.equal(edited.previewState, 'work')
})

test("an edit keeps the preview's shift too, for the footer's rows per shift", () => {
  const day = cell({ employeeId: 1, workDate: '2026-12-07', shiftId: 1 })
  const moved = applyEditTo(day, { shiftId: 2, isRestDay: false, isPinned: null })
  assert.equal(moved.shiftId, 2)
  assert.equal(moved.previewShiftId, 1)
  // A second edit of the same day still measures against the preview, not against the first edit.
  assert.equal(applyEditTo(moved, { shiftId: null, isRestDay: true, isPinned: null }).previewShiftId, 1)
})

test('Save sends the month days the plan may write, and an edited fact', () => {
  assert.equal(isSentCell(cell({ employeeId: 1, workDate: '2026-12-07' }), MONTH.from, MONTH.to), true)
  // Outside the month (a ghost or a fact of the window), never.
  assert.equal(isSentCell(cell({ employeeId: 1, workDate: '2026-11-30', origin: 'ghost' }), MONTH.from, MONTH.to), false)
  const fact = cell({ employeeId: 1, workDate: '2026-12-08', origin: 'fact', change: 'kept', expected: { exists: true, shiftId: 1 } })
  assert.equal(isSentCell(fact, MONTH.from, MONTH.to), false)
  assert.equal(isSentCell({ ...fact, edited: true, origin: 'draft', change: 'update' }, MONTH.from, MONTH.to), true)
  // A holiday off that stays without a row has nothing to send.
  const off = cell({ employeeId: 1, workDate: '2026-12-25', state: 'none', origin: 'holiday', change: 'unchanged' })
  assert.equal(isSentCell(off, MONTH.from, MONTH.to), false)
})

test('a saved row matches what the preview expected by state and shift', () => {
  assert.equal(rowMatches({ exists: false }, undefined), true)
  assert.equal(rowMatches({ exists: false }, { shiftId: 1, isRestDay: false }), false)
  assert.equal(rowMatches({ exists: true, shiftId: 1, isRestDay: false }, undefined), false)
  assert.equal(rowMatches({ exists: true, shiftId: 1, isRestDay: false }, { shiftId: 1, isRestDay: false }), true)
  assert.equal(rowMatches({ exists: true, shiftId: 1, isRestDay: false }, { shiftId: 2, isRestDay: false }), false)
  assert.equal(rowMatches({ exists: true, shiftId: null, isRestDay: true }, { shiftId: null, isRestDay: true }), true)
  assert.equal(rowMatches({ exists: true, shiftId: 1, isRestDay: false }, { shiftId: null, isRestDay: true }), false)
})

/** Two cells of a draft: Rami's planned Monday (no row), Lina's saved Tuesday morning. */
function draftCells(): DraftCell[] {
  return [
    cell({ employeeId: 1, workDate: '2026-12-07' }),
    cell({
      employeeId: 2,
      workDate: '2026-12-08',
      change: 'unchanged',
      expected: { exists: true, shiftId: 1, isRestDay: false },
    }),
  ]
}

function rows(entries: [string, SavedRow][]): Map<string, SavedRow> {
  return new Map(entries)
}

test('a re-read that changed no row is not a moved roster (the staffing save case)', () => {
  const base = rows([[draftKey(2, '2026-12-08'), { shiftId: 1, isRestDay: false }]])
  // The live signal of the drawer's own staffing save re-reads the month: a new map, the same rows.
  const reread = rows([[draftKey(2, '2026-12-08'), { shiftId: 1, isRestDay: false }]])
  assert.equal(
    daysMovedUnderDraft(draftCells(), MONTH.from, MONTH.to, (k) => reread.get(k), (k) => base.get(k)),
    0,
  )
})

test('a row that changed after the preview read it counts; one the page had not re-read yet does not', () => {
  const base = rows([[draftKey(2, '2026-12-08'), { shiftId: 1, isRestDay: false }]])
  // Somebody set Rami's Monday and made Lina's Tuesday a rest day after the preview.
  const now = rows([
    [draftKey(1, '2026-12-07'), { shiftId: 3, isRestDay: false }],
    [draftKey(2, '2026-12-08'), { shiftId: null, isRestDay: true }],
  ])
  assert.equal(daysMovedUnderDraft(draftCells(), MONTH.from, MONTH.to, (k) => now.get(k), (k) => base.get(k)), 2)

  // The page held an old Tuesday (evening) when the preview ran; the preview read the new one
  // (morning). Until a re-read the page still shows evening — that is the page behind, not a move.
  const behind = rows([[draftKey(2, '2026-12-08'), { shiftId: 2, isRestDay: false }]])
  assert.equal(
    daysMovedUnderDraft(draftCells(), MONTH.from, MONTH.to, (k) => behind.get(k), (k) => behind.get(k)),
    0,
  )
  // …and once it re-reads, the row is the one the preview expected.
  assert.equal(daysMovedUnderDraft(draftCells(), MONTH.from, MONTH.to, (k) => base.get(k), (k) => behind.get(k)), 0)
})

test("a row the page cannot see (another branch's day) never counts", () => {
  const otherBranch = [
    cell({ employeeId: 3, workDate: '2026-12-09', origin: 'fact', change: 'kept', expected: { exists: true, shiftId: 1 } }),
  ]
  const none = rows([])
  assert.equal(daysMovedUnderDraft(otherBranch, MONTH.from, MONTH.to, (k) => none.get(k), (k) => none.get(k)), 0)
})

test('a day the save would send that was pinned since counts; a pin the preview already knew does not', () => {
  const same = rows([[draftKey(2, '2026-12-08'), { shiftId: 1, isRestDay: false }]])
  const pinnedNow = new Set([draftKey(2, '2026-12-08')])
  assert.equal(
    daysMovedUnderDraft(
      draftCells(),
      MONTH.from,
      MONTH.to,
      (k) => same.get(k),
      (k) => same.get(k),
      (k) => pinnedNow.has(k),
      () => false,
    ),
    1,
  )
  assert.equal(
    daysMovedUnderDraft(
      draftCells(),
      MONTH.from,
      MONTH.to,
      (k) => same.get(k),
      (k) => same.get(k),
      (k) => pinnedNow.has(k),
      (k) => pinnedNow.has(k),
    ),
    0,
  )
})
