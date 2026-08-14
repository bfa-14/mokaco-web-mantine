import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Link } from 'react-router-dom'
import { ActionIcon, Loader } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { useAuth } from '../auth/useAuth'
import { useLive } from '../live/useLive'
import { useLiveEnabled } from '../live/useLiveSettings'
import { getErrorMessage } from '../api/errorMessage'
import { dashboardService } from '../services/dashboardService'
import { chainsService } from '../services/workflowService'
import { branchesService, employeesService } from '../services/hrService'
import { exchangeRatesService } from '../services/coreService'
import { StatusChip } from './workflow/workflowShared'
import { currentLocale } from '../i18n'
import { arrowForward } from '../i18n/physical'
import { localised } from '../i18n/referenceName'
import type {
  Dashboard,
  DashboardLeaveBalance,
  MonthMoneyLine,
  WaitingOnMeItem,
} from '../types/dashboard'
import type { Branch, EmployeeListItem } from '../types/hr'
import type { ExchangeRate } from '../types/core'
import type { RaisableRequestType } from '../types/workflow'

/**
 * The age at which a queue stops being a queue and starts being a problem. The same threshold the
 * requests hub uses for its amber cards, so a row that nags here nags there too.
 */
const STALE_DAYS = 3

/* ── formatting ── */

function nf(value: number): string {
  return new Intl.NumberFormat(currentLocale()).format(value)
}

/** A money figure with its currency: "180.00 USD", "2,400,000 LBP" (LBP has no minor unit). */
function money(amount: number, currency: string): string {
  const decimals = currency === 'LBP' ? 0 : 2
  return `${new Intl.NumberFormat(currentLocale(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount)} ${currency}`
}

/** "05 Aug" — a date short enough to sit inside a sentence. Parsed as a local date, so it never slips a day. */
function dayMonth(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return value.slice(0, 10)
  return new Date(y, m - 1, d).toLocaleDateString(currentLocale(), {
    day: '2-digit',
    month: 'short',
  })
}

