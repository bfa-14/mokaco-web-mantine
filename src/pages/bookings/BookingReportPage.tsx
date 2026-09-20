import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Loader, SegmentedControl } from '@mantine/core'
import { IconPrinter } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { getErrorMessage } from '../../api/errorMessage'
import { DateRangeField } from '../../components/DateRangeField'
import { useDateRangeParams } from '../../components/useDateRangeParams'
import { PageHelp } from '../../components/PageHelp'
import { bookingsService } from '../../services/bookingService'
import type { BookingReport } from '../../types/booking'
import { addDays, dayLabel, hoursLabel, PERMISSIONS, today } from './bookingShared'
import './bookings.css'

/**
 * What the rooms did over a period: a timeline bucketed by day, week or month, and each room's share
 * of the whole range.
 *
 * REVENUE AND COLLECTED ARE NOT THE SAME NUMBER AND MUST NOT BE ADDED UP AGAINST EACH OTHER.
 * Revenue counts Confirmed and Completed bookings — what was sold. Collected counts every payment
 * received in the period, INCLUDING money taken against a booking that was later cancelled — what
 * is in the till. The gap between them is the report's whole point, which is why they sit side by
 * side rather than being netted into one figure.
 *
 * THE PRINT BOUNDARY IS THE SAME TECHNIQUE THE ATTENDANCE REPORTS USE: the document sits inside
 * `.bk-print-root`, the stylesheet hides everything else, and the filters live outside it — so the
 * report cannot print with a toolbar attached by anybody forgetting to hide one.
 */
