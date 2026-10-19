/**
 * WHAT A GUEST OWES (QA3 BKG-8) AND HOW THE RECEIPT READS (BKG-10).
 *
 * A cancelled booking with a deposit refunded showed a BALANCE DUE in red in the list, the drawer
 * prefilled it as a payment, and the receipt printed "BALANCE DUE 40.00" for a booking that did not
 * happen. The receipt's room line multiplied the hours by the room's rate TODAY beside an amount after
 * the hour discount, so it never multiplied out. Run with `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { balanceOwed, receiptRoomLine } from '../src/pages/bookings/bookingMoney.ts'

test('a cancelled or no-show booking owes nothing (BKG-8)', () => {
  assert.equal(balanceOwed('Cancelled', 40), 0)
  assert.equal(balanceOwed('NoShow', 32), 0)
  assert.equal(balanceOwed('Confirmed', 32), 32)
  assert.equal(balanceOwed('Pending', undefined), 0)
})

test('the receipt prints the room as it was booked: before the discount, at the rate it was booked at (BKG-10)', () => {
  // 3 h at 20.00 = 60.00, 10 % discount 6.00, a 15.00 add-on: total 69.00
  assert.deepEqual(receiptRoomLine(69, [15], 6, 3), { gross: 60, discount: 6, net: 54, rate: 20 })
  assert.deepEqual(receiptRoomLine(40, [], 0, 2), { gross: 40, discount: 0, net: 40, rate: 20 })
  assert.deepEqual(receiptRoomLine(40, [], undefined, null), { gross: 40, discount: 0, net: 40, rate: null })
})
