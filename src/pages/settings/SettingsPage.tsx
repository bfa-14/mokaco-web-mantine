import { useCallback, useEffect, useState } from 'react'
import { ActionIcon, Button, Checkbox, Loader, NumberInput, Select, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconRefresh } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { useSettings } from '../../settings/useSettings'
import { settingsService } from '../../services/settingsService'
import { getErrorMessage } from '../../api/errorMessage'
import {
  ALLOW_SYSTEM_RESET_KEY,
  MACHINE_PULL_KEYS,
  PUNCH_DIRECTION_KEYS,
  SHOW_PAGE_HELP_KEY,
  type Setting,
} from '../../types/settings'
import { AttendanceMachinesSection } from './AttendanceMachinesSection'
import { PunchDirectionSection } from './PunchDirectionSection'
import { RejectionBehaviourSection } from './RejectionBehaviourSection'
import { DangerZone } from './DangerZone'
import { LiveUpdatesSection } from './LiveUpdatesSection'
import { LanguageSection } from './LanguageSection'

/** Only SETTING_MANAGE may read the full list or write any of it — these values decide what people are paid. */
const SETTING_MANAGE = 'SETTING_MANAGE'
/** The rejection-behaviour section answers to ROLE_MANAGE, a different trust from the settings themselves. */
const ROLE_MANAGE = 'ROLE_MANAGE'

/**
 * Extra guidance for the keys we know about today.
 *
 * This map is an ENHANCEMENT, not a gate. A setting that is not listed here still renders, using
 * its own Description from the database as the explanation — which is what makes adding a new
 * setting a matter of inserting a row, with no frontend change at all. Only add an entry here when
 * a key needs more than its Description can say.
 */
const KNOWN: Record<
  string,
  { group: string; title: string; min?: number; max?: number; step?: number }
> = {
  StandardWorkDayHours: {
    group: 'Attendance',
    title: 'Standard work day',
    min: 1,
    max: 24,
    step: 0.5,
  },
  ExitLeaveBasis: { group: 'Attendance', title: 'Exit leave basis' },
  FullDayThreshold: {
    group: 'Attendance',
    title: 'Full day threshold',
    min: 0,
    max: 1,
    step: 0.05,
  },
  [SHOW_PAGE_HELP_KEY]: { group: 'Appearance', title: 'Show page help' },
}

/** Values a setting of this key may take, when it is a fixed choice rather than free text. */
const CHOICES: Record<string, string[]> = {
  ExitLeaveBasis: ['Actual', 'Approved'],
}

/** The order groups appear in. Anything unrecognised falls to the end under 'Other'. */
const GROUP_ORDER = ['Appearance', 'Attendance', 'Other']

const OTHER = 'Other'

function groupOf(key: string): string {
  return KNOWN[key]?.group ?? OTHER
}

function titleOf(setting: Setting): string {
  return KNOWN[setting.settingKey]?.title ?? setting.settingKey
}

/**
 * Spells out what the value currently in the box actually MEANS, in real hours and minutes.
 *
 * This exists because FullDayThreshold is the one value here whose units are genuinely ambiguous:
 * it is a FRACTION of the day (1.00 = all of it, 0.90 = ninety per cent), NOT a percentage.
 * Somebody who reads "how much of the standard day" and types 90 has quietly broken payroll — the
 * day fraction it is compared against is capped at 1.00, so 90 can never be reached and NOBODY
 * would ever record a full day again. The number box refuses anything above 1, but the screen
 * should SAY what the number means rather than rely on being un-typeable.
 */
