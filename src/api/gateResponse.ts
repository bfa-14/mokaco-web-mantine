/**
 * Is this response the GOOGLE SIGN-IN GATE saying no (docs/GOOGLE_SIGNIN_GATE.md, MokaCo.HRMS)?
 *
 * When the gate is on, nginx asks the API about every request before it lets one through. A page
 * load that fails gets the gate page in place; an /api or /hubs call gets a 401 with the header
 * `X-Mokaco-Gate: required` and nginx's own HTML body. That 401 is NOT the token being rejected —
 * the HRMS session may be perfectly fine — so the refresh-then-login path would be wrong twice over:
 * the refresh call is gated too, and the login page would only be swapped for the gate page by nginx
 * with the tab's tokens already thrown away. The client reloads the page instead, which brings up
 * the gate; after Google, the same page loads again with the session still in this tab.
 *
 * Pure (no DOM, no import.meta.env), so tests/gateResponse.test.ts runs it under plain Node.
 */

/** The header nginx adds to every answer from the gate (spec §5, `location @mokaco_gate`). */
export const GATE_HEADER = 'X-Mokaco-Gate'

/** What apiRequest throws for a gated call, while the page reloads into the gate. */
export const GATE_MESSAGE = 'Sign in with Google to continue. Reload the page if it does not reload by itself.'

/**
 * A reload newer than this is not repeated. The gate cannot pass a page and refuse that page's own
 * API calls — both ask the same check about the same cookie — but if it ever did, a phone stuck
 * reloading forever is the worst way to find out.
 */
export const GATE_RELOAD_GUARD_MS = 10_000

/** The part of a fetch Response this needs — so a test can hand it a plain object. */
export interface GateResponseLike {
  status: number
  headers: { get(name: string): string | null }
}

/** A 401 that carries the gate's header (any non-blank value). */
export function isGateResponse(response: GateResponseLike): boolean {
  if (response.status !== 401) return false
  const value = response.headers.get(GATE_HEADER)
  return value != null && value.trim() !== ''
}

/**
 * The `data` of the ApiError apiRequest throws for a gated call. It is what tells that error apart
 * from the token's 401, for code that would otherwise end the session on any failure.
 */
export interface GateErrorData {
  gate: true
  /** The page is reloading into the gate now — false only when the reload guard held it back. */
  reloading: boolean
}

/** Is this the error apiRequest throws for a gated call? Read by shape, so it needs no client.ts. */
export function isGateError(err: unknown): err is { status: 401; data: GateErrorData } {
  if (err == null || typeof err !== 'object') return false
  const { status, data } = err as { status?: unknown; data?: unknown }
  return status === 401 && data != null && typeof data === 'object' && (data as { gate?: unknown }).gate === true
}

/**
 * Was a refused request refused by the gate? For callers that get a status but no headers back —
 * SignalR's handshake errors — `send` asks the same thing again by hand. A request that fails
 * outright is "no": nothing then says the gate is there.
 */
export async function refusedByGate(send: () => Promise<GateResponseLike>): Promise<boolean> {
  try {
    return isGateResponse(await send())
  } catch {
    return false
  }
}

/**
 * May this document reload for the gate now? `lastReloadAt` is when a gate reload last happened in
 * this tab (epoch ms), or null; a stored value that is not a number counts as none.
 */
export function mayReloadForGate(lastReloadAt: number | null, now: number): boolean {
  if (lastReloadAt == null || !Number.isFinite(lastReloadAt)) return true
  return now - lastReloadAt >= GATE_RELOAD_GUARD_MS || now < lastReloadAt
}
