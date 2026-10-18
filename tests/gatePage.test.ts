/**
 * THE GATE PAGE SPEAKS BOTH LANGUAGES, IN FULL, AND THE SETTINGS TAB DOES TOO.
 *
 * The gate is the first thing a phone sees when Google sign-in is on, before anybody has chosen a
 * language — so a key missing from one language is a blank line on the one screen nobody can get
 * past. Same for the Settings → Google sign-in tab (googleGate.* in src/i18n). Also the gate's two
 * small guesses about the reader: which language to start in, and whether it is inside an app's
 * built-in browser. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STRINGS, LANGUAGES, isInAppBrowser, pickLanguage, refusalKey } from '../public/gate/strings.js'

const here = dirname(fileURLToPath(import.meta.url))

/** Every leaf key of a nested dictionary, as dotted paths. */
function leafKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === 'object'
      ? leafKeys(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  )
}

test('the gate page has the same keys in English and Arabic, none empty', () => {
  assert.deepEqual(LANGUAGES, ['en', 'ar'])
  const en = Object.keys(STRINGS.en).sort()
  assert.deepEqual(Object.keys(STRINGS.ar).sort(), en)
  for (const lang of LANGUAGES) {
    for (const [key, value] of Object.entries(STRINGS[lang as 'en' | 'ar'])) {
      assert.ok(typeof value === 'string' && value.trim() !== '', `${lang}.${key}`)
    }
  }
})

test('the gate page fills the same placeholders in both languages', () => {
  const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
  for (const key of Object.keys(STRINGS.en) as (keyof typeof STRINGS.en)[]) {
    assert.equal(holes(STRINGS.ar[key]), holes(STRINGS.en[key]), key)
  }
})

test('every refusal maps to a sentence the page has', () => {
  for (const status of [0, 400, 403, 429, 500, 503]) {
    assert.ok(refusalKey(status) in STRINGS.en, String(status))
  }
  assert.equal(refusalKey(403), 'refused403')
  assert.equal(refusalKey(429), 'tooMany')
  assert.equal(refusalKey(418), 'failed')
})

test('the remembered language wins; otherwise Arabic only for an Arabic phone', () => {
  assert.equal(pickLanguage('ar', ['en-US']), 'ar')
  assert.equal(pickLanguage('en', ['ar-LB']), 'en')
  assert.equal(pickLanguage(null, ['ar-LB', 'en']), 'ar')
  assert.equal(pickLanguage(null, ['AR']), 'ar')
  assert.equal(pickLanguage(null, ['en-GB', 'ar']), 'en')
  assert.equal(pickLanguage('fr', ['fr-FR']), 'en')
  assert.equal(pickLanguage(undefined, undefined), 'en')
  assert.equal(pickLanguage(null, []), 'en')
})

test("an app's built-in browser is recognised; Chrome and Safari are not", () => {
  const androidWebView =
    'Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36'
  const whatsApp = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.10'
  const facebook = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]'
  const chrome =
    'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'
  const safari =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  assert.equal(isInAppBrowser(androidWebView), true)
  assert.equal(isInAppBrowser(whatsApp), true)
  assert.equal(isInAppBrowser(facebook), true)
  assert.equal(isInAppBrowser(chrome), false)
  assert.equal(isInAppBrowser(safari), false)
  assert.equal(isInAppBrowser(''), false)
  assert.equal(isInAppBrowser(undefined), false)
})

test('the Settings tab (googleGate.*) has the same keys in en.json and ar.json, none empty', () => {
  const en = JSON.parse(readFileSync(resolve(here, '../src/i18n/en.json'), 'utf8'))
  const ar = JSON.parse(readFileSync(resolve(here, '../src/i18n/ar.json'), 'utf8'))
  const enKeys = leafKeys(en.googleGate).sort()
  assert.ok(enKeys.length > 50)
  assert.deepEqual(leafKeys(ar.googleGate).sort(), enKeys)
  for (const key of enKeys) {
    const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], ar.googleGate)
    assert.ok(typeof value === 'string' && value.trim() !== '', `ar googleGate.${key}`)
  }
  assert.ok(en.settings.tabs.google && ar.settings.tabs.google)
  assert.ok(en.security.permissions.ACCESS_MANAGE && ar.security.permissions.ACCESS_MANAGE)
})