function describeValue(
  key: string,
  value: string,
  standardHours: number | undefined,
): string | null {
  const numeric = Number(value)
  if (value === '' || Number.isNaN(numeric)) return null

  if (key === 'StandardWorkDayHours') {
    const hours = Math.floor(numeric)
    const mins = Math.round((numeric - hours) * 60)
    const label = mins === 0 ? `${hours}h` : `${hours}h ${mins}m`
    return `A ${label} day. A 2-hour exit permission costs ${(2 / numeric).toFixed(2)} of a leave day.`
  }

  if (key === 'FullDayThreshold') {
    const percent = Math.round(numeric * 100)
    const base = `This is a fraction of the day, not a percentage: ${numeric.toFixed(2)} means ${percent}%.`
    if (!standardHours) return base

    const requiredHours = numeric * standardHours
    const h = Math.floor(requiredHours)
    const m = Math.round((requiredHours - h) * 60)
    const label = m === 0 ? `${h}h` : `${h}h ${m}m`

    return numeric >= 1
      ? `${base} The whole ${standardHours}h day must be worked before it counts as full.`
      : `${base} With a ${standardHours}h standard day, working ${label} is enough to count as a full day.`
  }

  return null
}

/**
 * One setting, one decision, one consequence. Rendered as a card rather than a grid row because
 * these are separate policy choices — a grid would invite somebody to skim them, and several of
 * them silently re-price everybody's pay.
 *
 * The control is chosen from the setting's DataType, so a key nobody has written any UI code for
 * still gets an appropriate editor.
 */
