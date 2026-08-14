/**
 * The adapters between this app's date STRINGS and the ones @mantine/dates v8 speaks.
 *
 * Every page here keeps the exact string shape its state, its validation and its API payload
 * already used — 'yyyy-MM-dd', 'yyyy-MM', 'HH:mm', 'yyyy-MM-ddTHH:mm(:ss)'. No Date object enters
 * state anywhere. Where a Mantine picker's own string differs, the translation happens AT THE
 * COMPONENT BOUNDARY and nowhere else, which is what these functions are.
 *
 * Two of the four pickers need no adapter and so appear nowhere below:
 *   · DatePickerInput speaks 'YYYY-MM-DD' — already the state's shape.
 *   · TimePicker (withSeconds off) speaks 'HH:mm' — already the state's shape.
 */

/**
 * 'yyyy-MM' → the 'YYYY-MM-DD' MonthPickerInput wants: the first of that month.
 *
 * The v8 picker is a DATE picker restricted to month granularity, not a month picker with a
 * month-shaped value — its `DateStringValue` is always a full day. Anchoring on day 01 is
 * arbitrary but stable, and {@link monthFromPicker} throws the day away again.
 */
export function monthToPicker(month: string | null | undefined): string | null {
  return month ? `${month}-01` : null
}

/** MonthPickerInput's 'YYYY-MM-DD' → the 'yyyy-MM' the state and the API keep. */
export function monthFromPicker(value: string | null): string {
  return value ? value.slice(0, 7) : ''
}

/** 'yyyy-MM-ddTHH:mm' → the 'YYYY-MM-DD HH:mm:ss' DateTimePicker wants (a space, not a T). */
export function dateTimeToPicker(value: string | null | undefined): string | null {
  return value ? value.replace('T', ' ') : null
}

/**
 * DateTimePicker's 'YYYY-MM-DD HH:mm:ss' → the 'yyyy-MM-ddTHH:mm' contract.
 *
 * The slice drops the seconds the picker appends; the app's minute-resolution contract predates
 * the picker and the API stores nothing finer.
 */
export function dateTimeFromPicker(value: string | null): string {
  return value ? value.slice(0, 16).replace(' ', 'T') : ''
}

/**
 * The seconds-bearing variant, for the attendance forms whose API shape is
 * 'yyyy-MM-ddTHH:mm:ss' and whose "not set" is null rather than an empty string.
 */
export function secondsDateTimeFromPicker(value: string | null): string | null {
  return value ? `${value.slice(0, 16).replace(' ', 'T')}:00` : null
}
