/**
 * THE BULK EXCUSE / DEDUCT TOUCHES ONLY THE ROWS ON SCREEN. A search or a column filter inside the list
 * narrows what a bulk decision reaches, and switches off the month's one-call endpoint, which would
 * otherwise decide rows nobody is looking at. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bulkTargets, coversWholeMonth, sameRows } from '../src/pages/attendance/anomalyBulk.ts'

const rows = [
  { anomalyId: 1, decision: null, type: 'LateArrival', who: 'Ahmad' },
  { anomalyId: 2, decision: null, type: 'EarlyDeparture', who: 'Ahmad' },
  { anomalyId: 3, decision: null, type: 'MissingPunch', who: 'Ahmad' },
  { anomalyId: 4, decision: null, type: 'LateArrival', who: 'Lina' },
  { anomalyId: 5, decision: 'Excused', type: 'LateArrival', who: 'Lina' },
]

test('with nothing narrowed inside the list, every undecided late / early row shown is a target', () => {
  const all = bulkTargets(rows, new Set(rows.map((row) => row.anomalyId)))
  assert.deepEqual(all.rows.map((row) => row.anomalyId), [1, 2, 4])
  assert.equal(all.skipped, 1)
})

test('a search inside the list narrows the targets to the rows it leaves', () => {
  // the reader searched "Lina": two rows left on screen, one of them already decided
  const lina = bulkTargets(rows, new Set([4, 5]))
  assert.deepEqual(lina.rows.map((row) => row.anomalyId), [4])
  assert.equal(lina.skipped, 0)
})

test('a list that shows nothing has no targets', () => {
  const none = bulkTargets(rows, new Set())
  assert.deepEqual(none.rows, [])
  assert.equal(none.skipped, 0)
})

test('an id the list reports but the top filters have dropped is never a target', () => {
  const stale = bulkTargets(rows.slice(0, 2), new Set([1, 2, 4]))
  assert.deepEqual(stale.rows.map((row) => row.anomalyId), [1, 2])
})

test('before the list has reported, the top filters alone decide', () => {
  assert.deepEqual(bulkTargets(rows, null).rows.map((row) => row.anomalyId), [1, 2, 4])
})

const month = { typeFilter: '', listNarrowed: false, from: '2026-10-01', to: '2026-10-31', monthFrom: '2026-10-01', monthTo: '2026-10-31' }

test('the one-call month endpoint is used only for a whole month with nothing narrowed', () => {
  assert.equal(coversWholeMonth(month), true)
  assert.equal(coversWholeMonth({ ...month, listNarrowed: true }), false)
  assert.equal(coversWholeMonth({ ...month, typeFilter: 'LateArrival' }), false)
  assert.equal(coversWholeMonth({ ...month, to: '2026-10-15' }), false)
})

test('the list read again is the same only when it holds exactly the rows on screen', () => {
  const screen = rows.slice(0, 2)
  assert.equal(sameRows(screen, [rows[1], rows[0]]), true)          // order does not matter
  assert.equal(sameRows(screen, rows.slice(0, 3)), false)           // one arrived since
  assert.equal(sameRows(screen, rows.slice(0, 1)), false)           // one was decided elsewhere
  assert.equal(sameRows(screen, [rows[0], rows[3]]), false)         // same count, another row
  assert.equal(sameRows([], []), true)
})
