import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Loader, NumberInput, Switch, Table, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { getErrorMessage } from '../../api/errorMessage'
import { accessService, gateService } from '../../services/accessService'
import { dateTime } from '../workflow/workflowFormat'
import { SettingGroup, SettingRow, SettingRows, SettingsCard } from './SettingsCard'
import { ConfirmDialog, ServerText, TestSignInDialog, whoText } from './GoogleSignInDialogs'
import { GoogleSignInPeople } from './GoogleSignInPeople'
import { GoogleSignInExtras } from './GoogleSignInExtras'
import type { AccessView, GateSignInOutcome } from '../../types/access'
import './googleSignIn.css'

const DAYS_MIN = 1
const DAYS_MAX = 365

/** The recent list shows this many until somebody asks for all of them. */
const RECENT_SHOWN = 20

/** The confirmations this tab asks for. */
type Confirming = 'turnOn' | 'signOutBrowser' | 'signOutEveryone'

function outcomeClass(outcome: GateSignInOutcome): string {
  return outcome === 'Allowed' ? 'badge badge--on' : 'badge badge--off'
}

/**
 * SETTINGS → GOOGLE SIGN-IN — the optional front door (docs/GOOGLE_SIGNIN_GATE.md in MokaCo.HRMS).
 *
 * When it is on, nginx shows a "Sign in with Google" page before anything else on the HRMS host,
 * and only a verified Gmail on the list gets through; the normal login follows. This tab is the
 * whole of its administration: the switch, the client ID and the days; who is on the list; extra
 * accounts; the sign-in log; and "sign everyone out". Everything is ACCESS_MANAGE (Admin, Owner).
 *
 * HAND-BUILT, like the Danger zone, not a generic settings row. The four Google* keys are refused by
 * the generic settings endpoint, because the one thing that must never happen — the owner turning
 * on a door they cannot open themselves — is guarded only on api/access: the switch goes on only
 * for a browser that has already passed Google (Test Google sign-in). That refusal (409) is shown
 * as the API words it.
 *
 * The switch saves on change and the client ID and days with Save, all three in one PUT each time
 * (the stored values for whatever is not being changed).
 */
