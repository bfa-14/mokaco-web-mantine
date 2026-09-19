import { apiRequest } from '../api/client'
import type { Currency, ExchangeRate, Holiday, HolidayInput } from '../types/core'

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

/**
 * Exchange rates — reading needs EMP_VIEW, and every WRITE needs CORE_MANAGE.
 *
 * ALL THREE WRITES CARRY THE PROCEDURES' OWN REFUSALS. core.EXCHANGE_RATE holds one rate per
 * (pair, type, effective date), and a clash comes back as a 400 whose message names the pair, the
 * type and the date, and says to edit the existing row rather than add another. That sentence is the
 * whole value of the refusal — show it verbatim, next to the figures it is about.
 */
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

  /**
   * Corrects a rate's figure, and optionally the date it takes effect.
   *
   * THE PAIR AND THE TYPE ARE NOT SENT, and the endpoint does not accept them: a rate row IS the
   * answer to "what was Official USD→LBP on this date", so moving the pair would not correct the row
   * — it would reassign it to a different question. Anything else is a new rate.
   *
   * `effectiveDate` omitted means "leave the date as it is", which is the common edit: a mistyped
   * figure. Returns the STORED row, so the caller shows what the database holds.
   */
  update(
    exchangeRateId: number,
    body: { rate: number; effectiveDate?: string | null },
  ): Promise<ExchangeRate> {
    return apiRequest<ExchangeRate>(`/api/exchange-rates/${exchangeRateId}`, {
      method: 'PUT',
      body: JSON.stringify({ rate: body.rate, effectiveDate: body.effectiveDate ?? null }),
    })
  },

  remove(exchangeRateId: number): Promise<void> {
    return apiRequest<void>(`/api/exchange-rates/${exchangeRateId}`, { method: 'DELETE' })
  },
}

/**
 * Public holidays (D1). Reading is open to everybody signed in (the leave form and the roster need it); writing
 * needs CORE_MANAGE. The API refuses a second holiday on the same date and branch, and one on a month that is
 * already paid for somebody it applies to — both as a sentence to show as it is.
 */
export const holidaysService = {
  getAll(year?: number | null, branchId?: number | null): Promise<Holiday[]> {
    const query = new URLSearchParams()
    if (year) query.set('year', String(year))
    if (branchId) query.set('branchId', String(branchId))
    const qs = query.toString()
    return apiRequest<Holiday[]>(`/api/holidays${qs ? `?${qs}` : ''}`)
  },
  create(input: HolidayInput): Promise<Holiday> {
    return apiRequest<Holiday>('/api/holidays', { method: 'POST', body: JSON.stringify(input) })
  },
  update(holidayId: number, input: HolidayInput): Promise<Holiday> {
    return apiRequest<Holiday>(`/api/holidays/${holidayId}`, { method: 'PUT', body: JSON.stringify(input) })
  },
  remove(holidayId: number): Promise<void> {
    return apiRequest<void>(`/api/holidays/${holidayId}`, { method: 'DELETE' })
  },
}
