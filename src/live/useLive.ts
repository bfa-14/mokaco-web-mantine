import { useEffect, useRef } from 'react'
import { liveClient } from './liveClient'

const DEBOUNCE_MS = 1500

/**
 * Subscribe a page to live updates.
 *
 * The contract is deliberately small: when something in one of `topics` changes, `onStale` runs and
 * the page refetches through its own existing calls. No data arrives over the socket, so this hook
 * can never put a figure on screen that the page's own endpoints would not have returned.
 *
 * FOUR BEHAVIOURS, EACH FIXING A REAL FAILURE:
 *
 *  1. DEBOUNCED 1.5s. One user action can be several writes — approving a request touches the
 *     request, the step and the dashboard. Undebounced, a page would refetch three times in a
 *     second and flicker. The trailing edge is what fires, so a burst settles into one refetch.
 *
 *  2. ONLY WHEN VISIBLE. A backgrounded tab that refetches on every signal is pure waste — nobody
 *     is looking, and a busy office would have every idle tab hammering the API all day. A signal
 *     arriving while hidden is REMEMBERED, not dropped, and spent as a single refetch when the tab
 *     comes forward. That is why it is a boolean flag and not a counter: ten missed signals still
 *     mean exactly one refetch, because one refetch already returns the current state.
 *
 *  3. CATCH-UP ON RECONNECT. While the socket was down, signals were missed and there is no way to
 *     know how many. Re-subscribing restores the groups; the single onStale that follows repairs
 *     whatever was missed in the gap.
 *
 *  4. `enabled` IS LIVE. Turning a feature off in settings unsubscribes immediately and turning it
 *     on resubscribes, with no reload — the effect simply re-runs, because `enabled` is a
 *     dependency.
 *
 * `onStale` is held in a ref so a caller may pass an inline arrow without re-subscribing on every
 * render — the effect depends on the topics and the flag, never on the callback's identity.
 */
export function useLive(topics: string[], onStale: () => void, enabled: boolean): void {
  // Assigned in an effect, not during render: a ref is not render-time state, and writing it while
  // rendering is the pattern that makes a component miss its own updates. After-commit is soon
  // enough — the only reader is a socket callback, which cannot fire mid-render.
  const onStaleRef = useRef(onStale)
  useEffect(() => {
    onStaleRef.current = onStale
  })

  // Joined into a string so an inline array literal — the normal way to call this — does not look
  // like a new dependency on every render and resubscribe endlessly.
  const topicKey = topics.join(',')

  useEffect(() => {
    if (!enabled || topicKey === '') return

    const wanted = topicKey.split(',')
    const mine = new Set(wanted)

    let timer: number | null = null
    let missedWhileHidden = false
    let cancelled = false

    const runRefetch = () => {
      if (cancelled) return
      onStaleRef.current()
    }

    const schedule = () => {
      if (cancelled) return
      if (document.visibilityState !== 'visible') {
        // Remember, do not queue: one refetch on return reflects everything that happened.
        missedWhileHidden = true
        return
      }
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        runRefetch()
      }, DEBOUNCE_MS)
    }

    const offStale = liveClient.onStale((topic) => {
      if (mine.has(topic)) schedule()
    })

    const offReconnect = liveClient.onReconnected(() => {
      // The gap may have swallowed anything; one catch-up covers all of it.
      schedule()
    })

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && missedWhileHidden) {
        missedWhileHidden = false
        schedule()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    wanted.forEach((t) => void liveClient.subscribe(t))

    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      offStale()
      offReconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      wanted.forEach((t) => void liveClient.unsubscribe(t))
    }
  }, [topicKey, enabled])
}