export function GoogleSignInSection({ refreshKey }: { refreshKey: number }) {
  const { t } = useTranslation()

  const [data, setData] = useState<AccessView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /**
   * Only the newest read may land. A save reloads the tab, and so does the page's Refresh; whichever
   * answer arrives last must be the one that was ASKED last, or a slow old read puts the switch
   * back where it was before the save.
   */
  const loadSeq = useRef(0)

  const [savingSwitch, setSavingSwitch] = useState(false)
  /** Null = not edited, the box shows what the server holds. */
  const [clientIdDraft, setClientIdDraft] = useState<string | null>(null)
  const [daysDraft, setDaysDraft] = useState<number | string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  const [confirming, setConfirming] = useState<Confirming | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  const [testOpen, setTestOpen] = useState(false)
  const [showAllRecent, setShowAllRecent] = useState(false)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const view = await accessService.get()
      if (seq !== loadSeq.current) return
      setData(view)
      setError(null)
    } catch (err) {
      if (seq === loadSeq.current) setError(getErrorMessage(err))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Mount, and every press of the page's Refresh. load() sets state only after its await.
    void load()
  }, [load, refreshKey])

  if (loading && !data) {
    return (
      <div className="page-loading">
        <Loader size={40} />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="alert alert--error" role="alert">
        <ServerText text={error ?? ''} />
      </div>
    )
  }

  const { settings, caller } = data
  const clientId = clientIdDraft ?? settings.clientId
  const days = daysDraft ?? settings.days
  const daysNumber = typeof days === 'number' ? days : Number(days)
  const daysValid = Number.isInteger(daysNumber) && daysNumber >= DAYS_MIN && daysNumber <= DAYS_MAX
  const dirty = clientId.trim() !== settings.clientId || daysNumber !== settings.days

  /** The switch: the stored client ID and days go with it, never an unsaved draft. */
  async function saveRequired(required: boolean): Promise<boolean> {
    setSavingSwitch(true)
    try {
      await accessService.saveSettings({ required, clientId: settings.clientId, days: settings.days })
      // Settles from the save: the PUT has landed, so the switch shows it before the reload does.
      setData((d) => (d ? { ...d, settings: { ...d.settings, required } } : d))
      notifications.show({
        message: required ? t('googleGate.turnedOn') : t('googleGate.turnedOff'),
        color: 'green',
        autoClose: 3000,
      })
      await load()
      return true
    } finally {
      setSavingSwitch(false)
    }
  }

  async function turnOff() {
    try {
      await saveRequired(false)
    } catch (err) {
      notifications.show({ message: <ServerText text={getErrorMessage(err)} />, color: 'red', autoClose: 6000 })
    }
  }

  async function saveSettings() {
    setSavingSettings(true)
    setSettingsError(null)
    try {
      await accessService.saveSettings({
        required: settings.required,
        clientId: clientId.trim(),
        days: daysNumber,
      })
      setClientIdDraft(null)
      setDaysDraft(null)
      notifications.show({ message: t('googleGate.saved'), color: 'green', autoClose: 2500 })
      await load()
    } catch (err) {
      // "That is not a Google client ID — it ends with .apps.googleusercontent.com." — in the card,
      // with what was typed left in the box.
      setSettingsError(getErrorMessage(err))
    } finally {
      setSavingSettings(false)
    }
  }

  function ask(what: Confirming) {
    setConfirmError(null)
    setConfirming(what)
  }

  async function confirm() {
    if (!confirming) return
    setConfirmBusy(true)
    setConfirmError(null)
    try {
      if (confirming === 'turnOn') {
        await saveRequired(true)
      } else if (confirming === 'signOutBrowser') {
        await signOutBrowser()
      } else {
        await accessService.signOutEveryone()
        notifications.show({ message: t('googleGate.signOutAll.done'), color: 'green', autoClose: 3000 })
        await load()
      }
      setConfirming(null)
    } catch (err) {
      // 409 "Sign in with Google in this browser first …" lands here, in the dialog it answers.
      setConfirmError(getErrorMessage(err))
    } finally {
      setConfirmBusy(false)
    }
  }

  async function signOutBrowser() {
    await gateService.signOut()
    notifications.show({ message: t('googleGate.browser.signedOut'), color: 'green', autoClose: 2500 })
    await load()
  }

  const recent = showAllRecent ? data.recent : data.recent.slice(0, RECENT_SHOWN)

  return (
    <div className="set-stack gate-tab">
      {error && (
        <div className="alert alert--error" role="alert">
          <ServerText text={error} />
        </div>
      )}

      <SettingsCard title={t('googleGate.title')} description={t('googleGate.description')}>
        <SettingRows>
          <SettingRow
            htmlFor="gate-required"
            label={t('googleGate.requiredLabel')}
            hint={settings.required ? t('googleGate.requiredOn') : t('googleGate.requiredOff')}
            meta={
              settings.modifiedAt
                ? t('googleGate.lastChanged', { when: dateTime(settings.modifiedAt) })
                : undefined
            }
            control={
              <Switch
                id="gate-required"
                size="md"
                checked={settings.required}
                disabled={savingSwitch}
                onChange={(e) => {
                  // Read before anything else: React may recycle the event after this handler.
                  const on = e.currentTarget.checked
                  // On is the act that can shut people out, so it is confirmed; off saves at once.
                  if (on) ask('turnOn')
                  else void turnOff()
                }}
              />
            }
          />

          <SettingRow
            htmlFor="gate-client-id"
            label={t('googleGate.clientIdLabel')}
            hint={t('googleGate.clientIdHint')}
            control={
              <TextInput
                id="gate-client-id"
                value={clientId}
                onChange={(e) => setClientIdDraft(e.currentTarget.value)}
                placeholder={t('googleGate.clientIdPlaceholder')}
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                disabled={savingSettings}
                w={420}
                maw="100%"
              />
            }
          />

          <SettingRow
            htmlFor="gate-days"
            label={t('googleGate.daysLabel')}
            hint={t('googleGate.daysHint')}
            error={settingsError && <ServerText text={settingsError} />}
            control={
              <>
                <NumberInput
                  id="gate-days"
                  value={days}
                  onChange={(v) => setDaysDraft(v)}
                  min={DAYS_MIN}
                  max={DAYS_MAX}
                  step={1}
                  allowDecimal={false}
                  allowNegative={false}
                  error={!daysValid}
                  disabled={savingSettings}
                  w={120}
                />
                <Button
                  onClick={() => void saveSettings()}
                  disabled={savingSettings || !dirty || !daysValid}
                >
                  {savingSettings ? t('common.saving') : t('common.save')}
                </Button>
              </>
            }
          />

          <SettingRow
            label={
              <>
                {t('googleGate.browser.label')}{' '}
                <span className={caller.verified ? 'badge badge--on' : 'badge badge--muted'}>
                  {caller.verified ? t('googleGate.browser.verified') : t('googleGate.browser.notVerified')}
                </span>
              </>
            }
            hint={
              caller.verified
                ? t('googleGate.browser.verifiedAs', { who: whoText(caller.email, caller.name) })
                : t('googleGate.browser.notVerifiedHint')
            }
            control={
              <>
                <Button variant="default" onClick={() => setTestOpen(true)}>
                  {t('googleGate.browser.test')}
                </Button>
                {caller.verified && (
                  <Button
                    variant="subtle"
                    color="red"
                    onClick={() => {
                      // While the gate is on, leaving it is worth a second look; while it is off
                      // the cookie does nothing yet, so it simply goes.
                      if (settings.required) ask('signOutBrowser')
                      else
                        void signOutBrowser().catch((err) =>
                          notifications.show({ message: <ServerText text={getErrorMessage(err)} />, color: 'red', autoClose: 6000 }),
                        )
                    }}
                  >
                    {t('googleGate.browser.signOut')}
                  </Button>
                )}
              </>
            }
          />
        </SettingRows>

        <SettingGroup title={t('googleGate.howTo.title')}>
          <ol className="gate-steps">
            <li>{t('googleGate.howTo.step1', { doc: '⁨docs/GOOGLE_SIGNIN_SETUP.md⁩' })}</li>
            <li>{t('googleGate.howTo.step2')}</li>
            <li>
              {t('googleGate.howTo.step3', { origin: `⁨${window.location.origin}⁩` })}
            </li>
            <li>{t('googleGate.howTo.step4')}</li>
            <li>{t('googleGate.howTo.step5')}</li>
            <li>{t('googleGate.howTo.step6')}</li>
          </ol>
        </SettingGroup>
      </SettingsCard>

      <GoogleSignInPeople people={data.people} onChanged={load} />

      <GoogleSignInExtras extras={data.extras} onChanged={load} />

      <SettingsCard title={t('googleGate.recent.title')} description={t('googleGate.recent.description')}>
        {data.recent.length === 0 ? (
          <div className="empty-hint">{t('googleGate.recent.empty')}</div>
        ) : (
          <>
            <Table.ScrollContainer minWidth={640}>
              <Table striped withTableBorder verticalSpacing="xs" fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('googleGate.recent.cols.when')}</Table.Th>
                    <Table.Th>{t('googleGate.recent.cols.email')}</Table.Th>
                    <Table.Th>{t('googleGate.recent.cols.result')}</Table.Th>
                    <Table.Th>{t('googleGate.recent.cols.person')}</Table.Th>
                    <Table.Th>{t('googleGate.recent.cols.ip')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {recent.map((row) => (
                    <Table.Tr key={row.gateSignInLogId}>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{dateTime(row.attemptedAt)}</Table.Td>
                      <Table.Td>
                        <bdi className="gate-email">{row.email}</bdi>
                      </Table.Td>
                      <Table.Td>
                        <span className={outcomeClass(row.outcome)}>
                          {t(`googleGate.recent.outcome.${row.outcome}`, { defaultValue: row.outcome })}
                        </span>
                      </Table.Td>
                      <Table.Td>{row.fullName ?? t('common.dash')}</Table.Td>
                      <Table.Td>
                        <bdi>{row.ip ?? t('common.dash')}</bdi>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {data.recent.length > RECENT_SHOWN && (
              <Button variant="subtle" size="xs" mt="xs" onClick={() => setShowAllRecent((v) => !v)}>
                {showAllRecent
                  ? t('googleGate.recent.showLess')
                  : t('googleGate.recent.showAll', { count: data.recent.length })}
              </Button>
            )}
          </>
        )}
      </SettingsCard>

      <SettingsCard title={t('googleGate.signOutAll.title')} description={t('googleGate.signOutAll.description')}>
        <Button variant="outline" color="red" onClick={() => ask('signOutEveryone')}>
          {t('googleGate.signOutAll.button')}
        </Button>
      </SettingsCard>

      <ConfirmDialog
        opened={confirming != null}
        title={
          confirming === 'turnOn'
            ? t('googleGate.confirmOn.title')
            : confirming === 'signOutBrowser'
              ? t('googleGate.browser.signOutTitle')
              : t('googleGate.signOutAll.confirmTitle')
        }
        confirmLabel={
          confirming === 'turnOn'
            ? t('googleGate.confirmOn.button')
            : confirming === 'signOutBrowser'
              ? t('googleGate.browser.signOut')
              : t('googleGate.signOutAll.confirmButton')
        }
        danger={confirming !== 'turnOn'}
        busy={confirmBusy}
        error={confirmError}
        onConfirm={() => void confirm()}
        onClose={() => setConfirming(null)}
      >
        {confirming === 'turnOn' && (
          <>
            <p style={{ marginTop: 0 }}>{t('googleGate.confirmOn.body')}</p>
            {!caller.verified && (
              <div className="alert alert--warning" role="note" style={{ marginBottom: 0 }}>
                {t('googleGate.browser.notVerifiedHint')}
              </div>
            )}
          </>
        )}
        {confirming === 'signOutBrowser' && <p style={{ marginTop: 0 }}>{t('googleGate.browser.signOutBody')}</p>}
        {confirming === 'signOutEveryone' && (
          <p style={{ marginTop: 0 }}>{t('googleGate.signOutAll.confirmBody')}</p>
        )}
      </ConfirmDialog>

      <TestSignInDialog
        opened={testOpen}
        clientId={settings.clientId}
        onClose={() => setTestOpen(false)}
        onVerified={() => void load()}
      />
    </div>
  )
}
