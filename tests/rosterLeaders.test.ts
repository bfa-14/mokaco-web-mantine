/**
 * THE SHIFT LEADERS picker of the auto-roster drawer: who it offers, what it sends, when it counts as changed, and the
 * rotation's leads that are leaders anyway. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import i18next from 'i18next'
import { leaderIds, leaderOptions, rotationLeads, sameLeaders } from '../src/pages/attendance/rosterLeaders.ts'
import en from '../src/i18n/en.json' with { type: 'json' }
import ar from '../src/i18n/ar.json' with { type: 'json' }

const staff = [
  { employeeId: 1, fullName: 'Lina' },
  { employeeId: 2, fullName: 'Rami' },
  { employeeId: 3, fullName: 'Maya' },
]

test('the picker offers the people of the month, then a stored leader who is not among them', () => {
  const leaders = [
    { employeeId: 2, fullName: 'Rami', isStored: true, leadSlot: null },
    { employeeId: 9, fullName: 'Nour (moved)', isStored: true, leadSlot: null },
    { employeeId: 8, fullName: 'Karim', isStored: false, leadSlot: 'L1' as const }, // a rotation lead of another month
  ]
  assert.deepEqual(
    leaderOptions(staff, leaders).map((o) => [o.value, o.label]),
    [['1', 'Lina'], ['2', 'Rami'], ['3', 'Maya'], ['9', 'Nour (moved)']],
  )
  assert.deepEqual(leaderOptions([], []), [])
})

test('the picker sends each person once, as numbers, in the order picked', () => {
  assert.deepEqual(leaderIds(['3', '1', '3']), [3, 1])
  assert.deepEqual(leaderIds(['x', '0', '-2', '2']), [2])
  assert.deepEqual(leaderIds([]), [])
})

test('the same people in another order is no change', () => {
  assert.equal(sameLeaders([1, 2], [2, 1]), true)
  assert.equal(sameLeaders([1, 2, 2], [2, 1]), true)
  assert.equal(sameLeaders([1], [1, 2]), false)
  assert.equal(sameLeaders([], []), true)
  assert.equal(sameLeaders([3], [4]), false)
})

test('the rotation leads are listed Lead 1 first and only them', () => {
  const leaders = [
    { employeeId: 1, fullName: 'Lina', isStored: true, leadSlot: 'L2' as const },
    { employeeId: 2, fullName: 'Rami', isStored: true, leadSlot: null },
    { employeeId: 3, fullName: 'Maya', isStored: false, leadSlot: 'L1' as const },
  ]
  assert.deepEqual(rotationLeads(leaders).map((l) => [l.fullName, l.leadSlot]), [['Maya', 'L1'], ['Lina', 'L2']])
  assert.deepEqual(rotationLeads([{ employeeId: 2, fullName: 'Rami', isStored: true }]), [])
})

async function translators() {
  const i18n = i18next.createInstance()
  await i18n.init({
    resources: { en: { translation: en }, ar: { translation: ar } },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  })
  return { enT: i18n.getFixedT('en'), arT: i18n.getFixedT('ar') }
}

test('the rotation leads line agrees in number with one lead or two, in both languages', async () => {
  const { enT, arT } = await translators()
  const key = 'attendance.roster.auto.leaders.rotationLeads'

  assert.equal(enT(key, { count: 1, names: 'Rami (Lead 1)' }), "The rotation list's lead counts too: Rami (Lead 1).")
  assert.equal(
    enT(key, { count: 2, names: 'Rami (Lead 1), Maya (Lead 2)' }),
    "The rotation list's leads count too: Rami (Lead 1), Maya (Lead 2).",
  )

  // One lead: the singular noun and verb, never the dual ("the two leads are both counted").
  const one = arT(key, { count: 1, names: 'رامي (مسؤول 1)' })
  assert.equal(one, 'مسؤول قائمة التناوب يُحسب أيضًا: رامي (مسؤول 1).')
  assert.doesNotMatch(one, /مسؤولا |يُحسبان/)
  // Two leads: the dual.
  assert.equal(
    arT(key, { count: 2, names: 'رامي (مسؤول 1)، مايا (مسؤول 2)' }),
    'مسؤولا قائمة التناوب يُحسبان أيضًا: رامي (مسؤول 1)، مايا (مسؤول 2).',
  )
})
