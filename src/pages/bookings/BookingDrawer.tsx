import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Button,
  Loader,
  NumberInput,
  Radio,
  Select,
  Stack,
  Textarea,
  TextInput,
} from '@mantine/core'
import { Drawer, Modal } from '../../components/dialogs'
import { notifications } from '@mantine/notifications'
import {
  IconCash,
  IconCashOff,
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
  BookingDetail,
  BookingPaymentLine,
  BookingReceipt,
  BookingRow,
  BookingStatus,
  CancelledBy,
  PaymentMethod,
} from '../../types/booking'
import {
  dayLabel,
  hasRefund,
  hhmm,
  hoursLabel,
  isClosed,
  money,
  REFUND_COLOR,
  refundLabel,
  refundOutstanding,
  refundStatusOf,
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
 * will not accept a cancellation without saying who cancelled. This component asks because the
 * refusal would otherwise be the way you found out, not because it is the authority on the rule.
 *
 * CANCELLING ASKS WHO, BECAUSE THAT DECIDES THE MONEY. Staff cancelling on the guest owes back
 * everything paid; a guest who asked keeps the deposit with the house. The server works the amount
 * out and answers with a refund position (Due / Partial / Refunded); this drawer then offers
 * "Record refund" until the position says Refunded. The refund fields and the flagged payment
 * lines come from GET /{id}, fetched beside the receipt and read defensively — an older build
 * sends none of them, and the drawer must still open.
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

  /** The refund position and flagged payment lines — GET /{id}, null until it arrives or on a build without it. */
  const [detail, setDetail] = useState<BookingDetail | null>(null)

  /* The payment form and the two dialogs. All start closed: a drawer that opens with a
     cancellation box already showing invites the one action nobody should take by accident. */
  const [cancelling, setCancelling] = useState(false)
  const [cancelledBy, setCancelledBy] = useState<CancelledBy>('Staff')
  const [cancelNote, setCancelNote] = useState('')
  /** The dialog's own refusal ("already closed") — shown in it, so the reader is still looking at what was refused. */
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [refunding, setRefunding] = useState(false)
  const [refundMethodId, setRefundMethodId] = useState<number | null>(null)
  const [refundAmount, setRefundAmount] = useState<NumberInputValue>(0)
  const refundAmountValue = parseDecimal(refundAmount) ?? 0
  const [refundReference, setRefundReference] = useState('')
  const [refundError, setRefundError] = useState<string | null>(null)
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
      setDetail(null)
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

    // The refund position, beside the receipt. Its failure is NOT the drawer's: a build without
    // GET /{id} leaves the row's own fields to speak, and the drawer opens exactly as before.
    bookingsService
      .getOne(booking.bookingId)
      .then((result) => {
        if (!cancelled) setDetail(result)
      })
      .catch(() => {
        if (!cancelled) setDetail(null)
      })

    return () => {
      cancelled = true
    }
  }, [opened, booking])

  /* Re-seed the inline forms whenever the drawer moves to a different booking. The amount is
     prefilled with the BALANCE, because "settle the rest" is what almost every payment is. */
  useEffect(() => {
    setCancelling(false)
    setCancelledBy('Staff')
    setCancelNote('')
    setCancelError(null)
    setRefunding(false)
    setRefundError(null)
    setRefundReference('')
    setRefundMethodId(null)
    setPaying(false)
    setReference('')
    setAmount(booking?.balanceDue ?? 0)
    setMethodId(null)
  }, [booking])

  async function setStatus(status: BookingStatus) {
    if (!booking) return

    setBusy(true)
    setError(null)
    try {
      await bookingsService.setStatus(booking.bookingId, { status })
      notifications.show({
        message: t('booking.drawer.statusChanged', { status: statusLabel(status) }),
        color: status === 'NoShow' ? 'orange' : 'green',
      })
      onChanged()
      onClose()
    } catch (err) {
      // "This booking is already closed (Cancelled)." — the procedure's own words.
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  /**
   * The cancellation, with who is cancelling. The note is optional to the new contract and
   * required by the older one, so it goes under both names — see BookingStatusPayload.reason.
   */
  async function cancelBooking() {
    if (!booking) return

    setBusy(true)
    setCancelError(null)
    try {
      const note = cancelNote.trim() || null
      const changed = await bookingsService.setStatus(booking.bookingId, {
        status: 'Cancelled',
        cancelledBy,
        note,
        reason: note,
      })
      const status = changed.refundStatus ?? 'None'
      notifications.show({
        message:
          status === 'None'
            ? t('booking.drawer.statusChanged', { status: statusLabel('Cancelled') })
            : `${t('booking.drawer.statusChanged', { status: statusLabel('Cancelled') })} ${refundLabel(status)}` +
              (changed.refundAmount != null
                ? ` — ${money(changed.refundAmount, booking.currencyCode)}`
                : ''),
        color: 'orange',
      })
      setCancelling(false)
      onChanged()
      onClose()
    } catch (err) {
      setCancelError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  /** Money handed back. Stays in the drawer afterwards, refreshed: a partial refund is followed by the rest. */
  async function recordRefund() {
    if (!booking || refundMethodId == null || refundAmountValue <= 0) return

    setBusy(true)
    setRefundError(null)
    try {
      const result = await bookingsService.recordRefund(booking.bookingId, {
        amount: refundAmountValue,
        method: refundMethodId,
        reference: refundReference.trim() || null,
      })
      notifications.show({
        message: t('booking.drawer.refundRecorded', {
          status: refundLabel(result.refundStatus ?? 'Partial'),
        }),
        color: result.refundStatus === 'Refunded' ? 'green' : 'orange',
      })
      setRefunding(false)
      setRefundReference('')
      onChanged()
      // The position AFTER, from the server — merged over what the drawer had rather than
      // computed from it, so nothing here ever subtracts a refund from a total.
      setDetail((current) => ({
        ...(current ?? booking),
        refundAmount: result.refundAmount ?? current?.refundAmount ?? booking.refundAmount,
        refundStatus: result.refundStatus ?? current?.refundStatus ?? booking.refundStatus,
        refundedUtc: result.refundedUtc ?? current?.refundedUtc ?? booking.refundedUtc,
        payments: result.payments ?? current?.payments,
      }))
      const [refreshedReceipt, refreshedDetail] = await Promise.all([
        bookingsService.getReceipt(booking.bookingId),
        bookingsService.getOne(booking.bookingId).catch(() => null),
      ])
      setReceipt(refreshedReceipt)
      if (refreshedDetail) setDetail(refreshedDetail)
    } catch (err) {
      // "Amount exceeds the refund due — 20.00 remains." — the procedure's own sentence.
      setRefundError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  /** Opens the refund dialog with the amount prefilled to what is still owed. */
  function openRefund() {
    setRefundAmount(refundDue)
    setRefundError(null)
    setRefundMethodId(null)
    setRefunding(true)
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

  /* THE REFUND POSITION: the detail read when it arrived, else the row. Both are read through the
     same helpers, which treat a missing field as "nothing owed". */
  const position = detail ?? booking
  const refundStatus = position ? refundStatusOf(position) : 'None'
  const refundOwed = position?.refundAmount ?? null
  /* Which lines are refunds: the detail's flag by paymentId, or the receipt's own flag where the
     build already sends one. A line neither knows about is an ordinary payment. */
  const refundIds = new Set(
    (detail?.payments ?? []).filter((line) => line.isRefund === true).map((line) => line.paymentId),
  )
  const isRefundLine = (line: { paymentId: number; isRefund?: boolean }) =>
    line.isRefund === true || refundIds.has(line.paymentId)
  const lines: Pick<BookingPaymentLine, 'amount' | 'isRefund'>[] = (
    detail?.payments ?? receipt?.payments ?? []
  ).map((line) => ({ amount: line.amount, isRefund: isRefundLine(line) }))
  const refundDue = refundOutstanding(refundOwed, lines)
  const canRecordRefund =
    canManage &&
    booking?.status === 'Cancelled' &&
    (refundStatus === 'Due' || refundStatus === 'Partial') &&
    refundDue > 0

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
              {position && hasRefund(position) && (
                <>
                  {' '}
                  <Badge color={REFUND_COLOR[refundStatus]} variant="light">
                    {refundLabel(refundStatus)}
                  </Badge>
                </>
              )}
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

              {position?.cancelledBy && (
                <>
                  <span className="bk-detail-label">{t('booking.fields.cancelledBy')}</span>
                  <span className="bk-detail-value">
                    {t(`booking.cancelledBy.${position.cancelledBy}`)}
                  </span>
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
            {/* What is owed BACK, on a cancelled booking. Red while any of it is outstanding —
                it is a debt the house carries, and the badge above says how far along it is. */}
            {position && hasRefund(position) && refundOwed != null && (
              <div
                className={
                  refundDue > 0 ? 'bk-money-row bk-money-row--refund' : 'bk-money-row'
                }
              >
                <span>
                  {t('booking.fields.refund')} · {refundLabel(refundStatus)}
                  {position.refundedUtc ? ` · ${stamp(position.refundedUtc)}` : ''}
                </span>
                <span>
                  {refundDue > 0 && refundDue !== refundOwed
                    ? `${money(refundDue, booking.currencyCode)} / `
                    : ''}
                  {money(refundOwed, booking.currencyCode)}
                </span>
              </div>
            )}

            {/* ── payments ── */}
            <h3 className="card-title" style={{ marginTop: 18 }}>
              {t('booking.drawer.payments')}
            </h3>
            {loading ? (
              <Loader size={20} />
            ) : (receipt?.payments ?? []).length === 0 ? (
              <div className="hint">{t('booking.drawer.noPayments')}</div>
            ) : (
              (receipt?.payments ?? []).map((payment) => {
                const refund = isRefundLine(payment)
                return (
                  <div
                    className={refund ? 'bk-money-row bk-money-row--refund' : 'bk-money-row'}
                    key={payment.paymentId}
                  >
                    <span>
                      {refund ? `${t('booking.drawer.refundLine')} · ` : ''}
                      {payment.methodName}
                      {payment.reference ? ` · ${payment.reference}` : ''}
                      <br />
                      <span className="bk-detail-label">
                        {stamp(payment.paidUtc)}
                        {payment.receivedBy ? ` · ${payment.receivedBy}` : ''}
                      </span>
                    </span>
                    <span>
                      {refund ? '−' : ''}
                      {money(Math.abs(payment.amount), booking.currencyCode)}
                    </span>
                  </div>
                )
              })
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

              {/* A cancelled booking that still owes money back keeps ONE action: handing it over. */}
              {canRecordRefund && (
                <Button
                  color="red"
                  variant="light"
                  leftSection={<IconCashOff size={16} />}
                  onClick={openRefund}
                >
                  {t('booking.drawer.recordRefund')}
                </Button>
              )}

              {canManage && !isClosed(booking.status) && !paying && (
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
                    onClick={() => {
                      setCancelError(null)
                      setCancelling(true)
                    }}
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

      {/* ── CANCEL: who is cancelling decides the refund, so it is asked first and by name. ── */}
      <Modal
        opened={cancelling && booking != null}
        onClose={() => !busy && setCancelling(false)}
        title={t('booking.drawer.cancelTitle', { id: booking?.bookingId ?? 0 })}
        size={480}
        centered
      >
        {cancelError && (
          <div className="alert alert--error" role="alert">
            {cancelError}
          </div>
        )}

        <Radio.Group
          label={t('booking.drawer.cancelWho')}
          value={cancelledBy}
          onChange={(value) => setCancelledBy(value === 'Guest' ? 'Guest' : 'Staff')}
        >
          <Stack gap="xs" mt="xs">
            <Radio
              value="Staff"
              label={t('booking.drawer.cancelByStaff')}
              description={t('booking.drawer.cancelByStaffHint')}
              disabled={busy}
            />
            <Radio
              value="Guest"
              label={t('booking.drawer.cancelByGuest')}
              description={t('booking.drawer.cancelByGuestHint')}
              disabled={busy}
            />
          </Stack>
        </Radio.Group>

        <div className="form-field" style={{ marginTop: 12 }}>
          <label className="form-label" htmlFor="bk-cancel-note">
            {t('booking.fields.note')} {t('common.optional')}
          </label>
          <Textarea
            id="bk-cancel-note"
            minRows={2}
            value={cancelNote}
            onChange={(e) => setCancelNote(e.currentTarget.value)}
            maxLength={300}
            disabled={busy}
          />
          <div className="hint">{t('booking.drawer.cancelNoteHint')}</div>
        </div>

        <div className="form-actions">
          <Button variant="default" onClick={() => setCancelling(false)} disabled={busy}>
            {t('booking.drawer.keepBooking')}
          </Button>
          <Button color="red" onClick={() => void cancelBooking()} loading={busy}>
            {t('booking.drawer.confirmCancel')}
          </Button>
        </div>
      </Modal>

      {/* ── RECORD REFUND: the amount defaults to what is still owed; the server caps it. ── */}
      <Modal
        opened={refunding && booking != null}
        onClose={() => !busy && setRefunding(false)}
        title={t('booking.drawer.refundTitle', { id: booking?.bookingId ?? 0 })}
        size={480}
        centered
      >
        {refundError && (
          <div className="alert alert--error" role="alert">
            {refundError}
          </div>
        )}

        <div className="form-grid">
          <div className="form-field">
            <label className="form-label" htmlFor="bk-refund-amount">
              {t('booking.fields.amount')}
            </label>
            <NumberInput
              id="bk-refund-amount"
              min={0}
              decimalScale={2}
              value={refundAmount}
              onChange={setRefundAmount}
              disabled={busy}
            />
            <div className="hint">
              {refundDue > 0
                ? t('booking.drawer.refundAmountHint', {
                    due: money(refundDue, booking?.currencyCode ?? ''),
                  })
                : t('booking.drawer.refundNothingDue')}
            </div>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="bk-refund-method">
              {t('booking.fields.method')}
            </label>
            <Select
              id="bk-refund-method"
              data={methods.map((m) => ({ value: String(m.paymentMethodId), label: m.name }))}
              value={refundMethodId == null ? null : String(refundMethodId)}
              onChange={(v) => setRefundMethodId(v ? Number(v) : null)}
              nothingFoundMessage={t('booking.drawer.noMethods')}
              disabled={busy}
            />
          </div>

          <div className="form-field full">
            <label className="form-label" htmlFor="bk-refund-ref">
              {t('booking.fields.reference')} {t('common.optional')}
            </label>
            <TextInput
              id="bk-refund-ref"
              value={refundReference}
              onChange={(e) => setRefundReference(e.currentTarget.value)}
              maxLength={80}
              disabled={busy}
            />
          </div>
        </div>

        <div className="form-actions">
          <Button variant="default" onClick={() => setRefunding(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            color="red"
            onClick={() => void recordRefund()}
            loading={busy}
            disabled={refundMethodId == null || refundAmountValue <= 0}
          >
            {t('booking.drawer.recordRefund')}
          </Button>
        </div>
      </Modal>
    </>
  )
}
