/**
 * DIALOGS FOLLOW THE PART OF THE SCREEN THE KEYBOARD LEAVES VISIBLE (1 Nov 2026). Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trackVisualViewport, viewportVars } from '../src/visualViewport.ts'

test('a reading at zoom 1 gives the visible height and how far the page is panned', () => {
  assert.deepEqual(viewportVars({ height: 412.6, offsetTop: 231.2, scale: 1 }, 844), { height: '413px', top: '231px' })
  assert.deepEqual(viewportVars({ height: 844, offsetTop: 0, scale: 1 }, 844), { height: '844px', top: '0px' })
})

test('while the person is pinch-zoomed the dialog takes the layout viewport, which a pinch does not change', () => {
  assert.deepEqual(viewportVars({ height: 300, offsetTop: 120, scale: 2.2 }, 844), { height: '844px', top: '0px' })
  // the keyboard came up during the zoom (Android, resizes-content): the layout is shorter, and so is the dialog
  assert.deepEqual(viewportVars({ height: 150, offsetTop: 40, scale: 2.2 }, 454), { height: '454px', top: '0px' })
})

test('a nonsense reading changes nothing; a negative pan (iOS rubber band) counts as none', () => {
  assert.equal(viewportVars({ height: 0, offsetTop: 0, scale: 1 }, 844), null)
  assert.equal(viewportVars({ height: Number.NaN, offsetTop: 0, scale: 1 }, 844), null)
  assert.equal(viewportVars({ height: 300, offsetTop: 0, scale: 2 }, 0), null)
  assert.deepEqual(viewportVars({ height: 600, offsetTop: -14, scale: 1 }, 844), { height: '600px', top: '0px' })
})

test('the variables follow the keyboard: set at once, then once per frame, and the listeners go away', () => {
  const listeners = new Map<string, () => void>()
  const vv = {
    height: 844, offsetTop: 0, scale: 1,
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  }
  const vars = new Map<string, string>()
  const frames: (() => void)[] = []
  const winListeners = new Map<string, () => void>()
  const win = {
    visualViewport: vv,
    addEventListener: (type: string, fn: () => void) => winListeners.set(type, fn),
    removeEventListener: (type: string) => winListeners.delete(type),
    document: {
      activeElement: null,
      documentElement: { clientHeight: 844, style: { setProperty: (k: string, v: string) => vars.set(k, v) } },
    },
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
    cancelAnimationFrame: () => {},
  } as unknown as Window

  const stop = trackVisualViewport(win)
  assert.equal(vars.get('--vv-height'), '844px')

  // the keyboard comes up: many resize events, one write
  vv.height = 480; vv.offsetTop = 120
  listeners.get('resize')!(); listeners.get('scroll')!(); listeners.get('resize')!()
  assert.equal(frames.length, 1)
  frames.shift()!()
  assert.equal(vars.get('--vv-height'), '480px')
  assert.equal(vars.get('--vv-top'), '120px')

  // the layout itself gets shorter (Android, resizes-content): the window's resize is enough
  vv.height = 454; vv.offsetTop = 0
  winListeners.get('resize')!()
  frames.shift()!()
  assert.equal(vars.get('--vv-height'), '454px')
  assert.equal(vars.get('--vv-top'), '0px')

  stop()
  assert.equal(listeners.size, 0)
  assert.equal(winListeners.size, 0)
})

test('a browser without visualViewport is left alone', () => {
  const stop = trackVisualViewport({ visualViewport: null } as unknown as Window)
  assert.doesNotThrow(stop)
})
