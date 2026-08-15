import { Checkbox, Group, Switch } from '@mantine/core'
import { SettingRow } from './SettingsCard'
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
 *
 * TWO ROWS of the Preferences card, not a card: the master is one decision and the per-page
 * choices are the second. Both write exactly what they wrote before.
 */
export function LiveUpdatesRows() {
  const { master, features, setMaster, setFeature } = useLiveSettings()

  return (
    <>
      <SettingRow
        label="Live updates"
        hint={
          <>
            When someone else changes something, the pages you have open refresh themselves. No data
            travels over the connection — your screen simply reloads what you are already allowed to
            see. Every Refresh button keeps working either way.
          </>
        }
        note="Changes apply immediately — no reload. Remembered per person on this browser."
        control={
          <Switch
            checked={master}
            onChange={(e) => setMaster(e.currentTarget.checked)}
            aria-label="Live updates"
            label={master ? 'On' : 'Off — nothing refreshes on its own'}
          />
        }
      />

      {/* Kept visible but disabled when the master is off, rather than hidden: somebody switching
          the master back on should see the choices they already made, not an empty space that
          implies the per-feature settings were forgotten. */}
      <SettingRow
        label="Pages that update live"
        hint="Which pages refresh themselves while the master switch is on."
        control={
          <Group gap="md">
            {LIVE_FEATURES.map((f) => (
              <Checkbox
                key={f}
                checked={features[f]}
                disabled={!master}
                label={LIVE_FEATURE_LABELS[f]}
                onChange={(e) => setFeature(f, e.currentTarget.checked)}
              />
            ))}
          </Group>
        }
      />
    </>
  )
}
