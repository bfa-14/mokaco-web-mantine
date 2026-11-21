import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { ActionIcon, Button, Loader, NumberInput, SegmentedControl, Select, TextInput } from '@mantine/core'
import { IconExternalLink, IconRefresh } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { getErrorMessage } from '../../api/errorMessage'
import { Modal } from '../../components/dialogs'
import { PageHelp } from '../../components/PageHelp'
import { gatewaysService } from '../../services/paymentsService'
import type {
  GatewayCheckResult,
  GatewayLookupResult,
  GatewayMode,
  GatewayName,
  GatewayOverview,
  GatewayTest,
  GatewayTestResult,
} from '../../types/payments'
import { ModeTag } from '../settings/PaymentGatewaysSection'
import { money, stamp } from './bookingShared'
import { FactRow } from './PaymentBits'
import { PAY_PERMISSIONS, TEST_POLL_MS, TEST_POLLS, testIsOpen, testTone } from './paymentLogic'
import './bookings.css'
import './payments.css'

/** The colour of a test's answer: red when what was asked for did not happen, whatever the test's own state. */
function resultClass(result: GatewayTestResult): string {
  if (!result.ok) return result.test.status === 'Unknown' ? 'alert--warning' : 'alert--error'
  return testTone(result.test.status) === 'good' ? 'alert--success' : 'alert--warning'
}

/**
 * GATEWAY TEST (admins only, permission GATEWAY_ADMIN) — try Bank of Beirut and Whish from HRMS, in test or in
 * live, without going through the website and without switching anything.
 *
 * THREE THINGS, FROM THE SAFEST UP:
 *   1. CHECK CONNECTION   asks the gateway with the saved keys. Moves no money.
 *   2. TEST PAYMENT       opens a small payment (a few dollars at most) and gives the gateway's own payment page to
 *                         pay it on. In TEST mode no real money moves; in LIVE mode it is a real payment, which the
 *                         page says before it is opened. The page then follows the payment by itself.
 *   3. LOOK UP            what the gateway holds for any reference: a booking's, a Whish attempt's, a test's.
 *
 * A TEST PAYMENT IS NEVER A BOOKING. Its reference starts with GT-, and it appears only on this page.
 *
 * WHICH MODE IS TRIED is chosen here, per test; it is NOT the mode the website's payments run in (that is chosen on
 * Settings > Payment gateways). So production can be tried while the website still works in test, and the reverse.
 */
