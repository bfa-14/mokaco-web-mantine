/** A currency — GET /api/currencies (mirrors backend Currency). */
export interface Currency {
  currencyCode: string
  name: string
  decimalPlaces: number
}

/** An exchange rate — GET /api/exchange-rates (mirrors backend ExchangeRate). */
export interface ExchangeRate {
  exchangeRateId: number
  fromCurrency: string
  toCurrency: string
  rateType: string
  effectiveDate: string
  rate: number
}

/**
 * A public holiday — GET /api/holidays (mirrors backend Holiday, core.HOLIDAY). branchId null = every branch.
 * A holiday changes what a day IS: attendance writes it as Holiday (paid, never Absent), a leave request does not
 * spend a day on it, a roster copy keeps it, and working it earns the payslip line "Holiday Work".
 */
export interface Holiday {
  holidayId: number
  /** ISO date-time as the API sends it; the first ten characters are the calendar day. */
  holidayDate: string
  name: string
  nameAr: string | null
  /** false = nobody is absent, but whoever was rostered to work it loses the day on the payslip. */
  isPaid: boolean
  branchId: number | null
  branchName: string | null
}

export interface HolidayInput {
  /** yyyy-MM-dd */
  holidayDate: string
  name: string
  nameAr: string | null
  isPaid: boolean
  branchId: number | null
}
