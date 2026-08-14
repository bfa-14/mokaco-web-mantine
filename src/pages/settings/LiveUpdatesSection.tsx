import { Checkbox, Switch } from '@mantine/core'
import { useLiveSettings } from '../../live/useLiveSettings'
import { LIVE_FEATURES, LIVE_FEATURE_LABELS } from '../../live/livePrefs'

/**
 * LIVE UPDATES — whether pages refresh themselves when somebody else changes something.
 *
 * NOT a system setting. It is stored per user on this browser, so it needs no permission and shows
 * for everybody: the whole question is "do I want my screen moving while I read it", which is a
 * personal one. That is also why it does not live in core.SETTING — an owner deciding this for the
 * whole company would be answering a question nobody asked them.
 *
 * The master switch is genuinely the master: turning it off closes the socket rather than merely
 * ignoring it, so a user who says no stops holding a connection open at all.
 */
export function LiveUpdatesSection() {
  const { master, features, setMaster, setFeature } = useLiveSettings()

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title">Live updates</div>
      <p className="hint">
        When someone else changes something, the pages you have open refresh themselves. No data
        travels over the connection — your screen simply reloads what you are already allowed to
        see. Every Refresh button keeps working either way.
      </p>

      <div className="form-field" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Switch
            checked={master}
            onChange={(e) => setMaster(e.currentTarget.checked)}
            aria-label="Live updates"
          />
          <span>{master ? 'On' : 'Off — nothing refreshes on its own'}</span>
        </div>
      </div>

      {/* Kept visible but disabled when the master is off, rather than hidden: somebody switching
          the master back on should see the choices they already made, not an empty space that
          implies the per-feature settings were forgotten. */}
      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {LIVE_FEATURES.map((f) => (
          <Checkbox
            key={f}
            checked={features[f]}
            disabled={!master}
            label={LIVE_FEATURE_LABELS[f]}
            onChange={(e) => setFeature(f, e.currentTarget.checked)}
          />
        ))}
      </div>

      <p className="hint" style={{ marginTop: 12 }}>
        Changes apply immediately — no reload. Settings are remembered per person on this browser.
      </p>
    </div>
  )
}
