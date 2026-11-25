/** A shift's change log in plain words (script 122), with the app's real English and Arabic sentences. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CHANGE_LOG_KEYS,
  changeLogDay,
  describeShiftChange,
  shiftChangeLine,
  shiftChangeNote,
} from '../src/pages/attendance/shiftChangeWords.ts'
import type { ChangeLogWords } from '../src/pages/attendance/shiftChangeWords.ts'
import type { ShiftChange } from '../src/types/attendance.ts'

type Dict = { [key: string]: string | Dict }
const load = (lang: string): Dict => JSON.parse(readFileSync(new URL(`../src/i18n/${lang}.json`, import.meta.url), 'utf-8')) as Dict

function translator(dict: Dict) {
  return (key: string, options: Record<string, unknown> = {}): string => {
    let node: string | Dict | undefined = dict
    for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined
    if (typeof node !== 'string') throw new Error(`missing translation: ${key}`)
    return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? `{{${name}}}`))
  }
}

const en: ChangeLogWords = {
  t: translator(load('en')),
  day: (iso) => changeLogDay(iso, 'en'),
  minutes: (m) => `${m}m`,
}
const ar: ChangeLogWords = { ...en, t: translator(load('ar')), day: (iso) => changeLogDay(iso, 'ar-u-nu-latn') }

const base: ShiftChange = {
  shiftChangeId: 1, shiftId: 5, changedAtUtc: '2026-11-22T10:00:00', changedOn: '2026-11-22T00:00:00', changedByUserId: 7,
  changedBy: 'Reda', action: 'HoursChanged', effectiveFrom: '2026-12-01T00:00:00', effectiveTo: null,
  oldStartTime: '08:00:00', newStartTime: '09:00:00', oldEndTime: '16:00:00', newEndTime: '17:00:00',
  oldCrossesMidnight: false, newCrossesMidnight: false, oldBreakMinutes: 30, newBreakMinutes: 30,
  oldGraceMinutes: null, newGraceMinutes: null, oldName: null, newName: null, daysCount: null, note: null,
}
const change = (over: Partial<ShiftChange>): ShiftChange => ({ ...base, ...over })

test('the owner\'s example: date, person, hours before and after, from when', () => {
  assert.equal(shiftChangeLine(base, en), '22 Nov 2026, Reda: hours 08:00–16:00 → 09:00–17:00 from 1 Dec 2026')
})

test('only what changed is said; a period has its end; the first hours are every day', () => {
  assert.equal(
    describeShiftChange(change({ newStartTime: '08:00:00', newEndTime: '16:00:00', newBreakMinutes: 60, newGraceMinutes: 5 }), en),
    'break 30m → 60m, grace the tolerance setting → 5m from 1 Dec 2026',
  )
  assert.equal(describeShiftChange(change({ effectiveTo: '2026-12-31T00:00:00' }), en),
    'hours 08:00–16:00 → 09:00–17:00 from 1 Dec 2026 to 31 Dec 2026')
  assert.equal(describeShiftChange(change({ effectiveFrom: '2000-01-01T00:00:00' }), en), 'hours 08:00–16:00 → 09:00–17:00 for every day')
  // an overnight shift says so
  assert.equal(describeShiftChange(change({ newStartTime: '22:00:00', newEndTime: '06:00:00', newCrossesMidnight: true }), en),
    'hours 08:00–16:00 → 22:00–06:00 (overnight) from 1 Dec 2026')
  // new hours with nothing before them
  assert.equal(describeShiftChange(change({ oldStartTime: null, oldEndTime: null }), en), 'hours set to 09:00–17:00 from 1 Dec 2026')
})

test('created, taken back, renamed, switched off and on, days not worked out again', () => {
  assert.equal(describeShiftChange(change({ action: 'Created', oldStartTime: null, effectiveFrom: '2000-01-01T00:00:00' }), en),
    'created with the hours 09:00–17:00')
  assert.equal(describeShiftChange(change({ action: 'HoursRemoved', oldStartTime: '07:00:00', oldEndTime: '15:00:00',
    newStartTime: '09:30:00', newEndTime: '17:30:00', effectiveFrom: '2027-01-10T00:00:00' }), en),
    'the change of 10 Jan 2027 (07:00–15:00) was taken back: 09:30–17:30 again')
  assert.equal(describeShiftChange(change({ action: 'HoursRemoved', newStartTime: null, newEndTime: null }), en),
    'the hours of 1 Dec 2026 (08:00–16:00) were removed')
  assert.equal(describeShiftChange(change({ action: 'Renamed', oldName: 'Morning', newName: 'Early' }), en), 'renamed Morning → Early')
  assert.equal(describeShiftChange(change({ action: 'Deactivated' }), en), 'switched off')
  assert.equal(describeShiftChange(change({ action: 'Activated' }), en), 'switched on again')
  assert.match(describeShiftChange(change({ action: 'DaysNotRederived', daysCount: 3, effectiveFrom: '2026-11-01T00:00:00',
    effectiveTo: '2026-11-25T00:00:00' }), en), /^3 day\(s\) from 1 Nov 2026 to 25 Nov 2026 could not be worked out again/)
  // nobody known: no name, no comma
  assert.equal(shiftChangeLine(change({ action: 'Activated', changedBy: null }), en), '22 Nov 2026: switched on again')
})

test('a person\'s reason is shown; the database\'s own notes are said by the line or translated', () => {
  assert.equal(shiftChangeNote(change({ note: '  Winter hours ' }), en), 'Winter hours')
  assert.equal(shiftChangeNote(change({ action: 'Created', note: 'The hours the shift was created with' }), en), null)
  assert.equal(shiftChangeNote(change({ action: 'DaysNotRederived', note: '3 day(s) from 2026-11-01 ...' }), en), null)
  assert.equal(shiftChangeNote(change({ note: 'Back to the hours before the change of 10/01/2027' }), en),
    'back to the hours before the change of 10 Jan 2027')
  assert.equal(shiftChangeNote(change({ note: null }), en), null)
})

test('the same lines in Arabic, with Western digits', () => {
  const line = shiftChangeLine(base, ar)
  assert.match(line, /Reda/)
  assert.match(line, /08:00–16:00/)
  assert.match(line, /09:00–17:00/)
  assert.ok(!/[٠-٩]/.test(line), line)
  assert.ok(/[؀-ۿ]/.test(line), line)
  for (const action of ['Created', 'HoursRemoved', 'Renamed', 'Deactivated', 'Activated', 'DaysNotRederived']) {
    assert.doesNotThrow(() => describeShiftChange(change({ action, daysCount: 1 }), ar))
  }
})

test('every change-log key exists in English and in Arabic', () => {
  const keysOf = (dict: Dict): string[] => {
    let node: string | Dict | undefined = dict
    for (const part of CHANGE_LOG_KEYS.split('.').filter(Boolean)) node = typeof node === 'object' ? node[part] : undefined
    return typeof node === 'object' ? Object.keys(node).sort() : []
  }
  const enKeys = keysOf(load('en'))
  assert.ok(enKeys.length > 10)
  assert.deepEqual(keysOf(load('ar')), enKeys)
})
