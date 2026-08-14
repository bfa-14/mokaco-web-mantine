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
