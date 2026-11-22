import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { ActionIcon, Button, Loader, SegmentedControl, Select, TextInput, Textarea } from '@mantine/core'
import { IconRefresh, IconSearch } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { getErrorMessage } from '../../api/errorMessage'
import { DateRangeField } from '../../components/DateRangeField'
import { useDateRangeParams } from '../../components/useDateRangeParams'
import { Drawer, Modal } from '../../components/dialogs'
import { PageHelp } from '../../components/PageHelp'
import { useLanguage } from '../../i18n/useLanguage'
import { paymentsService } from '../../services/paymentsService'
import type { PaymentActionResult, PaymentDetail, PaymentList, PayState } from '../../types/payments'
import { PAY_STATES } from '../../types/payments'
import { addDays, bookingDrawerLink, dayLabel, fromMinutes, money, stamp, today } from './bookingShared'
import { EventLine, FactRow, MethodTag, StateTag } from './PaymentBits'
import { gatewayParam, isTestPayment, needsAttention, PAY_PERMISSIONS } from './paymentLogic'
import './bookings.css'
import './payments.css'

type StateFilter = PayState | 'all' | 'attention'

/**
 * PAYMENTS — every booking deposit a guest tried to pay online, by card (Bank of Beirut) or by Whish: what was
 * received, what is still waiting, what needs somebody, and the full story of each one.
 *
 * THE LIST IS BOOKINGS, NOT GATEWAY CALLS. One row per booking a payment was opened for; the steps behind it (opened,
 * the gateway asked, paid, released, refunded) are the log inside the row's panel. A row's date is the day it was
 * paid - or the day it was opened, when it never was.
 *
 * TEST PAYMENTS ARE MARKED AND NEVER COUNTED AS MONEY. A payment made while a gateway worked in test mode carries a
 * TEST tag, and the totals above the list leave it out.
 *
 * WHAT STAFF CAN DO (permission BOOKING_PAYMENTS_MANAGE): ask the gateway again, and refund a Whish payment. Both
 * are decided by the server; the buttons only ask.
 */
