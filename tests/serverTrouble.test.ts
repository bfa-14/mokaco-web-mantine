import { test } from 'node:test'
import assert from 'node:assert/strict'
import { serverTrouble } from '../src/api/serverTrouble.ts'

const NGINX_502 =
  '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx/1.24.0 (Ubuntu)</center>\r\n</body>\r\n</html>'

test("the web server's 502 page is never shown as a message: the API is not answering", () => {
  assert.equal(serverTrouble(502, NGINX_502), 'notAnswering')
  assert.equal(serverTrouble(503, '<html><body>Service Unavailable</body></html>'), 'notAnswering')
  assert.equal(serverTrouble(504, null), 'notAnswering')
  assert.equal(serverTrouble(502, ''), 'notAnswering')
})

test("the API's own 502 or 503, with its sentence, is shown as it stands", () => {
  assert.equal(serverTrouble(502, { error: 'We could not start the payment step.', code: 'gateway_error' }), null)
  assert.equal(serverTrouble(503, { error: 'Bookings are paused.', code: 'paused' }), null)
})

test('a page of HTML under any other status is an error page, not a sentence', () => {
  assert.equal(serverTrouble(500, '<!DOCTYPE html><html><body>Internal Server Error</body></html>'), 'errorPage')
  assert.equal(serverTrouble(413, '<html><head><title>413 Request Entity Too Large</title></head></html>'), 'errorPage')
})

test("the API's refusals keep their own words", () => {
  assert.equal(serverTrouble(400, { error: 'Enter a refund amount greater than zero.' }), null)
  assert.equal(serverTrouble(400, 'Amount exceeds the balance'), null)
  assert.equal(serverTrouble(401, null), null)
  assert.equal(serverTrouble(404, ''), null)
})