/** A decimal day count as it should read in a balance: "8.5", "15", "−2". */
function days(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/* ── exchange rate ──
   The FX line exists because EXPENSES DEPEND ON IT: workflow.usp_Expense_Create converts any
   non-USD amount to USD to apply the owner threshold, and REFUSES the request outright when it
   cannot. So an empty rate table is not a cosmetic gap — it is a whole request type that silently
   cannot be raised, which is exactly the sort of thing this page exists to surface. */

interface UsdPair {
  /** The other side of the pair — the currency an expense might be filed in. */
  currency: string
  /** How many of that currency one USD buys. */
  perUsd: number
  effectiveDate: string
}

/**
 * The latest USD-paired rate for each other currency.
 *
 * MIRRORS THE PROCEDURE'S OWN RULE, deliberately: it takes the newest row for the pair in EITHER
 * direction ordered by effective date, and ignores RateType entirely. Picking "the Market rate" here
 * would show a number expenses are not actually costed at.
 */
function usdPairs(rates: ExchangeRate[]): UsdPair[] {
  const latest = new Map<string, UsdPair>()
  const ordered = [...rates].sort((a, b) =>
    a.effectiveDate === b.effectiveDate
      ? b.exchangeRateId - a.exchangeRateId
      : a.effectiveDate < b.effectiveDate
        ? 1
        : -1,
  )
  for (const rate of ordered) {
    const isForward = rate.fromCurrency === 'USD' && rate.toCurrency !== 'USD'
    const isReverse = rate.toCurrency === 'USD' && rate.fromCurrency !== 'USD'
    if (!isForward && !isReverse) continue
    const currency = isForward ? rate.toCurrency : rate.fromCurrency
    if (latest.has(currency) || rate.rate <= 0) continue
    latest.set(currency, {
      currency,
      perUsd: isForward ? rate.rate : 1 / rate.rate,
      effectiveDate: rate.effectiveDate,
    })
  }
  return Array.from(latest.values()).sort((a, b) => a.currency.localeCompare(b.currency))
}

/* ── this month's money ──
   Grouped by ITEM rather than rendered row by row, because "Expenses" in two currencies is one fact
   about expenses, not two facts. Overtime is kept in MINUTES and never priced: what an hour costs
   depends on the person and the multiplier, and payroll is the only thing that knows both. */

function monthMoneyText(lines: MonthMoneyLine[], t: TFunction): string[] {
  const byItem = new Map<string, string[]>()
  for (const line of lines) {
    // An aggregate with no GROUP BY still emits a row for a month with nothing in it. Both figures
    // null means exactly that, and an empty month should say nothing rather than "0".
    if (line.amount == null && line.minutes == null) continue
    const part =
      line.minutes != null
        ? t('dashboard.thisMonth.minutesApproved', { minutes: nf(line.minutes) })
        : money(line.amount ?? 0, line.currencyCode ?? 'USD')
    const parts = byItem.get(line.item) ?? []
    parts.push(part)
    byItem.set(line.item, parts)
  }
  return Array.from(byItem, ([item, parts]) => `${item} — ${parts.join(' + ')}`)
}

/* ── pieces ── */

/** A card with a heading that is itself a link to the full screen behind it. */
function DashCard({
  title,
  to,
  linkText,
  tone,
  children,
}: {
  title: string
  to?: string
  linkText?: string
  tone?: 'red'
  children: React.ReactNode
}) {
  const { t } = useTranslation()

  return (
    <section className={tone === 'red' ? 'card dash-card dash-card--red' : 'card dash-card'}>
      <div className="dash-card-head">
        <h2 className="card-title">{title}</h2>
        {to && (
          <Link className="dash-card-link" to={to}>
            {linkText ?? t('dashboard.seeAll')} {arrowForward()}
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

/** One clickable row. Amber when whatever it counts has been waiting too long. */
function DashRow({
  to,
  main,
  meta,
  trailing,
  amber,
}: {
  to: string
  main: string
  meta?: string
  trailing?: React.ReactNode
  amber?: boolean
}) {
  return (
    <Link className={amber ? 'dash-row dash-row--amber' : 'dash-row'} to={to}>
      <span className="dash-row-main">
        <span className="dash-row-title">{main}</span>
        {meta && <span className="dash-row-meta">{meta}</span>}
      </span>
      {trailing && <span className="dash-row-trailing">{trailing}</span>}
    </Link>
  )
}

/**
 * The headline. Not a card among cards — it is the reason the page exists, so it gets the count in
 * full size and sits above everything else.
 */
function WaitingOnMe({ items }: { items: WaitingOnMeItem[] }) {
  const { t } = useTranslation()
  // The list holds the five oldest; the TRUE total rides on every row. Zero rows is zero waiting.
  const total = items[0]?.totalCount ?? 0

  return (
    <section className={total > 0 ? 'card dash-hero dash-hero--active' : 'card dash-hero'}>
      <div className="dash-card-head">
        <div className="dash-hero-headline">
          <span className="dash-hero-count">{total}</span>
          <div>
            <h2 className="card-title" style={{ marginBottom: 0 }}>
              {t('dashboard.waitingOnMe.title')}
            </h2>
            <p className="dash-hero-sub">
              {total === 0
                ? t('dashboard.waitingOnMe.none')
                : t('dashboard.waitingOnMe.some', { count: total })}
            </p>
          </div>
        </div>
        <Link className="dash-card-link" to="/requests?tab=handle">
          {t('dashboard.waitingOnMe.openQueue')} {arrowForward()}
        </Link>
      </div>

      {total === 0 ? (
        <p className="empty-state">{t('dashboard.waitingOnMe.empty')}</p>
      ) : (
        <div className="dash-rows">
          {items.map((item) => (
            <DashRow
              key={item.requestInstanceId}
              to={`/requests/${item.requestInstanceId}`}
              main={item.title ?? item.requestTypeName}
              meta={item.requestTypeName}
              trailing={t('dashboard.waitingOnMe.ageDays', { count: item.ageDays })}
              amber={item.ageDays > STALE_DAYS}
            />
          ))}
          {total > items.length && (
            <Link className="dash-more" to="/requests?tab=handle">
              {t('dashboard.waitingOnMe.more', { count: total - items.length })} {arrowForward()}
            </Link>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * The caller's leave, one line per type they actually hold. Types that grant nothing AND hold
 * nothing are dropped: "Maternity 0 of 0" on a man's dashboard is noise, and noise is what makes
 * people stop reading the rest.
 */
function MyLeave({ balances }: { balances: DashboardLeaveBalance[] }) {
  const { t } = useTranslation()
  const shown = balances.filter(
    (balance) => (balance.annualEntitlementDays ?? 0) > 0 || balance.currentBalance !== 0,
  )
  if (shown.length === 0) return null

  return (
    <DashCard
      title={t('dashboard.myLeave.title')}
      to="/requests/new?type=LEAVE_REQUEST"
      linkText={t('dashboard.myLeave.link')}
    >
      <div className="dash-rows">
        {shown.map((balance) => (
          <DashRow
            key={balance.leaveTypeId}
            to="/requests/new?type=LEAVE_REQUEST"
            main={balance.leaveTypeName}
            meta={balance.isPaid ? undefined : t('dashboard.myLeave.unpaid')}
            trailing={
              <span className="dash-balance">
                <strong>{days(balance.currentBalance)}</strong>
                {balance.annualEntitlementDays != null &&
                  t('dashboard.myLeave.ofEntitlement', {
                    days: days(balance.annualEntitlementDays),
                  })}
              </span>
            }
          />
        ))}
      </div>
    </DashCard>
  )
}

/* ── the page ── */

export default function DashboardPage() {
  const { t } = useTranslation()
  const { user } = useAuth()

  const [data, setData] = useState<Dashboard | null>(null)
  const [types, setTypes] = useState<RaisableRequestType[]>([])
  /* NULL means the read FAILED, which is not the same fact as an empty list — and on a chip the
     difference is the whole point. "0 branches" is a claim about the company; a read that did not
     come back is a claim about nothing, and rendering it as a zero would be the page inventing a
     number. Each of these renders only once it has a real answer. */
  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [employees, setEmployees] = useState<EmployeeListItem[] | null>(null)
  const [rates, setRates] = useState<ExchangeRate[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const seq = useRef(0)

  /**
   * The dashboard call is the page; the other four are chrome, so each is allowed to fail on its own
   * without taking the page with it. They exist because the procedure does not carry them: the
   * raisable types are permission-scoped per caller, and the two chips and the FX line are facts
   * about the company rather than about today.
   *
   * `silent` keeps the current page on screen while refetching — used by the focus refresh, where
   * throwing up a spinner because somebody alt-tabbed back would be worse than a slightly stale row.
   */
  const load = useCallback(async (silent: boolean) => {
    const mine = ++seq.current
    if (!silent) setLoading(true)
    try {
      const [dashboard, typeList, branchList, employeeList, rateList] = await Promise.all([
        dashboardService.get(),
        chainsService.getRaisableRequestTypes().catch(() => [] as RaisableRequestType[]),
        branchesService.getAll().catch(() => null),
        employeesService.getAll().catch(() => null),
        exchangeRatesService.getAll().catch(() => null),
      ])
      if (mine !== seq.current) return
      setData(dashboard)
      setTypes(typeList)
      setBranches(branchList)
      setEmployees(employeeList)
      setRates(rateList)
      setError(null)
    } catch (err) {
      // The dashboard call itself failed. Drop what was on screen: a stale "Nothing waits on you"
      // over a fresh error message is the one thing this page must never say, because it is exactly
      // the sentence somebody would act on by closing the tab.
      if (mine === seq.current) {
        setData(null)
        setError(getErrorMessage(err))
      }
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [])

  // Mount-time fetch, silent because `loading` ALREADY starts true — the spinner is on until the
  // finally in load() takes it down. load() is async and setStates only after its awaits.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(true)
  }, [load])

  /**
   * LIVE: refetch silently when anything the dashboard summarises moves.
   *
   * Silent on purpose — a spinner appearing because a colleague approved something elsewhere would
   * be the page interrupting a reader who did nothing. The existing focus refetch and the Refresh
   * button both stay: live is an addition, and a socket that fails must leave the page exactly as
   * capable as it was before.
   */
  useLive(['dashboard'], () => void load(true), useLiveEnabled('dashboard'))

  /**
   * Refetch when the tab comes back to the front. NO POLLING: this page is read in bursts — opened,
   * acted on, left — and a timer ticking in a background tab would spend the whole day asking a
   * question nobody is listening to. Coming back IS the moment the answer might have changed, and it
   * is the only moment worth asking.
   */
  useEffect(() => {
    function refresh() {
      if (document.visibilityState === 'visible') void load(true)
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

  /* Whether the caller is managerial is the SERVER'S answer, not one re-derived here from roles. The
     procedure returns the company snapshot only to a managerial caller, so its presence is the
     signal — and it cannot disagree with the data beside it, because it IS that data. */
  const managerial = data?.companySnapshot != null

  /* Counted the same way the pages behind the chips count, so a chip and its destination can never
     disagree. Deliberately NOT companySnapshot.activeEmployees, which counts undeleted rows rather
     than employed people — a subtly different number, and one a non-managerial caller never gets. */
  const activeEmployees = useMemo(
    () => employees?.filter((employee) => !employee.terminationDate).length ?? null,
    [employees],
  )
  const activeBranches = useMemo(
    () => branches?.filter((b) => b.isActive).length ?? null,
    [branches],
  )
  const fx = useMemo(() => (rates == null ? null : usdPairs(rates)), [rates])
  const money12 = useMemo(() => monthMoneyText(data?.monthMoney ?? [], t), [data, t])

  const myRequestsTotal = data?.myRequests[0]?.totalCount ?? 0
  const resetArmed = data?.companySnapshot?.resetArmed === true
  const gaps = data?.coverageGaps ?? []
  const needsAttention = managerial && (gaps.length > 0 || resetArmed)
  const today = useMemo(() => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  }, [])
  const todayRange = `?from=${today}&to=${today}`

  if (loading) {
    return (
      <div className="page-loading">
        <Loader size={40} />
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('dashboard.title')}</h1>
          <p className="page-subtitle">
            <Trans
              i18nKey="dashboard.welcome"
              values={{ name: user?.username ?? t('dashboard.welcomeFallbackName') }}
              components={{ name: <strong /> }}
            />
          </p>
        </div>
        <div className="page-head-actions">
          <ActionIcon
            variant="default"
            size="lg"
            title={t('dashboard.refresh')}
            aria-label={t('dashboard.refresh')}
            onClick={() => void load(false)}
          >
            <IconRefresh size={18} />
          </ActionIcon>
        </div>
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {/* Nothing below this renders without the dashboard read. An empty page under an error message
          is honest; a page of confident zeroes under one is not. */}
      {!data ? null : (
        <>
          {/* The two figures that describe the company rather than the day, kept as small links so the
          page opens on work rather than on furniture. The exchange rate sits with them because it is
          the same kind of fact — until it is MISSING, at which point it becomes a warning. */}
          <div className="dash-chips">
            {activeEmployees != null && (
              <Link className="dash-chip" to="/hr/employees">
                <span className="dash-chip-value">{nf(activeEmployees)}</span>
                <span className="dash-chip-label">{t('dashboard.chips.activeEmployees')}</span>
              </Link>
            )}
            {activeBranches != null && (
              <Link className="dash-chip" to="/hr/branches">
                <span className="dash-chip-value">{nf(activeBranches)}</span>
                <span className="dash-chip-label">{t('dashboard.chips.branches')}</span>
              </Link>
            )}
            {fx != null &&
              (fx.length > 0 ? (
                <Link className="dash-chip dash-chip--wide" to="/core/exchange-rates">
                  <span className="dash-chip-label">{t('dashboard.chips.exchangeRate')}</span>
                  <span className="dash-chip-line">
                    {fx
                      .map((pair) =>
                        t('dashboard.chips.ratePair', {
                          rate: nf(Math.round(pair.perUsd * 100) / 100),
                          currency: pair.currency,
                        }),
                      )
                      .join(' · ')}
                    {/* Only with ONE pair: two currencies can be dated differently, and a single "as of"
                    over both would date one of them wrongly. */}
                    {fx.length === 1 && (
                      <span className="dash-chip-muted">
                        {' '}
                        {t('dashboard.chips.rateAsOf', { date: dayMonth(fx[0].effectiveDate) })}
                      </span>
                    )}
                  </span>
                </Link>
              ) : (
                <Link
                  className="dash-chip dash-chip--wide dash-chip--warn"
                  to="/core/exchange-rates"
                >
                  <span className="dash-chip-label">{t('dashboard.chips.exchangeRate')}</span>
                  <span className="dash-chip-line">
                    {t('dashboard.chips.noRate')} {arrowForward()}
                  </span>
                </Link>
              ))}
          </div>

          {/* 1 — the headline. */}
          <WaitingOnMe items={data.waitingOnMe} />

          <div className="dash-grid">
            {/* 2 — the queue behind the queue: what is piling up, by kind. */}
            {managerial && (
              <DashCard
                title={t('dashboard.byType.title')}
                to="/requests?tab=handle"
                linkText={t('dashboard.byType.link')}
              >
                {data.workflowByType.length === 0 ? (
                  <p className="empty-state">{t('dashboard.byType.empty')}</p>
                ) : (
                  <div className="dash-rows">
                    {data.workflowByType.map((row) => (
                      <DashRow
                        key={row.code}
                        /* status=Open travels with the type. The row says "4 open"; the hub's own
                           default is "All", so without it the click would land on a longer list
                           including closed history, and the number would look wrong the moment it
                           was checked. */
                        to={`/requests?type=${encodeURIComponent(row.code)}&status=Open`}
                        main={row.name}
                        meta={t('dashboard.byType.open', { count: row.openCount })}
                        trailing={
                          row.oldestAgeDays != null
                            ? t('dashboard.byType.oldest', { count: row.oldestAgeDays })
                            : undefined
                        }
                        amber={(row.oldestAgeDays ?? 0) > STALE_DAYS}
                      />
                    ))}
                  </div>
                )}
              </DashCard>
            )}

            {/* 3 — cover for today. "Rostered" is the ROSTER, not clock-ins: read as attendance, an
            ordinary morning would look like half the branch failing to show up. */}
            {managerial && (
              <DashCard
                title={t('dashboard.staffing.title')}
                to={`/attendance/daily${todayRange}`}
                linkText={t('dashboard.staffing.link')}
              >
                {data.staffingToday.length === 0 ? (
                  <p className="empty-state">{t('dashboard.staffing.empty')}</p>
                ) : (
                  <div className="dash-rows">
                    {data.staffingToday.map((branch) => (
                      <DashRow
                        key={branch.branchId}
                        to={`/attendance/daily${todayRange}`}
                        main={branch.branchName}
                        meta={t('dashboard.staffing.counts', {
                          rostered: branch.rosteredToday,
                          onLeave: branch.onLeaveToday,
                        })}
                      />
                    ))}
                  </div>
                )}
              </DashCard>
            )}

            {/* 4 — hidden entirely when nobody is off. An empty "On leave today" card is a card that
            teaches people to skip that corner of the page. */}
            {managerial && data.onLeaveToday.length > 0 && (
              <DashCard title={t('dashboard.onLeave.title')}>
                <div className="dash-rows">
                  {data.onLeaveToday.map((person) => (
                    <DashRow
                      key={`${person.requestInstanceId}-${person.fullName}`}
                      to={`/requests/${person.requestInstanceId}`}
                      main={person.fullName}
                      meta={t('dashboard.onLeave.until', {
                        leaveType: person.leaveTypeName,
                        date: dayMonth(person.toDate),
                      })}
                      trailing={person.branchName}
                    />
                  ))}
                </div>
              </DashCard>
            )}

            {/* 5 — the caller's own side of the workflow. */}
            <DashCard
              title={t('dashboard.myRequests.title')}
              to="/requests?tab=mine"
              linkText={t('dashboard.seeAll')}
            >
              {myRequestsTotal === 0 ? (
                <p className="empty-state">{t('dashboard.myRequests.empty')}</p>
              ) : (
                <div className="dash-rows">
                  {data.myRequests.map((request) => (
                    <DashRow
                      key={request.requestInstanceId}
                      to={`/requests/${request.requestInstanceId}`}
                      main={request.title ?? request.requestTypeName}
                      meta={request.requestTypeName}
                      trailing={<StatusChip status={request.status} />}
                    />
                  ))}
                  {myRequestsTotal > data.myRequests.length && (
                    <Link className="dash-more" to="/requests?tab=mine">
                      {t('dashboard.myRequests.more', {
                        count: myRequestsTotal - data.myRequests.length,
                      })}{' '}
                      {arrowForward()}
                    </Link>
                  )}
                </div>
              )}
            </DashCard>

            {/* 6 — renders ONLY when there is something wrong. A permanently-present "Needs attention"
            card that usually says "all clear" is one people learn not to look at. */}
            {needsAttention && (
              <DashCard title={t('dashboard.needsAttention.title')} tone="red">
                {gaps.length > 0 && (
                  <p className="dash-alarm">
                    {t('dashboard.needsAttention.noChainLabel')}{' '}
                    {gaps.map((gap, index) => (
                      <span key={gap.requestTypeId}>
                        {index > 0 && ', '}
                        <Link to={`/workflow/chains?type=${encodeURIComponent(gap.code)}`}>
                          {gap.name}
                        </Link>
                      </span>
                    ))}
                    {'. '}
                    {t('dashboard.needsAttention.cannotRaise', { count: gaps.length })}
                  </p>
                )}
                {resetArmed && (
                  <Link className="dash-strip" to="/settings">
                    {t('dashboard.needsAttention.resetArmed')} {arrowForward()}
                  </Link>
                )}
              </DashCard>
            )}

            {/* 7 — OVERTIME STAYS IN MINUTES. What an hour costs depends on the person and the
            multiplier; payroll knows both and this page knows neither. */}
            {managerial && (
              <DashCard title={t('dashboard.thisMonth.title')}>
                {money12.length === 0 ? (
                  <p className="empty-state">{t('dashboard.thisMonth.empty')}</p>
                ) : (
                  <ul className="dash-money">
                    {money12.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </DashCard>
            )}

            {/* 8 — one button per type the caller may ACTUALLY raise. The list is already scoped to them
            server-side, so a type without a published chain never offers a form that fails at submit. */}
            {types.length > 0 && (
              <DashCard title={t('dashboard.quickActions.title')}>
                <div className="dash-actions">
                  {types.map((type) => (
                    <Link
                      key={type.code}
                      className="dash-action"
                      to={`/requests/new?type=${encodeURIComponent(type.code)}`}
                    >
                      {/* The type's name is DATA, not a UI string — it has its own Arabic column
                          and falls back to English until somebody fills it in. */}
                      {localised(type.menuLabel || type.name, type.menuLabelAr || type.nameAr)}
                    </Link>
                  ))}
                </div>
              </DashCard>
            )}

            {/* 9 — absent entirely for an account with no employee record behind it: there is no leave
            to have. The procedure returns no balances in that case, so nothing here decides it. */}
            <MyLeave balances={data.leaveBalances} />
          </div>
        </>
      )}
    </div>
  )
}
