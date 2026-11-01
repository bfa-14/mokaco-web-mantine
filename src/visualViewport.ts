/**
 * The VISIBLE part of the screen, for dialogs on phones and tablets.
 *
 * A phone's on-screen keyboard covers the bottom of the page without (on iOS, and on Android browsers
 * that ignore the viewport's `interactive-widget=resizes-content`) making the layout any shorter. A
 * dialog sized to 100dvh then runs on under the keyboard, and its last row — "Take booking", "Save" —
 * cannot be reached. `window.visualViewport` is the part actually on screen; this keeps two variables
 * on <html> in step with it, and dx-parity.css sizes and places every dialog with them:
 *
 *   --vv-height  the visible height (100dvh until the first reading)
 *   --vv-top     how far the browser has panned the page to keep the focused field in view
 *
 * NOT WHILE ZOOMED: a pinch-zoom shrinks the visual viewport too. Following it would re-lay the dialog
 * out under the person's fingers, so a reading taken at a zoom other than 1 changes nothing.
 */

export interface VisualViewportReading {
  height: number
  offsetTop: number
  scale: number
}

/** The variables for one reading, or null to leave the current ones (the page is zoomed). */
export function viewportVars(vv: VisualViewportReading): { height: string; top: string } | null {
  if (!Number.isFinite(vv.height) || vv.height <= 0) return null
  if (Math.abs(vv.scale - 1) > 0.01) return null
  return {
    height: `${Math.round(vv.height)}px`,
    top: `${Math.max(0, Math.round(vv.offsetTop))}px`,
  }
}

/** Starts following the visual viewport; returns the function that stops it. A no-op without one. */
export function trackVisualViewport(win: Window = window): () => void {
  const vv = win.visualViewport
  if (!vv) return () => {}
  const root = win.document.documentElement
  let frame = 0

  const apply = () => {
    frame = 0
    const vars = viewportVars(vv)
    if (!vars) return
    root.style.setProperty('--vv-height', vars.height)
    root.style.setProperty('--vv-top', vars.top)
  }
  // One write per frame: the keyboard's animation fires resize and scroll many times a second.
  const schedule = () => {
    if (!frame) frame = win.requestAnimationFrame(apply)
  }

  apply()
  vv.addEventListener('resize', schedule)
  vv.addEventListener('scroll', schedule)
  // And the window's own resize: where the keyboard shortens the LAYOUT (Android with resizes-content,
  // a rotated tablet) a browser need not report it as a visual-viewport resize.
  win.addEventListener('resize', schedule)
  return () => {
    vv.removeEventListener('resize', schedule)
    vv.removeEventListener('scroll', schedule)
    win.removeEventListener('resize', schedule)
    if (frame) win.cancelAnimationFrame(frame)
  }
}
