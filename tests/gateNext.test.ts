/**
 * THE GATE PAGE NEVER SENDS A FRESHLY SIGNED-IN PHONE OFF-SITE, OR BACK TO ITSELF.
 *
 * public/gate/next.js decides where /gate/?next=… goes once Google has said yes. `next` comes out of
 * a URL, so it is attacker-supplied; whatever is refused lands on '/'. The rule is the app's own
 * safeNextPath (src/auth/sessionRedirect.ts), plus backslashes, control characters and the gate's
 * own paths. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_NEXT, isGatePath, safeNextPath } from '../public/gate/next.js'

test('a plain in-app path is kept as it is, query and hash included', () => {
  assert.equal(safeNextPath('/employees'), '/employees')
  assert.equal(safeNextPath('/requests/12?tab=history#top'), '/requests/12?tab=history#top')
  assert.equal(safeNextPath('/login?next=%2Femployees'), '/login?next=%2Femployees')
  assert.equal(safeNextPath('/settings?tab=google'), '/settings?tab=google')
})

test('nothing, or not a string, goes to the dashboard', () => {
  assert.equal(DEFAULT_NEXT, '/')
  assert.equal(safeNextPath(null), '/')
  assert.equal(safeNextPath(undefined), '/')
  assert.equal(safeNextPath(''), '/')
  assert.equal(safeNextPath('/'), '/')
})

test('another site, in any spelling, is refused', () => {
  for (const raw of [
    'https://evil.example/',
    'http://evil.example',
    '//evil.example',
    '///evil.example',
    'evil.example',
    'javascript:alert(1)',
    'employees',
  ]) {
    assert.equal(safeNextPath(raw), '/', raw)
  }
})

test('a backslash anywhere is refused — browsers read it as a slash', () => {
  assert.equal(safeNextPath('/\\evil.example'), '/')
  assert.equal(safeNextPath('/\\/evil.example'), '/')
  assert.equal(safeNextPath('/employees\\x'), '/')
})

test('control characters are refused — the URL parser deletes tabs and newlines', () => {
  assert.equal(safeNextPath('/\t/evil.example'), '/')
  assert.equal(safeNextPath('/\n/evil.example'), '/')
  assert.equal(safeNextPath('/\r/evil.example'), '/')
  assert.equal(safeNextPath('/employees\u0000'), '/')
  assert.equal(safeNextPath('/x\u007f'), '/')
})

test('the gate itself is never a destination', () => {
  for (const raw of ['/gate', '/gate/', '/gate/index.html', '/gate?next=/x', '/gate#x', '/./gate/', '/x/../gate/']) {
    assert.equal(safeNextPath(raw), '/', raw)
  }
  // Only the gate's own folder — a path that merely starts with the letters is an ordinary page.
  assert.equal(safeNextPath('/gateway'), '/gateway')
})

test('isGatePath names the gate page and nothing else', () => {
  assert.equal(isGatePath('/gate'), true)
  assert.equal(isGatePath('/gate/'), true)
  assert.equal(isGatePath('/gate/index.html'), true)
  assert.equal(isGatePath('/'), false)
  assert.equal(isGatePath('/employees'), false)
  assert.equal(isGatePath('/gateway'), false)
  assert.equal(isGatePath('/x/gate/'), false)
})
