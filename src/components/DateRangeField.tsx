import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { CloseButton, Input, Popover, UnstyledButton } from '@mantine/core'
import { DatePicker } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import './DateRangeField.css'

type Ymd = string

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number): Ymd => `${y}-${pad(m)}-${pad(d)}`

/** Today on the COMPANY's clock (Beirut), not the browser's — "this month" must not flip early on a laptop abroad. */
export function beirutToday(): Ymd {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(new Date())
}

/** Calendar arithmetic on the string itself (UTC, so no timezone can move the day). */
export function addDaysYmd(value: Ymd, days: number): Ymd {
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function monthRange(year: number, month: number): [Ymd, Ymd] {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return [ymd(year, month, 1), ymd(year, month, last)]
}

export type DateRangePreset = 'thisMonth' | 'lastMonth' | 'last7Days'

/** The preset ranges, as of today in Beirut. Exported so a page default and a preset can never disagree. */
export function presetRange(preset: DateRangePreset, today: Ymd = beirutToday()): [Ymd, Ymd] {
  const [y, m] = today.split('-').map(Number)
  if (preset === 'thisMonth') return monthRange(y, m)
  if (preset === 'lastMonth') return m === 1 ? monthRange(y - 1, 12) : monthRange(y, m - 1)
  return [addDaysYmd(today, -6), today]
}

const PRESETS: DateRangePreset[] = ['thisMonth', 'lastMonth', 'last7Days']

/** 'yyyy-MM-dd' → 'DD/MM/YYYY', the way dates are written here. */
function display(value: Ymd | null): string {
  if (!value) return ''
  const [y, m, d] = value.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/** What somebody typed → 'yyyy-MM-dd', or null when it is not a real day. No Date parsing of free text: 31/02 is refused, not rolled over. */
export function parseTypedDate(text: string): Ymd | null {
  const raw = text.trim()
  let y: number, m: number, d: number
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw)
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else {
    match = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})$/.exec(raw)
    if (!match) return null
    ;[d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])]
    if (y < 100) y += 2000
  }
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) return null
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null
  return ymd(y, m, d)
}

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
 * THE HALF-PICKED RANGE LIVES HERE, NOT IN THE CALLER. Between the first click and the second the range has a start
 * and no end. That state used to be handed to the caller, and a caller that (reasonably) only stores complete ranges
 * threw it away — the controlled picker then snapped back to the old range, the second click became a first click
 * again, and the range could never be changed. The draft is now this component's own: `onChange` is called with a
 * COMPLETE range or with a cleared one, never with half of one, so no caller can break the picker by being careful.
 *
 * TYPING WORKS. The two ends are real text inputs ('DD/MM/YYYY', also D/M/YYYY, '-' or '.' separators, and
 * 'YYYY-MM-DD'); Enter or leaving the box applies it, and a date that would invert the range drags the other end along
 * rather than being refused. Anything unreadable is put back as it was.
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
  defaultFrom,
  defaultTo,
  presets = true,
}: {
  /** The start, 'yyyy-MM-dd'. Null when the period is unset. */
  from: string | null
  /** The end, 'yyyy-MM-dd'. Null when unset. */
  to: string | null
  /**
   * Both ends at once, always — and only ever a COMPLETE range (both set) or a cleared one (both null). The state
   * between the first click and the second never leaves this component; see the note above.
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
   * that produces a broken request. Such a caller passes `defaultFrom` / `defaultTo` instead.
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
  /**
   * THE PAGE'S DEFAULT RANGE. With it, the X means "back to the default" and is shown only while the range differs
   * from it — the right reading of "clear" on a filter that cannot be empty.
   */
  defaultFrom?: string
  defaultTo?: string
  /** The shortcut list (This month / Last month / Last 7 days / Custom). Off on forms, where "last month" is not a thing to request leave for. */
  presets?: boolean
}) {
  const { t } = useTranslation()
  const [opened, setOpened] = useState(false)
  /** The half-picked range: a start and no end yet. Null whenever nothing is in progress. */
  const [draftStart, setDraftStart] = useState<Ymd | null>(null)
  /** The month the calendar is showing. */
  const [shown, setShown] = useState<Ymd>(from ?? beirutToday())
  const [fromText, setFromText] = useState(display(from))
  const [toText, setToText] = useState(display(to))
  const [invalid, setInvalid] = useState<'from' | 'to' | null>(null)
  const fromRef = useRef<HTMLInputElement>(null)

  // The boxes follow the value whenever it changes from outside (a preset, the URL, the page's reset).
  useEffect(() => {
    setFromText(display(from))
    setToText(display(to))
    setInvalid(null)
  }, [from, to])

  function open() {
    if (disabled || opened) return
    setDraftStart(null)
    setShown(from ?? beirutToday())
    setOpened(true)
  }
  function close() {
    setOpened(false)
    setDraftStart(null)
  }

  const inBounds = (value: Ymd) => (!minDate || value >= minDate) && (!maxDate || value <= maxDate)

  function commit(nextFrom: Ymd, nextTo: Ymd) {
    setDraftStart(null)
    if (nextFrom !== from || nextTo !== to) onChange(nextFrom, nextTo)
  }

  /** Enter / leaving a box. Unreadable text is put back; a date past the other end drags that end along. */
  function applyTyped(end: 'from' | 'to') {
    const text = end === 'from' ? fromText : toText
    const current = end === 'from' ? from : to
    if (text.trim() === '' || text === display(current)) {
      setFromText(display(from))
      setToText(display(to))
      setInvalid(null)
      return
    }
    const parsed = parseTypedDate(text)
    if (!parsed || !inBounds(parsed)) {
      setInvalid(end)
      return
    }
    setInvalid(null)
    if (end === 'from') {
      const nextTo = to && to >= parsed ? to : parsed
      if (!allowSingleDateInRange && nextTo === parsed) return setInvalid(end)
      commit(parsed, nextTo)
      setShown(parsed)
    } else {
      const nextFrom = from && from <= parsed ? from : parsed
      if (!allowSingleDateInRange && nextFrom === parsed) return setInvalid(end)
      commit(nextFrom, parsed)
      setShown(parsed)
    }
  }

  function onKeyDown(end: 'from' | 'to', event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      applyTyped(end)
    } else if (event.key === 'Escape') {
      setFromText(display(from))
      setToText(display(to))
      setInvalid(null)
      close()
    }
  }

  const isDefault = defaultFrom != null && defaultTo != null && from === defaultFrom && to === defaultTo
  const canReset = defaultFrom != null && defaultTo != null && !isDefault
  const canClear = clearable && (from != null || to != null)
  const activePreset = from && to ? (PRESETS.find((p) => { const [a, b] = presetRange(p); return a === from && b === to }) ?? 'custom') : null

  return (
    <Input.Wrapper label={label} labelProps={id ? { htmlFor: id } : undefined} w={w} className="drf-wrapper">
      <Popover
        opened={opened}
        onChange={(next) => (next ? open() : close())}
        position="bottom-start"
        shadow="md"
        withinPortal
        // Focus stays in the text box that opened it: somebody typing a date must not have the caret taken away.
        trapFocus={false}
        returnFocus={false}
        zIndex={400}
      >
        <Popover.Target>
          <div
            className="drf"
            data-testid="date-range"
            data-disabled={disabled || undefined}
            data-invalid={invalid ?? undefined}
            data-from={from ?? ''}
            data-to={to ?? ''}
            onClick={open}
          >
            <IconCalendar size={14} className="drf-icon" aria-hidden />
            <input
              ref={fromRef}
              id={id}
              className="drf-input"
              data-range-end="from"
              // Digits and slashes read left to right in Arabic too; the FIELD mirrors, the date does not.
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              aria-label={t('dateRange.from')}
              aria-invalid={invalid === 'from' || undefined}
              placeholder={placeholder ?? t('dateRange.placeholder')}
              disabled={disabled}
              value={fromText}
              onFocus={open}
              onChange={(e) => { setFromText(e.currentTarget.value); setInvalid(null) }}
              onBlur={() => applyTyped('from')}
              onKeyDown={(e) => onKeyDown('from', e)}
            />
            <span className="drf-sep" aria-hidden>–</span>
            <input
              className="drf-input"
              data-range-end="to"
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              aria-label={t('dateRange.to')}
              aria-invalid={invalid === 'to' || undefined}
              placeholder={placeholder ?? t('dateRange.placeholder')}
              disabled={disabled}
              value={toText}
              onFocus={open}
              onChange={(e) => { setToText(e.currentTarget.value); setInvalid(null) }}
              onBlur={() => applyTyped('to')}
              onKeyDown={(e) => onKeyDown('to', e)}
            />
            {(canReset || canClear) && !disabled && (
              <CloseButton
                size="sm"
                className="drf-clear"
                data-range-clear
                aria-label={canReset ? t('dateRange.reset') : t('dateRange.clear')}
                title={canReset ? t('dateRange.reset') : t('dateRange.clear')}
                // mousedown would blur the box and "apply" half-typed text before the click lands
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation()
                  close()
                  if (canReset) onChange(defaultFrom!, defaultTo!)
                  else onChange(null, null)
                }}
              />
            )}
          </div>
        </Popover.Target>
        <Popover.Dropdown className="drf-dropdown" onMouseDown={(e) => e.preventDefault() /* clicking a day must not blur (and re-apply) the text box */}>
          {presets && (
            <div className="drf-presets" role="group" aria-label={t('dateRange.presets')}>
              {PRESETS.map((preset) => (
                <UnstyledButton
                  key={preset}
                  className="drf-preset"
                  data-preset={preset}
                  data-active={activePreset === preset || undefined}
                  onClick={() => {
                    const [a, b] = presetRange(preset)
                    if (!inBounds(a) || !inBounds(b)) return
                    commit(a, b)
                    close()
                  }}
                >
                  {t(`dateRange.${preset}`)}
                </UnstyledButton>
              ))}
              {/* "Custom" is what the calendar and the two boxes already are: it says so, and puts the caret in the first box. */}
              <UnstyledButton
                className="drf-preset"
                data-preset="custom"
                data-active={activePreset === 'custom' || undefined}
                onClick={() => { fromRef.current?.focus(); fromRef.current?.select() }}
              >
                {t('dateRange.custom')}
              </UnstyledButton>
            </div>
          )}
          <DatePicker
            type="range"
            allowSingleDateInRange={allowSingleDateInRange}
            minDate={minDate}
            maxDate={maxDate}
            date={shown}
            onDateChange={(next) => setShown(String(next).slice(0, 10))}
            // While a range is being picked the calendar shows the DRAFT (a start, no end) — that is what makes the
            // hover preview run from the first click to the pointer. Otherwise it shows the value.
            value={draftStart ? [draftStart, null] : [from, to]}
            onChange={([nextFrom, nextTo]) => {
              const a = nextFrom ? String(nextFrom).slice(0, 10) : null
              const b = nextTo ? String(nextTo).slice(0, 10) : null
              if (a && b) {
                commit(a, b)
                close()
              } else {
                setDraftStart(a)
              }
            }}
          />
        </Popover.Dropdown>
      </Popover>
    </Input.Wrapper>
  )
}

/**
 * The hover-range preview, RTL, and the calendar's own reading order need no code here: the app is
 * wrapped in Mantine's `<DirectionProvider detectDirection>` (see main.tsx) and `applyLanguage` sets
 * `document.documentElement.dir`, so the picker mirrors itself in Arabic on its own. This note
 * exists so the next person does not add a `dir` prop that would fight it.
 */
