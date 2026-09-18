/**
 * THE ROUTE TABLE CANNOT DRIFT FROM THE ACCESS MAP.
 *
 * App.tsx wraps a route in its guard by calling guard(path, element), which looks the path up in
 * ROUTE_ACCESS (src/auth/routeAccess.ts). That design has one hole: a route somebody forgets to
 * wrap, or wraps under a path string the map does not know, renders open without a word of
 * complaint. This test closes it by reading App.tsx as text and checking, for every <Route>:
 *
 *   · every path in ROUTE_ACCESS is rendered through guard() under exactly that path;
 *   · every guard() call names a path ROUTE_ACCESS actually lists (else the guard is a no-op);
 *   · every route that is NOT guarded is either a <Navigate> redirect, the login page, the
 *     catch-all, or listed in OPEN_ROUTES — open by decision, not by omission.
 *
 * App.tsx is parsed with regular expressions rather than imported: it renders JSX and pulls in
 * every page in the app, and this test has to run with nothing but Node. The regexes are kept
 * deliberately simple, so the shape they expect is the shape App.tsx already has:
 *
 *   <Route path="/x" element={guard('/x', <Page />)} />
 *   <Route path="/x" element={<Navigate to="/x/y" replace />} />
 *   <Route path="/x" element={<Page />} />
 *
 * Run with `npm test` (node --test; no runner to install).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OPEN_ROUTES, ROUTE_ACCESS } from '../src/auth/routeAccess.ts'

const here = dirname(fileURLToPath(import.meta.url))
const appSource = readFileSync(resolve(here, '../src/App.tsx'), 'utf8')

interface ParsedRoute {
  path: string
  /** The path string passed to guard(), when the element is guarded. */
  guardedAs: string | null
  redirect: boolean
}

/** Every <Route … path="…" … element={…} … /> in App.tsx, however its attributes are laid out. */
function parseRoutes(source: string): ParsedRoute[] {
  const routes: ParsedRoute[] = []
  // A <Route> tag runs from "<Route" to the next "/>" or ">" — the route table never nests a
  // pathed route's children inline, so the first closer ends the tag.
  const tag = /<Route\b([\s\S]*?)\/?>/g
  for (const match of source.matchAll(tag)) {
    const attrs = match[1]
    const path = /\bpath="([^"]+)"/.exec(attrs)?.[1]
    if (!path) continue // the layout routes: <Route element={<ProtectedRoute />}>
    const guardedAs = /\belement=\{guard\(\s*'([^']+)'/.exec(attrs)?.[1] ?? null
    const redirect = /\belement=\{<Navigate\b/.test(attrs)
    routes.push({ path, guardedAs, redirect })
  }
  return routes
}

const routes = parseRoutes(appSource)
const byPath = new Map(routes.map((r) => [r.path, r]))

/** Routes that exist for the router's own sake, not as pages anybody is gated from. */
const STRUCTURAL = new Set(['/login', '*'])

test('App.tsx was parsed into a plausible route table', () => {
  // A regex that silently matched nothing would make every other assertion pass vacuously.
  assert.ok(routes.length >= 40, `only ${routes.length} routes parsed — has App.tsx changed shape?`)
  assert.ok(byPath.has('/'), 'the dashboard route was not parsed')
  assert.ok(byPath.has('/settings'), 'the settings route was not parsed')
  const duplicates = routes
    .map((r) => r.path)
    .filter((path, index, all) => all.indexOf(path) !== index)
  assert.deepEqual(duplicates, [], `the same path is routed twice: ${duplicates.join(', ')}`)
})

test('every path in ROUTE_ACCESS is rendered through guard() under that same path', () => {
  const problems: string[] = []
  for (const rule of ROUTE_ACCESS) {
    const route = byPath.get(rule.path)
    if (!route) {
      problems.push(`${rule.path}: listed in ROUTE_ACCESS but App.tsx has no such route`)
    } else if (route.guardedAs !== rule.path) {
      problems.push(
        `${rule.path}: listed in ROUTE_ACCESS but App.tsx renders it ` +
          (route.guardedAs ? `guarded as '${route.guardedAs}'` : 'WITHOUT guard()'),
      )
    }
  }
  assert.deepEqual(problems, [])
})

test('every guard() call names a path ROUTE_ACCESS lists — a guard on an unknown path is a no-op', () => {
  const known = new Set(ROUTE_ACCESS.map((r) => r.path))
  const problems: string[] = []
  for (const route of routes) {
    if (route.guardedAs == null) continue
    if (route.guardedAs !== route.path) {
      problems.push(`${route.path}: guard() was given '${route.guardedAs}' — the two must match`)
    }
    if (!known.has(route.guardedAs)) {
      problems.push(`${route.path}: guard('${route.guardedAs}') has no ROUTE_ACCESS entry, so it guards nothing`)
    }
  }
  assert.deepEqual(problems, [])
})

test('every unguarded route is a redirect, structural, or open by decision (OPEN_ROUTES)', () => {
  const open = new Set(OPEN_ROUTES)
  const problems: string[] = []
  for (const route of routes) {
    if (route.guardedAs != null || route.redirect || STRUCTURAL.has(route.path)) continue
    if (!open.has(route.path)) {
      problems.push(
        `${route.path}: rendered without guard() and not in OPEN_ROUTES — ` +
          'add it to ROUTE_ACCESS and wrap it, or list it in OPEN_ROUTES with the reason',
      )
    }
  }
  assert.deepEqual(problems, [])
})

test('OPEN_ROUTES and ROUTE_ACCESS do not overlap, and every open route exists', () => {
  const gated = new Set(ROUTE_ACCESS.map((r) => r.path))
  const problems: string[] = []
  for (const path of OPEN_ROUTES) {
    if (gated.has(path)) problems.push(`${path}: in both OPEN_ROUTES and ROUTE_ACCESS`)
    if (!byPath.has(path)) problems.push(`${path}: in OPEN_ROUTES but App.tsx has no such route`)
    else if (byPath.get(path)!.guardedAs != null) {
      problems.push(`${path}: in OPEN_ROUTES but App.tsx guards it`)
    }
  }
  assert.deepEqual(problems, [])
})
