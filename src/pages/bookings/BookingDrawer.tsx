import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Button,
  Loader,
  NumberInput,
  Select,
  Textarea,
  TextInput,
} from '@mantine/core'
import { Drawer } from '../../components/dialogs'
import { notifications } from '@mantine/notifications'
import {
  IconCash,
  IconCheck,
  IconPrinter,
  IconTrash,
  IconUserOff,
  IconX,
} from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { useLanguage } from '../../i18n/useLanguage'
import { bookingsService, roomsService } from '../../services/bookingService'
import type {
  BookingBlock,
  BookingReceipt,
  BookingRow,
  BookingStatus,
  PaymentMethod,
} from '../../types/booking'
import {
  dayLabel,
  hhmm,
  hoursLabel,
  isClosed,
  money,
  stamp,
  STATUS_COLOR,
  statusLabel,
} from './bookingShared'
import { ReceiptModal } from './ReceiptModal'
import { parseDecimal } from '../../components/numeric'
import type { NumberInputValue } from '../../components/numeric'

/**
 * Everything about one booking, and everything that can be done to it — opened by clicking a block
 * in the calendar or a row in the list, so the two screens can never drift about what a booking is.
 *
 * IT SHOWS TWO KINDS OF THING. A booking has a guest, money and a status; a staff BLOCK has none of
 * those and can only be removed. They share a drawer because they share a place on the calendar, and
 * the drawer branches once at the top rather than the pages having to decide which panel to open.
 *
 * THE ROW IT WAS GIVEN IS NOT ENOUGH. The range endpoint returns the booking and its money position
 * but not its add-on lines or its individual payments, so the drawer FETCHES THE RECEIPT for the
 * selected booking — the one call that returns all three. That also means the payments list and the
 * balance always came from the same read, which is what stops "Add payment" prefilling an amount
 * that the list beneath it contradicts.
 *
 * EVERY ACTION IS THE SERVER'S TO REFUSE. Confirm, complete, cancel and no-show all go through one
 * procedure that owns the transitions — it will not move a booking that is already closed, and it
 * will not accept a cancellation with no reason. This component asks for the reason because the
 * refusal would otherwise be the way you found out, not because it is the authority on the rule.
 */
