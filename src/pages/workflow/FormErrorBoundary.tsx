import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/**
 * A crashing FORM must not blank the whole route.
 *
 * Without this, one bad render anywhere in a body unmounts the entire page and leaves a white
 * screen: no picker to switch away with, no message, and nothing in the UI naming the file. The
 * person reporting it can only say "it went white", which is the least useful bug report there is.
 *
 * So the blast radius stops here. The picker, the header and the rest of the page survive; the form
 * column is replaced by the error itself — message and component stack — which is exactly what
 * someone needs to paste into a bug report or hand to whoever is fixing it.
 *
 * It is a CLASS because React offers no hook for this; componentDidCatch has no function equivalent.
 */
export class FormErrorBoundary extends Component<
  {
    /**
     * Change this to clear a caught error — the selected type code. Without it a boundary that has
     * caught once stays broken forever, so switching to a working type would still show the old
     * crash and look like every type was broken.
     */
    resetKey: string | null
    children: ReactNode
  },
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

  /**
   * Clears the error when the reset key moves on. Done in derived state rather than an effect so the
   * recovery happens in the SAME render as the switch — an effect would paint the stale crash once
   * more before clearing it.
   */
  static getDerivedStateFromProps(
    props: { resetKey: string | null },
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
    console.error('[NewRequestShell] a form body crashed', error, info)
    this.setState({ stack: info.componentStack ?? null })
  }

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children

    return (
      <div className="card" role="alert">
        <div className="card-title" style={{ color: '#b91c1c' }}>
          This form could not be displayed
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          The rest of the page still works — pick another request type on the left, or send this to
          whoever is fixing it.
        </p>
        {/* The message VERBATIM. Never a friendly paraphrase: the exact text is the whole value. */}
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
    )
  }
}
