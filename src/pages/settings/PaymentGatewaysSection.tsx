import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button, Loader, PasswordInput, SegmentedControl, Switch, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { getErrorMessage } from '../../api/errorMessage'
import { Modal } from '../../components/dialogs'
import { gatewaysService } from '../../services/paymentsService'
import type {
  GatewayCheckResult,
  GatewayKeysPayload,
  GatewayMode,
  GatewayModeView,
  GatewayName,
  GatewayOverview,
  GatewayView,
} from '../../types/payments'
import { stamp } from '../bookings/bookingShared'
import { SettingRow, SettingRows, SettingsCard } from './SettingsCard'
import '../bookings/payments.css'

/** The address the bank gave for its TEST gateway: offered as the starting value of the test box. */
const CARD_TEST_ADDRESS = 'https://test-bobsal.gateway.mastercard.com'

/**
 * SETTINGS > PAYMENT GATEWAYS (permission GATEWAY_ADMIN) — the keys of Whish and of the bank's card gateway, each
 * for TEST and for LIVE, and which of the two a gateway works in.
 *
 * A KEY IS TYPED ONCE AND NEVER SHOWN AGAIN. The server stores it encrypted and answers with the end of it at most,
 * so every secret box here is always empty: leaving it empty keeps what is saved. Nothing on this page turns a
 * gateway on for the website - saving keys only makes them available; "Check connection" asks the gateway with them
 * and moves no money.
 *
 * LIVE IS SAID IN RED, AND ASKED FOR TWICE: switching a gateway to live means real payments.
 */