export function BookingDrawer({
  booking,
  block,
  opened,
  onClose,
  onChanged,
  canManage,
}: {
  booking: BookingRow | null
  block: BookingBlock | null
  opened: boolean
  onClose: () => void
  /** Fired after any successful mutation so the calling page refetches its range. */
  onChanged: () => void
  canManage: boolean
}) {
  const { t } = useTranslation()
  const { isRtl } = useLanguage()

  const [receipt, setReceipt] = useState<BookingReceipt | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /* The two inline forms. Both start closed: a drawer that opens with a cancellation box already
     showing invites the one action nobody should take by accident. */
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [paying, setPaying] = useState(false)
  const [methodId, setMethodId] = useState<number | null>(null)
  /** As the box hands it over ("45." on the way to 45.5) — coerced below. See numeric.ts. */
  const [amount, setAmount] = useState<NumberInputValue>(0)
  const amountValue = parseDecimal(amount) ?? 0
  const [reference, setReference] = useState('')

  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const methodsLoaded = useRef(false)

  const [receiptOpen, setReceiptOpen] = useState(false)

  /** The payment methods, fetched ONCE per mount and only for somebody who can actually take money. */
  useEffect(() => {
    if (!opened || !canManage || methodsLoaded.current) return
    methodsLoaded.current = true

    roomsService
      .getPaymentMethods()
      .then(setMethods)
      .catch(() => {
        /* The drawer still works without them — only the payment form needs the list, and it says
           so itself when it is empty. */
      })
  }, [opened, canManage])

  /** The add-ons and payments for the selected booking. Blocks have neither, so they skip this. */
  useEffect(() => {
    if (!opened || booking == null) {
      setReceipt(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    bookingsService
      .getReceipt(booking.bookingId)
      .then((result) => {
        if (!cancelled) setReceipt(result)
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [opened, booking])

  /* Re-seed the inline forms whenever the drawer moves to a different booking. The amount is
     prefilled with the BALANCE, because "settle the rest" is what almost every payment is. */
  useEffect(() => {
    setCancelling(false)
    setCancelReason('')
    setPaying(false)
    setReference('')
    setAmount(booking?.balanceDue ?? 0)
    setMethodId(null)
  }, [booking])

  async function setStatus(status: BookingStatus, reason?: string) {
    if (!booking) return

    setBusy(true)
    setError(null)
    try {
      await bookingsService.setStatus(booking.bookingId, { status, reason: reason ?? null })
      notifications.show({
        message: t('booking.drawer.statusChanged', { status: statusLabel(status) }),
        color: status === 'Cancelled' || status === 'NoShow' ? 'orange' : 'green',
      })
      setCancelling(false)
      onChanged()
      onClose()
    } catch (err) {
      // "This booking is already closed (Cancelled)." — the procedure's own words.
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function addPayment() {
    if (!booking || methodId == null || amountValue <= 0) return

    setBusy(true)
    setError(null)
    try {
      const added = await bookingsService.addPayment(booking.bookingId, {
        paymentMethodId: methodId,
        amount: amountValue,
        reference: reference.trim() || null,
      })
      notifications.show({
        message: t('booking.drawer.paymentAdded', {
          amount: money(added.paidTotal, booking.currencyCode),
          balance: money(added.balanceDue, booking.currencyCode),
        }),
        color: 'green',
      })
      setPaying(false)
      setReference('')
      onChanged()
      // Refetch in place rather than closing: taking a deposit and then a balance in one sitting is
      // ordinary, and a drawer that shut after each would make it three clicks longer every time.
      const refreshed = await bookingsService.getReceipt(booking.bookingId)
      setReceipt(refreshed)
      setAmount(refreshed.header?.balanceDue ?? 0)
    } catch (err) {
      // "Amount exceeds the balance — 45.00 remains."
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function removeBlock() {
    if (!block) return

    setBusy(true)
    setError(null)
    try {
      await bookingsService.deleteBlock(block.blockId)
      notifications.show({ message: t('booking.drawer.blockRemoved'), color: 'green' })
      onChanged()
      onClose()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const header = receipt?.header ?? null
  /* The receipt is the fresher read — it is refetched after every payment — so the money comes from
     it when it has arrived, and from the row that opened the drawer until then. */
  const paid = header?.paidAmount ?? booking?.paidAmount ?? 0
  const balance = header?.balanceDue ?? booking?.balanceDue ?? 0

  return (
    <>
      <Drawer
        opened={opened}
        onClose={onClose}
        // Mantine's Drawer position vocabulary is PHYSICAL and has no logical equivalent, so this is
        // one of the few places that has to know which way round the page is — the trailing edge, so
        // the panel never lands on top of where the eye starts. See src/i18n/physical.ts.
        position={isRtl ? 'left' : 'right'}
        size={440}
        title={
          block
            ? t('booking.drawer.blockTitle')
            : t('booking.drawer.title', { id: booking?.bookingId ?? 0 })
        }
      >
        {error && (
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        )}

        {/* ── a staff block ── */}
        {block && (
          <>
            <div className="bk-detail-grid">
              <span className="bk-detail-label">{t('booking.fields.room')}</span>
              <span className="bk-detail-value">{block.roomName}</span>

              <span className="bk-detail-label">{t('booking.fields.date')}</span>
              <span className="bk-detail-value">{dayLabel(block.blockDate)}</span>

              <span className="bk-detail-label">{t('booking.fields.time')}</span>
              <span className="bk-detail-value">
                {hhmm(block.startTime)} – {hhmm(block.endTime)}
              </span>

              <span className="bk-detail-label">{t('booking.block.reason')}</span>
              <span className="bk-detail-value">
                {block.reason || t('common.none')}
              </span>

              <span className="bk-detail-label">{t('booking.fields.createdBy')}</span>
              <span className="bk-detail-value">
                {block.createdByUsername || t('common.dash')}
              </span>
            </div>

            <div className="hint" style={{ marginTop: 10 }}>
              {t('booking.drawer.blockHint')}
            </div>

            {canManage && (
              <div className="form-actions">
                <Button
                  color="red"
                  variant="light"
                  leftSection={<IconTrash size={16} />}
                  onClick={removeBlock}
                  loading={busy}
                >
                  {t('booking.drawer.removeBlock')}
                </Button>
              </div>
            )}
          </>
        )}

        {/* ── a booking ── */}
        {booking && (
          <>
            <div style={{ marginBottom: 12 }}>
              <Badge color={STATUS_COLOR[booking.status]} variant="light">
                {statusLabel(booking.status)}
              </Badge>{' '}
              <Badge color="gray" variant="outline">
                {t(`booking.source.${booking.source}`)}
              </Badge>
            </div>

            <div className="bk-detail-grid">
              <span className="bk-detail-label">{t('booking.fields.guest')}</span>
              <span className="bk-detail-value">{booking.guestName}</span>

              <span className="bk-detail-label">{t('booking.fields.phone')}</span>
              <span className="bk-detail-value">{booking.guestPhone}</span>

              {booking.guestEmail && (
                <>
                  <span className="bk-detail-label">{t('booking.fields.email')}</span>
                  <span className="bk-detail-value">{booking.guestEmail}</span>
                </>
              )}

              <span className="bk-detail-label">{t('booking.fields.room')}</span>
              <span className="bk-detail-value">{booking.roomName}</span>

              <span className="bk-detail-label">{t('booking.fields.date')}</span>
              <span className="bk-detail-value">{dayLabel(booking.bookDate)}</span>

              <span className="bk-detail-label">{t('booking.fields.time')}</span>
              <span className="bk-detail-value">
                {hhmm(booking.startTime)} – {hhmm(booking.endTime)} (
                {t('booking.fields.hoursValue', { value: hoursLabel(booking.hours) })})
              </span>

              <span className="bk-detail-label">{t('booking.fields.persons')}</span>
              <span className="bk-detail-value">{booking.persons}</span>

              {booking.note && (
                <>
                  <span className="bk-detail-label">{t('booking.fields.note')}</span>
                  <span className="bk-detail-value">{booking.note}</span>
                </>
              )}

              {booking.cancelReason && (
                <>
                  <span className="bk-detail-label">{t('booking.fields.cancelReason')}</span>
                  <span className="bk-detail-value">{booking.cancelReason}</span>
                </>
              )}

              {booking.decidedByUsername && (
                <>
                  <span className="bk-detail-label">{t('booking.fields.decidedBy')}</span>
                  <span className="bk-detail-value">
                    {booking.decidedByUsername}
                    {booking.decidedUtc ? ` · ${stamp(booking.decidedUtc)}` : ''}
                  </span>
                </>
              )}
            </div>

            {/* ── add-ons ── */}
            {(receipt?.addons ?? []).length > 0 && (
              <>
                <h3 className="card-title" style={{ marginTop: 18 }}>
                  {t('booking.fields.addons')}
                </h3>
                {(receipt?.addons ?? []).map((addon, index) => (
                  <div className="bk-money-row" key={`${addon.name}-${index}`}>
                    <span>{addon.name}</span>
                    <span>{money(addon.amount, booking.currencyCode)}</span>
                  </div>
                ))}
              </>
            )}

            {/* ── money ── */}
            <h3 className="card-title" style={{ marginTop: 18 }}>
              {t('booking.drawer.money')}
            </h3>
            <div className="bk-money-row bk-money-row--total">
              <span>{t('booking.fields.total')}</span>
              <span>{money(booking.totalAmount, booking.currencyCode)}</span>
            </div>
            <div className="bk-money-row">
              <span>{t('booking.fields.deposit')}</span>
              <span>{money(booking.depositDue, booking.currencyCode)}</span>
            </div>
            <div className="bk-money-row">
              <span>{t('booking.fields.paid')}</span>
              <span>{money(paid, booking.currencyCode)}</span>
            </div>
            <div
              className={
                balance > 0 ? 'bk-money-row bk-money-row--due' : 'bk-money-row'
              }
            >
              <span>{t('booking.fields.balance')}</span>
              <span>{money(balance, booking.currencyCode)}</span>
            </div>

            {/* ── payments ── */}
            <h3 className="card-title" style={{ marginTop: 18 }}>
              {t('booking.drawer.payments')}
            </h3>
            {loading ? (
              <Loader size={20} />
            ) : (receipt?.payments ?? []).length === 0 ? (
              <div className="hint">{t('booking.drawer.noPayments')}</div>
            ) : (
              (receipt?.payments ?? []).map((payment) => (
                <div className="bk-money-row" key={payment.paymentId}>
                  <span>
                    {payment.methodName}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                    <br />
                    <span className="bk-detail-label">
                      {stamp(payment.paidUtc)}
                      {payment.receivedBy ? ` · ${payment.receivedBy}` : ''}
                    </span>
                  </span>
                  <span>{money(payment.amount, booking.currencyCode)}</span>
                </div>
              ))
            )}

            {/* ── the payment form ── */}
            {canManage && paying && (
              <div className="form-grid" style={{ marginTop: 12 }}>
                <div className="form-field full">
                  <label className="form-label" htmlFor="bk-pay-method">
                    {t('booking.fields.method')}
                  </label>
                  <Select
                    id="bk-pay-method"
                    data={methods.map((m) => ({
                      value: String(m.paymentMethodId),
                      label: m.name,
                    }))}
                    value={methodId == null ? null : String(methodId)}
                    onChange={(v) => setMethodId(v ? Number(v) : null)}
                    nothingFoundMessage={t('booking.drawer.noMethods')}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="bk-pay-amount">
                    {t('booking.fields.amount')}
                  </label>
                  <NumberInput
                    id="bk-pay-amount"
                    min={0}
                    decimalScale={2}
                    value={amount}
                    onChange={setAmount}
                  />
                  <div className="hint">
                    {t('booking.drawer.amountHint', {
                      balance: money(balance, booking.currencyCode),
                    })}
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="bk-pay-ref">
                    {t('booking.fields.reference')} {t('common.optional')}
                  </label>
                  <TextInput
                    id="bk-pay-ref"
                    value={reference}
                    onChange={(e) => setReference(e.currentTarget.value)}
                    maxLength={80}
                  />
                </div>

                <div className="form-field full">
                  <div className="form-actions">
                    <Button
                      variant="default"
                      onClick={() => setPaying(false)}
                      disabled={busy}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      onClick={addPayment}
                      loading={busy}
                      disabled={methodId == null || amountValue <= 0}
                    >
                      {t('common.save')}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* ── the cancellation form ── */}
            {canManage && cancelling && (
              <div className="form-field" style={{ marginTop: 12 }}>
                <label className="form-label" htmlFor="bk-cancel-reason">
                  {t('booking.fields.cancelReason')} {t('common.required')}
                </label>
                <Textarea
                  id="bk-cancel-reason"
                  minRows={2}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.currentTarget.value)}
                  maxLength={300}
                />
                <div className="hint">{t('booking.drawer.cancelHint')}</div>
                <div className="form-actions">
                  <Button
                    variant="default"
                    onClick={() => setCancelling(false)}
                    disabled={busy}
                  >
                    {t('common.back')}
                  </Button>
                  <Button
                    color="red"
                    onClick={() => setStatus('Cancelled', cancelReason.trim())}
                    loading={busy}
                    disabled={cancelReason.trim() === ''}
                  >
                    {t('booking.drawer.confirmCancel')}
                  </Button>
                </div>
              </div>
            )}

            {/* ── actions ──
                A CLOSED BOOKING SHOWS NO DECISIONS AT ALL, only the receipt. The server refuses to
                move one, so offering the buttons would be offering four ways to be told no. */}
            <div className="form-actions" style={{ flexWrap: 'wrap' }}>
              <Button
                variant="default"
                leftSection={<IconPrinter size={16} />}
                onClick={() => setReceiptOpen(true)}
              >
                {t('booking.drawer.printReceipt')}
              </Button>

              {canManage && !isClosed(booking.status) && !cancelling && !paying && (
                <>
                  <Button
                    variant="default"
                    leftSection={<IconCash size={16} />}
                    onClick={() => setPaying(true)}
                  >
                    {t('booking.drawer.addPayment')}
                  </Button>

                  {booking.status === 'Pending' && (
                    <Button
                      color="green"
                      leftSection={<IconCheck size={16} />}
                      onClick={() => setStatus('Confirmed')}
                      loading={busy}
                    >
                      {t('booking.drawer.confirm')}
                    </Button>
                  )}

                  {booking.status === 'Confirmed' && (
                    <Button
                      color="gray"
                      leftSection={<IconCheck size={16} />}
                      onClick={() => setStatus('Completed')}
                      loading={busy}
                    >
                      {t('booking.drawer.complete')}
                    </Button>
                  )}

                  <Button
                    color="orange"
                    variant="light"
                    leftSection={<IconUserOff size={16} />}
                    onClick={() => setStatus('NoShow')}
                    loading={busy}
                  >
                    {t('booking.drawer.noShow')}
                  </Button>

                  <Button
                    color="red"
                    variant="light"
                    leftSection={<IconX size={16} />}
                    onClick={() => setCancelling(true)}
                  >
                    {t('booking.drawer.cancelBooking')}
                  </Button>
                </>
              )}
            </div>

            {isClosed(booking.status) && (
              <div className="hint">
                {t('booking.drawer.closedHint', {
                  status: statusLabel(booking.status),
                })}
              </div>
            )}
          </>
        )}
      </Drawer>

      <ReceiptModal
        bookingId={booking?.bookingId ?? null}
        opened={receiptOpen}
        onClose={() => setReceiptOpen(false)}
      />
    </>
  )
}
