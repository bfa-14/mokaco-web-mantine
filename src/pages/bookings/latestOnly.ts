/**
 * Only the LATEST answer is applied (WEB-17).
 *
 * A page that fetches on every change — paging through weeks, a live message, a filter, a form
 * field — has several requests in flight, and they do not come back in the order they left: an older
 * answer arriving last used to overwrite the newer one (the booking calendar drew the previous week's
 * bookings under this week's dates). `begin()` marks a new request and returns a check that stays true
 * only while no later request has begun; `cancel()` makes everything in flight stale (an unmount).
 *
 * The sequence-number guard of RequestsHubPage (reqSeq), as a pure function so that it is tested
 * (tests/bookingLatest.test.ts). No imports: `npm test` runs it as is.
 */
export interface Latest {
  /** A new request: the returned check is true while it is still the latest one. */
  begin(): () => boolean
  /** Every request in flight is stale from now on. */
  cancel(): void
}

export function latestOnly(): Latest {
  let current = 0
  return {
    begin() {
      const mine = ++current
      return () => mine === current
    },
    cancel() {
      current++
    },
  }
}
