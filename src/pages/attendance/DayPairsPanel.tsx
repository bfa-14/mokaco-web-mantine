import { useTranslation } from 'react-i18next'
import { Anchor, Button, Loader, Table } from '@mantine/core'
import { describeAnomaly, formatMinutes, formatTime } from './attendanceFormat'
import type { AttendanceDetail, AttendanceRecord } from '../../types/attendance'

/**
 * THE PAIRS BEHIND ONE DAY — every in→out stretch the processor formed, in the order it formed
 * them.
 *
 * Worked time is the SUM OF THESE, not last-out minus first-in, and that distinction is invisible
 * in a single "7h 28m" cell. A day where somebody left for two hours reads the same as one where
 * they did not, until you can see the two stretches and the gap between them. This panel is that
 * view: the arithmetic behind the number, laid out so a person can check it rather than trust it.
 *
 * It renders what the processor RECORDED. It does not re-pair anything or second-guess the
 * pairing — if the pairs look wrong, the fix is upstream (punch direction, debounce, a correction),
 * and the Punches view beside it is where the raw evidence lives.
 */

/** What the page knows about one row's intervals: in flight, failed, or here. */
export type PairsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: AttendanceDetail }

/** The pixel widths the sub-table pins, so every expanded row lines up with every other. */
const PAIR_WIDTHS = { seq: 44, time: 80, worked: 110, gap: 120 }

export function DayPairsPanel({
  record,
  state,
  onRetry,
  onSeePunches,
}: {
  record: AttendanceRecord
  state: PairsState
  onRetry: () => void
  onSeePunches: () => void
}) {
  const { t } = useTranslation()

  if (state.status === 'loading') {
    return (
      <div className="pairs-panel pairs-panel--busy">
        <Loader size={20} />
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="pairs-panel">
        <div className="alert alert--error" role="alert">
          {state.message}
        </div>
        <Button size="xs" variant="default" onClick={onRetry}>
          {t('common.refresh')}
        </Button>
      </div>
    )
  }

  const intervals = state.detail.intervals
  const totalMinutes = intervals.reduce((sum, interval) => sum + interval.minutes, 0)

  if (intervals.length === 0) {
    return (
      <div className="pairs-panel">
        <div className="pairs-empty">{t('attendance.pairs.none')}</div>
        {/* Even with nothing to show, the way to the evidence stays open: a day with no pairs is
            precisely the day somebody needs to look at the raw punches for. */}
        <Anchor component="button" type="button" onClick={onSeePunches}>
          {t('attendance.pairs.seePunches')}
        </Anchor>
      </div>
    )
  }

  return (
    <div className="pairs-panel">
      <Table className="pairs-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: PAIR_WIDTHS.seq }}>{t('attendance.pairs.seq')}</Table.Th>
            <Table.Th style={{ width: PAIR_WIDTHS.time }}>{t('attendance.pairs.in')}</Table.Th>
            <Table.Th style={{ width: PAIR_WIDTHS.time }}>{t('attendance.pairs.out')}</Table.Th>
            <Table.Th style={{ width: PAIR_WIDTHS.worked }}>
              {t('attendance.pairs.worked')}
            </Table.Th>
            <Table.Th style={{ width: PAIR_WIDTHS.gap }}>
              <span title={t('attendance.pairs.gapTitle')}>{t('attendance.pairs.gap')}</span>
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {intervals.map((interval) => (
            <Table.Tr key={interval.intervalId}>
              <Table.Td className="pairs-seq">{interval.seqNo}</Table.Td>
              <Table.Td>{formatTime(interval.inTimeUtc)}</Table.Td>
              <Table.Td>{formatTime(interval.outTimeUtc)}</Table.Td>
              <Table.Td>{formatMinutes(interval.minutes)}</Table.Td>
              {/* Dimmed because the gap is context, not a result — it is time NOT worked, and it
                  must never read as though it were part of the day's total. */}
              <Table.Td className="pairs-gap">
                {interval.gapAfterMins > 0 ? formatMinutes(interval.gapAfterMins) : ''}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <div className="pairs-summary">
        {t('attendance.pairs.summary', {
          count: intervals.length,
          total: formatMinutes(totalMinutes),
        })}
      </div>

      {/* THE LEFTOVER PUNCHES. The processor pairs consecutive punches, so an odd number leaves one
          with no partner — and that one is the whole reason a day's total can look wrong.

          It is described rather than timed: the orphan punch is not in the intervals (that is what
          makes it an orphan) and no endpoint returns it on its own. `describeAnomaly` is the
          sentence the rest of the app already uses for this, and it names times in the cases where
          they ARE knowable. Guessing the rest from the raw log would be worse than saying less —
          debounce collapses repeat presses, so a raw punch missing from every interval is just as
          likely to be a swallowed duplicate as a genuine orphan. */}
      {record.hasAnomaly && (
        <div className="pairs-unpaired">
          {describeAnomaly(record)}{' '}
          <Anchor component="button" type="button" onClick={onSeePunches}>
            {t('attendance.pairs.seePunches')}
          </Anchor>
        </div>
      )}
    </div>
  )
}
