/**
 * A 429 ON THE TOKEN REFRESH KEEPS THE SESSION AND WAITS (QA3 SEC-6).
 *
 * The API rate-limits /api/auth/refresh and answers the excess with 429 + Retry-After. The client
 * (src/api/client.ts) used to read any refused refresh as "session over" and send the person to the
 * login page. Now it waits as asked, within a cap, asks once more, and keeps the tokens either way.
 * Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REFRESH_RETRY_DEFAULT_MS,
  REFRESH_RETRY_MIN_MS,
  REFRESH_WAIT_CAP_MS,
  isRateLimited,
  refreshWaitMs,
  retryAfterMs,
} from '../src/api/refreshThrottle.ts'

const now = Date.UTC(2026, 9, 19, 9, 0, 0)

test('Retry-After in seconds, as the API sends it', () => {
  assert.equal(retryAfterMs('60', now), 60_000)
  assert.equal(retryAfterMs(' 5 ', now), 5_000)
  assert.equal(retryAfterMs('1.5', now), 1_500)
})

test('Retry-After as an HTTP date', () => {
  assert.equal(retryAfterMs(new Date(now + 30_000).toUTCString(), now), 30_000)
  // A date already past is "now", held to the minimum.
  assert.equal(retryAfterMs(new Date(now - 30_000).toUTCString(), now), REFRESH_RETRY_MIN_MS)
})

test('a missing or unreadable Retry-After is "a moment"', () => {
  for (const header of [null, undefined, '', '  ', 'soon', '-5', '1e3', '12:00']) {
    assert.equal(retryAfterMs(header, now), REFRESH_RETRY_DEFAULT_MS, String(header))
  }
})

test('the wait is kept between the minimum and the cap', () => {
  assert.equal(retryAfterMs('0', now), REFRESH_RETRY_MIN_MS)
  assert.equal(retryAfterMs('3600', now), REFRESH_WAIT_CAP_MS)
  assert.equal(retryAfterMs(new Date(now + 3_600_000).toUTCString(), now), REFRESH_WAIT_CAP_MS)
})

test('one call waits once for what the server asked, then gives up keeping the session', () => {
  // Never told to wait: ask at once.
  assert.equal(refreshWaitMs(0, now, 0), 0)
  assert.equal(refreshWaitMs(now - 1, now, 0), 0)
  // Told 60 s: wait the 60 s.
  assert.equal(refreshWaitMs(now + 60_000, now, 0), 60_000)
  // Refused again after waiting them: another minute would pass the cap — give up for this call.
  assert.equal(refreshWaitMs(now + 60_000, now, 60_000), null)
  // A short wait after a short wait still fits.
  assert.equal(refreshWaitMs(now + 10_000, now, 10_000), 10_000)
  // A clock that jumped back is held to the cap rather than waiting an hour.
  assert.equal(refreshWaitMs(now + 3_600_000, now, 0), REFRESH_WAIT_CAP_MS)
})

test('"too many requests" is told apart from the session ending', () => {
  assert.equal(isRateLimited({ status: 429, data: { refreshLimited: true } }), true)
  assert.equal(isRateLimited({ status: 429 }), true)
  for (const err of [{ status: 401 }, { status: 403 }, new Error('429'), null, '429', undefined]) {
    assert.equal(isRateLimited(err), false, String(err))
  }
})

/*
 * Read as text, like gateResponse.test.ts: the client must not send a 429 down the "session over"
 * path, and restoring the session on load must not throw the tokens away on one either.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('the API client waits on a 429 from the refresh instead of signing out', () => {
  const client = read('src/api/client.ts')
  assert.match(client, /response\.status === 429/)
  assert.match(client, /retryAfterMs\(/)
  assert.match(client, /refreshWaitMs\(/)
  assert.match(client, /kind === 'limited'/)
})

test('restoring the session keeps the tokens when the refresh was only rate-limited', () => {
  assert.match(read('src/auth/AuthProvider.tsx'), /isRateLimited\(err\)/)
})

test('signing out never turns into a refresh (a changed password has already ended the session)', () => {
  const service = read('src/services/authService.ts')
  assert.match(service, /'\/api\/auth\/logout',[\s\S]{0,160}?skipRefresh: true,\s*\}\)/)
})
