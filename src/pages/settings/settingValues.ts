/**
 * THE TWO DIALECTS core.SETTING actually stores a bool in.
 *
 * The table holds both: AllowSystemReset and NotifyOnRequestClosed are '1', while ShowPageHelp and
 * MachinePullEnabled are 'true'. Reading only 'true' as on — which is what this file did — shows
 * every '1' row as OFF and, worse, writes 'true' the first time somebody touches it. That is not
 * cosmetic for NotifyOnRequestClosed: core.usp_Email_QueueClosedRequests tests `<> '1'` and RETURNS,
 * so a switch that saved 'true' would silently turn the automatic mail OFF while displaying it as on.
 */
export const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

/** Is this stored value the ON state, in either dialect? */
export function isOn(value: string): boolean {
  return TRUE_VALUES.has(value.trim().toLowerCase())
}

/**
 * The new value to store, IN THE DIALECT THE ROW ALREADY USES — read from what the server holds, not
 * from the draft, so toggling twice returns the row to exactly the string it started with. A key
 * with no value yet has no dialect to keep, and gets '1'/'0' (QA3): several procedures test
 * `= '1'` only (the booking switches did until script 104), while every C# reader and every newer
 * procedure accept both, so '1' is the value that every reader understands.
 */
export function boolValue(stored: string, on: boolean): string {
  const current = stored.trim().toLowerCase()
  const words = current === 'true' || current === 'false' || current === 'yes' || current === 'no' || current === 'on' || current === 'off'
  return words ? (on ? 'true' : 'false') : on ? '1' : '0'
}
