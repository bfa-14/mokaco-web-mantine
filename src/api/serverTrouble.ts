/**
 * WHEN THE ANSWER IS NOT THE API'S. A failed call normally carries the API's own sentence, and that sentence is shown
 * as it stands. But when the API is not running (it is being updated, or it stopped) the web server in front of it
 * answers instead, with a page of HTML - and that page must never be printed into a form as if it were a message.
 *
 *   notAnswering   502 / 503 / 504 with no JSON of the API's: the API is not running or not reachable right now
 *   errorPage      any other failure whose body is a page of HTML
 *   null           the API's own answer: show its sentence
 */
export type ServerTrouble = 'notAnswering' | 'errorPage' | null

export function serverTrouble(status: number, body: unknown): ServerTrouble {
  const text = typeof body === 'string' ? body : null
  const fromApi = body != null && typeof body === 'object'
  if ((status === 502 || status === 503 || status === 504) && !fromApi) return 'notAnswering'
  if (text != null && /<\s*(!doctype|html|head|body|center|h1)\b/i.test(text)) return 'errorPage'
  return null
}
