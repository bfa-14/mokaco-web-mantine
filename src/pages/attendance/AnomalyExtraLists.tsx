import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, Group, Loader, Select, Table } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconUserCheck } from '@tabler/icons-react'
import { Modal } from '../../components/dialogs'
import { getErrorMessage } from '../../api/errorMessage'
import { attendanceService } from '../../services/attendanceService'
import { employeesService } from '../../services/hrService'
import { useAuth } from '../../auth/useAuth'
import { PERMISSIONS } from '../../types/attendance'
import type { QuarantinedDeviceUser, QuarantineMapResult, WorkedWithoutRoster } from '../../types/attendance'
import { employeeLabel } from '../../types/hr'
import type { EmployeeListItem } from '../../types/hr'
import { formatDate, formatMinutes, formatTime, periodLabel } from './attendanceFormat'

/**
 * WORKED WITHOUT A ROSTER (rule 12). The month's roster is APPROVED and gives this employee no row for the day, yet
 * they punched. Nothing is paid or deducted for such a day — it is not an anomaly to rule on, it is a day the roster
 * does not know about. The list is the prompt to add it to the roster (the next reprocess derives it) or to leave it.
 */
export function WorkedWithoutRosterList({
  from,
  to,
  branchId,
  reloadKey,
}: {
  from: string
  to: string
  branchId: number | null
  reloadKey: number
}) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<WorkedWithoutRoster[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    attendanceService
      .getWorkedWithoutRoster(from, to, branchId)
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [from, to, branchId, reloadKey])

  if (error)
    return (
      <div className="alert alert--error" role="alert">
        {error}
      </div>
    )
  if (rows == null)
    return (
      <div className="page-loading">
        <Loader size={40} />
      </div>
    )
  if (rows.length === 0)
    return (
      <div className="card">
        <div className="empty-hint">
          <div className="empty-hint-main">{t('attendance.unrostered.emptyTitle', { month: periodLabel(from.slice(0, 7)) })}</div>
          {t('attendance.unrostered.emptyText')}
        </div>
      </div>
    )

  return (
    <div className="card">
      <Table.ScrollContainer minWidth={760}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('attendance.unrostered.date')}</Table.Th>
              <Table.Th>{t('attendance.unrostered.employee')}</Table.Th>
              <Table.Th>{t('attendance.unrostered.branch')}</Table.Th>
              <Table.Th>{t('attendance.unrostered.firstPunch')}</Table.Th>
              <Table.Th>{t('attendance.unrostered.lastPunch')}</Table.Th>
              <Table.Th style={{ textAlign: 'end' }}>{t('attendance.unrostered.punches')}</Table.Th>
              <Table.Th style={{ textAlign: 'end' }}>{t('attendance.unrostered.worked')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={`${r.employeeId}:${r.workDate}`}>
                <Table.Td>{formatDate(r.workDate)}</Table.Td>
                <Table.Td>{r.employeeName}</Table.Td>
                <Table.Td>{r.branchName}</Table.Td>
                <Table.Td>{formatTime(r.firstPunch)}</Table.Td>
                <Table.Td>{r.punchCount > 1 ? formatTime(r.lastPunch) : '—'}</Table.Td>
                <Table.Td style={{ textAlign: 'end' }}>{r.punchCount}</Table.Td>
                <Table.Td style={{ textAlign: 'end' }}>{formatMinutes(r.workedMinutes)}</Table.Td>
                <Table.Td style={{ textAlign: 'end' }}>
                  <Link to={`/attendance/roster?period=${r.workDate.slice(0, 7)}`}>
                    {t('attendance.unrostered.openRoster')}
                  </Link>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </div>
  )
}

/**
 * UNKNOWN DEVICE USERS (D9). Punches that arrived under a PIN enrolled to nobody are kept, not dropped: one line per
 * (device, PIN) — a PIN is only unique within its terminal. "Map to employee" enrols the PIN, hands the waiting punches
 * to that employee and REPLAYS them, so every day they belong to is derived again from all its punches. Days already
 * paid stay as they were paid; the answer says how many, because those need a payroll adjustment instead.
 */
