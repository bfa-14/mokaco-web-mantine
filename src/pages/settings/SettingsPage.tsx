import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { ActionIcon, Loader, Tabs } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconRefresh } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { AccessDenied } from '../AccessDenied'
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
import { SystemSettingRow, tabOfSection, titleOf } from './SystemSettingRow'
import { AttendanceMachinesSection } from './AttendanceMachinesSection'
import { PunchDirectionRows } from './PunchDirectionSection'
import { DangerZone } from './DangerZone'
import { LiveUpdatesRows } from './LiveUpdatesSection'
import { LanguageRow } from './LanguageSection'
import './settings.css'

/** Only SETTING_MANAGE may read the full list or write any of it — these values decide what people are paid. */
const SETTING_MANAGE = 'SETTING_MANAGE'

/**
 * The tab a `?tab=` value may name. Kept as a union so a URL somebody typed by hand cannot select
 * a panel that does not exist.
 */
const TAB_IDS = [
  'preferences',
  'attendance',
  'leave',
  'payroll',
  'workflow',
  'notifications',
  'advanced',
  'danger',
] as const
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
  /**
   * EVERY listed setting, filed by the tab its SECTION names — and filed exactly once.
   *
   * The page used to ask a per-key map which tab each setting belonged to, then band the leftovers
   * by Section inside Advanced. Two routers, so a key could reach two places: an Attendance row the
   * map did not name appeared under an "Attendance" heading inside Advanced, next to a real
   * Attendance tab. One bucket per key, chosen by one field, makes that unrepresentable.
   */
  const byTab = useMemo(() => {
    const buckets = new Map<TabId, Setting[]>()
    for (const setting of listed) {
      const tab = tabOfSection(setting.section)
      const existing = buckets.get(tab)
      if (existing) existing.push(setting)
      else buckets.set(tab, [setting])
    }
    return buckets
  }, [listed])

  /**
   * THE DUPLICATE ALARM — development only, and it should never fire.
   *
   * Routing is now a pure function of one field, so a key CANNOT reach two tabs by construction.
   * What this still catches is the other half of the same symptom: the API returning the same
   * SettingKey twice. That would render two rows whose Save buttons overwrite each other, which on
   * screen looks exactly like the bug this replaced.
   */
  useEffect(() => {
    if (!import.meta.env.DEV || settings.length === 0) return
    const seen = new Set<string>()
    const duplicates = settings
      .map((s) => s.settingKey)
      .filter((key) => (seen.has(key) ? true : (seen.add(key), false)))
    if (duplicates.length > 0) {
      console.warn(
        '[settings] duplicate SettingKey from the API — each renders its own row and they will ' +
          'overwrite one another on save:',
        [...new Set(duplicates)],
      )
    }
  }, [settings])

  /**
   * One tab's settings, split into the bands core.SETTING declares.
   *
   * ORDER IS THE API'S. usp_Setting_GetAll returns rows by Section then SortOrder — host, port,
   * user, password — which is the order somebody fills a mail server in. A Map preserves insertion
   * order, so nothing is sorted again here and the two cannot disagree.
   *
   * MOST TABS HAVE ONE BAND, because a tab is a section. Advanced is the exception by design: it
   * holds its own section plus every section nobody has mapped — Booking today — each under its own
   * name rather than in one undifferentiated list.
   */
  const bandsOf = (tab: TabId): { bands: [string, Setting[]][]; loose: Setting[] } => {
    const bands = new Map<string, Setting[]>()
    const loose: Setting[] = []
    for (const setting of byTab.get(tab) ?? []) {
      const section = setting.section?.trim()
      if (!section) {
        loose.push(setting)
        continue
      }
      const existing = bands.get(section)
      if (existing) existing.push(setting)
      else bands.set(section, [setting])
    }
    return { bands: [...bands.entries()], loose }
  }

  const preferenceSettings = byTab.get('preferences') ?? []
  const attendanceSettings = byTab.get('attendance') ?? []

  const advancedSettings = byTab.get('advanced') ?? []
  const advancedBands = bandsOf('advanced')
  const workflowBands = bandsOf('workflow')
  const leaveBands = bandsOf('leave')
  const payrollBands = bandsOf('payroll')
  const notificationBands = bandsOf('notifications')

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
    ...(canManage && leaveBands.bands.length + leaveBands.loose.length > 0
      ? [{ id: 'leave' as TabId, label: t('settings.tabs.leave') }]
      : []),
    ...(canManage && payrollBands.bands.length + payrollBands.loose.length > 0
      ? [{ id: 'payroll' as TabId, label: t('settings.tabs.payroll') }]
      : []),
    // A TAB PER SECTION, and only when that section actually has rows: an empty tab behind a label
    // somebody clicked reads as a page that failed to load.
    ...(canManage && workflowBands.bands.length + workflowBands.loose.length > 0
      ? [{ id: 'workflow' as TabId, label: t('settings.tabs.workflow') }]
      : []),
    ...(canManage && notificationBands.bands.length + notificationBands.loose.length > 0
      ? [{ id: 'notifications' as TabId, label: t('settings.tabs.notifications') }]
      : []),
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

  /**
   * A SYSTEM TAB ASKED FOR BY SOMEBODY WHO MAY NOT SEE IT IS REFUSED, NOT REDIRECTED.
   *
   * The route itself stays open — it has to, for Preferences (see routeAccess.ts) — so this is
   * where the gate that RequirePermission would have been sits: a ?tab= naming a panel this user
   * cannot open renders the same No access panel a guarded route would, rather than quietly
   * landing them on Preferences as if the link had never said anything else. A tab that is merely
   * empty for a manager (no Workflow rows yet) still falls back, because that is a tab with nothing
   * in it, not a tab they are kept out of.
   */
  const requestedIsSystemTab =
    requested != null && requested !== 'preferences' && (TAB_IDS as readonly string[]).includes(requested)
  const refusedTab =
    requestedIsSystemTab &&
    !visible.some((tab) => tab.id === requested) &&
    (requested === 'danger' ? !canReset : !canManage)
  if (refusedTab) return <AccessDenied />

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

            {/* THE SYSTEM SETTINGS ARE REFUSED IN SO MANY WORDS for a user without SETTING_MANAGE.
                Not an error — the page opened, and their own preferences above are theirs — but
                the same No access wording every guarded route uses, so that what this page is
                mostly made of is visibly not theirs rather than merely absent. */}
            {!canManage && (
              <SettingsCard title={t('access.deniedTitle')}>
                <div className="empty-hint" role="note">
                  <div className="empty-hint-main">{t('access.deniedTitle')}</div>
                  {t('settings.systemDenied')}
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

        {/* ── LEAVE and PAYROLL — promoted from cards under Advanced to tabs of their own ──────
            Fed by Section = 'Leave' / 'Payroll', exactly like Workflow below: nothing is listed by
            name, and each tab exists only while its section has rows. One card per tab, untitled
            by the section (the tab already says it) unless the rows carry no section at all. */}
        {canManage &&
          ([
            ['leave', leaveBands],
            ['payroll', payrollBands],
          ] as const).map(([id, tabBands]) => (
            <Tabs.Panel key={id} value={id} className="set-panel">
              <div className="set-stack">
                {errorBanner}
                {loading ? (
                  spinner
                ) : (
                  <>
                    {tabBands.bands.map(([section, rows]) => (
                      <SettingsCard key={section} title={section}>
                        <SettingRows>{rows.map(renderSetting)}</SettingRows>
                      </SettingsCard>
                    ))}
                    {tabBands.loose.length > 0 && (
                      <SettingsCard title={t(`settings.tabs.${id}`)}>
                        <SettingRows>{tabBands.loose.map(renderSetting)}</SettingRows>
                      </SettingsCard>
                    )}
                  </>
                )}
              </div>
            </Tabs.Panel>
          ))}

        {/* ── WORKFLOW — how requests behave ──────────────────────────────────────────────────
            Its own tab now, fed by Section = 'Workflow'. Nothing is listed here by name: the rows
            arrive from the API and the tab exists only while there are some. */}
        {canManage && (
          <Tabs.Panel value="workflow" className="set-panel">
            <div className="set-stack">
              {errorBanner}
              {loading ? (
                spinner
              ) : (
                <>
                  {workflowBands.bands.map(([section, rows]) => (
                    <SettingsCard key={section} title={section}>
                      <SettingRows>{rows.map(renderSetting)}</SettingRows>
                    </SettingsCard>
                  ))}
                  {workflowBands.loose.length > 0 && (
                    <SettingsCard title={t('settings.tabs.workflow')}>
                      <SettingRows>{workflowBands.loose.map(renderSetting)}</SettingRows>
                    </SettingsCard>
                  )}
                </>
              )}
            </div>
          </Tabs.Panel>
        )}

        {/* ── NOTIFICATIONS — how the system writes to people ─────────────────────────────────
            The mail server and WhatsApp, which used to appear as bands inside Advanced purely
            because no per-key entry had claimed them. Section says Notifications, so they are. */}
        {canManage && (
          <Tabs.Panel value="notifications" className="set-panel">
            <div className="set-stack">
              {errorBanner}
              {loading ? (
                spinner
              ) : (
                <>
                  {notificationBands.bands.map(([section, rows]) => (
                    <SettingsCard key={section} title={section}>
                      <SettingRows>{rows.map(renderSetting)}</SettingRows>
                    </SettingsCard>
                  ))}
                  {notificationBands.loose.length > 0 && (
                    <SettingsCard title={t('settings.tabs.notifications')}>
                      <SettingRows>{notificationBands.loose.map(renderSetting)}</SettingRows>
                    </SettingsCard>
                  )}
                </>
              )}
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

                  {/* THE EMPTY AND NOTHING-LEFT CASES KEEP THEIR OWN CARD, because both are a
                      sentence about the whole tab rather than about any one band. */}
                  {settings.length === 0 || advancedSettings.length === 0 ? (
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
                      ) : (
                        <p className="hint">Every setting on the server has a home of its own.</p>
                      )}
                    </SettingsCard>
                  ) : (
                    <>
                      {/* ONE CARD PER SECTION, titled by the database. The heading is data, not a
                          translated string, for the same reason each row's explanation is: it comes
                          from core.SETTING and is the wording whoever added the keys chose. */}
                      {advancedBands.bands.map(([section, rows]) => (
                        <SettingsCard key={section} title={section}>
                          <SettingRows>{rows.map(renderSetting)}</SettingRows>
                        </SettingsCard>
                      ))}

                      {advancedBands.loose.length > 0 && (
                        <SettingsCard
                          title="Other settings"
                          description="Anything on the server that has no dedicated home on this page. Each is described by the database's own wording."
                        >
                          <SettingRows>{advancedBands.loose.map(renderSetting)}</SettingRows>
                        </SettingsCard>
                      )}
                    </>
                  )}
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
