import { currentDirection } from './index'

/**
 * PHYSICAL directions, for the few things that cannot take a logical one.
 *
 * CSS mirrors itself: `margin-inline-start`, `text-align: start` and friends follow the document's
 * `dir` with no JavaScript involved, and layout should use those. This file is for the exceptions —
 * APIs whose vocabulary is 'left' and 'right' and which therefore have to be told which way round
 * the page is.
 *
 * THE DEVEXTREME TRAP THIS EXISTS FOR: `alignment` on a grid column is physical, and an EXPLICIT
 * alignment is honoured verbatim under `rtlEnabled`. DevExtreme mirrors only the alignment it
 * chooses for itself —
 *
 *     column.alignment = column.alignment || getAlignmentByDataType(dataType, rtlEnabled)
 *
 * — so a column left on its default flips correctly in Arabic and a column we aligned by hand does
 * not. That is why an ID column pinned with `alignment="left"` would end up on the TRAILING edge in
 * Arabic, alone among its neighbours.
 *
 * These read the direction at call time rather than through a hook. That is safe here, and only
 * here, because LanguageProvider remounts the entire routed tree when the language changes: every
 * grid is constructed afresh, so there is no rendered value left holding a stale direction. Use the
 * `useLanguage()` hook anywhere that has to REACT to the switch rather than merely be born right.
 */

/** Where text starts: left in English, right in Arabic. */
export function alignStart(): 'left' | 'right' {
  return currentDirection() === 'rtl' ? 'right' : 'left'
}

/**
 * Where text ends — the side row actions belong on.
 *
 * NOT FOR FIGURES. A money or count column keeps `alignment="right"` in both directions, because
 * digits line up under digits only when the units digit sits on a fixed edge — and because
 * DevExtreme aligns every `dataType="number"` column right regardless of `rtlEnabled`, so a column
 * we mirrored by hand would disagree with the grid beside it on the same Arabic page.
 */
export function alignEnd(): 'left' | 'right' {
  return currentDirection() === 'rtl' ? 'left' : 'right'
}

/**
 * DevExtreme's chevron icons, for the ones that mean "backwards" and "forwards" rather than
 * "left" and "right".
 *
 * `chevronprev` and `chevronnext` sound direction-aware and are not — they are plain aliases for
 * the left and right glyphs. So a Back button or a previous-month arrow has to be told which way
 * back is, or it points INTO the page in Arabic and reads as "forward".
 */
export function chevronBack(): 'chevronleft' | 'chevronright' {
  return currentDirection() === 'rtl' ? 'chevronright' : 'chevronleft'
}

export function chevronForward(): 'chevronleft' | 'chevronright' {
  return currentDirection() === 'rtl' ? 'chevronleft' : 'chevronright'
}

/**
 * The "onwards" arrow on a see-all link.
 *
 * KEPT OUT OF THE TRANSLATION FILES on purpose. U+2192 is bidi-neutral, so it does NOT mirror
 * itself inside an Arabic line — it keeps pointing right while the sentence runs left. Leaving it
 * in the translated string would make every link a chance for a translator to forget that;
 * deciding it here means it is right everywhere or wrong nowhere.
 */
export function arrowForward(): '→' | '←' {
  return currentDirection() === 'rtl' ? '←' : '→'
}

/** The "go back / undo" hooked arrow, on a withdraw or reclaim control. Same reasoning. */
export function arrowReturn(): '↩' | '↪' {
  return currentDirection() === 'rtl' ? '↪' : '↩'
}

/** The step-to-step arrow in a chain flow. Points the way the chain runs, which is the reading way. */
export function arrowFlow(): '→' | '←' {
  return currentDirection() === 'rtl' ? '←' : '→'
}
