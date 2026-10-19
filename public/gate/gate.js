/**
 * THE GOOGLE SIGN-IN GATE PAGE (docs/GOOGLE_SIGNIN_GATE.md §4, in MokaCo.HRMS).
 *
 * nginx shows this page instead of whatever was asked for — same address, status 200 — while the
 * Google sign-in gate is on and this browser has no valid gate cookie. It can also be opened at its
 * own address, /gate/?next=/somewhere.
 *
 *   1. GET /api/gate/config. Not required (or already signed in) → carry on to the page.
 *   2. No client ID → "not set up yet". Otherwise load Google's script and draw its button.
 *   3. Google hands back an ID token → POST /api/gate/google. The API checks it and the list and
 *      sets the gate cookie. Then: at our own address go to the safe ?next=, else reload — the
 *      reload is the page that was asked for, and nginx now lets it through.
 *   4. A refusal (400/403/429/503) shows the API's sentence and keeps the button, so another
 *      account can be tried.
 *
 * Plain JavaScript with no build step: Vite copies public/ as it is. Every URL is absolute
 * (/gate/…, /api/…) because the page is usually shown under somebody else's address. Text from the
 * server only ever goes into textContent.
 *
 * ?v=1 on the files: nginx sends them without a Cache-Control, so a phone may keep an old copy for
 * weeks. Bump it in index.html and here whenever gate.js, gate.css, next.js or strings.js change.
 */
import { isGatePath, safeNextPath } from '/gate/next.js?v=1'
import { STRINGS, isInAppBrowser, pickLanguage, refusalKey } from '/gate/strings.js?v=1'

const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client'
const GOOGLE_TIMEOUT_MS = 15000
const LANG_KEY = 'mokaco_gate_lang'

/**
 * The page continues by itself when the API says the gate is not needed. If nginx keeps showing
 * the gate anyway, a second automatic reload inside this window is not made — the person gets a
 * Continue button instead of a phone that reloads forever.
 */
const CONTINUE_KEY = 'mokaco_gate_continue_at'
const CONTINUE_GUARD_MS = 10000

const $ = (id) => document.getElementById(id)
const ui = {
  lang: $('gate-lang'),
  testTag: $('gate-test'),
  status: $('gate-status'),
  alert: $('gate-alert'),
  google: $('gate-google'),
  retry: $('gate-retry'),
  cont: $('gate-continue'),
  inApp: $('gate-inapp'),
  help: $('gate-help'),
}

/* ---- storage, always guarded: a private window or blocked site data throws ---- */

function readStorage(store, key) {
  try {
    return window[store].getItem(key)
  } catch {
    return null
  }
}

function writeStorage(store, key, value) {
  try {
    window[store].setItem(key, value)
  } catch {
    /* not remembered — the page still works */
  }
}

/* ---- language ---- */

let lang = pickLanguage(readStorage('localStorage', LANG_KEY), navigator.languages)

/** Bidi isolates around an address or host name, so it stays whole inside an Arabic sentence. */
const isolate = (text) => `⁨${text}⁩`

function t(key, params) {
  let text = STRINGS[lang][key] ?? STRINGS.en[key] ?? key
  for (const [name, value] of Object.entries(params || {})) {
    text = text.replace(`{${name}}`, isolate(value))
  }
  return text
}

/* ---- what the page is showing ----
   One `view` at a time; render() draws it, and draws it again in the other language on a switch. */

let config = null
let view = { kind: 'loading' }
let busy = false

function setView(next) {
  view = next
  render()
}

function render() {
  const showGoogle = view.kind === 'ready' || view.kind === 'refused' || view.kind === 'checking'
  const statusKey = {
    loading: 'loading',
    loadingGoogle: 'loadingGoogle',
    checking: 'checking',
    opening: 'opening',
    stuck: 'stuck',
  }[view.kind]

  ui.status.textContent =
    view.kind === 'success' ? t('success', { email: view.email }) : statusKey ? t(statusKey) : ''
  ui.status.hidden = ui.status.textContent === ''

  ui.alert.replaceChildren()
  ui.alert.classList.toggle('gate-alert--info', view.kind === 'notSetUp')
  if (view.kind === 'refused') {
    // English: the API's own sentence when it sent one. Arabic: our line, then the API's (English)
    // sentence under it, marked as English so it reads left to right.
    const own = t(refusalKey(view.status))
    if (lang === 'en' || !view.server) addLine(view.server || own)
    else {
      addLine(own)
      addLine(view.server, 'en')
    }
  } else if (view.kind === 'notSetUp' || view.kind === 'offline' || view.kind === 'gsiFailed') {
    addLine(t(view.kind))
  }
  ui.alert.hidden = ui.alert.childElementCount === 0

  ui.google.hidden = !showGoogle
  ui.google.setAttribute('aria-busy', String(view.kind === 'checking'))
  ui.retry.hidden = !(view.kind === 'offline' || view.kind === 'gsiFailed')
  ui.cont.hidden = view.kind !== 'stuck'
  // A failure is when the Chrome-or-Safari advice matters most, so it is made to stand out then.
  ui.help.classList.toggle(
    'gate-help--strong',
    view.kind === 'gsiFailed' || (view.kind === 'refused' && view.status === 400),
  )
}

function addLine(text, textLang) {
  const p = document.createElement('p')
  p.textContent = text
  if (textLang) {
    p.lang = textLang
    p.dir = 'ltr'
  }
  ui.alert.appendChild(p)
}

