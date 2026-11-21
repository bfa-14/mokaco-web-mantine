/**
 * THE RECIPES PAGE FINDS THE DRINK THAT WAS TYPED, typos and all, and shows millilitres next to ounces
 * without touching cup sizes. Run with `npm test`.
 *
 * The drinks below are a made-up sample: the real recipe book is confidential and is never in this repository
 * (an admin uploads it on the Recipes page).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize, otherTemp, searchRecipes, withMl } from '../src/pages/prepBook/prepSearch.ts'

const SAMPLE = [
  { name: 'Iced Pistachio Latte', ingredients: ['espresso', 'pistachio sauce', 'milk'] },
  { name: 'Hot Pistachio Latte', ingredients: ['espresso', 'pistachio sauce', 'milk'] },
  { name: 'Iced Caramel Macchiato', ingredients: ['espresso', 'caramel', 'milk'] },
  { name: 'Hot Caramel Macchiato', ingredients: ['espresso', 'caramel', 'milk'] },
  { name: 'Iced Biscoff Latte', ingredients: ['espresso', 'biscoff spread', 'caramel sauce', 'milk'] },
  { name: 'Iced Spanish Latte', ingredients: ['espresso', 'condensed milk'] },
  { name: 'Pistachio Cold Foam', ingredients: ['pistachio', 'heavy cream'] },
  { name: "Sana'ani", aliases: ['صنعاني'], sizes: [{ size: '12 oz', items: ['1 scoop'] }] },
  { name: 'Arabic Coffee', aliases: ['قهوة عربية'], sizes: [{ size: '12 oz', items: ['1 scoop'] }] },
  { name: 'Frozen Blends (Smoothies)', aliases: ['smoothie'], ingredients: ['smoothie mix', 'milk'] },
]

const names = (q: string) => searchRecipes(SAMPLE, q).map((r) => r.name)

test('an empty search shows the whole book in its own order', () => {
  assert.deepEqual(names('  '), SAMPLE.map((r) => r.name))
})

test('the drink named comes first, ahead of drinks that only contain it', () => {
  assert.deepEqual(names('pistachio latte').slice(0, 2), ['Iced Pistachio Latte', 'Hot Pistachio Latte'])
  // Caramel: the drinks named for it first, then the one that only uses caramel sauce.
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
  assert.equal(normalize('Coffee Frappé'), 'coffee frappe')
})

test('ounces gain millilitres; cup sizes and lines already in mL do not', () => {
  assert.equal(withMl('8 oz milk (dairy or plant-based)'), '8 oz (240 ml) milk (dairy or plant-based)')
  assert.equal(withMl('2oz club soda'), '2oz (60 ml) club soda')
  assert.equal(withMl('1 1/2 oz water'), '1 1/2 oz (45 ml) water')
  assert.equal(withMl('Grab a 16 oz cup and fill it ¾ with ice'), 'Grab a 16 oz cup and fill it ¾ with ice')
  assert.equal(withMl('Grab a 16 oz hot cup'), 'Grab a 16 oz hot cup')
  assert.equal(withMl('12 oz hot water'), '12 oz (360 ml) hot water')
  assert.equal(withMl('1 quart (32 fl oz / 946 mL) heavy whipping cream'), '1 quart (32 fl oz / 946 mL) heavy whipping cream')
  assert.equal(withMl('150 ml milk'), '150 ml milk')
})

test('a drink finds its other temperature, and only its own', () => {
  const book = [
    { name: 'Iced Pistachio Latte', category: 'coffee', temp: 'iced' },
    { name: 'Hot Pistachio Latte', category: 'coffee', temp: 'hot' },
    { name: 'Iced White Mocha Latte', category: 'coffee', temp: 'iced' },
    { name: 'Hot White Mocha', category: 'coffee', temp: 'hot' },
    { name: 'Brown Sugar Shaken Oat Iced Latte', category: 'coffee', temp: 'iced' },
    { name: 'Brown Sugar Oat Latte', category: 'coffee', temp: 'hot' },
    { name: 'Iced Matcha', category: 'matcha', temp: 'iced' },
    { name: 'Hot Matcha Latte', category: 'matcha', temp: 'hot' },
    { name: 'Iced Pistachio Matcha', category: 'matcha', temp: 'iced' },
    { name: 'Hot Pistachio Matcha', category: 'matcha', temp: 'hot' },
    { name: 'Mango Refresher', category: 'refreshers' },
  ]
  const other = (name: string) => otherTemp(book.find((r) => r.name === name)!, book)?.name ?? null
  assert.equal(other('Iced Pistachio Latte'), 'Hot Pistachio Latte')
  assert.equal(other('Hot White Mocha'), 'Iced White Mocha Latte')
  assert.equal(other('Brown Sugar Oat Latte'), 'Brown Sugar Shaken Oat Iced Latte')
  assert.equal(other('Iced Matcha'), 'Hot Matcha Latte')
  assert.equal(other('Hot Pistachio Matcha'), 'Iced Pistachio Matcha')
  assert.equal(other('Mango Refresher'), null)
})

test('a page of a PDF guide is found by a word written on it, its name first', () => {
  const pages = [
    { name: 'Page 1', text: '' },
    { name: 'Test Latte', text: 'Test Latte\n2 shots of water\nstir gently' },
    { name: 'Sample Frappe', text: 'Sample Frappe\nblend with ice\nserve with a test latte biscuit' },
  ]
  assert.deepEqual(searchRecipes(pages, 'stir').map((p) => p.name), ['Test Latte'])
  assert.deepEqual(searchRecipes(pages, 'latte').map((p) => p.name), ['Test Latte', 'Sample Frappe'])
  assert.deepEqual(searchRecipes(pages, 'mango'), [])
})