export default function PaymentsPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canView = hasPermission(PAY_PERMISSIONS.view)
  const canManage = hasPermission(PAY_PERMISSIONS.manage)

  const defaultRange = useMemo(() => ({ from: addDays(today(), -30), to: today() }), [])
  const { from, to, setRange } = useDateRangeParams(defaultRange)
  const [params, setParams] = useSearchParams()

  const [gateway, setGateway] = useState('all')
  const [state, setState] = useState<StateFilter>('all')
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')

  /* What the server last answered, and for which question: "loading" is simply "the answer on screen is not the
     answer to what is being asked now", so no flag has to be switched on and off around the request. */
  const [answer, setAnswer] = useState<{ key: string; list: PaymentList | null; error: string | null } | null>(null)
  const [reloads, setReloads] = useState(0)
  const load = useCallback(() => setReloads((count) => count + 1), [])

  /* The search box asks the server a moment after the typing stops, not on every letter. */
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchText.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [searchText])

  const question = `${from}|${to}|${gateway}|${search}|${reloads}`
  useEffect(() => {
    if (!canView || !from || !to) return
    // Only the newest answer is shown: a slow earlier one must not overwrite it.
    let stale = false
    paymentsService
      .list({ from, to, gateway: gatewayParam(gateway), q: search })
      .then((list) => {
        if (!stale) setAnswer({ key: question, list, error: null })
      })
      .catch((err) => {
        if (!stale) setAnswer((earlier) => ({ key: question, list: earlier?.list ?? null, error: getErrorMessage(err) }))
      })
    return () => {
      stale = true
    }
  }, [canView, from, to, gateway, search, question])

  const list = answer?.list ?? null
  const loading = answer?.key !== question
  const error = answer?.key === question ? answer.error : null

  const rows = useMemo(() => {
    const all = list?.payments ?? []
    if (state === 'all') return all
    if (state === 'attention') return all.filter(needsAttention)
    return all.filter((row) => row.state === state)
  }, [list, state])

  /* ?open=<bookingId> names the payment whose panel is open, so a link to one payment can be shared. */
  const openId = Number(params.get('open')) || null
  const openPayment = useCallback(
    (bookingId: number | null) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (bookingId == null) next.delete('open')
          else next.set('open', String(bookingId))
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  if (!canView) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1 className="page-title">{t('payments.title')}</h1>
          </div>
        </div>
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">{t('payments.noAccess')}</div>
            {t('payments.noAccessHint')}
          </div>
        </div>
      </div>
    )
  }

  const totals = list?.totals
  const stateOptions = [
    { value: 'all', label: t('payments.filter.allStates') },
    { value: 'attention', label: t('payments.filter.attention') },
    ...PAY_STATES.map((value) => ({ value, label: t(`payments.state.${value}`) })),
  ]

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('payments.title')}</h1>
          <p className="page-subtitle">{t('payments.subtitle')}</p>
        </div>
        <div className="page-head-actions">
          <ActionIcon
            variant="default"
            size="lg"
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            onClick={load}
          >
            <IconRefresh size={18} />
          </ActionIcon>
        </div>
      </div>

      <PageHelp>{t('payments.help')}</PageHelp>

      {/* ── what the period came to ── */}
      {totals && (
        <div className="pay-tiles">
          {totals.money.length === 0 ? (
            <div className="pay-tile">
              <div className="pay-tile-label">{t('payments.tiles.received')}</div>
              <div className="pay-tile-value">{t('common.dash')}</div>
              <div className="pay-tile-note">{t('payments.tiles.nothingReceived')}</div>
            </div>
          ) : (
            totals.money.map((sum) => (
              <div className="pay-tile pay-tile--good" key={sum.currency}>
                <div className="pay-tile-label">{t('payments.tiles.received')}</div>
                <div className="pay-tile-value">{money(sum.received, sum.currency)}</div>
                <div className="pay-tile-note">
                  {t('payments.tiles.split', {
                    card: sum.card.toFixed(2),
                    whish: sum.whish.toFixed(2),
                  })}
                  {sum.refunded > 0 && <> · {t('payments.tiles.refunded', { amount: sum.refunded.toFixed(2) })}</>}
                </div>
              </div>
            ))
          )}

          <button
            type="button"
            className={`pay-tile pay-tile--button${state === 'Open' ? ' pay-tile--active' : ''}`}
            onClick={() => setState(state === 'Open' ? 'all' : 'Open')}
          >
            <div className="pay-tile-label">{t('payments.tiles.waiting')}</div>
            <div className="pay-tile-value">{totals.waiting}</div>
            <div className="pay-tile-note">{t('payments.tiles.waitingNote')}</div>
          </button>

          <button
            type="button"
            className={`pay-tile pay-tile--button${totals.needAttention > 0 ? ' pay-tile--warn' : ''}${
              state === 'attention' ? ' pay-tile--active' : ''
            }`}
            onClick={() => setState(state === 'attention' ? 'all' : 'attention')}
          >
            <div className="pay-tile-label">{t('payments.tiles.attention')}</div>
            <div className="pay-tile-value">{totals.needAttention}</div>
            <div className="pay-tile-note">{t('payments.tiles.attentionNote')}</div>
          </button>

          {totals.testPayments > 0 && (
            <div className="pay-tile">
              <div className="pay-tile-label">{t('payments.tiles.tests')}</div>
              <div className="pay-tile-value">{totals.testPayments}</div>
              <div className="pay-tile-note">{t('payments.tiles.testsNote')}</div>
            </div>
          )}
        </div>
      )}

      {/* ── filters ── */}
      <div className="bk-toolbar">
        <div className="form-field">
          <span className="form-label">{t('common.period')}</span>
          <DateRangeField
            from={from}
            to={to}
            defaultFrom={defaultRange.from}
            defaultTo={defaultRange.to}
            onChange={setRange}
            w={240}
          />
        </div>

        <div className="form-field">
          <span className="form-label">{t('payments.filter.method')}</span>
          <SegmentedControl
            value={gateway}
            onChange={setGateway}
            data={[
              { value: 'all', label: t('common.all') },
              { value: 'card', label: t('payments.gateway.cardShort') },
              { value: 'whish', label: t('payments.gateway.whish') },
            ]}
          />
        </div>

        <div className="form-field">
          <span className="form-label">{t('payments.filter.state')}</span>
          <Select
            value={state}
            onChange={(value) => setState((value as StateFilter) ?? 'all')}
            data={stateOptions}
            allowDeselect={false}
            w={190}
          />
        </div>

        <div className="form-field pay-search">
          <span className="form-label">{t('common.search')}</span>
          <TextInput
            value={searchText}
            onChange={(event) => setSearchText(event.currentTarget.value)}
            placeholder={t('payments.filter.searchPlaceholder')}
            leftSection={<IconSearch size={16} />}
          />
        </div>
      </div>

      {search && <div className="hint pay-search-note">{t('payments.filter.searchAllDates')}</div>}

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {/* ── the list ── */}
      {loading && !list ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">{t('payments.empty')}</div>
            {t('payments.emptyHint')}
          </div>
        </div>
      ) : (
        <div className="card pay-list">
          <table className="pay-table">
            <thead>
              <tr>
                <th>{t('payments.col.when')}</th>
                <th>{t('payments.col.booking')}</th>
                <th>{t('payments.col.method')}</th>
                <th className="num">{t('payments.col.amount')}</th>
                <th>{t('payments.col.state')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.bookingId}
                  className={row.bookingId === openId ? 'pay-row pay-row--open' : 'pay-row'}
                  onClick={() => openPayment(row.bookingId)}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      openPayment(row.bookingId)
                    }
                  }}
                >
                  <td data-label={t('payments.col.when')}>{stamp(row.activityAt)}</td>
                  <td data-label={t('payments.col.booking')}>
                    <div className="pay-ref">{row.ref}</div>
                    <div className="pay-sub">
                      {row.guestName} · {row.roomName} · {dayLabel(row.date)}
                    </div>
                  </td>
                  <td data-label={t('payments.col.method')}>
                    <MethodTag row={row} />
                  </td>
                  <td className="num" data-label={t('payments.col.amount')}>
                    {money(row.paidAmount ?? row.deposit, row.currency)}
                    {row.paidAmount == null && <div className="pay-sub">{t('payments.notReceived')}</div>}
                  </td>
                  <td data-label={t('payments.col.state')}>
                    <StateTag state={row.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint pay-count">{t('payments.count', { count: rows.length })}</div>
        </div>
      )}

      <PaymentPanel
        bookingId={openId}
        canManage={canManage}
        onClose={() => openPayment(null)}
        onChanged={load}
      />
    </div>
  )
}