test('the Settings tab fills the same placeholders in en.json and ar.json', () => {
  const en = JSON.parse(readFileSync(resolve(here, '../src/i18n/en.json'), 'utf8'))
  const ar = JSON.parse(readFileSync(resolve(here, '../src/i18n/ar.json'), 'utf8'))
  const holes = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(',')
  for (const key of leafKeys(en.googleGate)) {
    const pick = (d: Record<string, unknown>) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], d) as string
    assert.equal(holes(pick(ar.googleGate)), holes(pick(en.googleGate)), `googleGate.${key}`)
  }
})

/*
 * "How to set it up" must include publishing the Google app. A new app starts in Testing, where
 * only the test users listed in Google can sign in: an admin who is one of them passes "Test Google
 * sign-in" and turns the gate on, and every other employee is then refused by Google.
 */
test('the how-to says to publish the Google app, in both languages, and every step is shown', () => {
  const section = readFileSync(resolve(here, '../src/pages/settings/GoogleSignInSection.tsx'), 'utf8')
  for (const lang of ['en', 'ar']) {
    const howTo = JSON.parse(readFileSync(resolve(here, `../src/i18n/${lang}.json`), 'utf8')).googleGate.howTo
    const steps = Object.keys(howTo).filter((k) => k !== 'title')
    assert.deepEqual(steps, steps.map((_, i) => `step${i + 1}`), `${lang}: step1, step2, … in order`)
    const text = steps.map((k) => howTo[k]).join('\n')
    assert.match(text, /Publish app/, `${lang}: publish the app`)
    assert.match(text, /In production/, `${lang}: until it says In production`)
    assert.match(text, /Authorized JavaScript origins/, `${lang}: the console's spelling`)
    assert.doesNotMatch(text, /APIs & Services|Credentials/, `${lang}: the old console's menu`)
    assert.match(text, /\{\{doc\}\}/, `${lang}: points to the full steps`)
    for (const k of steps) assert.ok(section.includes(`'googleGate.howTo.${k}'`), `the tab shows ${k}`)
  }
})

/*
 * The API's sentences are English. On the Arabic tab a bare one takes the page's right-to-left
 * direction and its full stop jumps to the wrong end, so every error on the tab goes through
 * ServerText (dir="auto"): no alert renders a bare {variable}, no notification a bare message.
 */
test('the Settings tab shows refusals with their own direction', () => {
  const dir = resolve(here, '../src/pages/settings')
  for (const file of ['GoogleSignInSection.tsx', 'GoogleSignInDialogs.tsx', 'GoogleSignInExtras.tsx', 'GoogleSignInPeople.tsx']) {
    const source = readFileSync(resolve(dir, file), 'utf8')
    assert.doesNotMatch(source, /role="alert"[^>]*>\s*\{\w+\}/, `${file}: an alert shows a bare message`)
    assert.doesNotMatch(source, /message: getErrorMessage\(/, `${file}: a notification shows a bare message`)
    // A bare string may only go to ConfirmDialog, which shows it through ServerText itself.
    for (const m of source.matchAll(/\berror=\{(\w+)\}/g)) {
      const tag = [...source.slice(0, m.index).matchAll(/<([A-Z]\w*)/g)].at(-1)?.[1]
      assert.equal(tag, 'ConfirmDialog', `${file}: ${m[1]} shown bare on <${tag}>`)
    }
  }
  assert.match(
    readFileSync(resolve(dir, 'GoogleSignInDialogs.tsx'), 'utf8'),
    /export function ServerText[\s\S]*?<span dir="auto">\{text\}<\/span>/,
  )
})
