import { useTranslation } from 'react-i18next'
import type { PaymentEvent, PaymentRow, PayState } from '../../types/payments'
import { stamp } from './bookingShared'
import { answerKey, eventKey, eventTone, isTestPayment, stateTone } from './paymentLogic'

/** The small pieces the Payments page and the Gateway test page are both drawn from. */

export function StateTag({ state }: { state: PayState }) {
  const { t } = useTranslation()
  return <span className={`pay-tag pay-tag--${stateTone(state)}`}>{t(`payments.state.${state}`)}</span>
}

export function MethodTag({ row }: { row: Pick<PaymentRow, 'gateway' | 'mode'> }) {
  const { t } = useTranslation()
  return (
    <span className="pay-method">
      <span className={`pay-gateway pay-gateway--${row.gateway}`}>
        {t(row.gateway === 'card' ? 'payments.gateway.cardShort' : 'payments.gateway.whish')}
      </span>
      {isTestPayment(row) && (
        <span className="pay-test" title={t('payments.testHint')}>
          {t('payments.test')}
        </span>
      )}
    </span>
  )
}

/** One line of the log, as a sentence. */
export function EventLine({ event }: { event: PaymentEvent }) {
  const { t } = useTranslation()
  const answer = answerKey(event)
  const by = event.by ?? t('payments.someone')

  return (
    <li className={`pay-step pay-step--${eventTone(event)}`}>
      <div className="pay-step-main">
        {t(eventKey(event), { by })}
        {answer && <> — {t(answer)}</>}
      </div>
      {event.gatewayStatus && (
        <div className="pay-step-note">{t('payments.event.gatewaySaid', { words: event.gatewayStatus })}</div>
      )}
      {event.detail && <div className="pay-step-note">{event.detail}</div>}
      <div className="pay-step-time">
        {stamp(event.at)}
        {event.by && event.source === 'Staff' && event.type !== 'Checked' && <> · {event.by}</>}
        {event.repeats > 1 && (
          <> · {t('payments.event.repeats', { count: event.repeats, last: stamp(event.lastAt) })}</>
        )}
        {event.mode === 'test' && <> · {t('payments.test')}</>}
      </div>
    </li>
  )
}

export function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}
