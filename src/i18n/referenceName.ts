import { currentDirection } from './index'

/**
 * Names that come out of the DATABASE rather than out of en.json.
 *
 * Component types, leave types and request types are reference DATA — rows an administrator
 * maintains, not strings a developer wrote — so no amount of work in the translation files touches
 * them. They carry their own optional Arabic name (`NameAr`), added by
 * `docs/i18n_reference_names.sql`, and this is the one place that decides which one to show.
 *
 * FALLBACK IS THE WHOLE DESIGN. `NameAr` is nullable and starts out null on every row, so a
 * half-translated catalogue is a working catalogue: an untranslated leave type reads in English
 * inside an Arabic page, which is mildly untidy and completely usable. That is what lets the Arabic
 * names be filled in one row at a time instead of all at once before anything works.
 *
 * It is also inert until the API supplies the field. Until the C# DTOs gain the property, Dapper
 * drops the column, `nameAr` arrives undefined, and every call here returns the English name — the
 * exact behaviour of the app today.
 */
export interface HasLocalisedName {
  name?: string | null
  nameAr?: string | null
}

/** The name to show for a reference row: the Arabic one when reading Arabic and it exists. */
export function referenceName(row: HasLocalisedName | null | undefined): string {
  if (!row) return ''
  if (currentDirection() === 'rtl') return row.nameAr || row.name || ''
  return row.name || ''
}

/**
 * The same choice for any pair of fields — a request type has three of them (Name, MenuLabel,
 * Description), and only the first is called `Name`.
 */
export function localised(
  english: string | null | undefined,
  arabic: string | null | undefined,
): string {
  if (currentDirection() === 'rtl') return arabic || english || ''
  return english || ''
}
