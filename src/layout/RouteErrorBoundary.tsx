import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/**
 * A CRASHING PAGE MUST NOT BLANK THE WHOLE APPLICATION.
 *
 * React unmounts the entire tree when a render throws with nothing to catch it, so one bad cell
 * renderer on one page took the nav, the header and every route with it — a white screen, no way
 * back, and a bug report that can only say "it went white". That is the least useful report there
 * is, and it is exactly what happened on Payroll → Tiers & ceilings.
 *
 * The blast radius now stops at the routed page. The shell around it — nav, header, language
 * switch — survives, so the reader can walk away to a working page instead of reloading and
 * guessing. The panel prints the message and the component stack VERBATIM, because the exact text
 * is the whole value to whoever fixes it; a friendly paraphrase would throw away the only evidence.
 *
 * RESET ON NAVIGATION. `resetKey` is the current pathname: a boundary that has caught once would
 * otherwise stay broken forever, so every subsequent route would render this panel and the whole
 * app would look dead after one crash. Cleared in derived state rather than an effect so recovery
 * happens in the SAME render as the navigation — an effect would paint the stale crash once more.
 *
 * It is a CLASS because React offers no hook for this; componentDidCatch has no function equivalent.
 * Modelled on {@link ../pages/workflow/FormErrorBoundary}, which does the same job one level down.
 */
export class RouteErrorBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { error: Error | null; stack: string | null; shownFor: string | null }
> {
  state: { error: Error | null; stack: string | null; shownFor: string | null } = {
    error: null,
    stack: null,
    shownFor: null,
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { error: Error | null; shownFor: string | null },
  ) {
    if (state.error && state.shownFor !== null && state.shownFor !== props.resetKey) {
      return { error: null, stack: null, shownFor: null }
    }
    if (state.error && state.shownFor === null) {
      return { shownFor: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Still logged: the console remains the fullest record, and this panel is a summary of it.
    console.error('[route] a page crashed', error, info)
    this.setState({ stack: info.componentStack ?? null })
  }

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children

    return (
      <div role="alert">
        <div className="page-head">
          <div>
            <h1 className="page-title">This page could not be displayed</h1>
            <p className="page-subtitle">
              Something on it failed to render. The rest of the application still works — pick
              another page from the menu, or send this to whoever is fixing it.
            </p>
          </div>
        </div>

        <div className="card">
          {/* The message VERBATIM. Never a friendly paraphrase: the exact text is the evidence. */}
          <pre className="wf-crash-detail">{error.message}</pre>
          {stack && (
            <details>
              <summary className="hint" style={{ cursor: 'pointer' }}>
                Where it happened
              </summary>
              <pre className="wf-crash-detail">{stack.trim()}</pre>
            </details>
          )}
        </div>
      </div>
    )
  }
}
