import { useState } from 'react'
import type { ReactNode } from 'react'
import { IconChevronDown, IconInfoCircle } from '@tabler/icons-react'
import { useSettings } from '../settings/useSettings'

/**
 * The "What is this page for?" panel that sits at the top of every Attendance page.
 *
 * It exists because the person using these screens is an HR manager at a coffee shop,
 * not a developer. They will open this once a month, under time pressure, and they will
 * not read a manual. Every page therefore has to answer, unprompted: what is this, what
 * do I do here, and what happens if I get it wrong.
 *
 * Open by default, and dismissal is REMEMBERED ONLY FOR THIS SESSION (component state —
 * deliberately not localStorage). Somebody who comes back next month gets the explanation
 * again, which is exactly when they need it.
 */
export function PageHelp({ children }: { children: ReactNode }) {
  const { showPageHelp } = useSettings()
  const [open, setOpen] = useState(true)

  // Switched off system-wide on the Settings page, once the team knows the system. Rendering
  // nothing (rather than a collapsed panel) is the point — a team that has turned help off should
  // not still be looking at a row of "What is this page for?" toggles they never open.
  if (!showPageHelp) return null

  return (
    <div className={open ? 'page-help page-help--open' : 'page-help'}>
      <button
        type="button"
        className="page-help-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {/* PORT: dx-icon-info / dx-icon-spf glyphs → Tabler equivalents; the page-help-chevron
            class (and its --open rotation) is CSS-driven and carries over unchanged. */}
        <IconInfoCircle size={16} aria-hidden="true" />
        <span>What is this page for?</span>
        <IconChevronDown
          size={16}
          className={`page-help-chevron${open ? ' page-help-chevron--open' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && <p className="page-help-body">{children}</p>}
    </div>
  )
}
