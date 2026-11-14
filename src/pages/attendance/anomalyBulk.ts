/**
 * THE BULK EXCUSE / DEDUCT ACTS ON THE ROWS THE READER IS LOOKING AT, AND ON NO OTHERS.
 *
 * The Anomalies page narrows its list twice: the filters on top (period, type, decision, branch) and
 * the list's own search box and column filters. The two buttons used to read only the first, so
 * searching one name, seeing three rows and pressing "Excuse all" decided every undecided row of the
 * month. A decision moves pay, so the set is the rows left after BOTH.
 *
 * Pure, no imports: `npm test` reads this file directly.
 */

/** The three fields of an anomaly row this rule reads. */
export interface BulkRow {
  anomalyId: number
  decision: string | null
  type: string
}

/**
 * What a bulk decision would touch.
 * @param shown        the rows the top filters leave
 * @param listVisible  the ids the list itself still shows after its own search and column filters
 *                     (every page of them); null while the list has not reported yet
 */
export function bulkTargets<T extends BulkRow>(
  shown: readonly T[],
  listVisible: ReadonlySet<number> | null,
): { rows: T[]; skipped: number } {
  const visible = listVisible ? shown.filter((row) => listVisible.has(row.anomalyId)) : [...shown]
  const undecided = visible.filter((row) => row.decision == null)
  return {
    // A missing punch has no minutes to excuse or deduct: it needs its own corrected time.
    rows: undecided.filter((row) => row.type !== 'MissingPunch'),
    skipped: undecided.filter((row) => row.type === 'MissingPunch').length,
  }
}

/**
 * The month's one-call endpoint decides "every undecided late / early of the month, optionally of one
 * branch". It may be used only when the rows on screen ARE that set: a whole month, no type filter,
 * and nothing narrowed inside the list. Otherwise each row is decided on its own.
 */
export function coversWholeMonth(scope: {
  typeFilter: string
  listNarrowed: boolean
  from: string
  to: string
  monthFrom: string
  monthTo: string
}): boolean {
  return !scope.typeFilter && !scope.listNarrowed && scope.from === scope.monthFrom && scope.to === scope.monthTo
}

/**
 * Are these the same anomalies, whatever their order? The list is read again just before a month-wide
 * decision: if anomalies arrived or were decided since the page was loaded, the two sets differ and
 * nothing is decided on the strength of a stale screen.
 */
export function sameRows(a: readonly BulkRow[], b: readonly BulkRow[]): boolean {
  if (a.length !== b.length) return false
  const ids = new Set(a.map((row) => row.anomalyId))
  return ids.size === a.length && b.every((row) => ids.has(row.anomalyId))
}
