import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button, NumberInput, Select } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { SettingGroup, SettingRow, SettingRows } from './SettingsCard'
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
 *
 * A GROUP OF ROWS inside Attendance rules rather than a card of its own. It sat as a separate card
 * because it is separately titled, but it is the same kind of thing as the standard day and the
 * full-day threshold — a rule the whole system is measured against — and somebody checking how a
 * day is built should not have to remember which card each half of the answer was on. Every
 * translation key it renders, and both saves, are exactly as they were.
 */
export function PunchDirectionRows({
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
      <SettingGroup title={t('settings.punchDirection.title')}>
        <div className="empty-hint">
          <div className="empty-hint-main">{t('settings.punchDirection.missingMain')}</div>
          <Trans
            i18nKey="settings.punchDirection.missingBody"
            components={{ code: <code /> }}
          />
        </div>
      </SettingGroup>
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
    <SettingGroup
      title={t('settings.punchDirection.title')}
      hint={t('settings.punchDirection.intro')}
    >
      <SettingRows>
        {modeSetting && (
          <SettingRow
            htmlFor="punch-direction-mode"
            label={t('settings.punchDirection.modeLabel')}
            hint={
              mode === 'Alternate'
                ? t('settings.punchDirection.modeHintAlternate')
                : t('settings.punchDirection.modeHintDevice')
            }
            control={
              <Select
                id="punch-direction-mode"
                data={modes}
                value={mode}
                allowDeselect={false}
                disabled={savingKey === modeSetting.settingKey}
                // Saves on change, exactly as before — the choice IS the edit.
                onChange={(value) => {
                  if (value) void save(modeSetting, value)
                }}
                // The two labels are whole sentences, so the box needs room to be read at the end
                // of a row rather than at the full width of a card.
                w={380}
              />
            }
          />
        )}

        {debounceSetting && (
          <SettingRow
            htmlFor="punch-debounce-minutes"
            label={t('settings.punchDirection.debounceLabel')}
            hint={t('settings.punchDirection.debounceHint')}
            control={
              <>
                <NumberInput
                  id="punch-debounce-minutes"
                  value={debounce}
                  // Mantine emits a string while typing and '' for a cleared box; neither may reach
                  // the request as NaN, and an empty box means "no debounce" rather than "unknown".
                  onChange={(value) =>
                    setDebounceDraft(
                      typeof value === 'number' ? value : Number(value) || DEBOUNCE_MIN,
                    )
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
                  {savingKey === debounceSetting.settingKey
                    ? t('common.saving')
                    : t('common.save')}
                </Button>
              </>
            }
          />
        )}
      </SettingRows>

      {/* Trans rather than t(): the sentence carries a link to the page that acts on it, and the
          Arabic puts that link in a different place in the sentence than the English does. */}
      <p className="set-card-foot">
        <Trans
          i18nKey="settings.punchDirection.footnote"
          components={{ daily: <Link to="/attendance/daily" /> }}
        />
      </p>
    </SettingGroup>
  )
}
