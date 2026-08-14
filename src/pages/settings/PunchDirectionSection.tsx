import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button, NumberInput, Select } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { getErrorMessage } from '../../api/errorMessage'
import { settingsService } from '../../services/settingsService'
import {
  PUNCH_DEBOUNCE_MINUTES_KEY,
  PUNCH_DIRECTION_MODE_KEY,
  type Setting,
} from '../../types/settings'

const DEBOUNCE_MIN = 0
const DEBOUNCE_MAX = 10

function find(settings: Setting[], key: string): Setting | undefined {
  return settings.find((s) => s.settingKey === key)
}

/**
 * PUNCH DIRECTION — how the system reads the punches it already holds.
 *
 * THE RAW LOG IS NEVER TOUCHED BY ANY OF THIS. What the machine sent stays exactly as it arrived;
 * these two settings change only how it is INTERPRETED when a day is built. That is what makes
 * switching modes safe, and it is also why switching does nothing to days already processed —
 * they were derived under the old reading and nothing revisits them on its own. Re-process day, on
 * the Daily page, is how a past day catches up.
 */
export function PunchDirectionSection({
  settings,
  onSaved,
}: {
  settings: Setting[]
  onSaved: () => Promise<void> | void
}) {
  const { t } = useTranslation()

  const modeSetting = find(settings, PUNCH_DIRECTION_MODE_KEY)
  const debounceSetting = find(settings, PUNCH_DEBOUNCE_MINUTES_KEY)

  /**
   * The two ways a punch's direction can be decided, in the words of the person choosing.
   *
   * 'Alternate' is first because it is the one that matches how people actually use these
   * terminals: they present a finger and walk, and whether the machine happened to be showing IN
   * or OUT at that moment is not something anybody checks. 'Device' is correct only where staff
   * genuinely do press the state key every time.
   *
   * Built here rather than at module scope because the labels are translated, and a module-level
   * constant would be frozen in whichever language happened to load first.
   */
  const modes = [
    { value: 'Alternate', label: t('settings.punchDirection.modeAlternate') },
    { value: 'Device', label: t('settings.punchDirection.modeDevice') },
  ]

  const [savingKey, setSavingKey] = useState<string | null>(null)

  /**
   * Null means "not edited" — the box echoes the server. Same override-that-clears-on-success shape
   * as the other sections: a refused write must leave what the user chose in front of them rather
   * than silently reverting to a value they did not pick.
   */
  const [debounceDraft, setDebounceDraft] = useState<number | null>(null)
  const serverDebounce = Number(debounceSetting?.settingValue) || 0
  const debounce = debounceDraft ?? serverDebounce
  const debounceDirty = debounceDraft != null && debounceDraft !== serverDebounce

  if (!modeSetting && !debounceSetting) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">{t('settings.punchDirection.title')}</div>
        <div className="empty-hint">
          <div className="empty-hint-main">{t('settings.punchDirection.missingMain')}</div>
          <Trans
            i18nKey="settings.punchDirection.missingBody"
            components={{ code: <code /> }}
          />
        </div>
      </div>
    )
  }

  async function save(setting: Setting, value: string) {
    setSavingKey(setting.settingKey)
    try {
      await settingsService.update(setting.settingKey, {
        settingValue: value,
        dataType: setting.dataType,
        description: setting.description,
      })
      if (setting.settingKey === PUNCH_DEBOUNCE_MINUTES_KEY) setDebounceDraft(null)
      await onSaved()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSavingKey(null)
    }
  }

  const mode = modeSetting?.settingValue === 'Device' ? 'Device' : 'Alternate'

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title">{t('settings.punchDirection.title')}</div>
      <p className="hint">{t('settings.punchDirection.intro')}</p>

      {modeSetting && (
        <div className="form-field" style={{ marginTop: 16 }}>
          <label className="form-label" htmlFor="punch-direction-mode">
            {t('settings.punchDirection.modeLabel')}
          </label>
          <Select
            id="punch-direction-mode"
            data={modes}
            value={mode}
            allowDeselect={false}
            disabled={savingKey === modeSetting.settingKey}
            onChange={(value) => {
              if (value) void save(modeSetting, value)
            }}
          />
          <p className="hint" style={{ marginTop: 6 }}>
            {mode === 'Alternate'
              ? t('settings.punchDirection.modeHintAlternate')
              : t('settings.punchDirection.modeHintDevice')}
          </p>
        </div>
      )}

      {debounceSetting && (
        <div className="form-field">
          <label className="form-label" htmlFor="punch-debounce-minutes">
            {t('settings.punchDirection.debounceLabel')}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NumberInput
              id="punch-debounce-minutes"
              value={debounce}
              // Mantine emits a string while typing and '' for a cleared box; neither may reach the
              // request as NaN, and an empty box means "no debounce" rather than "unknown".
              onChange={(value) =>
                setDebounceDraft(typeof value === 'number' ? value : Number(value) || DEBOUNCE_MIN)
              }
              min={DEBOUNCE_MIN}
              max={DEBOUNCE_MAX}
              step={1}
              allowDecimal={false}
              w={140}
              disabled={savingKey === debounceSetting.settingKey}
            />
            <Button
              disabled={savingKey === debounceSetting.settingKey || !debounceDirty}
              onClick={() => void save(debounceSetting, String(debounce))}
            >
              {savingKey === debounceSetting.settingKey ? t('common.saving') : t('common.save')}
            </Button>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            {t('settings.punchDirection.debounceHint')}
          </p>
        </div>
      )}

      {/* Trans rather than t(): the sentence carries a link to the page that acts on it, and the
          Arabic puts that link in a different place in the sentence than the English does. */}
      <p className="hint" style={{ marginTop: 12 }}>
        <Trans
          i18nKey="settings.punchDirection.footnote"
          components={{ daily: <Link to="/attendance/daily" /> }}
        />
      </p>
    </div>
  )
}
