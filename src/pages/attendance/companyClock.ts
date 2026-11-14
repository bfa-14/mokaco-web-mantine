/**
 * A SERVER TIMESTAMP IN UTC, SHOWN ON THE COMPANY'S CLOCK. Punch times are the terminal's wall clock (Beirut) and
 * are shown as they are; but the moments the SERVER stamps (a punch landing, CreatedUtc) are UTC, and printing
 * them raw put "landed 08:01" beside a punch made at 09:39. This converts them to Beirut time.
 *
 * Pure, no imports: `npm test` reads this file directly.
 */

/** '2026-11-14T08:01:23' (UTC, with or without a Z) → { day: '14/11/2026', time: '10:01' } in Beirut. */
export function utcToCompany(value: string | null | undefined): { day: string; time: string } | null {
  if (!value) return null
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Beirut',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { day: `${get('day')}/${get('month')}/${get('year')}`, time: `${get('hour')}:${get('minute')}` }
}