function SettingCard({
  setting,
  draft,
  saving,
  standardHours,
  onDraftChange,
  onSave,
}: {
  setting: Setting
  draft: string
  saving: boolean
  /** The configured standard day, so a fraction can be shown as real hours rather than a bare decimal. */
  standardHours: number | undefined
  onDraftChange: (value: string) => void
  onSave: () => void
}) {
  const known = KNOWN[setting.settingKey]
  const choices = CHOICES[setting.settingKey]
  const dirty = draft !== setting.settingValue
  const example = describeValue(setting.settingKey, draft, standardHours)
  const inputId = `setting-${setting.settingKey}`

  const isBool = setting.dataType === 'bool'
  const isNumber = setting.dataType === 'int' || setting.dataType === 'decimal'

  return (
    <div className="card">
      <div className="tab-toolbar">
        <div>
          <div className="card-title">{titleOf(setting)}</div>
          <span className="hint">{setting.settingKey}</span>
        </div>
      </div>

      <div className="form-field">
        {isBool ? (
          <Checkbox
            checked={draft === 'true'}
            onChange={(e) => onDraftChange(e.currentTarget.checked ? 'true' : 'false')}
            label={draft === 'true' ? 'On' : 'Off'}
            disabled={saving}
          />
        ) : choices ? (
          <Select
            id={inputId}
            data={choices}
            value={draft}
            onChange={(v) => onDraftChange(v ?? '')}
            allowDeselect={false}
            w={220}
            disabled={saving}
          />
        ) : isNumber ? (
          <NumberInput
            id={inputId}
            value={draft === '' ? '' : Number(draft)}
            onChange={(v) => onDraftChange(v == null || v === '' ? '' : String(v))}
            w={220}
            disabled={saving}
            min={known?.min}
            max={known?.max}
            step={known?.step ?? 1}
            // format '#0' / '#0.##' — whole numbers for int keys, up to two decimals otherwise.
            allowDecimal={setting.dataType !== 'int'}
            decimalScale={setting.dataType === 'int' ? 0 : 2}
          />
        ) : (
          <TextInput
            id={inputId}
            value={draft}
            onChange={(e) => onDraftChange(e.currentTarget.value)}
            w={320}
            disabled={saving}
          />
        )}
      </div>

      {/* The Description from the database IS the explanation. A setting nobody has written UI code
          for is still fully usable, because this line always tells the user what it does. */}
      {setting.description && <p className="hint">{setting.description}</p>}

      {example && <p className="hint">{example}</p>}

      <div className="form-actions">
        {setting.modifiedAt && (
          <span className="hint">
            Last changed {setting.modifiedAt.slice(0, 10)}
          </span>
        )}
        <Button onClick={onSave} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

/**
 * System settings — the rules the whole application is measured against.
 *
 * Not an attendance page: core.SETTING is global, and payroll and workflow will add their own keys
 * here. The page is deliberately DATA-DRIVEN — it renders whatever the API returns and picks a
 * control from each setting's DataType — so a new setting is a database row, not a code change.
 */
export default function SettingsPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission(SETTING_MANAGE)
  // A SEPARATE trust: rejection behaviour is role administration, so someone may hold it WITHOUT
  // SETTING_MANAGE. The page must open for either permission, not only the settings one.
  const canManageRoles = hasPermission(ROLE_MANAGE)

  // Changing the help flag must take effect everywhere immediately, not on the next reload.
  const { refresh: refreshUiSettings } = useSettings()

  const [settings, setSettings] = useState<Setting[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  // Only start in a loading state if we are actually going to fetch. Without SETTING_MANAGE there
  // is nothing to wait for, and a spinner that resolves into "you have no access" is a small lie.
  const [loading, setLoading] = useState(canManage)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await settingsService.getAll()
      setSettings(list)
      setDrafts(
        Object.fromEntries(list.map((s) => [s.settingKey, s.settingValue])),
      )
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Reading the list needs SETTING_MANAGE, so do not even ask without it — a guaranteed 403
    // dressed up as an error message helps nobody.
    if (!canManage) return

    let cancelled = false
    async function initialLoad() {
      try {
        const list = await settingsService.getAll()
        if (!cancelled) {
          setSettings(list)
          setDrafts(
            Object.fromEntries(list.map((s) => [s.settingKey, s.settingValue])),
          )
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void initialLoad()
    return () => {
      cancelled = true
    }
  }, [canManage])

  function refresh() {
    setLoading(true)
    void load()
  }

  async function save(setting: Setting) {
    const value = drafts[setting.settingKey] ?? ''
    setSavingKey(setting.settingKey)

    try {
      await settingsService.update(setting.settingKey, {
        // The dataType and description are the database's, not ours to invent — a wrong dataType
        // on a policy value is worse than a value nobody can edit here.
        settingValue: value,
        dataType: setting.dataType,
        description: setting.description,
      })

      notifications.show({
        message: `${titleOf(setting)} saved.`,
        color: 'green',
        autoClose: 2500,
      })

      // The help flag changes every other page in the app, so push it out at once.
      if (setting.settingKey === SHOW_PAGE_HELP_KEY) {
        await refreshUiSettings()
      }

      await load()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSavingKey(null)
    }
  }

  const standardHours = Number(drafts.StandardWorkDayHours) || undefined

  /**
   * The arming flag, owned by the Danger zone. Kept OUT of the ordinary list below: it is not a
   * preference, and a switch that permits deleting every employee must not sit among the
   * pay-affecting values where someone could flip it while looking for something else.
   */
  const armedSetting = settings.find((s) => s.settingKey === ALLOW_SYSTEM_RESET_KEY) ?? null

  // Group for display, then order the groups. An unrecognised key still appears — under 'Other' —
  // which is the whole point: a new setting shows up without anybody touching this file.
  const groups = GROUP_ORDER.map((group) => ({
    group,
    items: settings.filter(
      (s) =>
        groupOf(s.settingKey) === group &&
        s.settingKey !== ALLOW_SYSTEM_RESET_KEY &&
        // The machine-pull keys are the schedule for the machines listed in their own section
        // below; shown here as three loose cards they would say nothing about what they poll.
        !MACHINE_PULL_KEYS.includes(s.settingKey) &&
        // Same for the punch-direction pair: the mode and its debounce are one decision.
        !PUNCH_DIRECTION_KEYS.includes(s.settingKey),
    ),
  })).filter((g) => g.items.length > 0)

  /**
   * The choices a person makes about THEMSELVES — no permission, every signed-in user.
   *
   * Rendered in BOTH branches below on purpose. Somebody with neither system trust still reaches
   * this page, and the language switch in particular has to be there for them: it is the only way
   * to read the application in Arabic, and turning an employee away at the door would leave them
   * no route to it at all.
   *
   * Language sits first because it is the choice that changes every other word on the screen.
   */
  const personalPreferences = (
    <>
      <LanguageSection />
      <LiveUpdatesSection />
    </>
  )

  // Only turn someone away when they hold NEITHER trust. With ROLE_MANAGE alone they still get the
  // page — just the rejection-behaviour section, which gates itself on that permission.
  if (!canManage && !canManageRoles) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-subtitle">
              The rules the whole system is measured against.
            </p>
          </div>
        </div>

        {personalPreferences}

        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">
              You do not have access to system settings.
            </div>
            These values decide what a working day is — and therefore what people are
            paid — so they are owner-level rather than day-to-day. Ask whoever
            administers the system if one of them needs to change.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">
            The rules the whole system is measured against.
          </p>
        </div>
        {canManage && (
          <div className="page-head-actions">
            <ActionIcon
              variant="default"
              size="lg"
              title="Refresh"
              aria-label="Refresh"
              onClick={refresh}
            >
              <IconRefresh size={18} />
            </ActionIcon>
          </div>
        )}
      </div>

      {/* Role administration, not a system setting — it self-gates on ROLE_MANAGE and shows above the
          pay-affecting values, since it is the more day-to-day of the two. */}
      <RejectionBehaviourSection />

      {/* Personal preferences, not system settings — so they sit outside the SETTING_MANAGE gate
          below and show for every signed-in user. */}
      {personalPreferences}

      {/* Everything below is the pay-affecting settings, behind SETTING_MANAGE. A ROLE_MANAGE-only
          user has already seen the one section that is theirs; nothing here renders for them. */}
      {canManage && (
        <>
          <div className="card">
            <div className="card-title">Change these rarely</div>
            <p className="hint">
              These values decide what a working day IS. Changing one silently re-prices
              every part-day and every exit permission from now on. It does not
              re-calculate days that have already been processed — so a change made today
              leaves last month exactly as it was.
            </p>
          </div>

          {error && (
            <div className="alert alert--error" role="alert">
              {error}
            </div>
          )}

          {loading ? (
            <div className="page-loading">
              <Loader size={40} />
            </div>
          ) : settings.length === 0 ? (
            <div className="card">
              <div className="empty-hint">
                <div className="empty-hint-main">
                  No settings are configured on the server.
                </div>
                The system is running on its built-in defaults, so every part-day and every
                exit permission is being priced by values nobody chose. Run the settings
                seed script, then press Refresh.
              </div>
            </div>
          ) : (
            groups.map(({ group, items }) => (
              <div key={group} style={{ marginBottom: 24 }}>
                <h2 className="tab-section-title">{group}</h2>
                <div style={{ display: 'grid', gap: 16 }}>
                  {items.map((setting) => (
                    <SettingCard
                      key={setting.settingKey}
                      setting={setting}
                      draft={drafts[setting.settingKey] ?? ''}
                      saving={savingKey === setting.settingKey}
                      standardHours={standardHours}
                      onDraftChange={(value) =>
                        setDrafts((current) => ({
                          ...current,
                          [setting.settingKey]: value,
                        }))
                      }
                      onSave={() => void save(setting)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}

          {/* Its own section rather than three cards in the list above: the schedule only means
              something next to the machines it polls, and one of those machines being unreachable
              is the thing somebody came to this page to find out.

              Inside the SETTING_MANAGE gate because the values it writes are ordinary core.SETTING
              rows — a DEVICE_MANAGE-only user cannot read them at all, so there is nothing to show
              them here. The Test / Pull now buttons inside gate separately on DEVICE_MANAGE. */}
          {/* Directly above the machines that produce the punches it interprets: the order on the
              page follows the punch's own journey — off the terminal, then read. */}
          {!loading && <PunchDirectionSection settings={settings} onSaved={load} />}

          {!loading && (
            <AttendanceMachinesSection settings={settings} onSaved={load} />
          )}
        </>
      )}

      {/* Last on the page and visually apart, because it belongs to a different kind of act than
          everything above it. Renders nothing without SYSTEM_RESET. */}
      <DangerZone armedSetting={armedSetting} onArmedChanged={load} />
    </div>
  )
}
