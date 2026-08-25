import { DatePickerInput } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import type { ReactNode } from 'react'

/**
 * ONE control for every from→to pair that is a single continuous PERIOD.
 *
 * WHY ONE CONTROL AND NOT TWO. Two date inputs let somebody type an inverted range — the 20th, then
 * the 5th — which every screen then had to catch afterwards and explain. They also left three
 * separate ways to be incomplete (no start, no end, end before start), each needing its own message.
 * A range picker cannot express any of them: the first click is the start, the second is the end,
 * and the calendar orders them itself. The invalid states stop being states rather than being
 * caught, so the validation that used to describe them simply has nothing left to say.
 *
 * THE STRING BOUNDARY. Every caller keeps its own two 'yyyy-MM-dd' fields — in its state, in its
 * query string, in its request body — and this component adapts between those two fields and the
 * one tuple the picker wants. Nothing above it changes shape.
 *
 * NO Date OBJECT IS EVER CONSTRUCTED, and that is the point of doing the adapter here rather than at
 * twenty call sites. Mantine 8's date inputs speak 'YYYY-MM-DD' natively, so the strings pass
 * straight through; going via `new Date(...)` would reintroduce the timezone bug where a day picked
 * late in the evening is stored as the day before.
 *
 * CLEARING IS ALL-OR-NOTHING. The X clears both ends together, because a period with only an end is
 * not half an answer, it is a nonsense one. What that MEANS is the caller's to decide: on a filter
 * it means "no date filter" and the grid reloads unfiltered, so `clearable` is offered only where
 * the caller can actually honour that — see `clearable` below.
 */
export function DateRangeField({
  from,
  to,
  onChange,
  label,
  id,
  disabled = false,
  clearable = false,
  allowSingleDateInRange = true,
  minDate,
  maxDate,
  w,
  placeholder,
}: {
  /** The start, 'yyyy-MM-dd'. Null when the period is unset. */
  from: string | null
  /** The end, 'yyyy-MM-dd'. Null while the second click is still to come, or when unset. */
  to: string | null
  /**
   * Both ends at once, always. Callers set two fields from one call, so the pair can never be half
   * applied — and a caller that only stored one of them would be back to the inverted range this
   * component exists to make impossible.
   */
  onChange: (from: string | null, to: string | null) => void
  label?: ReactNode
  id?: string
  disabled?: boolean
  /**
   * Offer the X that clears BOTH ends.
   *
   * DEFAULT OFF, deliberately. On a filter an empty range is a real answer — no date filter — but
   * on a form, and on a filter whose endpoint requires both dates, there is nothing sensible to send
   * for "cleared". Turning it on where the caller cannot honour an empty range would offer a button
   * that produces a broken request.
   */
  clearable?: boolean
  /** A one-day period is a real period, and on leave it is the commonest one. */
  allowSingleDateInRange?: boolean
  /** 'yyyy-MM-dd' bounds, passed through untouched. Left undefined by most callers: back-dating is
   *  ordinary — sick leave is reported the morning after — and a picker that refuses yesterday
   *  blocks the commonest entry there is. */
  minDate?: string
  maxDate?: string
  w?: number | string
  placeholder?: string
}) {
  return (
    <DatePickerInput
      type="range"
      id={id}
      label={label}
      // The format people here write dates in. The VALUE is unaffected — it stays 'yyyy-MM-dd'.
      valueFormat="DD/MM/YYYY"
      leftSection={<IconCalendar size={14} />}
      allowSingleDateInRange={allowSingleDateInRange}
      clearable={clearable}
      minDate={minDate}
      maxDate={maxDate}
      w={w}
      placeholder={placeholder}
      disabled={disabled}
      value={[from, to]}
      onChange={([nextFrom, nextTo]) => {
        /*
         * CLEARING THE START CLEARS BOTH — that is the X, and it is also what happens when a caller
         * clears the field any other way.
         *
         * A null END is the opposite case and must be left alone: it is the ordinary state between
         * the first click and the second, and forcing the start to null there would undo the click
         * the user has just made and make the range unselectable.
         */
        onChange(nextFrom || null, nextFrom ? nextTo || null : null)
      }}
    />
  )
}

/**
 * The hover-range preview, RTL, and the calendar's own reading order need no code here: the app is
 * wrapped in Mantine's `<DirectionProvider detectDirection>` (see main.tsx) and `applyLanguage` sets
 * `document.documentElement.dir`, so the picker mirrors itself in Arabic on its own. This note
 * exists so the next person does not add a `dir` prop that would fight it.
 */