export default function GatewayTestPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const allowed = hasPermission(PAY_PERMISSIONS.admin)
  const [params, setParams] = useSearchParams()

  const [overview, setOverview] = useState<GatewayOverview | null>(null)
  const [tests, setTests] = useState<GatewayTest[]>([])
  const [error, setError] = useState<string | null>(null)

  const [gateway, setGateway] = useState<GatewayName>('whish')
  const [mode, setMode] = useState<GatewayMode>('test')

  const [busy, setBusy] = useState<'check' | 'open' | 'lookup' | null>(null)
  const [check, setCheck] = useState<GatewayCheckResult | null>(null)
  const [amount, setAmount] = useState<number | string>(1)
  const [currency, setCurrency] = useState('USD')
  const [confirmLive, setConfirmLive] = useState(false)
  const [current, setCurrent] = useState<GatewayTestResult | null>(null)
  const [reference, setReference] = useState('')
  const [lookup, setLookup] = useState<GatewayLookupResult | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)

  const [reloads, setReloads] = useState(0)
  const load = useCallback(() => setReloads((count) => count + 1), [])

  useEffect(() => {
    if (!allowed) return
    let stale = false
    Promise.all([gatewaysService.get(), gatewaysService.listTests()])
      .then(([gateways, list]) => {
        if (stale) return
        setOverview(gateways)
        setTests(list)
        setError(null)
      })
      .catch((err) => {
        if (!stale) setError(getErrorMessage(err))
      })
    return () => {
      stale = true
    }
  }, [allowed, reloads])

  /* Changing what is being tried clears the answers that belonged to the other choice. */
  function choose(nextGateway: GatewayName, nextMode: GatewayMode) {
    setGateway(nextGateway)
    setMode(nextMode)
    setCheck(null)
    setLookup(null)
    setLookupError(null)
  }

  const upsert = useCallback((test: GatewayTest) => {
    setTests((rows) => (rows.some((row) => row.ref === test.ref) ? rows.map((row) => (row.ref === test.ref ? test : row)) : [test, ...rows]))
  }, [])

  /* ── coming back from the gateway's page: ?test=GT-... names the test that was just paid ── */
  const returned = params.get('test')
  useEffect(() => {
    if (!allowed || !returned) return
    let stale = false
    gatewaysService
      .checkTest(returned)
      .then((answer) => {
        if (stale) return
        setCurrent(answer)
        setGateway(answer.test.gateway)
        setMode(answer.test.mode)
        upsert(answer.test)
      })
      .catch((err) => {
        if (!stale) setError(getErrorMessage(err))
      })
      .finally(() => {
        if (stale) return
        setParams(
          (now) => {
            const next = new URLSearchParams(now)
            next.delete('test')
            return next
          },
          { replace: true },
        )
      })
    return () => {
      stale = true
    }
  }, [allowed, returned, setParams, upsert])

  /* ── the page follows an open test by itself, for as long as its payment page can be paid ── */
  const polls = useRef(0)
  const openRef = current && testIsOpen(current.test.status) ? current.test.ref : null
  useEffect(() => {
    if (!openRef) return
    polls.current = 0
    const timer = window.setInterval(() => {
      polls.current += 1
      if (polls.current > TEST_POLLS) {
        window.clearInterval(timer)
        return
      }
      gatewaysService
        .checkTest(openRef)
        .then((answer) => {
          setCurrent(answer)
          upsert(answer.test)
        })
        .catch(() => {
          /* the next tick asks again; the button is there for a person */
        })
    }, TEST_POLL_MS)
    return () => window.clearInterval(timer)
  }, [openRef, upsert])

  const view = overview ? overview[gateway] : null
  const modeView = view?.modes.find((entry) => entry.mode === mode) ?? null
  const ready = modeView?.ready ?? false
  const max = currency === 'LBP' ? (overview?.maxTestAmount.lbp ?? 2000000) : (overview?.maxTestAmount.usd ?? 20)
  const name = t(`gateways.name.${gateway}`)

  const recent = useMemo(() => tests.slice(0, 30), [tests])

  if (!allowed) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1 className="page-title">{t('gatewayTest.title')}</h1>
          </div>
        </div>
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">{t('gatewayTest.noAccess')}</div>
            {t('gatewayTest.noAccessHint')}
          </div>
        </div>
      </div>
    )
  }

  async function runCheck() {
    setBusy('check')
    setError(null)
    try {
      setCheck(await gatewaysService.check(gateway, mode))
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function openTest() {
    setConfirmLive(false)
    setBusy('open')
    setError(null)
    try {
      const answer = await gatewaysService.openTest({ gateway, mode, amount: Number(amount), currency })
      setCurrent(answer)
      upsert(answer.test)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function act(ref: string, action: 'check' | 'refund') {
    setRowBusy(`${action}:${ref}`)
    setError(null)
    try {
      const answer = action === 'check' ? await gatewaysService.checkTest(ref) : await gatewaysService.refundTest(ref)
      upsert(answer.test)
      setCurrent(answer)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setRowBusy(null)
    }
  }

  async function runLookup() {
    setBusy('lookup')
    setLookupError(null)
    setLookup(null)
    try {
      setLookup(await gatewaysService.lookup({ gateway, mode, reference: reference.trim(), currency }))
    } catch (err) {
      setLookupError(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('gatewayTest.title')}</h1>
          <p className="page-subtitle">{t('gatewayTest.subtitle')}</p>
        </div>
        <div className="page-head-actions">
          <ActionIcon variant="default" size="lg" title={t('common.refresh')} aria-label={t('common.refresh')} onClick={load}>
            <IconRefresh size={18} />
          </ActionIcon>
        </div>
      </div>

      <PageHelp>{t('gatewayTest.help')}</PageHelp>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {!overview ? (
        !error && (
          <div className="page-loading">
            <Loader size={40} />
          </div>
        )
      ) : (
        <div className="gw-steps">
          {/* ── 1. what to try ── */}
          <section className="card">
            <h2 className="gw-step-title">
              <span className="gw-step-number">1</span>
              {t('gatewayTest.choose.title')}
            </h2>
            <div className="gw-row">
              <div className="form-field">
                <span className="form-label">{t('gatewayTest.choose.gateway')}</span>
                <SegmentedControl
                  value={gateway}
                  onChange={(value) => choose(value as GatewayName, mode)}
                  data={[
                    { value: 'whish', label: t('gateways.name.whish') },
                    { value: 'card', label: t('gateways.name.card') },
                  ]}
                />
              </div>
              <div className="form-field">
                <span className="form-label">{t('gatewayTest.choose.mode')}</span>
                <SegmentedControl
                  value={mode}
                  onChange={(value) => choose(gateway, value as GatewayMode)}
                  color={mode === 'live' ? 'red' : undefined}
                  data={[
                    { value: 'test', label: t('gateways.mode.test') },
                    { value: 'live', label: t('gateways.mode.live') },
                  ]}
                />
              </div>
            </div>

            {mode === 'live' ? (
              <div className="alert alert--error gw-result">{t('gatewayTest.choose.liveWarning')}</div>
            ) : (
              <div className="hint gw-result">{t('gatewayTest.choose.testNote')}</div>
            )}

            {!ready && (
              <div className="alert alert--warning gw-result">
                {modeView?.problem ?? t('gatewayTest.choose.noKeys')}{' '}
                <Link to="/settings?tab=gateways">{t('gatewayTest.choose.openSettings')}</Link>
              </div>
            )}
            {ready && view && (
              <div className="hint">
                {t('gatewayTest.choose.keysFrom', {
                  source: t(`gatewayTest.source.${modeView?.source ?? 'none'}`),
                })}{' '}
                {view.activeMode === mode ? t('gatewayTest.choose.sameAsWebsite') : t('gatewayTest.choose.notWebsiteMode', { mode: t(`gateways.mode.${view.activeMode}`) })}
              </div>
            )}
          </section>

          {/* ── 2. the connection ── */}
          <section className="card">
            <h2 className="gw-step-title">
              <span className="gw-step-number">2</span>
              {t('gatewayTest.connection.title')}
            </h2>
            <div className="hint">{t('gatewayTest.connection.about', { name })}</div>
            <div className="gw-row">
              <Button onClick={() => void runCheck()} loading={busy === 'check'} disabled={!ready || busy != null}>
                {t('gateways.keys.check')}
              </Button>
            </div>
            {check && (
              <div className={`alert gw-result ${check.ok ? 'alert--success' : 'alert--error'}`} role="status">
                {check.message}
                {check.ms != null && <span className="pay-sub"> · {t('gateways.keys.took', { ms: check.ms })}</span>}
              </div>
            )}
          </section>

          {/* ── 3. a test payment ── */}
          <section className="card">
            <h2 className="gw-step-title">
              <span className="gw-step-number">3</span>
              {t('gatewayTest.payment.title')}
            </h2>
            <div className="hint">
              {t(mode === 'live' ? 'gatewayTest.payment.aboutLive' : `gatewayTest.payment.aboutTest.${gateway}`)}
            </div>
            <div className="gw-row">
              <NumberInput
                label={t('common.amount')}
                value={amount}
                onChange={setAmount}
                min={currency === 'LBP' ? 1000 : 0.5}
                max={max}
                decimalScale={currency === 'LBP' ? 0 : 2}
                w={130}
              />
              <Select
                label={t('common.currency')}
                value={currency}
                onChange={(value) => {
                  setCurrency(value ?? 'USD')
                  setAmount(value === 'LBP' ? 100000 : 1)
                }}
                data={['USD', 'LBP']}
                allowDeselect={false}
                w={110}
              />
              <Button
                color={mode === 'live' ? 'red' : undefined}
                onClick={() => (mode === 'live' ? setConfirmLive(true) : void openTest())}
                loading={busy === 'open'}
                disabled={!ready || busy != null || !(Number(amount) > 0) || Number(amount) > max}
              >
                {t(mode === 'live' ? 'gatewayTest.payment.openLive' : 'gatewayTest.payment.open')}
              </Button>
            </div>
            <div className="hint">{t('gatewayTest.payment.limit', { max: money(max, currency) })}</div>

            {current && (
              <div className={`alert gw-result ${resultClass(current)}`} role="status">
                <div>
                  <strong>
                    {current.test.ref} · {t(`gatewayTest.status.${current.test.status}`)}
                  </strong>{' '}
                  <ModeTag mode={current.test.mode} />
                </div>
                <div>{current.message}</div>

                {testIsOpen(current.test.status) && current.test.payUrl && (
                  <div className="gw-buttons">
                    <Button
                      component="a"
                      href={current.test.payUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      leftSection={<IconExternalLink size={16} />}
                    >
                      {t('gatewayTest.payment.openPage')}
                    </Button>
                    <Button variant="default" onClick={() => void act(current.test.ref, 'check')} loading={rowBusy === `check:${current.test.ref}`}>
                      {t('gatewayTest.payment.checkNow')}
                    </Button>
                  </div>
                )}
                {testIsOpen(current.test.status) && <div className="pay-sub">{t('gatewayTest.payment.following')}</div>}

                <dl className="pay-facts pay-facts--inline">
                  <FactRow label={t('common.amount')} value={money(current.test.amount, current.test.currency)} />
                  {current.test.payerPhone && <FactRow label={t('payments.panel.paidFrom')} value={current.test.payerPhone} />}
                  {current.test.gateway === 'whish' && (
                    <FactRow
                      label={t('gatewayTest.payment.callback')}
                      value={current.test.callbackAt ? t('gatewayTest.payment.callbackYes', { when: stamp(current.test.callbackAt) }) : t('gatewayTest.payment.callbackNo')}
                    />
                  )}
                  {(current.facts ?? []).map((fact) => (
                    <FactRow key={fact.label} label={fact.label} value={fact.value} />
                  ))}
                </dl>
              </div>
            )}
          </section>

          {/* ── 4. look a payment up ── */}
          <section className="card">
            <h2 className="gw-step-title">
              <span className="gw-step-number">4</span>
              {t('gatewayTest.lookup.title')}
            </h2>
            <div className="hint">{t('gatewayTest.lookup.about', { name })}</div>
            <div className="gw-row">
              <TextInput
                label={t('gatewayTest.lookup.reference')}
                value={reference}
                onChange={(event) => setReference(event.currentTarget.value)}
                placeholder="MC-XXXXXXXX"
                w={220}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && reference.trim() && ready) void runLookup()
                }}
              />
              <Button variant="default" onClick={() => void runLookup()} loading={busy === 'lookup'} disabled={!ready || busy != null || !reference.trim()}>
                {t('gatewayTest.lookup.ask')}
              </Button>
            </div>
            {lookupError && (
              <div className="alert alert--error gw-result" role="alert">
                {lookupError}
              </div>
            )}
            {lookup && (
              <div className={`alert gw-result ${lookup.ok ? 'alert--success' : 'alert--warning'}`} role="status">
                <div>{lookup.message}</div>
                <dl className="pay-facts pay-facts--inline">
                  {lookup.facts.map((fact) => (
                    <FactRow key={fact.label} label={fact.label} value={fact.value} />
                  ))}
                </dl>
              </div>
            )}
          </section>

          {/* ── the tests so far ── */}
          <section className="card pay-list">
            <h2 className="gw-step-title" style={{ padding: '14px 14px 0' }}>
              {t('gatewayTest.recent.title')}
            </h2>
            {recent.length === 0 ? (
              <div className="hint" style={{ padding: 14 }}>
                {t('gatewayTest.recent.empty')}
              </div>
            ) : (
              <table className="pay-table">
                <thead>
                  <tr>
                    <th>{t('payments.col.when')}</th>
                    <th>{t('gatewayTest.recent.test')}</th>
                    <th className="num">{t('payments.col.amount')}</th>
                    <th>{t('payments.col.state')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recent.map((test) => (
                    <tr key={test.ref}>
                      <td data-label={t('payments.col.when')}>
                        {stamp(test.createdAt)}
                        {test.createdBy && <div className="pay-sub">{test.createdBy}</div>}
                      </td>
                      <td data-label={t('gatewayTest.recent.test')}>
                        <div className="pay-ref">{test.ref}</div>
                        <div className="pay-method">
                          <span className="pay-gateway">{t(`gateways.name.${test.gateway}`)}</span>
                          <ModeTag mode={test.mode} />
                        </div>
                      </td>
                      <td className="num" data-label={t('payments.col.amount')}>
                        {money(test.amount, test.currency)}
                      </td>
                      <td data-label={t('payments.col.state')}>
                        <span className={`pay-tag pay-tag--${testTone(test.status)}`}>{t(`gatewayTest.status.${test.status}`)}</span>
                        {test.detail && <div className="pay-sub">{test.detail}</div>}
                      </td>
                      <td>
                        <div className="gw-buttons" style={{ marginTop: 0 }}>
                          <Button size="xs" variant="default" onClick={() => void act(test.ref, 'check')} loading={rowBusy === `check:${test.ref}`} disabled={rowBusy != null}>
                            {t('gatewayTest.recent.check')}
                          </Button>
                          {test.gateway === 'whish' && test.status === 'Paid' && (
                            <Button size="xs" variant="light" color="red" onClick={() => void act(test.ref, 'refund')} loading={rowBusy === `refund:${test.ref}`} disabled={rowBusy != null}>
                              {t('gatewayTest.recent.refund')}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {/* A live test is a real payment: said in so many words before it is opened. */}
      <Modal opened={confirmLive} onClose={() => setConfirmLive(false)} title={t('gatewayTest.live.title')} centered>
        <p>{t('gatewayTest.live.body', { amount: money(Number(amount), currency), name })}</p>
        <p className="hint">{t(`gatewayTest.live.refund.${gateway}`)}</p>
        <div className="pay-refund-actions">
          <Button variant="default" onClick={() => setConfirmLive(false)}>
            {t('common.cancel')}
          </Button>
          <Button color="red" onClick={() => void openTest()}>
            {t('gatewayTest.live.confirm', { amount: money(Number(amount), currency) })}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
