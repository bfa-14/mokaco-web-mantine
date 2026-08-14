import { apiRequest } from '../api/client'
import type { Currency, ExchangeRate } from '../types/core'

/** Currencies — read requires EMP_VIEW, write requires EMP_EDIT. */
export const currenciesService = {
  getAll(): Promise<Currency[]> {
    return apiRequest<Currency[]>('/api/currencies')
  },
  /** Insert or update a currency (upsert on the code). */
  upsert(currency: Currency): Promise<void> {
    return apiRequest<void>('/api/currencies', {
      method: 'POST',
      body: JSON.stringify(currency),
    })
  },
}

/** Exchange rates — read requires EMP_VIEW, write requires EMP_EDIT. */
export const exchangeRatesService = {
  getAll(): Promise<ExchangeRate[]> {
    return apiRequest<ExchangeRate[]>('/api/exchange-rates')
  },
  create(rate: {
    fromCurrency: string
    toCurrency: string
    rateType: string
    effectiveDate: string
    rate: number
  }): Promise<{ exchangeRateId: number }> {
    return apiRequest<{ exchangeRateId: number }>('/api/exchange-rates', {
      method: 'POST',
      body: JSON.stringify(rate),
    })
  },
}
