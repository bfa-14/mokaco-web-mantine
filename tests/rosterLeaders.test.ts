/**
 * THE SHIFT LEADERS picker of the auto-roster drawer: who it offers, what it sends, when it counts as changed, and the
 * rotation's leads that are leaders anyway. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import i18next from 'i18next'
import {
  LEADER_NOT_IN_BRANCH,
  LEADERS_NOT_READY,
  leaderIds,
  leaderNotInBranch,
  leaderOptions,
  leadersNotReady,
  rotationLeads,
  sameLeaders,
} from '../src/pages/attendance/rosterLeaders.ts'
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

test('the picker offers only whom a save accepts: the candidates, the month\'s people first, then the stored leaders', () => {
  const leaders = [
    { employeeId: 2, fullName: 'Rami', isStored: true, leadSlot: null },
    { employeeId: 9, fullName: 'Nour (moved)', isStored: true, leadSlot: null }, // stored: shown so it can be removed
  ]
  // Maya (3) worked here earlier in the month and has moved: not a candidate, not offered (the save would refuse her).
  // Omar (5) is in the branch today but not on the month's days (he leaves before it starts): offered after the month.
  const candidates = [
    { employeeId: 5, fullName: 'Omar' },
    { employeeId: 2, fullName: 'Rami' },
    { employeeId: 1, fullName: 'Lina' },
  ]
  assert.deepEqual(
    leaderOptions(staff, leaders, candidates).map((o) => [o.value, o.label]),
    [['1', 'Lina'], ['2', 'Rami'], ['5', 'Omar'], ['9', 'Nour (moved)']],
  )
  // Nobody may be added: only the stored leaders, to be kept or taken off.
  assert.deepEqual(leaderOptions(staff, leaders, []).map((o) => o.value), ['2', '9'])
  // An older API sends no candidates: the month's people stand in, as before.
  assert.deepEqual(leaderOptions(staff, leaders, undefined).map((o) => o.value), ['1', '2', '3', '9'])
  assert.deepEqual(leaderOptions(staff, leaders, null).map((o) => o.value), ['1', '2', '3', '9'])
})

test("the save's 'not in this branch' answer is told apart by its code and gives back the name", () => {
  assert.equal(leaderNotInBranch({ error: 'Rami Haddad is not in this branch: ...', code: LEADER_NOT_IN_BRANCH, name: 'Rami Haddad' }), 'Rami Haddad')
  assert.equal(leaderNotInBranch({ error: 'Rami Haddad is not in this branch: ...' }), null) // an older API: no code
  assert.equal(leaderNotInBranch({ code: LEADER_NOT_IN_BRANCH }), null) // no name to say
  assert.equal(leaderNotInBranch({ code: LEADER_NOT_IN_BRANCH, name: '  ' }), null)
  assert.equal(leaderNotInBranch({ code: LEADERS_NOT_READY, name: 'x' }), null)
  assert.equal(leaderNotInBranch(null), null)
  assert.equal(leaderNotInBranch('leader_not_in_branch'), null)
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

test("the API's own 'not there yet' answer is told apart by its code, not by the 503 alone", () => {
  assert.equal(leadersNotReady({ error: 'The shift leaders list is not available yet.', code: LEADERS_NOT_READY }), true)
  assert.equal(leadersNotReady({ error: 'The database did not answer in time.' }), false) // a slow database is a 503 too
  assert.equal(leadersNotReady({ code: 'paused' }), false)
  assert.equal(leadersNotReady(null), false) // the web server's own 503 page: ApiError.data is null
  assert.equal(leadersNotReady('leaders_not_ready'), false)
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

test("the 'not there yet' sentence is plain and in each language", async () => {
  const { enT, arT } = await translators()
  const key = 'attendance.roster.auto.leaders.notReady'
  const english = enT(key)
  const arabic = arT(key)

  assert.equal(english, 'The shift leaders list is not available yet. Ask your administrator to finish the update.')
  assert.notEqual(arabic, english) // an Arabic sentence, not the English one inside Arabic text
  for (const sentence of [english, arabic]) assert.doesNotMatch(sentence, /docs\/|\.sql|script|123/i)
})

test("the 'not in this branch' refusal is said in each language, with the name", async () => {
  const { enT, arT } = await translators()
  const key = 'attendance.roster.auto.leaders.notInBranch'
  const english = enT(key, { name: 'Rami Haddad' })
  const arabic = arT(key, { name: 'رامي حداد' })

  assert.equal(english, "Rami Haddad is not one of this branch's people today, so cannot be added as a shift leader. Take them off the list.")
  assert.match(arabic, /^رامي حداد /)
  assert.ok(/[\u0600-\u06FF]/.test(arabic.replace('رامي حداد', '')), arabic)
  assert.doesNotMatch(arabic, /branch|leader/i) // not the English sentence inside Arabic text
  // The picker's line about whom it offers, in both languages.
  assert.equal(enT('attendance.roster.auto.leaders.candidatesHint'), 'Only people who work in this branch today can be added.')
  assert.notEqual(arT('attendance.roster.auto.leaders.candidatesHint'), enT('attendance.roster.auto.leaders.candidatesHint'))
})
