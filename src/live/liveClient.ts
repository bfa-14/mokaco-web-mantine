import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr'
import { API_BASE_URL } from '../config'
import { tokenStorage } from '../auth/tokenStorage'
import { redirectToLogin } from '../auth/sessionRedirect'

/**
 * ONE hub connection for the whole tab.
 *
 * The socket carries SIGNALS, never data: the server sends a topic name, a subscribed page refetches
 * through its ordinary permission-gated endpoints. Nothing here ever puts a payload on screen, which
 * is why this file has no types for one.
 *
 * ONE CONNECTION, NOT ONE PER PAGE. A single-page app mounts and unmounts screens constantly; a
 * connection per screen would mean a handshake on every navigation and several sockets open at once
 * whenever two live components are mounted. Instead the connection is a module singleton, opened on
 * the first subscription and reference-counted per topic.
 *
 * PER-TAB IDENTITY IS INHERITED, NOT REIMPLEMENTED. `accessTokenFactory` reads through the existing
 * tokenStorage, which is sessionStorage — so a tab signed in as one user opens a socket that
 * authenticates as that user, and a second tab signed in as somebody else gets its own. If this had
 * cached the token at construction it would have pinned the connection to whoever loaded the page
 * first; the factory is called per (re)connect, so a refreshed token is picked up too.
 */

/**
 * Topics the server knows. Kept in step with LiveHub.KnownTopics.
 *
 * 'hr' is listed because the server broadcasts it — employee, branch, leave-policy and document
 * writes all signal it — even though no page subscribes yet. Leaving it out of the union would make
 * the first page that wants it look like a mistake rather than the obvious next step, and the two
 * vocabularies drifting is exactly how a signal ends up sent to nobody for months.
 */
export type LiveTopic = 'workflow' | 'payroll' | 'attendance' | 'dashboard' | 'hr'

type StaleHandler = (topic: string) => void

let connection: HubConnection | null = null
let starting: Promise<void> | null = null

/** How many live components currently want each topic. Zero means unsubscribe. */
const refCounts = new Map<string, number>()
/** Everyone who wants to hear about a "stale" signal, whatever the topic. */
const staleHandlers = new Set<StaleHandler>()
/** Everyone who wants to know a reconnect happened, so they can catch up on what they missed. */
const reconnectHandlers = new Set<() => void>()

function build(): HubConnection {
  const built = new HubConnectionBuilder()
    .withUrl(`${API_BASE_URL}/hubs/live`, {
      // A browser cannot set Authorization on a WebSocket, so SignalR appends this as
      // ?access_token=. The server reads it for this path only.
      accessTokenFactory: () => tokenStorage.getAccessToken() ?? '',
    })
    // Default schedule: 0s, 2s, 10s, 30s, then stop. Enough to ride out a restart or a laptop lid.
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Warning)
    .build()

  built.on('stale', (topic: string) => {
    staleHandlers.forEach((h) => h(topic))
  })

  built.onreconnected(() => {
    // Groups do NOT survive a reconnect — SignalR gives the new connection a new id, and the
    // server's group membership was keyed to the old one. Re-subscribing here is not an
    // optimisation; without it the socket comes back alive and permanently silent.
    void resubscribeAll()
    reconnectHandlers.forEach((h) => h())
  })

  return built
}

/**
 * Whether a failed handshake means "you are not signed in" rather than "the server is unreachable".
 *
 * SignalR does not surface a typed status for this. A refused negotiate arrives as an HttpError
 * carrying `statusCode`, but a refused WebSocket upgrade arrives as a plain Error whose message is
 * the only evidence — so both are checked, and the status is preferred where it exists.
 */
function isUnauthorized(err: unknown): boolean {
  const status = (err as { statusCode?: number } | null)?.statusCode
  if (typeof status === 'number') return status === 401
  const message = err instanceof Error ? err.message : String(err ?? '')
  return /\b401\b|Unauthorized/i.test(message)
}

async function ensureStarted(): Promise<void> {
  if (connection && connection.state === HubConnectionState.Connected) return
  if (!connection) connection = build()

  // Concurrent subscribers must not each call start(); the shared promise collapses them into one.
  starting ??= connection
    .start()
    .catch(async (err) => {
      // A REFUSED handshake is not a degraded feature — it is the session being over, and the
      // socket says so before any page happens to poll. The connection is stopped FIRST: SignalR
      // would otherwise keep the automatic-reconnect schedule running, and a tab on its way to the
      // login page must not leave a retry loop behind it hammering a hub it cannot enter.
      if (isUnauthorized(err)) {
        await liveClient.stop()
        redirectToLogin()
        return
      }
      // Anything else — server down, network gone — genuinely IS a degraded feature, never a broken
      // page: every screen still has its refresh button and its own initial fetch.
      console.warn('[live] could not connect; live updates are off for now', err)
    })
    .finally(() => {
      starting = null
    })

  await starting
}

async function resubscribeAll(): Promise<void> {
  if (!connection || connection.state !== HubConnectionState.Connected) return
  for (const topic of refCounts.keys()) {
    try {
      await connection.invoke('Subscribe', topic)
    } catch (err) {
      console.warn('[live] re-subscribe failed', topic, err)
    }
  }
}

export const liveClient = {
  /** Registers a listener for every "stale" signal. Returns an unsubscribe function. */
  onStale(handler: StaleHandler): () => void {
    staleHandlers.add(handler)
    return () => staleHandlers.delete(handler)
  },

  /** Registers a listener for reconnects (the missed-window catch-up). Returns an unsubscribe. */
  onReconnected(handler: () => void): () => void {
    reconnectHandlers.add(handler)
    return () => reconnectHandlers.delete(handler)
  },

  /**
   * Wants a topic. Opens the connection on first use and joins the server-side group.
   * Reference-counted, so two pages wanting 'workflow' join once and the group survives either
   * one unmounting.
   */
  async subscribe(topic: string): Promise<void> {
    const next = (refCounts.get(topic) ?? 0) + 1
    refCounts.set(topic, next)
    if (next > 1) return

    await ensureStarted()
    if (connection?.state !== HubConnectionState.Connected) return
    try {
      await connection.invoke('Subscribe', topic)
    } catch (err) {
      console.warn('[live] subscribe failed', topic, err)
    }
  },

  /** Releases a topic. Leaves the group only when the last interested component has gone. */
  async unsubscribe(topic: string): Promise<void> {
    const next = (refCounts.get(topic) ?? 1) - 1
    if (next <= 0) refCounts.delete(topic)
    else refCounts.set(topic, next)
    if (next > 0) return

    if (connection?.state !== HubConnectionState.Connected) return
    try {
      await connection.invoke('Unsubscribe', topic)
    } catch {
      /* leaving a group we may already have left is not worth reporting */
    }
  },

  /**
   * Closes the socket entirely — the master switch being turned off, or signing out.
   *
   * Ref-counts are cleared too: leaving them behind would make the next subscribe() think the
   * topic was already joined and skip the invoke, giving a connection that is up and deaf.
   */
  async stop(): Promise<void> {
    refCounts.clear()
    const c = connection
    connection = null
    starting = null
    if (c) {
      try {
        await c.stop()
      } catch {
        /* already down */
      }
    }
  },

  /** For diagnostics only. */
  get state(): string {
    return connection?.state ?? 'Disconnected'
  },
}
