import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { ActionIcon, Loader, Tabs } from '@mantine/core'
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
  SYSTEM_RESET_PERMISSION,
  type Setting,
} from '../../types/settings'
import { SettingRows, SettingsCard } from './SettingsCard'
import { SystemSettingRow, tabOf, titleOf } from './SystemSettingRow'
import { AttendanceMachinesSection } from './AttendanceMachinesSection'
import { PunchDirectionRows } from './PunchDirectionSection'
import { RejectionBehaviourSection } from './RejectionBehaviourSection'
import { DangerZone } from './DangerZone'
import { LiveUpdatesRows } from './LiveUpdatesSection'
import { LanguageRow } from './LanguageSection'
import './settings.css'

/** Only SETTING_MANAGE may read the full list or write any of it — these values decide what people are paid. */
const SETTING_MANAGE = 'SETTING_MANAGE'
/** The rejection-behaviour section answers to ROLE_MANAGE, a different trust from the settings themselves. */
const ROLE_MANAGE = 'ROLE_MANAGE'

/**
 * The tab a `?tab=` value may name. Kept as a union so a URL somebody typed by hand cannot select
 * a panel that does not exist.
 */
const TAB_IDS = ['preferences', 'attendance', 'workflow', 'advanced', 'danger'] as const
type TabId = (typeof TAB_IDS)[number]

/**
 * SETTINGS — the rules the whole application is measured against, plus the choices a person makes
 * about their own screen.
 *
 * FIVE TABS, NOT ONE SCROLL. The page had accumulated a card per batch of work — language, live
 * updates, a card per system setting, rejection behaviour, the punch pair, the machines, the danger
 * zone — in the order they happened to be built, which is not an order anybody reads in. Grouping
 * them by WHOSE settings they are (mine / attendance's / workflow's / rarely anyone's / the
 * destructive one) puts every tab within a screen of its own top.
 *
 * Not an attendance page: core.SETTING is global, and payroll and workflow will add their own keys
 * here. The system-setting side stays deliberately DATA-DRIVEN — it renders whatever the API
 * returns and picks a control from each setting's DataType — so a new setting is a database row,
 * not a code change. An unrecognised key lands on Advanced rather than nowhere.
 */
