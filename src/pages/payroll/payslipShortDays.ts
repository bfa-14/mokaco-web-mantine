/**
 * The payslip line that deducts short days ("2.25 day(s) short across 4 date(s)", script 103 section D): an
 * attendance line with no source record and that wording. Pure: `npm test` reads this file directly.
 */
export function isShortDaysLine(line: { sourceType: string; sourceId: number | null; note: string | null }): boolean {
  return line.sourceType === 'Attendance' && line.sourceId == null && /day\(s\) short across/.test(line.note ?? '')
}

/** The list and the line disagree (attendance changed after the run was generated): compare at two decimals. */
export function listDiffersFromLine(total: number, line: number | null): boolean {
  if (line == null) return false
  return Math.round(total * 100) !== Math.round(line * 100)
}
