import { parseDecimal } from './numeric.ts'
import type { NumberInputValue } from './numeric.ts'

/**
 * TRAP 6, ONE CONVERSION AT SUBMIT (handoff section 11).
 *
 * A NumberInput whose onChange did `typeof v === 'number' ? v : null` wrote null back the moment a
 * separator was typed ("0." is a string to Mantine), the box re-rendered empty, and the next digit
 * started a new number: 0.5 became 5 — clamped to a whole day — and 12.50 became 50 (QA3 WEB-5).
 * The forms now keep what the box holds, exactly as received, and convert it ONCE, here, when the
 * figure is needed. Pure, so the conversions are tested without a component (tests/decimalInputs.test.ts).
 */

/** A figure that must lie in [min, max]: null for a blank box, 'invalid' for anything else that is not such a number. */
export function parseBoundedDecimal(
  value: NumberInputValue | null | undefined,
  min: number,
  max: number,
): number | null | 'invalid' {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null
  const n = parseDecimal(typeof value === 'string' ? value.trim() : value)
  if (n == null || n < min || n > max) return 'invalid'
  return n
}

/**
 * One editor row of an inline grid, converted for the save: every NUMBER column through parseDecimal,
 * every text column trimmed. Null while any cell is blank or not a number — the row is not ready.
 */
export function parseRowCells(
  cells: Record<string, NumberInputValue | null | undefined>,
  columns: readonly { field: string; type?: 'text' | 'number' }[],
): Record<string, string | number> | null {
  const row: Record<string, string | number> = {}
  for (const c of columns) {
    const raw = cells[c.field]
    if (c.type === 'text') {
      const text = String(raw ?? '').trim()
      if (text === '') return null
      row[c.field] = text
    } else {
      const n = parseDecimal(typeof raw === 'string' ? raw.trim() : raw)
      if (n == null) return null
      row[c.field] = n
    }
  }
  return row
}