export default function SettingsPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canManage = hasPermission(SETTING_MANAGE)
  // A SEPARATE trust: rejection behaviour is role administration, so someone may hold it WITHOUT
  // SETTING_MANAGE. The page must open for either permission, not only the settings one.
  const canManageRoles = hasPermission(ROLE_MANAGE)
  // Read here as well as inside the Danger zone, which still gates itself: the TAB has to know
  // whether it has anything to show before it renders a label somebody would click into an empty
  // panel.
  const canReset = hasPermission(SYSTEM_RESET_PERMISSION)

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

  /**
   * The settings that render as ordinary rows, filed by tab.
   *
   * The three exclusions are unchanged and each has its own home elsewhere on the page: the arming
   * flag belongs to the Danger zone, the machine-pull keys are the schedule for the machines they
   * poll, and the punch pair is one decision rather than two loose values.
   */
  const listed = settings.filter(
    (s) =>
      s.settingKey !== ALLOW_SYSTEM_RESET_KEY &&
      !MACHINE_PULL_KEYS.includes(s.settingKey) &&
      !PUNCH_DIRECTION_KEYS.includes(s.settingKey),
  )
  const preferenceSettings = listed.filter((s) => tabOf(s.settingKey) === 'preferences')
  const attendanceSettings = listed.filter((s) => tabOf(s.settingKey) === 'attendance')
  const advancedSettings = listed.filter((s) => tabOf(s.settingKey) === 'advanced')

  /** One system setting as a row — the wiring is identical for every tab it appears on. */
  function renderSetting(setting: Setting) {
    return (
      <SystemSettingRow
        key={setting.settingKey}
        setting={setting}
        draft={drafts[setting.settingKey] ?? ''}
        saving={savingKey === setting.settingKey}
        standardHours={standardHours}
        onDraftChange={(value) =>
          setDrafts((current) => ({ ...current, [setting.settingKey]: value }))
        }
        onSave={() => void save(setting)}
      />
    )
  }

  /** The page-wide read failure, shown on whichever settings tab the user is looking at. */
  const errorBanner = error && (
    <div className="alert alert--error" role="alert">
      {error}
    </div>
  )

  const spinner = (
    <div className="page-loading">
      <Loader size={40} />
    </div>
  )

  /**
   * WHICH TABS EXIST FOR THIS USER.
   *
   * A tab whose whole content is permission-hidden is not rendered at all — an empty panel behind
   * a label somebody clicked is worse than never offering it, because it reads as a page that
   * failed to load rather than as a thing that is not theirs.
   *
   * Preferences is always present: language and live updates need no permission, and the language
   * switch in particular MUST reach everybody — it is the only way to read the application in
   * Arabic, and turning an employee away at the door would leave them no route to it at all.
   */
  const visible: { id: TabId; label: string; danger?: boolean }[] = [
    { id: 'preferences', label: t('settings.tabs.preferences') },
    ...(canManage ? [{ id: 'attendance' as TabId, label: t('settings.tabs.attendance') }] : []),
    ...(canManageRoles ? [{ id: 'workflow' as TabId, label: t('settings.tabs.workflow') }] : []),
    ...(canManage ? [{ id: 'advanced' as TabId, label: t('settings.tabs.advanced') }] : []),
    // LAST, always — it belongs to a different kind of act than everything before it.
    ...(canReset ? [{ id: 'danger' as TabId, label: t('settings.tabs.danger'), danger: true }] : []),
  ]

  /**
   * The selected tab lives in the URL, so a refresh — and a link somebody pastes to a colleague —
   * lands on the same panel rather than back at Preferences.
   *
   * A `?tab=` naming a panel this user cannot see falls back to the first one they can, which is
   * what makes such a pasted link safe to follow: it opens the page rather than an empty frame.
   */
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const active = visible.find((tab) => tab.id === requested)?.id ?? visible[0].id

  function selectTab(value: string | null) {
    if (!value) return
    const next = new URLSearchParams(params)
    next.set('tab', value)
    // Replace rather than push: flicking between tabs is reading, not navigating, and Back should
    // return to the page the user came from rather than to the tab they just left.
    setParams(next, { replace: true })
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

      {/* keepMounted={false} — a panel's contents mount when it is first opened, so the machines
          list does not fetch for somebody who never opens the Attendance tab. */}
      <Tabs
        value={active}
        onChange={selectTab}
        keepMounted={false}
        className="set-tabs"
      >
        <Tabs.List>
          {visible.map((tab) => (
            <Tabs.Tab
              key={tab.id}
              value={tab.id}
              className={tab.danger ? 'set-tab-danger' : undefined}
            >
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        {/* ── PREFERENCES — the choices a person makes about THEMSELVES ───────────────────────
            One card, one row per setting. These were three separate cards, which said they were
            three separate kinds of decision; they are not, they are all "how this screen behaves
            for me". Language first, because it is the choice that changes every other word. */}
        <Tabs.Panel value="preferences" className="set-panel">
          <div className="set-stack">
            <SettingsCard
              title={t('settings.tabs.preferences')}
              description="Yours alone — remembered per person on this browser, and never changed for anyone else."
            >
              <SettingRows>
                <LanguageRow />
                <LiveUpdatesRows />
                {/* Page help is a core.SETTING row, so it only appears for a user who may read
                    the settings list — but it is a choice about this screen, so it belongs here
                    rather than among the values that decide what people are paid. */}
                {preferenceSettings.map(renderSetting)}
              </SettingRows>
            </SettingsCard>

            {/* The one thing a user with neither system trust needs to be told, kept exactly as
                it read before: not an error, an explanation of whose settings those are. */}
            {!canManage && !canManageRoles && (
              <SettingsCard title="System settings">
                <div className="empty-hint">
                  <div className="empty-hint-main">
                    You do not have access to system settings.
                  </div>
                  These values decide what a working day is — and therefore what people are
                  paid — so they are owner-level rather than day-to-day. Ask whoever
                  administers the system if one of them needs to change.
                </div>
              </SettingsCard>
            )}
          </div>
        </Tabs.Panel>

        {/* ── ATTENDANCE — how a day is built, and what builds it ─────────────────────────────
            Two cards. The rules that decide what a day IS, and the machines the punches come off.
            Punch direction is part of the first: it is the same kind of thing as the standard day,
            and it used to sit two cards away from it. */}
        {canManage && (
          <Tabs.Panel value="attendance" className="set-panel">
            <div className="set-stack">
              {errorBanner}

              {loading ? (
                spinner
              ) : (
                <>
                  <SettingsCard
                    title="Attendance rules"
                    description="How a working day is measured, and how the punches behind it are read. A change applies from now on — it does not re-calculate days that have already been processed."
                  >
                    {attendanceSettings.length > 0 && (
                      <SettingRows>{attendanceSettings.map(renderSetting)}</SettingRows>
                    )}

                    {/* Directly under the rules it belongs to: the order on the page follows the
                        punch's own journey — off the terminal, then read. */}
                    <PunchDirectionRows settings={settings} onSaved={load} />
                  </SettingsCard>

                  {/* Its own card rather than three loose values: the schedule only means something
                      next to the machines it polls, and one of those machines being unreachable is
                      the thing somebody came to this page to find out.

                      Inside the SETTING_MANAGE gate because the values it writes are ordinary
                      core.SETTING rows — a DEVICE_MANAGE-only user cannot read them at all. The
                      Test / Pull now buttons inside gate separately on DEVICE_MANAGE. */}
                  <AttendanceMachinesSection settings={settings} onSaved={load} />
                </>
              )}
            </div>
          </Tabs.Panel>
        )}

        {/* ── WORKFLOW — how requests behave ──────────────────────────────────────────────────
            Role administration, on ROLE_MANAGE rather than SETTING_MANAGE. The section still
            self-gates; this tab exists only when it would render something. */}
        {canManageRoles && (
          <Tabs.Panel value="workflow" className="set-panel">
            <div className="set-stack">
              <RejectionBehaviourSection />
            </div>
          </Tabs.Panel>
        )}

        {/* ── ADVANCED — the rarely-touched, and whatever nobody has filed yet ─────────────────
            An unrecognised key lands here, which is what keeps "a new setting is a database row"
            true: it appears, with its own Description as the explanation, without this file
            changing at all. */}
        {canManage && (
          <Tabs.Panel value="advanced" className="set-panel">
            <div className="set-stack">
              {errorBanner}

              {loading ? (
                spinner
              ) : (
                <>
                  <SettingsCard
                    title="Change these rarely"
                    description="These values decide what a working day IS. Changing one silently re-prices every part-day and every exit permission from now on. It does not re-calculate days that have already been processed — so a change made today leaves last month exactly as it was."
                  />

                  <SettingsCard
                    title="Other settings"
                    description="Anything on the server that has no dedicated home on this page. Each is described by the database's own wording."
                  >
                    {settings.length === 0 ? (
                      <div className="empty-hint">
                        <div className="empty-hint-main">
                          No settings are configured on the server.
                        </div>
                        The system is running on its built-in defaults, so every part-day and every
                        exit permission is being priced by values nobody chose. Run the settings
                        seed script, then press Refresh.
                      </div>
                    ) : advancedSettings.length === 0 ? (
                      <p className="hint">Every setting on the server has a home of its own.</p>
                    ) : (
                      <SettingRows>{advancedSettings.map(renderSetting)}</SettingRows>
                    )}
                  </SettingsCard>
                </>
              )}
            </div>
          </Tabs.Panel>
        )}

        {/* ── DANGER ZONE — a different kind of act, and the last tab there is ────────────────
            Content untouched. It still renders nothing without SYSTEM_RESET, so the two gates
            agree even if one is ever changed without the other. */}
        {canReset && (
          <Tabs.Panel value="danger" className="set-panel">
            <DangerZone armedSetting={armedSetting} onArmedChanged={load} />
          </Tabs.Panel>
        )}
      </Tabs>
    </div>
  )
}
