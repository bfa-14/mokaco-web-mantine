/**
 * What a booking owes and how its receipt reads, as pure functions — no React, no i18n, so `npm test`
 * runs them (tests/bookingMoney.test.ts). QA3 BKG-8 and BKG-10.
 */

/**
 * What a guest still owes (QA3 BKG-8): a Cancelled or No-show booking owes NOTHING — its computed
 * balance (total less what is paid net of refunds) only grows as a refund is handed back, and it is
 * the café that owes the refund. The API sends 0 for these already; this keeps an older API honest.
 */
export function balanceOwed(status: string, balanceDue: number | null | undefined): number {
  if (status === 'Cancelled' || status === 'NoShow') return 0
  return balanceDue ?? 0
}

/**
 * The room line of a receipt from what was STORED (QA3 BKG-10): the total less the add-on lines is
 * the room after its discount; adding the discount back gives the room before it, and dividing by the
 * hours the rate it was booked at — not the room's rate today, which may have changed since.
 */
export function receiptRoomLine(
  totalAmount: number,
  addonAmounts: number[],
  discountAmount: number | null | undefined,
  hours: number | null | undefined,
): { gross: number; discount: number; net: number; rate: number | null } {
  const round2 = (value: number) => Math.round(value * 100) / 100
  const net = round2(totalAmount - addonAmounts.reduce((sum, amount) => sum + amount, 0))
  const discount = round2(discountAmount ?? 0)
  const gross = round2(net + discount)
  const rate = hours && hours > 0 ? round2(gross / hours) : null
  return { gross, discount, net, rate }
}