export default function BookingReportPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canView = hasPermission(PERMISSIONS.view)

  /* The period lives in the URL (?from=&to=). The last 30 days are the default. */
  const defaultRange = useMemo(() => ({ from: addDays(today(), -30), to: today() }), [])
  const { from, to, setRange } = useDateRangeParams(defaultRange)
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day')

  const [report, setReport] = useState<BookingReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = useCallback(async () => {
    if (!from || !to) return

    setLoading(true)
    try {
      setReport(await bookingsService.getReport(from, to, groupBy))
      setError(null)
    } catch (err) {
      // "GroupBy must be day, week or month." — the procedure's own refusal, shown as it stands.
      setError(getErrorMessage(err))
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [from, to, groupBy])

  /* Runs on mount and whenever the selection changes. The report is cheap and read-only, and a
     page that opens on an empty frame with a Generate button is one click of nothing. */
  useEffect(() => {
    if (!canView) return
    void generate()
  }, [canView, generate])

  if (!canView) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1 className="page-title">{t('booking.report.title')}</h1>
          </div>
        </div>
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">{t('booking.noAccess')}</div>
            {t('booking.noAccessHint')}
          </div>
        </div>
      </div>
    )
  }

  const isEmpty = report != null && report.buckets.length === 0

  /* The column totals. Computed from the buckets on screen rather than asked of the server, so the
     footer can never disagree with the rows above it. */
  const totals = (report?.buckets ?? []).reduce(
    (sum, bucket) => ({
      bookings: sum.bookings + bucket.bookings,
      cancelled: sum.cancelled + bucket.cancelled,
      noShows: sum.noShows + bucket.noShows,
      hoursSold: sum.hoursSold + bucket.hoursSold,
      revenue: sum.revenue + bucket.revenue,
      collected: sum.collected + bucket.collected,
    }),
    { bookings: 0, cancelled: 0, noShows: 0, hoursSold: 0, revenue: 0, collected: 0 },
  )

  return (
    <div>
      <div className="page-head bk-no-print">
        <div>
          <h1 className="page-title">{t('booking.report.title')}</h1>
          <p className="page-subtitle">{t('booking.report.subtitle')}</p>
        </div>
      </div>

      <div className="bk-no-print">
        <PageHelp>{t('booking.report.help')}</PageHelp>
      </div>

      <div className="bk-toolbar bk-no-print">
        <div className="form-field">
          <span className="form-label">{t('common.period')}</span>
          <DateRangeField
            from={from}
            to={to}
            defaultFrom={defaultRange.from}
            defaultTo={defaultRange.to}
            onChange={setRange}
            w={240}
          />
        </div>

        <div className="form-field">
          <span className="form-label">{t('booking.report.groupBy')}</span>
          <SegmentedControl
            value={groupBy}
            onChange={(value) => setGroupBy(value as 'day' | 'week' | 'month')}
            data={[
              { value: 'day', label: t('booking.report.day') },
              { value: 'week', label: t('booking.report.week') },
              { value: 'month', label: t('booking.report.month') },
            ]}
          />
        </div>

        <div className="bk-toolbar-spacer">
          <Button
            leftSection={<IconPrinter size={16} />}
            onClick={() => window.print()}
            disabled={report == null || loading || isEmpty}
            title={
              report == null || isEmpty
                ? t('booking.report.printDisabled')
                : t('booking.report.printHint')
            }
          >
            {t('booking.report.print')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="alert alert--error bk-no-print" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="page-loading bk-no-print">
          <Loader size={40} />
        </div>
      ) : isEmpty ? (
        <div className="card bk-no-print">
          <div className="empty-hint">
            <div className="empty-hint-main">{t('booking.report.empty')}</div>
            {t('booking.report.emptyHint')}
          </div>
        </div>
      ) : (
        report && (
          <div className="bk-print-root">
            <div className="card">
              <div className="bk-receipt-head">
                <h2 className="bk-receipt-brand">MokaCo</h2>
                <div className="bk-receipt-sub">
                  {t('booking.report.docTitle')} ·{' '}
                  {t('booking.report.docRange', {
                    from: dayLabel(from),
                    to: dayLabel(to),
                  })}{' '}
                  · {t(`booking.report.${groupBy}`)}
                </div>
              </div>

              <h3 className="card-title">{t('booking.report.byPeriod')}</h3>
              <table className="bk-report-table">
                <thead>
                  <tr>
                    <th>{t('booking.report.bucket')}</th>
                    <th className="num">{t('booking.report.bookings')}</th>
                    <th className="num">{t('booking.report.cancelled')}</th>
                    <th className="num">{t('booking.report.noShows')}</th>
                    <th className="num">{t('booking.report.hoursSold')}</th>
                    <th className="num">{t('booking.report.revenue')}</th>
                    <th className="num">{t('booking.report.collected')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.buckets.map((bucket) => (
                    <tr key={bucket.bucket}>
                      <td>{bucket.bucket}</td>
                      <td className="num">{bucket.bookings}</td>
                      <td className="num">{bucket.cancelled}</td>
                      <td className="num">{bucket.noShows}</td>
                      <td className="num">{hoursLabel(bucket.hoursSold)}</td>
                      <td className="num">{bucket.revenue.toFixed(2)}</td>
                      <td className="num">{bucket.collected.toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr>
                    <th>{t('booking.report.total')}</th>
                    <th className="num">{totals.bookings}</th>
                    <th className="num">{totals.cancelled}</th>
                    <th className="num">{totals.noShows}</th>
                    <th className="num">{hoursLabel(totals.hoursSold)}</th>
                    <th className="num">{totals.revenue.toFixed(2)}</th>
                    <th className="num">{totals.collected.toFixed(2)}</th>
                  </tr>
                </tbody>
              </table>

              <h3 className="card-title" style={{ marginTop: 22 }}>
                {t('booking.report.byRoom')}
              </h3>
              {report.rooms.length === 0 ? (
                <div className="hint">{t('booking.report.noRooms')}</div>
              ) : (
                <table className="bk-report-table">
                  <thead>
                    <tr>
                      <th>{t('booking.fields.room')}</th>
                      <th className="num">{t('booking.report.bookings')}</th>
                      <th className="num">{t('booking.report.hoursSold')}</th>
                      <th className="num">{t('booking.report.revenue')}</th>
                      <th className="num">{t('booking.report.collected')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rooms.map((room) => (
                      <tr key={room.roomName}>
                        <td>{room.roomName}</td>
                        <td className="num">{room.bookings}</td>
                        <td className="num">{hoursLabel(room.hoursSold)}</td>
                        <td className="num">{room.revenue.toFixed(2)}</td>
                        <td className="num">{room.collected.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="bk-receipt-policy">{t('booking.report.footnote')}</div>
            </div>
          </div>
        )
      )}
    </div>
  )
}
