/**
 * SENTENCES THAT CARRY A COUNT read right for every count, in English and in Arabic, through the app's own i18next:
 * English has a singular and a plural; Arabic has six forms (zero, one, two, 3-10, 11-99, 100+), and a missing one
 * falls back to the ENGLISH sentence, not to another Arabic form. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import i18next from 'i18next'
import en from '../src/i18n/en.json' with { type: 'json' }
import ar from '../src/i18n/ar.json' with { type: 'json' }

type Dict = { [key: string]: string | Dict }

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

function node(dict: Dict, path: string): Dict {
  let at: string | Dict = dict
  for (const part of path.split('.')) at = (at as Dict)[part]
  return at as Dict
}

/** The counted sentences of the shift and roster work, and the bookings list's count. */
const COUNTED = [
  'attendance.shiftsPage.notify.takenBackDays',
  'attendance.shiftsPage.changeLog.daysNotRederived',
  'attendance.roster.auto.rhythm.newHire',
  'attendance.roster.auto.method.rotationNewHire',
  'booking.list.showUnpaid',
]

test('every counted sentence has its two English forms and its six Arabic forms', () => {
  for (const key of COUNTED) {
    const parent = key.slice(0, key.lastIndexOf('.'))
    const leaf = key.slice(key.lastIndexOf('.') + 1)
    const enNode = node(en as Dict, parent)
    const arNode = node(ar as Dict, parent)
    for (const form of ['one', 'other']) assert.equal(typeof enNode[`${leaf}_${form}`], 'string', `en ${key}_${form}`)
    for (const form of ['zero', 'one', 'two', 'few', 'many', 'other'])
      assert.equal(typeof arNode[`${leaf}_${form}`], 'string', `ar ${key}_${form}`)
    // No bare key left beside the forms: it would hide a missing form.
    assert.equal(enNode[leaf], undefined, `en ${key}`)
    assert.equal(arNode[leaf], undefined, `ar ${key}`)
  }
})

test('no Arabic count falls back to English', async () => {
  const { enT, arT } = await translators()
  for (const key of COUNTED) {
    for (const count of [0, 1, 2, 3, 10, 11, 99, 100, 101]) {
      const arabic = arT(key, { count, day: '1 كانون الأول', from: 'أ', to: 'ب' })
      assert.notEqual(arabic, enT(key, { count, day: '1 كانون الأول', from: 'أ', to: 'ب' }), `${key} ${count}`)
      assert.ok(/[؀-ۿ]/.test(arabic), `${key} ${count}: ${arabic}`)
    }
  }
})

test('the days taken back after a change of hours read right', async () => {
  const { enT, arT } = await translators()
  const key = 'attendance.shiftsPage.notify.takenBackDays'
  assert.equal(enT(key, { count: 1, day: '1 Dec' }), 'The change of 1 Dec was taken back. 1 day was worked out again.')
  assert.equal(enT(key, { count: 5, day: '1 Dec' }), 'The change of 1 Dec was taken back. 5 days were worked out again.')
  assert.match(arT(key, { count: 1, day: 'x' }), /يوم واحد\.$/)
  assert.match(arT(key, { count: 2, day: 'x' }), /يومين\.$/)
  assert.match(arT(key, { count: 5, day: 'x' }), /5 أيام\.$/)
  assert.match(arT(key, { count: 15, day: 'x' }), /15 يومًا\.$/)
  assert.match(arT(key, { count: 100, day: 'x' }), /100 يوم\.$/)
})

test("the new-hire rule says its months: 'first month', 'first 3 months', and the Arabic dual and plural", async () => {
  const { enT, arT } = await translators()
  const rhythm = 'attendance.roster.auto.rhythm.newHire'
  assert.equal(enT(rhythm, { count: 3 }), 'New employees work 6 days every week in their first 3 months, then 6 and 5 in turn, starting with 6.')
  assert.equal(enT(rhythm, { count: 1 }), 'New employees work 6 days every week in their first month, then 6 and 5 in turn, starting with 6.')
  assert.match(arT(rhythm, { count: 1 }), /شهرهم الأول/)
  assert.match(arT(rhythm, { count: 2 }), /أول شهرين/)
  assert.match(arT(rhythm, { count: 3 }), /أول 3 أشهر/)
  assert.match(arT(rhythm, { count: 12 }), /أول 12 شهرًا/)
  const rotation = 'attendance.roster.auto.method.rotationNewHire'
  assert.match(enT(rotation, { count: 3 }), /^New employees have only one day off a week in their first 3 months/)
  assert.match(arT(rotation, { count: 3 }), /أول 3 أشهر/)
})

test("the exit permission shows its length and no share of a fixed day", async () => {
  const { enT, arT } = await translators()
  assert.equal(enT('body.exitPermission.duration', { duration: '2h 0m' }), 'Length: 2h 0m')
  assert.match(arT('body.exitPermission.duration', { duration: '2h 0m' }), /2h 0m/)
  assert.equal(node(en as Dict, 'workflow').dayFraction, undefined)
  assert.equal(node(ar as Dict, 'workflow').dayFraction, undefined)
  assert.match(enT('body.exitPermission.convertOn'), /that day’s shift hours/)
})
