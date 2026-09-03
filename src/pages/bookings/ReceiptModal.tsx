import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Loader, Modal } from '@mantine/core'
import { IconPrinter } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { bookingsService } from '../../services/bookingService'
import type { BookingReceipt } from '../../types/booking'
import { dayLabel, hhmm, hoursLabel, money, stamp, statusLabel } from './bookingShared'
import './bookings.css'

/**
 * The printed receipt: MokaCo header, the booking, the add-ons as charged, every payment, and one
 * large footer line that is either PAID or BALANCE DUE.
 *
 * ONE FETCH, THREE LISTS. GET /{id}/receipt returns the header, the add-on lines and the payments
 * together, because a receipt assembled from three separate calls can print a total that does not
 * match the lines under it.
 *
 * THE PRINT BOUNDARY IS `.bk-print-root`, and only what is inside it survives window.print() — the
 * stylesheet hides the rest of the document rather than this component remembering to hide the app.
 * The Print button itself sits inside the modal and carries `.bk-no-print`, so it does not appear on
 * the paper it produces.
 *
 * THE AMOUNTS ARE HISTORICAL, THE TERMS ARE CURRENT. Add-on names and amounts were copied onto the
 * booking when it was taken, so a reprint after a rename still shows what the guest paid for; the
 * policy text is read from the room as it stands today. That asymmetry is the server's and is worth
 * knowing before somebody "fixes" it.
 */
export function ReceiptModal({
  bookingId,
  opened,
  onClose,
}: {
  bookingId: number | null
  opened: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()

  const [receipt, setReceipt] = useState<BookingReceipt | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!opened || bookingId == null) return

    let cancelled = false
    setLoading(true)
    setError(null)

    bookingsService
      .getReceipt(bookingId)
      .then((result) => {
        if (!cancelled) setReceipt(result)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(getErrorMessage(err))
          setReceipt(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [opened, bookingId])

  const header = receipt?.header ?? null
  const currency = header?.currencyCode ?? ''
  const isPaid = (header?.balanceDue ?? 0) <= 0

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('booking.receipt.title')}
      size={640}
      centered
    >
      {error && (
        <div className="alert alert--error bk-no-print" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="page-loading">
          <Loader size={32} />
        </div>
      ) : header ? (
        <>
          <div className="bk-print-root">
            <div className="bk-receipt">
              <div className="bk-receipt-head">
                <h2 className="bk-receipt-brand">MokaCo</h2>
                <div className="bk-receipt-sub">
                  {t('booking.receipt.heading', { id: header.bookingId })}
                  {' · '}
                  {statusLabel(header.status)}
                </div>
              </div>

              <div className="bk-receipt-section">
                <h3>{t('booking.receipt.details')}</h3>
                <div className="bk-detail-grid">
                  <span className="bk-detail-label">{t('booking.fields.guest')}</span>
                  <span className="bk-detail-value">{header.guestName}</span>

                  <span className="bk-detail-label">{t('booking.fields.phone')}</span>
                  <span className="bk-detail-value">{header.guestPhone}</span>

                  {header.guestEmail && (
                    <>
                      <span className="bk-detail-label">{t('booking.fields.email')}</span>
                      <span className="bk-detail-value">{header.guestEmail}</span>
                    </>
                  )}

                  <span className="bk-detail-label">{t('booking.fields.room')}</span>
                  <span className="bk-detail-value">{header.roomName}</span>

                  <span className="bk-detail-label">{t('booking.fields.date')}</span>
                  <span className="bk-detail-value">{dayLabel(header.bookDate)}</span>

                  <span className="bk-detail-label">{t('booking.fields.time')}</span>
                  <span className="bk-detail-value">
                    {hhmm(header.startTime)} – {hhmm(header.endTime)} (
                    {t('booking.fields.hoursValue', { value: hoursLabel(header.hours) })})
                  </span>

                  <span className="bk-detail-label">{t('booking.fields.persons')}</span>
                  <span className="bk-detail-value">{header.persons}</span>

                  {header.note && (
                    <>
                      <span className="bk-detail-label">{t('booking.fields.note')}</span>
                      <span className="bk-detail-value">{header.note}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="bk-receipt-section">
                <h3>{t('booking.receipt.charges')}</h3>
                <table className="bk-receipt-table">
                  <tbody>
                    <tr>
                      <td>
                        {t('booking.receipt.roomCharge', {
                          hours: hoursLabel(header.hours),
                          rate: money(header.pricePerHour, currency),
                        })}
                      </td>
                      <td className="num">
                        {/* The room's share is the total less the add-on lines: the server stores
                            the TOTAL, not a breakdown, and re-deriving it from the current rate
                            would disagree with the total whenever the room has been re-priced. */}
                        {money(
                          header.totalAmount -
                            (receipt?.addons ?? []).reduce((sum, a) => sum + a.amount, 0),
                          currency,
                        )}
                      </td>
                    </tr>
                    {(receipt?.addons ?? []).map((addon, index) => (
                      <tr key={`${addon.name}-${index}`}>
                        <td>{addon.name}</td>
                        <td className="num">{money(addon.amount, currency)}</td>
                      </tr>
                    ))}
                    <tr>
                      <th>{t('booking.fields.total')}</th>
                      <th className="num">{money(header.totalAmount, currency)}</th>
                    </tr>
                    <tr>
                      <td>{t('booking.fields.deposit')}</td>
                      <td className="num">{money(header.depositDue, currency)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="bk-receipt-section">
                <h3>{t('booking.receipt.payments')}</h3>
                {(receipt?.payments ?? []).length === 0 ? (
                  <div className="hint">{t('booking.receipt.noPayments')}</div>
                ) : (
                  <table className="bk-receipt-table">
                    <thead>
                      <tr>
                        <th>{t('booking.fields.when')}</th>
                        <th>{t('booking.fields.method')}</th>
                        <th>{t('booking.fields.reference')}</th>
                        <th className="num">{t('booking.fields.amount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(receipt?.payments ?? []).map((payment) => (
                        <tr key={payment.paymentId}>
                          <td>{stamp(payment.paidUtc)}</td>
                          <td>{payment.methodName}</td>
                          <td>{payment.reference || t('common.dash')}</td>
                          <td className="num">{money(payment.amount, currency)}</td>
                        </tr>
                      ))}
                      <tr>
                        <th colSpan={3}>{t('booking.fields.paid')}</th>
                        <th className="num">{money(header.paidAmount, currency)}</th>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>

              <div
                className={
                  isPaid
                    ? 'bk-receipt-footer'
                    : 'bk-receipt-footer bk-receipt-footer--due'
                }
              >
                <span>
                  {isPaid
                    ? t('booking.receipt.paidInFull')
                    : t('booking.receipt.balanceDue')}
                </span>
                <span>
                  {money(isPaid ? header.paidAmount : header.balanceDue, currency)}
                </span>
              </div>

              {header.policyText && (
                <div className="bk-receipt-policy">{header.policyText}</div>
              )}
            </div>
          </div>

          <div className="form-actions bk-no-print">
            <Button variant="default" onClick={onClose}>
              {t('common.close')}
            </Button>
            <Button
              leftSection={<IconPrinter size={16} />}
              onClick={() => window.print()}
            >
              {t('booking.receipt.print')}
            </Button>
          </div>
        </>
      ) : (
        !error && <div className="hint">{t('booking.receipt.notFound')}</div>
      )}
    </Modal>
  )
}