/**
 * ONE PAYMENT: what it is, what can be done about it, and everything that happened to it.
 *
 * The two buttons ask the server and show its sentence as it comes: the rules (a payment already on the books is not
 * recorded twice; a refund only on a cancelled booking, only once) are the server's, and its answer says which one
 * applied.
 */
function PaymentPanel(props: {
  bookingId: number | null
  canManage: boolean
  onClose: () => void
  onChanged: () => void
}) {
  // Keyed by the payment: opening another one starts from a clean panel, with nothing of the last one left in it.
  return <PaymentPanelBody key={props.bookingId ?? 'closed'} {...props} />
}

function PaymentPanelBody({
  bookingId,
  canManage,
  onClose,
  onChanged,
}: {
  bookingId: number | null
  canManage: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const { isRtl } = useLanguage()

  const [detail, setDetail] = useState<PaymentDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'check' | 'refund' | null>(null)
  const [result, setResult] = useState<PaymentActionResult | null>(null)
  const [refundOpen, setRefundOpen] = useState(false)
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (bookingId == null) return

    let stale = false
    paymentsService
      .get(bookingId)
      .then((answer) => {
        if (!stale) setDetail(answer)
      })
      .catch((err) => {
        if (!stale) setError(getErrorMessage(err))
      })
    return () => {
      stale = true
    }
  }, [bookingId])

  async function run(action: 'check' | 'refund') {
    if (bookingId == null) return
    setBusy(action)
    setError(null)
    try {
      const answer =
        action === 'check' ? await paymentsService.check(bookingId) : await paymentsService.refund(bookingId, reason.trim())
      setResult(answer)
      if (answer.payment) setDetail(answer.payment)
      if (answer.changed) onChanged()
      if (action === 'refund') setRefundOpen(false)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const payment = detail?.payment

  return (
    <>
      <Drawer
        opened={bookingId != null}
        onClose={onClose}
        // The trailing edge, as every other panel in this app (see BookingDrawer).
        position={isRtl ? 'left' : 'right'}
        size={480}
        title={payment ? t('payments.panel.title', { ref: payment.ref }) : t('payments.panel.loading')}
      >
        {error && (
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        )}

        {!detail && !error && (
          <div className="page-loading">
            <Loader size={32} />
          </div>
        )}

        {detail && payment && (
          <div className="pay-panel">
            {/* ── what it is ── */}
            <div className="pay-panel-head">
              <StateTag state={payment.state} />
              <MethodTag row={payment} />
            </div>
            <div className="pay-panel-amount">{money(payment.paidAmount ?? payment.deposit, payment.currency)}</div>
            <div className="pay-sub">
              {payment.paidAmount != null
                ? t('payments.panel.paidOn', { when: stamp(payment.paidAt) })
                : t('payments.panel.depositNotReceived')}
            </div>
            <div className="pay-explain">{t(`payments.stateHelp.${payment.state}`)}</div>

            {isTestPayment(payment) && <div className="alert alert--warning">{t('payments.panel.testNote')}</div>}

            <dl className="pay-facts">
              <dt>{t('payments.panel.guest')}</dt>
              <dd>
                {payment.guestName}
                {payment.guestPhone && <> · {payment.guestPhone}</>}
              </dd>
              <dt>{t('payments.panel.booking')}</dt>
              <dd>
                {payment.roomName} · {dayLabel(payment.date)} · {fromMinutes(payment.startMin % 1440)}–
                {fromMinutes(payment.endMin % 1440)} · {t(`booking.status.${payment.bookingStatus}`, payment.bookingStatus)}
              </dd>
              <dt>{t('payments.panel.total')}</dt>
              <dd>
                {money(payment.total, payment.currency)} · {t('payments.panel.deposit')} {money(payment.deposit, payment.currency)}
              </dd>
              {payment.payerPhone && (
                <>
                  <dt>{t('payments.panel.paidFrom')}</dt>
                  <dd>{payment.payerPhone}</dd>
                </>
              )}
              <dt>{t('payments.panel.gatewayId')}</dt>
              <dd className="pay-mono">{payment.gatewayOrderId ?? t('common.dash')}</dd>
              {payment.gateway === 'card' && payment.transactionId && (
                <>
                  <dt>{t('payments.panel.transaction')}</dt>
                  <dd className="pay-mono">{payment.transactionId}</dd>
                </>
              )}
              {payment.gateway === 'whish' && payment.attempts > 1 && (
                <>
                  <dt>{t('payments.panel.attempts')}</dt>
                  <dd>{payment.attempts}</dd>
                </>
              )}
              {(payment.refundDue > 0 || payment.refundedAmount > 0) && (
                <>
                  <dt>{t('payments.panel.refund')}</dt>
                  <dd>
                    {t('payments.panel.refundLine', {
                      due: payment.refundDue.toFixed(2),
                      done: payment.refundedAmount.toFixed(2),
                      currency: payment.currency,
                    })}
                  </dd>
                </>
              )}
            </dl>

            {/* ── what can be done ── */}
            <div className="pay-actions">
              {canManage && (
                <Button onClick={() => void run('check')} loading={busy === 'check'} disabled={busy != null}>
                  {t('payments.actions.check')}
                </Button>
              )}
              {canManage && payment.gateway === 'whish' && detail.refundRefusal == null && (
                <Button color="red" variant="light" onClick={() => setRefundOpen(true)} disabled={busy != null}>
                  {t('payments.actions.refund')}
                </Button>
              )}
              <Button component={Link} to={bookingDrawerLink(payment)} variant="default">
                {t('payments.actions.openBooking')}
              </Button>
            </div>
            {canManage && <div className="hint">{t('payments.actions.checkHint')}</div>}
            {/* Why there is no refund button, in the server's own sentence. A card is refunded at the bank: that
                sentence already says everything, so it stands alone. */}
            {canManage && detail.refundRefusal && payment.paidAmount != null && (
              <div className="hint">
                {payment.gateway === 'whish' && <>{t('payments.actions.refundWhy')} </>}
                {detail.refundRefusal}
              </div>
            )}

            {result && (
              <div className={`alert ${result.ok ? 'alert--success' : 'alert--warning'}`} role="status">
                <div>{result.message}</div>
                {result.facts && result.facts.length > 0 && (
                  <dl className="pay-facts pay-facts--inline">
                    {result.facts.map((fact) => (
                      <FactRow key={fact.label} label={fact.label} value={fact.value} />
                    ))}
                  </dl>
                )}
              </div>
            )}

            {/* ── everything that happened ── */}
            <h3 className="pay-section">{t('payments.panel.log')}</h3>
            {detail.events.length === 0 ? (
              <div className="hint">{t('payments.panel.noLog')}</div>
            ) : (
              <ol className="pay-steps">
                {detail.events.map((event) => (
                  <EventLine key={event.id} event={event} />
                ))}
              </ol>
            )}

            <h3 className="pay-section">{t('payments.panel.money')}</h3>
            {detail.lines.length === 0 ? (
              <div className="hint">{t('payments.panel.noMoney')}</div>
            ) : (
              <table className="pay-lines">
                <tbody>
                  {detail.lines.map((line) => (
                    <tr key={line.paymentId}>
                      <td>
                        <div>{line.isRefund ? t('payments.panel.refundLineName', { method: line.method }) : line.method}</div>
                        <div className="pay-sub">
                          {stamp(line.paidAt)}
                          {line.receivedBy && <> · {line.receivedBy}</>}
                        </div>
                        {line.reference && <div className="pay-sub">{line.reference}</div>}
                      </td>
                      <td className={line.isRefund ? 'num pay-neg' : 'num'}>{money(line.amount, payment.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Drawer>

      {/* A refund moves real money back: it is asked for twice, with the amount in front of the eye. */}
      <Modal
        opened={refundOpen && payment != null}
        onClose={() => setRefundOpen(false)}
        title={t('payments.refund.title')}
        centered
      >
        {payment && (
          <div className="pay-refund">
            <p>
              {t('payments.refund.body', {
                amount: money(payment.paidAmount, payment.currency),
                phone: payment.payerPhone ?? t('payments.refund.thePayer'),
              })}
            </p>
            <p className="hint">{t('payments.refund.note')}</p>
            <Textarea
              label={t('payments.refund.reason')}
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
              placeholder={t('payments.refund.reasonPlaceholder')}
              maxLength={120}
              autosize
              minRows={2}
            />
            <div className="pay-refund-actions">
              <Button variant="default" onClick={() => setRefundOpen(false)} disabled={busy != null}>
                {t('common.cancel')}
              </Button>
              <Button color="red" onClick={() => void run('refund')} loading={busy === 'refund'}>
                {t('payments.refund.confirm', { amount: money(payment.paidAmount, payment.currency) })}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
