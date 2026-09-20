import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

const YMD = /^\d{4}-\d{2}-\d{2}$/

/**
 * A page's from–to period, KEPT IN THE URL (?from=&to=) so it survives a reload and travels in a link.
 *
 * The default is NOT written: a page opened plainly keeps a plain address, and "back to the default" removes the two
 * parameters again. A hand-typed address with a malformed or inverted pair falls back to the default rather than
 * sending the server a range it will refuse. Replace, not push — nudging a filter must not bury the page the user
 * came from under history entries.
 *
 * `defaults: null` is the filter that may be empty (the Requests hub): no parameters = no date filter.
 */
export function useDateRangeParams(defaults: { from: string; to: string } | null) {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawFrom = searchParams.get('from')
  const rawTo = searchParams.get('to')
  const valid = rawFrom != null && rawTo != null && YMD.test(rawFrom) && YMD.test(rawTo) && rawFrom <= rawTo
  const from = valid ? rawFrom : (defaults?.from ?? null)
  const to = valid ? rawTo : (defaults?.to ?? null)

  const defaultFrom = defaults?.from ?? null
  const defaultTo = defaults?.to ?? null
  const setRange = useCallback(
    (nextFrom: string | null, nextTo: string | null) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current)
          const isDefault = nextFrom === defaultFrom && nextTo === defaultTo
          if (!nextFrom || !nextTo || isDefault) {
            params.delete('from')
            params.delete('to')
          } else {
            params.set('from', nextFrom)
            params.set('to', nextTo)
          }
          return params
        },
        { replace: true },
      )
    },
    [setSearchParams, defaultFrom, defaultTo],
  )

  return { from, to, setRange }
}
