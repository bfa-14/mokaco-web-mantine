/**
 * A DAY WITH PUNCHES THAT THE APPROVED ROSTER DOES NOT KNOW: what the page works out by itself. The shift
 * is only ever PROPOSED (the one that starts nearest the first punch); "not work" needs its reason; a day
 * outside the employment or in a month waiting for approval can be dismissed but not added. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DECISION_NOTE_MAX,
  addBlockedBy,
  decisionNote,
  decisionProblem,
  inWorkOrder,
  punchDates,
  punchesOfDay,
  suggestShift,
} from '../src/pages/attendance/unrosteredDay.ts'

const shifts = [
  { shiftId: 1, startTime: '07:00:00', isActive: true },
  { shiftId: 2, startTime: '15:00:00', isActive: true },
  { shiftId: 3, startTime: '23:00:00', isActive: true },
  { shiftId: 4, startTime: '08:00:00', isActive: false },
]

test('the proposed shift is the active one that starts nearest the first punch', () => {
  assert.equal(suggestShift('2026-11-07T07:20:00', shifts), 1)
  assert.equal(suggestShift('2026-11-07T14:40:00', shifts), 2)
  // 08:00 would be nearer for an 08:05 punch, but that shift is retired
  assert.equal(suggestShift('2026-11-07T08:05:00', shifts), 1)
})

test('nearest is measured around the clock: a punch just after midnight belongs to the night shift', () => {
  assert.equal(suggestShift('2026-11-08T00:10:00', shifts), 3)
  assert.equal(suggestShift('2026-11-07T22:50:00', shifts), 3)
})

test('nothing to propose without active shifts or a readable punch time', () => {
  assert.equal(suggestShift('2026-11-07T07:20:00', []), null)
  assert.equal(suggestShift('2026-11-07T07:20:00', [{ shiftId: 4, startTime: '08:00:00', isActive: false }]), null)
  assert.equal(suggestShift('not a time', shifts), null)
})

test('a tie goes to the lower shift id, so the proposal is the same every time', () => {
  const pair = [
    { shiftId: 9, startTime: '10:00:00', isActive: true },
    { shiftId: 5, startTime: '06:00:00', isActive: true },
  ]
  assert.equal(suggestShift('2026-11-07T08:00:00', pair), 5)
})

test('"not work" needs a reason; a shift decision needs its shift; a rest day needs neither', () => {
  assert.equal(decisionProblem('Dismiss', null, '   '), 'note')
  assert.equal(decisionProblem('Dismiss', null, 'came in to collect a payslip'), null)
  assert.equal(decisionProblem('Shift', null, ''), 'shift')
  assert.equal(decisionProblem('Shift', 2, ''), null)
  assert.equal(decisionProblem('RestDay', null, ''), null)
})

test('a note is trimmed, cut to the stored length, and blank is nothing', () => {
  assert.equal(decisionNote('  covered for Maya  '), 'covered for Maya')
  assert.equal(decisionNote(' \n\t'), null)
  assert.equal(decisionNote('x'.repeat(DECISION_NOTE_MAX + 30))?.length, DECISION_NOTE_MAX)
})

test('what stands in the way of adding a day (dismissing stays possible)', () => {
  assert.equal(addBlockedBy({ outsideEmployment: false, openRosterRequestId: null }), null)
  assert.equal(addBlockedBy({ outsideEmployment: true, openRosterRequestId: null }), 'outsideEmployment')
  assert.equal(addBlockedBy({ outsideEmployment: false, openRosterRequestId: 214 }), 'rosterWaiting')
  // the employment comes first: the roster's approval would not make such a day addable
  assert.equal(addBlockedBy({ outsideEmployment: true, openRosterRequestId: 214 }), 'outsideEmployment')
})

const day = { employeeId: 7, firstPunch: '2026-11-07T22:05:00', lastPunch: '2026-11-08T06:02:00' }

test('the punches behind a day are that person\'s, between its first and last punch, in time order', () => {
  const punches = [
    { rawLogId: 4, employeeId: 7, punchTimeUtc: '2026-11-08T06:02:00' },
    { rawLogId: 1, employeeId: 7, punchTimeUtc: '2026-11-07T08:00:00' },   // the day shift before: another day
    { rawLogId: 2, employeeId: 7, punchTimeUtc: '2026-11-07T22:05:00' },
    { rawLogId: 3, employeeId: 9, punchTimeUtc: '2026-11-07T23:00:00' },   // somebody else
    { rawLogId: 5, employeeId: null, punchTimeUtc: '2026-11-07T23:30:00' }, // a PIN mapped to nobody
  ]
  assert.deepEqual(punchesOfDay(punches, day).map((punch) => punch.rawLogId), [2, 4])
})

test('an overnight day spans two calendar dates; a day shift one', () => {
  assert.deepEqual(punchDates(day), ['2026-11-07', '2026-11-08'])
  assert.deepEqual(punchDates({ firstPunch: '2026-11-07T08:02:00', lastPunch: '2026-11-07T16:11:00' }), ['2026-11-07'])
})

test('open days come first, newest first; dismissed ones after', () => {
  const rows = [
    { state: 'Dismissed' as const, workDate: '2026-11-09T00:00:00', employeeName: 'Ali' },
    { state: 'Open' as const, workDate: '2026-11-05T00:00:00', employeeName: 'Rami' },
    { state: 'Open' as const, workDate: '2026-11-07T00:00:00', employeeName: 'Maya' },
    { state: 'Open' as const, workDate: '2026-11-07T00:00:00', employeeName: 'Ali' },
  ]
  assert.deepEqual(inWorkOrder(rows).map((row) => `${row.state} ${row.workDate.slice(8, 10)} ${row.employeeName}`), [
    'Open 07 Ali',
    'Open 07 Maya',
    'Open 05 Rami',
    'Dismissed 09 Ali',
  ])
})

import { bulkCandidates, selectedByDefault } from '../src/pages/attendance/unrosteredDay.ts'

test('several at once: only the open days this person may add', () => {
  const base = { state: 'Open' as const, canDecide: true, isPaid: false, outsideEmployment: false, openRosterRequestId: null }
  const days = [
    { ...base, id: 1 },
    { ...base, id: 2, canDecide: false },
    { ...base, id: 3, isPaid: true },
    { ...base, id: 4, outsideEmployment: true },
    { ...base, id: 5, openRosterRequestId: 12 },
    { ...base, id: 6, state: 'Dismissed' as const },
  ]
  assert.deepEqual(bulkCandidates(days).map((d) => d.id), [1])
})

test('a single punch is not ticked at first', () => {
  assert.equal(selectedByDefault({ punchCount: 2 }), true)
  assert.equal(selectedByDefault({ punchCount: 1 }), false)
})