export function DeviceQuarantineList({
  branchId,
  reloadKey,
  onMapped,
}: {
  branchId: number | null
  reloadKey: number
  onMapped: () => void
}) {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canMap = hasPermission(PERMISSIONS.import)

  const [rows, setRows] = useState<QuarantinedDeviceUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [employees, setEmployees] = useState<EmployeeListItem[]>([])
  const [target, setTarget] = useState<QuarantinedDeviceUser | null>(null)
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [last, setLast] = useState<(QuarantineMapResult & { employeeName: string; enrollPin: string }) | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await attendanceService.getDeviceQuarantine(branchId))
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }, [branchId])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  // Only someone who can map needs the employee list; a viewer never opens the dialog.
  useEffect(() => {
    if (!canMap) return
    employeesService
      .getAll()
      .then(setEmployees)
      .catch(() => setEmployees([]))
  }, [canMap])

  const employeeOptions = useMemo(
    // Terminated people stay in the list: the punches waiting here may well be from before they left.
    () => employees.map((e) => ({ value: String(e.employeeId), label: employeeLabel(e) })),
    [employees],
  )

  function open(row: QuarantinedDeviceUser) {
    setTarget(row)
    setEmployeeId(null)
    setDialogError(null)
  }

  async function submit() {
    if (!target) return
    if (employeeId == null) {
      setDialogError(t('attendance.quarantine.pickEmployee'))
      return
    }
    setSaving(true)
    try {
      const result = await attendanceService.mapDeviceQuarantine({
        deviceId: target.deviceId,
        enrollPin: target.enrollPin,
        employeeId,
      })
      const employeeName = employees.find((e) => e.employeeId === employeeId)?.fullName ?? ''
      setLast({ ...result, employeeName, enrollPin: target.enrollPin })
      notifications.show({
        message: t('attendance.quarantine.mapped', { count: result.punchesResolved, employee: employeeName }),
        color: 'green',
        autoClose: 4000,
      })
      setTarget(null)
      await load()
      onMapped()
    } catch (err) {
      // The procedure's refusal (PIN already enrolled, employee inactive…) is the whole message.
      setDialogError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {last && (
        <div className={`alert ${last.daysAlreadyPaid > 0 ? 'alert--warning' : 'alert--success'}`} role="status">
          {t('attendance.quarantine.result', {
            pin: last.enrollPin,
            employee: last.employeeName,
            punches: last.punchesResolved,
            days: last.daysDerived,
          })}
          {last.daysAlreadyPaid > 0 && <> {t('attendance.quarantine.resultPaid', { count: last.daysAlreadyPaid })}</>}
        </div>
      )}

      {error ? (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      ) : rows == null ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">{t('attendance.quarantine.emptyTitle')}</div>
            {t('attendance.quarantine.emptyText')}
          </div>
        </div>
      ) : (
        <div className="card">
          <Table.ScrollContainer minWidth={720}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('attendance.quarantine.device')}</Table.Th>
                  <Table.Th>{t('attendance.quarantine.branch')}</Table.Th>
                  <Table.Th>{t('attendance.quarantine.pin')}</Table.Th>
                  <Table.Th style={{ textAlign: 'end' }}>{t('attendance.quarantine.punches')}</Table.Th>
                  <Table.Th>{t('attendance.quarantine.first')}</Table.Th>
                  <Table.Th>{t('attendance.quarantine.last')}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={`${r.deviceId}::${r.enrollPin}`}>
                    <Table.Td>{r.deviceName || r.serialNumber || `#${r.deviceId}`}</Table.Td>
                    <Table.Td>{r.branchName ?? '—'}</Table.Td>
                    <Table.Td>
                      <strong>{r.enrollPin}</strong>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'end' }}>{r.punchCount}</Table.Td>
                    <Table.Td>{`${formatDate(r.firstPunch)} ${formatTime(r.firstPunch)}`}</Table.Td>
                    <Table.Td>{`${formatDate(r.lastPunch)} ${formatTime(r.lastPunch)}`}</Table.Td>
                    <Table.Td style={{ textAlign: 'end' }}>
                      {canMap && (
                        <Button size="compact-sm" variant="subtle" leftSection={<IconUserCheck size={14} />} onClick={() => open(r)}>
                          {t('attendance.quarantine.map')}
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </div>
      )}

      {target && (
        <Modal opened onClose={() => !saving && setTarget(null)} title={t('attendance.quarantine.mapTitle', { pin: target.enrollPin })} size={480} centered>
          <p style={{ marginTop: 0 }}>
            {t('attendance.quarantine.mapBody', {
              count: target.punchCount,
              device: target.deviceName || target.serialNumber || `#${target.deviceId}`,
            })}
          </p>
          <div className="form-field">
            <label className="form-label" htmlFor="quarantine-employee">
              {t('attendance.quarantine.employee')}
            </label>
            <Select
              id="quarantine-employee"
              data={employeeOptions}
              value={employeeId != null ? String(employeeId) : null}
              searchable
              placeholder={t('attendance.quarantine.employeePlaceholder')}
              disabled={saving}
              onChange={(v) => {
                setEmployeeId(v != null ? Number(v) : null)
                setDialogError(null)
              }}
            />
          </div>
          {dialogError && (
            <div className="alert alert--error" role="alert">
              {dialogError}
            </div>
          )}
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setTarget(null)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void submit()} loading={saving}>
              {t('attendance.quarantine.map')}
            </Button>
          </Group>
        </Modal>
      )}
    </div>
  )
}
