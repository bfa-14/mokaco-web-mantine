/**
 * THE PREP BOOK FINDS THE DRINK THAT WAS TYPED, typos and all, and shows millilitres next to ounces
 * without touching cup sizes. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PREP_CATEGORIES, PREP_RECIPES } from '../src/pages/prepBook/prepBookData.ts'
import { normalize, searchRecipes, withMl } from '../src/pages/prepBook/prepSearch.ts'

const names = (q: string) => searchRecipes(PREP_RECIPES, q).map((r) => r.name)

test('an empty search shows the whole book in its own order', () => {
  assert.equal(searchRecipes(PREP_RECIPES, '  ').length, PREP_RECIPES.length)
})

test('the drink named comes first, ahead of drinks that only contain it', () => {
  assert.deepEqual(names('pistachio latte').slice(0, 2), ['Iced Pistachio Latte', 'Hot Pistachio Latte'])
  // Every drink NAMED pistachio comes before the ones that only use the sauce or syrup.
  const named = names('pistachio').map((n) => n.includes('Pistachio'))
  assert.ok(named.indexOf(false) === -1 || named.indexOf(false) > named.lastIndexOf(true))
  // Salted caramel: the lattes named for it first, then the Biscoff that only uses caramel sauce.
  const caramel = names('caramel')
  assert.ok(caramel.indexOf('Iced Biscoff Latte') > caramel.indexOf('Hot Caramel Macchiato'))
  assert.ok(names('pistachio').includes('Pistachio Cold Foam'))
})

test('every word must match: "hot pistachio" never shows the iced one', () => {
  const found = names('hot pistachio')
  assert.ok(found.includes('Hot Pistachio Latte'))
  assert.ok(!found.includes('Iced Pistachio Latte'))
})

test('one typo is forgiven', () => {
  assert.equal(names('pistashio latte')[0], 'Iced Pistachio Latte')
  assert.equal(names('carmel macchiato')[0], 'Iced Caramel Macchiato')
  assert.equal(names('spansh')[0], 'Iced Spanish Latte')
})

test('partial words, apostrophes and Arabic names all find the drink', () => {
  assert.equal(names('bisc')[0], 'Iced Biscoff Latte')
  assert.equal(names('sanaani')[0], "Sana'ani")
  assert.equal(names('قهوة عربية')[0], 'Arabic Coffee')
  assert.equal(names('قهوه عربيه')[0], 'Arabic Coffee')
  assert.equal(names('smoothie')[0], 'Frozen Blends (Smoothies)')
})

test('nonsense finds nothing', () => {
  assert.deepEqual(names('zzzz'), [])
})

test('normalize folds case, accents and apostrophes', () => {
  assert.equal(normalize("SANA'ANI Purée"), 'sanaani puree')
})

test('ounces gain millilitres; cup sizes and lines already in mL do not', () => {
  assert.equal(withMl('8 oz milk (dairy or plant-based)'), '8 oz (240 ml) milk (dairy or plant-based)')
  assert.equal(withMl('2oz club soda'), '2oz (60 ml) club soda')
  assert.equal(withMl('1 1/2 oz water'), '1 1/2 oz (45 ml) water')
  assert.equal(withMl('Grab a 16 oz cup and fill it ¾ with ice'), 'Grab a 16 oz cup and fill it ¾ with ice')
  assert.equal(withMl('Grab a 16 oz hot cup'), 'Grab a 16 oz hot cup')
  assert.equal(withMl('12 oz hot water'), '12 oz (360 ml) hot water')
  assert.equal(withMl('1 quart (32 fl oz / 946 mL) heavy whipping cream'), '1 quart (32 fl oz / 946 mL) heavy whipping cream')
})

test('the book is well formed: unique ids, known categories, something to show for every drink', () => {
  const ids = new Set(PREP_RECIPES.map((r) => r.id))
  assert.equal(ids.size, PREP_RECIPES.length)
  for (const r of PREP_RECIPES) {
    assert.ok(PREP_CATEGORIES.includes(r.category), r.id)
    assert.ok(r.page || r.label, `${r.id} has no source page`)
    assert.ok((r.ingredients?.length ?? 0) + (r.sizes?.length ?? 0) > 0, `${r.id} is empty`)
  }
})
