/**
 * THE APP READS PRODUCTION UNLESS THE COOKIE SAYS EXACTLY "test".
 *
 * The test environment is chosen by nginx from the mokaco_env cookie; the app only reads it to
 * colour the header and the switch. Reading it wrong one way paints live data as a test copy;
 * reading it wrong the other way hides that the user is on the copy. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { environmentFromCookie, switchPath } from '../src/environmentCookie.ts'

test('no cookie, or no mokaco_env among them, is production', () => {
  assert.equal(environmentFromCookie(''), 'production')
  assert.equal(environmentFromCookie('theme=dark; lang=ar'), 'production')
})

test('mokaco_env=test anywhere in the list is test', () => {
  assert.equal(environmentFromCookie('mokaco_env=test'), 'test')
  assert.equal(environmentFromCookie('lang=ar; mokaco_env=test; theme=dark'), 'test')
  assert.equal(environmentFromCookie('lang=ar;mokaco_env=test'), 'test')
})

test('any other value, or a cookie that only ends in the name, is production', () => {
  assert.equal(environmentFromCookie('mokaco_env='), 'production')
  assert.equal(environmentFromCookie('mokaco_env=prod'), 'production')
  assert.equal(environmentFromCookie('mokaco_env=testing'), 'production')
  assert.equal(environmentFromCookie('x_mokaco_env=test'), 'production')
})

test('the switch goes to the two paths nginx answers', () => {
  assert.equal(switchPath('test'), '/env/test')
  assert.equal(switchPath('production'), '/env/prod')
})
