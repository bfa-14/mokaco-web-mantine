import { createTheme } from '@mantine/core'

/**
 * Where a dialog is the whole screen (dx-parity.css makes it so up to 560px), or the device is driven
 * by a finger: phones and touch tablets. Read when a dialog renders, so a rotated tablet is asked again.
 */
const TOUCH_DIALOGS = '(max-width: 560px), (hover: none) and (pointer: coarse)'
function touchDialogs(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(TOUCH_DIALOGS).matches === true
}

/**
 * EVERY Modal and Drawer of the app (1 Nov 2026: on a phone a dialog could not be scrolled to its
 * buttons, moved or zoomed).
 *
 * Mantine locks the page behind an open dialog with react-remove-scroll, which cancels any touch move
 * that nothing under the finger can scroll in that direction: a sideways move always, and an upward
 * one once the dialog has reached its end. With the keyboard up, "Take booking" sat under the keyboard
 * and there was no gesture left to reach it. On a touch device the dialog covers what the lock
 * protects, so there it is off: the browser pans, zooms and scrolls the dialog as it would any page.
 * Everywhere, a pinch is a zoom (allowPinchZoom), never swallowed.
 */
const dialogDefaults = () => ({
  lockScroll: !touchDialogs(),
  removeScrollProps: { allowPinchZoom: true },
})
import type { MantineColorsTuple } from '@mantine/core'

/**
 * The Moka & Co palette as a Mantine theme — the same tokens index.css declares as CSS variables
 * (single desert accent over warm neutrals, per the brand sheet). Shade 6 is --brand-desert
 * (#bd8648) and shade 7 is --brand-desert-strong (#a5723b), so `primaryColor: 'desert'` renders
 * buttons exactly where the DevExtreme accent overrides used to land.
 */
const desert: MantineColorsTuple = [
  '#faf5ee', // 0
  '#f3e8d8', // 1
  '#e8d3b4', // 2
  '#dcbc8d', // 3
  '#d1a86c', // 4
  '#c79556', // 5
  '#bd8648', // 6  --brand-desert
  '#a5723b', // 7  --brand-desert-strong
  '#8d6132', // 8
  '#745029', // 9
]

export const theme = createTheme({
  primaryColor: 'desert',
  primaryShade: { light: 6, dark: 6 },
  colors: { desert },
  /* The DevExtreme generic-light widget stack, NOT Poppins. In the original app every DX widget
     rendered in this face at a 12px base while the page chrome around it (page-head, cards, hints
     — all from index.css, unchanged here) stayed Poppins. Mantine components stand in for the DX
     widgets, so they inherit the DX face; index.css keeps Poppins on the chrome. That split is the
     original look, not an oversight. Metrics live in dx-parity.css. */
  fontFamily: "'Helvetica Neue', 'Segoe UI', helvetica, verdana, sans-serif",
  headings: { fontFamily: "'Helvetica Neue', 'Segoe UI', helvetica, verdana, sans-serif" },
  defaultRadius: 'md',
  components: {
    // A FUNCTION, called on each render (Mantine's useProps), so the media query is current. .extend()
    // types defaultProps as an object only, hence the plain entries.
    Modal: { defaultProps: dialogDefaults },
    Drawer: { defaultProps: dialogDefaults },
  },
})
