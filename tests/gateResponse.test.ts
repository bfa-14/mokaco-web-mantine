/**
 * A 401 FROM THE GOOGLE SIGN-IN GATE RELOADS THE PAGE; ANY OTHER 401 IS THE TOKEN'S BUSINESS.
 *
 * nginx answers a gated /api or /hubs call with 401 and `X-Mokaco-Gate: required`. The API client
 * (src/api/client.ts) must tell that apart from the JWT middleware's 401: one means "show the gate"
 * (reload), the other "refresh the token, or sign in again". Mixing them up either signs a working
 * session out or leaves a page failing behind a closed gate. The same holds for every other place
 * that can end the session on a failure — restoring it on load, and the live-updates socket.
 * Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GATE_HEADER,
  GATE_RELOAD_GUARD_MS,
  isGateError,
  isGateResponse,
  mayReloadForGate,
  refusedByGate,
} from '../src/api/gateResponse.ts'

const headers = (init: Record<string, string>) => new Headers(init)

test('a 401 carrying the gate header is the gate, in any letter case', () => {
  assert.equal(GATE_HEADER, 'X-Mokaco-Gate')
  assert.equal(isGateResponse({ status: 401, headers: headers({ 'X-Mokaco-Gate': 'required' }) }), true)
  assert.equal(isGateResponse({ status: 401, headers: headers({ 'x-mokaco-gate': 'required' }) }), true)
  assert.equal(isGateResponse(new Response(null, { status: 401, headers: { 'X-Mokaco-Gate': 'required' } })), true)
})

test("the JWT middleware's 401 is not the gate", () => {
  assert.equal(isGateResponse({ status: 401, headers: headers({}) }), false)
  assert.equal(isGateResponse({ status: 401, headers: headers({ 'WWW-Authenticate': 'Bearer' }) }), false)
  assert.equal(isGateResponse({ status: 401, headers: headers({ 'X-Mokaco-Gate': ' ' }) }), false)
})

test('the header on any other status is not the gate', () => {
  for (const status of [200, 204, 400, 403, 404, 500]) {
    assert.equal(isGateResponse({ status, headers: headers({ 'X-Mokaco-Gate': 'required' }) }), false, String(status))
  }
})

test('a gate reload is not repeated inside the guard window', () => {
  const now = 1_000_000
  assert.equal(mayReloadForGate(null, now), true)
  assert.equal(mayReloadForGate(Number.NaN, now), true)
  assert.equal(mayReloadForGate(now - 1, now), false)
  assert.equal(mayReloadForGate(now - GATE_RELOAD_GUARD_MS + 1, now), false)
  assert.equal(mayReloadForGate(now - GATE_RELOAD_GUARD_MS, now), true)
  // A clock that went backwards must not hold the guard shut.
  assert.equal(mayReloadForGate(now + 60_000, now), true)
})

test('the error thrown for a gated call is told apart from any other', () => {
  assert.equal(isGateError({ status: 401, data: { gate: true, reloading: true } }), true)
  assert.equal(isGateError({ status: 401, data: { gate: true, reloading: false } }), true)
  // The token's 401, and the API's own error bodies, are not the gate.
  assert.equal(isGateError({ status: 401, data: undefined }), false)
  assert.equal(isGateError({ status: 401, data: { error: 'Invalid token.' } }), false)
  assert.equal(isGateError({ status: 401, data: { gate: 'true' } }), false)
  assert.equal(isGateError({ status: 403, data: { gate: true, reloading: true } }), false)
  assert.equal(isGateError(new Error('401')), false)
  assert.equal(isGateError(null), false)
  assert.equal(isGateError('401'), false)
})

test('a refused handshake asked again: only the gate header says "gate"', async () => {
  const answer = (status: number, init: Record<string, string> = {}) => async () => ({ status, headers: headers(init) })
  assert.equal(await refusedByGate(answer(401, { 'X-Mokaco-Gate': 'required' })), true)
  assert.equal(await refusedByGate(answer(401, { 'WWW-Authenticate': 'Bearer' })), false)
  assert.equal(await refusedByGate(answer(200)), false)
  // Nothing came back at all: nothing says the gate is there, so the old path stands.
  assert.equal(await refusedByGate(async () => { throw new TypeError('Failed to fetch') }), false)
})

/*
 * EVERY PLACE THAT ENDS THE SESSION ON A FAILURE ASKS ABOUT THE GATE FIRST.
 *
 * The gate's 401 must keep the tab's HRMS tokens. The API client knew that, but restoring the
 * session on load and the live-updates socket did not, and each signed people out of the HRMS when
 * only Google's sign-in had lapsed. Read as text, like routeTable.test.ts: a file that calls
 * redirectToLogin() or tokenStorage.clear() must use one of the gate checks, or be listed here as a
 * deliberate sign-out.
 */
const DELIBERATE_SIGN_OUTS: Record<string, string> = {
  'src/auth/sessionRedirect.ts': 'defines redirectToLogin',
  'src/services/authService.ts': 'the Sign out button',
  'src/environment.ts': 'switching between production and test',
}

test('every place that ends the session on a failure checks for the gate first', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const files = (readdirSync(join(root, 'src'), { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => join(root, 'src', f))
  const endsSession = /\bredirectToLogin\(\)|\btokenStorage\.clear\(\)/
  const asksGate = /\b(isGateResponse|isGateError|refusedByGate)\(/
  const found: string[] = []
  for (const file of files) {
    const name = relative(root, file).split('\\').join('/')
    const source = readFileSync(file, 'utf8')
    if (!endsSession.test(source)) continue
    found.push(name)
    if (name in DELIBERATE_SIGN_OUTS) continue
    assert.match(source, asksGate, `${name} ends the session without asking whether the gate refused`)
  }
  // The scan itself works: the three known places are among what it found.
  for (const name of ['src/api/client.ts', 'src/auth/AuthProvider.tsx', 'src/live/liveClient.ts']) {
    assert.ok(found.includes(name), name)
  }
})