/** Everything that depends on the language: static text, direction, the toggle, Google's button. */
function applyLanguage() {
  const root = document.documentElement
  root.lang = lang
  root.dir = lang === 'ar' ? 'rtl' : 'ltr'
  document.title = t('docTitle')
  for (const node of document.querySelectorAll('[data-text]')) node.textContent = t(node.dataset.text)

  const other = lang === 'ar' ? 'en' : 'ar'
  ui.lang.textContent = STRINGS[other].langName
  ui.lang.lang = other
  ui.lang.hidden = false

  ui.help.textContent = t('help', { host: location.host })
  ui.inApp.textContent = t('inApp', { host: location.host })
  render()
  drawGoogleButton()
}

/* ---- where to go once through ---- */

const atOwnAddress = () => isGatePath(location.pathname)

/** Signed in: to ?next= at the gate's own address, else the page that was asked for. */
function goOn() {
  if (atOwnAddress()) location.replace(safeNextPath(new URLSearchParams(location.search).get('next')))
  else location.reload()
}

/** The gate is not needed (off, or this browser is already in): carry on, but never in a loop. */
function continueWithoutSignIn() {
  if (atOwnAddress()) {
    setView({ kind: 'opening' })
    goOn()
    return
  }
  const last = Number(readStorage('sessionStorage', CONTINUE_KEY))
  if (Number.isFinite(last) && last > 0 && Date.now() - last < CONTINUE_GUARD_MS) {
    setView({ kind: 'stuck' })
    return
  }
  writeStorage('sessionStorage', CONTINUE_KEY, String(Date.now()))
  setView({ kind: 'opening' })
  location.reload()
}

/* ---- Google ---- */

let googleLoading = null
let initializedFor = null
/** The room the button was last drawn for — a phone's address bar coming and going is not a turn. */
let drawnFor = 0

function loadGoogle() {
  const ready = window.google?.accounts?.id
  if (ready) return Promise.resolve(ready)
  googleLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GOOGLE_SCRIPT
    script.async = true
    const fail = () => {
      clearTimeout(timer)
      script.remove()
      googleLoading = null
      reject(new Error('Google sign-in did not load.'))
    }
    const timer = setTimeout(fail, GOOGLE_TIMEOUT_MS)
    script.onload = () => {
      clearTimeout(timer)
      const id = window.google?.accounts?.id
      if (id) resolve(id)
      else fail()
    }
    script.onerror = fail
    document.head.appendChild(script)
  })
  return googleLoading
}

function drawGoogleButton() {
  const id = window.google?.accounts?.id
  if (!id || !initializedFor) return
  // Google's limits are 200–400 px. The card body is measured, not the holder, which may be hidden.
  const room = ui.google.parentElement.clientWidth
  drawnFor = room
  ui.google.replaceChildren()
  id.renderButton(ui.google, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
    logo_alignment: 'left',
    width: Math.max(200, Math.min(320, room || 320)),
    locale: lang,
  })
}

async function showGoogle() {
  setView({ kind: 'loadingGoogle' })
  try {
    const id = await loadGoogle()
    if (initializedFor !== config.clientId) {
      id.initialize({ client_id: config.clientId, callback: onCredential, ux_mode: 'popup' })
      initializedFor = config.clientId
    }
    setView({ kind: 'ready' })
    drawGoogleButton()
  } catch {
    setView({ kind: 'gsiFailed' })
  }
}

/** The API's sentence from an error answer: { error } JSON, or a short plain text. */
async function errorText(response) {
  try {
    const type = response.headers.get('content-type') || ''
    if (type.includes('json')) {
      const body = await response.json()
      for (const key of ['error', 'message', 'detail', 'title']) {
        if (body && typeof body[key] === 'string' && body[key]) return body[key]
      }
      return ''
    }
    const text = (await response.text()).trim()
    return text.length > 0 && text.length <= 300 && !text.startsWith('<') ? text : ''
  } catch {
    return ''
  }
}

async function onCredential(response) {
  if (busy) return
  busy = true
  setView({ kind: 'checking' })
  try {
    const answer = await fetch('/api/gate/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ credential: response && response.credential }),
    })
    if (answer.ok) {
      const body = await answer.json().catch(() => null)
      setView({ kind: 'success', email: (body && body.email) || '' })
      goOn()
      return
    }
    setView({ kind: 'refused', status: answer.status, server: await errorText(answer) })
  } catch {
    // No answer at all (status 0): the connection, not the account.
    setView({ kind: 'refused', status: 0, server: '' })
  } finally {
    busy = false
  }
}

/* ---- start ---- */

async function start() {
  setView({ kind: 'loading' })
  try {
    const answer = await fetch('/api/gate/config', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!answer.ok) throw new Error(`config ${answer.status}`)
    config = await answer.json()
  } catch {
    setView({ kind: 'offline' })
    return
  }

  if (!config.required || config.signedIn) continueWithoutSignIn()
  else if (!config.clientId) setView({ kind: 'notSetUp' })
  else await showGoogle()
}

ui.lang.addEventListener('click', () => {
  lang = lang === 'ar' ? 'en' : 'ar'
  writeStorage('localStorage', LANG_KEY, lang)
  applyLanguage()
})

ui.retry.addEventListener('click', () => {
  if (view.kind === 'gsiFailed' && config) void showGoogle()
  else void start()
})

ui.cont.addEventListener('click', () => {
  if (atOwnAddress()) goOn()
  else location.reload()
})

// Redraw Google's button when the phone turns: its width is fixed when it is drawn.
let resizeTimer = 0
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (ui.google.parentElement.clientWidth !== drawnFor) drawGoogleButton()
  }, 200)
})

// Shown on the test copy of the HRMS, like the red tag on its login page.
ui.testTag.hidden = !/(?:^|;\s*)mokaco_env=test(?:;|$)/.test(document.cookie)
ui.inApp.hidden = !isInAppBrowser(navigator.userAgent)

applyLanguage()
void start()