export function PaymentGatewaysSection({ refreshKey }: { refreshKey: number }) {
  const { t } = useTranslation()
  const [overview, setOverview] = useState<GatewayOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Bumped after a save, a removal, a mode change or a check: the page re-reads what the server now holds. */
  const [changes, setChanges] = useState(0)
  const load = useCallback(() => setChanges((count) => count + 1), [])

  useEffect(() => {
    let stale = false
    gatewaysService
      .get()
      .then((answer) => {
        if (stale) return
        setOverview(answer)
        setError(null)
      })
      .catch((err) => {
        if (!stale) setError(getErrorMessage(err))
      })
    return () => {
      stale = true
    }
  }, [changes, refreshKey])

  if (error && !overview) {
    return (
      <div className="alert alert--error" role="alert">
        {error}
      </div>
    )
  }

  if (!overview) {
    return (
      <div className="page-loading">
        <Loader size={32} />
      </div>
    )
  }

  const addressesMissing = !overview.siteUrl || !overview.apiPublicUrl

  return (
    <div className="set-stack">
      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {/* ── where things stand ── */}
      <SettingsCard
        title={t('gateways.glance.title')}
        description={t('gateways.glance.description')}
        headExtra={
          <Button component={Link} to="/bookings/gateway-test" variant="light" size="xs">
            {t('gateways.glance.openTest')}
          </Button>
        }
      >
        <dl className="pay-facts">
          <dt>{t('gateways.glance.card')}</dt>
          <dd>
            <ReadyTag view={overview.card} />
          </dd>
          <dt>{t('gateways.glance.whish')}</dt>
          <dd>
            <ReadyTag view={overview.whish} />
          </dd>
        </dl>
        {addressesMissing && <div className="alert alert--warning">{t('gateways.glance.addressesMissing')}</div>}
      </SettingsCard>

      <WebsiteSwitches overview={overview} onChanged={load} />

      <GatewayCard view={overview.whish} onChanged={load} />
      <GatewayCard view={overview.card} onChanged={load} />

      {/* ── who changed what ── */}
      <SettingsCard title={t('gateways.history.title')} description={t('gateways.history.description')}>
        {overview.history.length === 0 ? (
          <div className="hint">{t('gateways.history.empty')}</div>
        ) : (
          <ul className="gw-history">
            {overview.history.map((row) => (
              <li key={row.id}>
                <strong>{t(`gateways.name.${row.gateway}`)}</strong>
                {row.mode && <> · {t(`gateways.mode.${row.mode}`)}</>} ·{' '}
                {t(`gateways.history.${row.type}`, {
                  defaultValue: row.type,
                  outcome: row.outcome === 'Ok' ? t('gateways.history.ok') : t('gateways.history.failed'),
                })}
                {row.type === 'ModeChanged' && row.detail && <> ({row.detail})</>}
                <div className="pay-sub">
                  {stamp(row.at)}
                  {row.by && <> · {row.by}</>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
    </div>
  )
}

/**
 * WHAT GUESTS CAN DO ON THE WEBSITE — the two switches that turn the gateways on for the public: take the deposit
 * online at all (the card, Bank of Beirut), and offer Whish beside it.
 *
 * TURNING ONE ON IS ASKED FOR TWICE, with the mode in front of the eye: from that moment guests are asked to pay.
 * Turning one off is immediate - it only ever stops a payment. The server refuses a switch that would offer guests a
 * gateway that is not ready, or (on the live system) one in test mode, and its sentence is shown as it comes.
 */
function WebsiteSwitches({ overview, onChanged }: { overview: GatewayOverview; onChanged: () => void }) {
  const { t } = useTranslation()
  const [asking, setAsking] = useState<'deposits' | 'whish' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function apply(which: 'deposits' | 'whish', on: boolean) {
    setBusy(true)
    setError(null)
    try {
      const answer = await gatewaysService.setWebsite(which === 'deposits' ? { deposits: on } : { whish: on })
      notifications.show({ message: answer.message, color: 'green' })
      onChanged()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
      setAsking(null)
    }
  }

  function toggle(which: 'deposits' | 'whish', on: boolean) {
    if (on) setAsking(which)
    else void apply(which, false)
  }

  const gateway = asking === 'whish' ? overview.whish : overview.card
  // A gateway in test mode offered to guests: fine on the test side, never on the live one (the server refuses it).
  const testOffered =
    overview.depositsRequired &&
    ((overview.card.ready && overview.card.activeMode === 'test') ||
      (overview.whishOnWebsite && overview.whish.ready && overview.whish.activeMode === 'test'))

  return (
    <SettingsCard title={t('gateways.website.title')} description={t('gateways.website.description')}>
      <SettingRows>
        <SettingRow
          label={t('gateways.website.deposits')}
          hint={overview.depositsRequired ? t('gateways.glance.depositsOn') : t('gateways.glance.depositsOff')}
          control={
            <Switch
              checked={overview.depositsRequired}
              onChange={(event) => toggle('deposits', event.currentTarget.checked)}
              disabled={busy}
              aria-label={t('gateways.website.deposits')}
            />
          }
        />
        <SettingRow
          label={t('gateways.website.whish')}
          hint={
            overview.whishOnWebsite
              ? overview.depositsRequired
                ? t('gateways.glance.whishWebsiteOn')
                : t('gateways.website.whishWaiting')
              : t('gateways.glance.whishWebsiteOff')
          }
          control={
            <Switch
              checked={overview.whishOnWebsite}
              onChange={(event) => toggle('whish', event.currentTarget.checked)}
              disabled={busy}
              aria-label={t('gateways.website.whish')}
            />
          }
        />
      </SettingRows>

      {error && (
        <div className="alert alert--error gw-check" role="alert">
          {error}
        </div>
      )}
      {/* On the test side this is how things are meant to be. On the live system it is a hole: said in red. */}
      {testOffered &&
        (overview.production ? (
          <div className="alert alert--error gw-check" role="alert">
            {t('gateways.website.testOfferedLive')}
          </div>
        ) : (
          <div className="alert alert--warning gw-check">{t('gateways.website.testOffered')}</div>
        ))}

      <Modal opened={asking != null} onClose={() => setAsking(null)} title={t('gateways.website.confirmTitle')} centered>
        <p>{t(asking === 'whish' ? 'gateways.website.confirmWhish' : 'gateways.website.confirmDeposits')}</p>
        <p>
          {t('gateways.website.confirmMode', { name: t(`gateways.name.${gateway.gateway}`) })} <ModeTag mode={gateway.activeMode} />
        </p>
        {gateway.activeMode === 'test' && <p className="hint">{t('gateways.website.confirmTestNote')}</p>}
        <div className="pay-refund-actions">
          <Button variant="default" onClick={() => setAsking(null)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => asking && void apply(asking, true)} loading={busy}>
            {t('gateways.website.confirm')}
          </Button>
        </div>
      </Modal>
    </SettingsCard>
  )
}

function ReadyTag({ view }: { view: GatewayView }) {
  const { t } = useTranslation()
  if (!view.ready) return <span className="pay-tag pay-tag--plain">{t('gateways.notSetUp')}</span>
  return (
    <span className="gw-status">
      <span className="pay-tag pay-tag--good">{t('gateways.ready')}</span>
      <ModeTag mode={view.activeMode} />
    </span>
  )
}

export function ModeTag({ mode }: { mode: GatewayMode }) {
  const { t } = useTranslation()
  return mode === 'live' ? (
    <span className="pay-live">{t('gateways.modeTag.live')}</span>
  ) : (
    <span className="pay-test">{t('gateways.modeTag.test')}</span>
  )
}

/** One gateway: the mode it works in, and its two sets of keys. */
function GatewayCard({ view, onChanged }: { view: GatewayView; onChanged: () => void }) {
  const { t } = useTranslation()
  const [wanted, setWanted] = useState<GatewayMode | null>(null)
  const [busy, setBusy] = useState(false)

  async function applyMode(mode: GatewayMode | null) {
    setBusy(true)
    try {
      const answer = await gatewaysService.setMode(view.gateway, mode)
      notifications.show({ message: answer.message, color: mode === 'live' ? 'red' : 'green' })
      onChanged()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red' })
    } finally {
      setBusy(false)
      setWanted(null)
    }
  }

  function chooseMode(mode: GatewayMode) {
    if (mode === view.activeMode && view.chosenMode === mode) return
    // Live is asked for twice. Test is not: nothing real can happen there.
    if (mode === 'live') setWanted('live')
    else void applyMode('test')
  }

  const name = t(`gateways.name.${view.gateway}`)

  return (
    <SettingsCard
      title={name}
      description={t(`gateways.about.${view.gateway}`)}
      headExtra={<ReadyTag view={view} />}
    >
      <div className="gw-inuse">
        <div className="form-field">
          <span className="form-label">{t('gateways.inUse')}</span>
          <SegmentedControl
            value={view.activeMode}
            onChange={(value) => chooseMode(value as GatewayMode)}
            disabled={busy}
            data={[
              { value: 'test', label: t('gateways.mode.test') },
              { value: 'live', label: t('gateways.mode.live') },
            ]}
          />
        </div>
        <div className="hint">
          {view.chosenMode
            ? t('gateways.modeChosen', {
                by: view.modeChangedBy ?? t('payments.someone'),
                when: stamp(view.modeChangedAt),
              })
            : view.serverMode
              ? t('gateways.modeFromServer')
              : t('gateways.modeDefault')}
          {view.chosenMode && view.serverMode && (
            <>
              {' '}
              <button type="button" className="link-button" onClick={() => void applyMode(null)} disabled={busy}>
                {t('gateways.followServer')}
              </button>
            </>
          )}
        </div>
      </div>

      {!view.ready && view.problem && <div className="alert alert--warning gw-check">{view.problem}</div>}

      <div className="gw-grid">
        {view.modes.map((mode) => (
          <ModeKeys
            key={mode.mode}
            gateway={view.gateway}
            mode={mode}
            active={view.activeMode === mode.mode}
            onChanged={onChanged}
          />
        ))}
      </div>

      <Modal opened={wanted === 'live'} onClose={() => setWanted(null)} title={t('gateways.goLive.title', { name })} centered>
        <p>{t('gateways.goLive.body', { name })}</p>
        <p className="hint">{t('gateways.goLive.note')}</p>
        <div className="pay-refund-actions">
          <Button variant="default" onClick={() => setWanted(null)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button color="red" onClick={() => void applyMode('live')} loading={busy}>
            {t('gateways.goLive.confirm')}
          </Button>
        </div>
      </Modal>
    </SettingsCard>
  )
}

/** The keys of one gateway in one mode: what is saved (masked), a form to save or replace them, and a check. */
function ModeKeys({
  gateway,
  mode,
  active,
  onChanged,
}: {
  gateway: GatewayName
  mode: GatewayModeView
  active: boolean
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const [keys, setKeys] = useState<GatewayKeysPayload>({})
  const [busy, setBusy] = useState<'save' | 'check' | 'remove' | null>(null)
  const [check, setCheck] = useState<GatewayCheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  const shown = mode.shown
  /* The value is read NOW: by the time React runs the updater, the event no longer points at its input. */
  const set = (field: keyof GatewayKeysPayload) => (event: { currentTarget: { value: string } }) => {
    const value = event.currentTarget.value
    setKeys((current) => ({ ...current, [field]: value }))
  }

  /** What a box shows while empty: the saved value (a secret only by its end), so "empty" visibly means "keep". */
  const kept = (field: string, fallback: string) =>
    shown[field] ? t('gateways.keys.kept', { value: shown[field] }) : fallback

  async function save() {
    setBusy('save')
    setError(null)
    try {
      const answer = await gatewaysService.saveKeys(gateway, mode.mode, keys)
      notifications.show({ message: answer.message, color: 'green' })
      setKeys({})
      setCheck(null)
      onChanged()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function runCheck() {
    setBusy('check')
    setError(null)
    try {
      setCheck(await gatewaysService.check(gateway, mode.mode))
      onChanged()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('remove')
    setError(null)
    try {
      const answer = await gatewaysService.deleteKeys(gateway, mode.mode)
      notifications.show({ message: answer.message, color: 'green' })
      setCheck(null)
      onChanged()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(null)
      setRemoving(false)
    }
  }

  const typed = Object.values(keys).some((value) => (value ?? '').trim().length > 0)
  const id = `gw-${gateway}-${mode.mode}`

  return (
    <section className={`gw-mode gw-mode--${mode.mode}${active ? ' gw-mode--active' : ''}`}>
      <div className="gw-mode-head">
        <span className="gw-mode-title">{t(`gateways.keys.title.${mode.mode}`)}</span>
        <span className="gw-status">
          {active && <span className="pay-tag pay-tag--good">{t('gateways.keys.inUse')}</span>}
          <ModeTag mode={mode.mode} />
        </span>
      </div>

      <div className="hint">
        {mode.unreadable
          ? t('gateways.keys.unreadable')
          : mode.source === 'settings'
            ? t('gateways.keys.savedBy', { by: mode.savedBy ?? t('payments.someone'), when: stamp(mode.savedAt) })
            : mode.source === 'server'
              ? t('gateways.keys.fromServer')
              : t(`gateways.keys.none.${mode.mode}`)}
      </div>

      <div className="gw-fields">
        {gateway === 'whish' ? (
          <>
            <TextInput
              id={`${id}-channel`}
              label={t('gateways.fields.channel')}
              value={keys.channel ?? ''}
              onChange={set('channel')}
              placeholder={kept('channel', t('gateways.fields.channelHint'))}
              autoComplete="off"
            />
            <PasswordInput
              id={`${id}-secret`}
              label={t('gateways.fields.secret')}
              value={keys.secret ?? ''}
              onChange={set('secret')}
              placeholder={kept('secret', t('gateways.fields.secretHint'))}
              autoComplete="new-password"
            />
            <TextInput
              id={`${id}-website`}
              label={t('gateways.fields.websiteUrl')}
              description={t('gateways.fields.websiteUrlHint')}
              value={keys.websiteUrl ?? ''}
              onChange={set('websiteUrl')}
              placeholder={kept('websiteUrl', 'mokanco.com.lb')}
              autoComplete="off"
            />
          </>
        ) : (
          <>
            <TextInput
              id={`${id}-base`}
              label={t('gateways.fields.baseUrl')}
              value={keys.baseUrl ?? ''}
              onChange={set('baseUrl')}
              placeholder={kept('baseUrl', mode.mode === 'test' ? CARD_TEST_ADDRESS : t('gateways.fields.baseUrlHint'))}
              autoComplete="off"
            />
            <TextInput
              id={`${id}-merchant`}
              label={t('gateways.fields.merchantId')}
              description={t(`gateways.fields.merchantHint.${mode.mode}`)}
              value={keys.merchantId ?? ''}
              onChange={set('merchantId')}
              placeholder={kept('merchantId', mode.mode === 'test' ? 'TESTMOKANDCO' : 'MOKANDCO')}
              autoComplete="off"
            />
            <PasswordInput
              id={`${id}-password`}
              label={t('gateways.fields.apiPassword')}
              value={keys.apiPassword ?? ''}
              onChange={set('apiPassword')}
              placeholder={kept('apiPassword', t('gateways.fields.secretHint'))}
              autoComplete="new-password"
            />
            <TextInput
              id={`${id}-version`}
              label={t('gateways.fields.apiVersion')}
              value={keys.apiVersion ?? ''}
              onChange={set('apiVersion')}
              placeholder={kept('apiVersion', '73')}
              inputMode="numeric"
              autoComplete="off"
            />
          </>
        )}
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}
      {!mode.ready && mode.problem && mode.hasKeys && <div className="alert alert--warning">{mode.problem}</div>}

      <div className="gw-buttons">
        <Button onClick={() => void save()} loading={busy === 'save'} disabled={!typed || busy != null}>
          {mode.source === 'settings' ? t('gateways.keys.replace') : t('gateways.keys.save')}
        </Button>
        <Button
          variant="default"
          onClick={() => void runCheck()}
          loading={busy === 'check'}
          disabled={!mode.ready || typed || busy != null}
          title={typed ? t('gateways.keys.saveFirst') : undefined}
        >
          {t('gateways.keys.check')}
        </Button>
        {mode.source === 'settings' && (
          <Button variant="subtle" color="red" onClick={() => setRemoving(true)} disabled={busy != null}>
            {t('gateways.keys.remove')}
          </Button>
        )}
      </div>

      {check && (
        <div className={`alert gw-check ${check.ok ? 'alert--success' : 'alert--error'}`} role="status">
          {check.message}
          {check.ms != null && <span className="pay-sub"> · {t('gateways.keys.took', { ms: check.ms })}</span>}
        </div>
      )}

      <Modal opened={removing} onClose={() => setRemoving(false)} title={t('gateways.keys.removeTitle')} centered>
        <p>
          {t('gateways.keys.removeBody', {
            name: t(`gateways.name.${gateway}`),
            mode: t(`gateways.mode.${mode.mode}`),
          })}
        </p>
        <div className="pay-refund-actions">
          <Button variant="default" onClick={() => setRemoving(false)} disabled={busy != null}>
            {t('common.cancel')}
          </Button>
          <Button color="red" onClick={() => void remove()} loading={busy === 'remove'}>
            {t('gateways.keys.remove')}
          </Button>
        </div>
      </Modal>
    </section>
  )
}
