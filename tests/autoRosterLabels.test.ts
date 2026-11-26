/**
 * EVERY REASON AND ISSUE THE AUTO-ROSTER WRITES HAS A LABEL, IN ENGLISH AND IN ARABIC.
 *
 * The planner (MokaCo.HRMS.Services/Attendance/AutoRoster) explains each planned day with a reason code and reports
 * each problem with an issue code; the preview card and the grid's tooltip translate them under
 * attendance.roster.auto.reason / .issue / .issueShift. A code with no label shows up as the bare code, so the lists
 * below are the API's, and a new code is added here and in both languages together. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import en from '../src/i18n/en.json' with { type: 'json' }
import ar from '../src/i18n/ar.json' with { type: 'json' }

type Tree = { [key: string]: string | Tree }

/** RosterPlanner.Reason* and RotationRule.Reason*. */
const REASONS = [
  'REST_WEEKEND_OWED', 'REST_LEVEL', 'REST_PAIR', 'REST_PATTERN', 'REST_CONSECUTIVE',
  'WORK_HOLIDAY_COVER', 'HOLIDAY_OFF', 'WORK_SHIFT_COVER', 'WORK_LEAD_APART', 'WORK_SHIFT_BALANCE',
  'REST_ROTATION', 'WORK_ROTATION_LEAD', 'WORK_ROTATION',
]

/** RosterPlanValidator's codes. */
const ISSUES = [
  'MONTH_LOCKED', 'WORK_WITHOUT_SHIFT', 'REST_ON_HOLIDAY', 'CONSECUTIVE_CAP', 'HOLIDAY_HIDDEN_BY_REST',
  'RHYTHM_SHORT', 'RHYTHM_OVER', 'REST_ABSORBED_BY_LEAVE', 'SHORT_STAFFED', 'SHIFT_UNCOVERED',
  'TURNAROUND', 'WEEKLY_REST_HOURS', 'PATTERN_REST_WORKED', 'LONG_RUN', 'ROTATION_NOT_SET', 'LEADS_SAME_SHIFT',
]

/** The issues that name the shift they are about (AutoRosterIssue.ShiftId). */
const SHIFT_ISSUES = ['SHORT_STAFFED', 'SHIFT_UNCOVERED', 'LEADS_SAME_SHIFT']

function section(tree: unknown, name: string): Record<string, string> {
  const auto = ((tree as Tree).attendance as Tree).roster as Tree
  return (auto.auto as Tree)[name] as Record<string, string>
}

const holes = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(',')

for (const [name, codes] of [['reason', REASONS], ['issue', ISSUES], ['issueShift', SHIFT_ISSUES]] as const) {
  test(`every auto-roster ${name} code has an English and an Arabic label with the same placeholders`, () => {
    const english = section(en, name)
    const arabic = section(ar, name)
    for (const code of codes) {
      assert.ok(typeof english[code] === 'string' && english[code].trim() !== '', `en ${name}.${code}`)
      assert.ok(typeof arabic[code] === 'string' && arabic[code].trim() !== '', `ar ${name}.${code}`)
      assert.equal(holes(arabic[code]), holes(english[code]), `${name}.${code} placeholders`)
    }
  })
}

test('a moved day names the shift it was moved to', () => {
  for (const code of ['WORK_SHIFT_COVER', 'WORK_SHIFT_BALANCE']) {
    assert.match(section(en, 'reason')[code], /\{\{shift\}\}/)
    assert.match(section(ar, 'reason')[code], /\{\{shift\}\}/)
  }
})
