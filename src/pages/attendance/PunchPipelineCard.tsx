import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader } from '@mantine/core'
import { getErrorMessage } from '../../api/errorMessage'
import { useLive } from '../../live/useLive'
import { useLiveEnabled } from '../../live/useLiveSettings'
import { attendanceService, devicesService, importService } from '../../services/attendanceService'
import { formatDate, formatTime } from './attendanceFormat'
import type { Device, RawPunch } from '../../types/attendance'

/**
 * TODAY'S PUNCH PIPELINE — the whole journey, in five numbers and one line per machine.
 *
 * The question this answers is "is attendance working right now", and before this card the only
 * honest answer was to open three pages and a SQL client. The stages are shown in the order a
 * punch travels them, because that is what makes a number meaningful: 14 landed but 14 unmapped
 * means enrollment; 14 landed and 0 days processed means the processor has not run; 0 landed means
 * the machine was never read, and the per-machine line below says which one and when it last
 * answered.
 *
 * NUMBERS, NOT PROSE, and every number is a link to the page that explains it — a dashboard whose
 * figures are dead ends makes people go and find the real page anyway.
 *
 * It refetches on the live "attendance" signal, so a punch appears in the count within seconds of
 * the machine being pulled.
 */

/** Today as 'YYYY-MM-DD' in the READER'S timezone — toISOString() would hand the server yesterday. */
function todayParam(): string {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

/** One figure, its meaning, and where it gets resolved. */
function Stat({
  value,
  label,
  to,
  hint,
  tone,
}: {
  value: number
  label: string
  to?: string
  hint: string
  tone?: 'warn'
}) {
  const body = (
    <>
      <div className={tone === 'warn' && value > 0 ? 'pipeline-value pipeline-value--warn' : 'pipeline-value'}>
        {value}
      </div>
      <div className="pipeline-label">{label}</div>
    </>
  )

  // A zero is never a problem to be clicked into — "0 on unmapped PINs" is the good outcome, and
  // linking it would send somebody to an empty page to confirm nothing is wrong.
  return to && value > 0 ? (
    <Link className="pipeline-stat" to={to} title={hint}>
      {body}
    </Link>
  ) : (
    <div className="pipeline-stat" title={hint}>
      {body}
    </div>
  )
}

export function PunchPipelineCard() {
  const [punches, setPunches] = useState<RawPunch[]>([])
  const [unmapped, setUnmapped] = useState<RawPunch[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [processedDays, setProcessedDays] = useState(0)
  const [anomalyDays, setAnomalyDays] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const today = todayParam()

  const load = useCallback(async () => {
    try {
      // Assembled from endpoints that already exist rather than a new "dashboard" one: every
      // figure here is the same number its own page shows, which is what stops this card and the
      // pages disagreeing after the next change to either.
      const [landed, unresolved, machines, days] = await Promise.all([
        importService.getPunches(today),
        importService.getPunches(today, { unresolvedOnly: true }),
        devicesService.getAll(),
        attendanceService.get(today, today),
      ])

      setPunches(landed)
      setUnmapped(unresolved)
      setDevices(machines)
      setProcessedDays(days.length)
      setAnomalyDays(days.filter((d) => d.hasAnomaly).length)
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [today])

  useEffect(() => {
    void load()
  }, [load])

  useLive(['attendance'], () => void load(), useLiveEnabled('attendance'))

  if (loading) {
    return (
      <div className="card">
        <div className="page-loading">
          <Loader size={28} />
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-title">Today&apos;s punch pipeline</div>
      <p className="hint">
        What has reached the system today, in the order a punch travels: off the machine, onto a
        person, into a day. {formatDate(today)}.
      </p>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <div className="pipeline-stats">
        <Stat
          value={punches.length}
          label="Punches landed"
          to="/attendance/daily"
          hint="Raw punches recorded today by any machine, however they reached us. Zero means no machine has been read yet."
        />
        <Stat
          value={unmapped.length}
          label="On unmapped PINs"
          to="/attendance/unresolved"
          tone="warn"
          hint="Stored, but on a PIN nobody is enrolled on — so they belong to no one yet. Nothing is lost: mapping the PIN claims them retroactively."
        />
        <Stat
          value={processedDays}
          label="Employee-days processed"
          to="/attendance/daily"
          hint="Days the processor has built from today's punches. Zero with punches landed is normal before the nightly run."
        />
        <Stat
          value={anomalyDays}
          label="Anomaly days"
          to="/attendance/anomalies"
          tone="warn"
          hint="Days the processor could not read confidently — usually a missing punch-out. These block payroll until somebody resolves them."
        />
      </div>

      {devices.length > 0 && (
        <div className="pipeline-machines">
          {devices.map((device) => {
            const label =
              device.name && device.name.trim().length > 0 ? device.name : device.serialNumber

            return (
              <div className="pipeline-machine" key={device.deviceId}>
                <span className="pipeline-machine-name">{label}</span>
                <span className="hint">
                  last punch{' '}
                  {device.lastPunchUtc ? formatTime(device.lastPunchUtc) : '—'}
                </span>
                <span className="hint">
                  last pull {device.lastPullUtc ? formatTime(device.lastPullUtc) : '—'}
                </span>
                {device.lastPullError && (
                  <span className="badge badge--off" title={device.lastPullError}>
                    ⚠ {device.lastPullError}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
