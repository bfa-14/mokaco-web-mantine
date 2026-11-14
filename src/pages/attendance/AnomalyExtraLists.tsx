import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Group, Loader, Select, Table, Textarea } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconArchive, IconUserCheck } from '@tabler/icons-react'
import { Modal } from '../../components/dialogs'
import { getErrorMessage } from '../../api/errorMessage'
import { attendanceService } from '../../services/attendanceService'
import { employeesService } from '../../services/hrService'
import { useAuth } from '../../auth/useAuth'
import { PERMISSIONS } from '../../types/attendance'
import type { QuarantinedDeviceUser, QuarantineMapResult } from '../../types/attendance'
import { employeeLabel } from '../../types/hr'
import type { EmployeeListItem } from '../../types/hr'
import { formatDate, formatTime } from './attendanceFormat'
import { DISMISS_NOTE_MAX, dismissRequestFor } from './quarantineDismiss'

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
  /* QA3: setting the punches of a PIN that belongs to nobody aside, with the reason */
  const [aside, setAside] = useState<QuarantinedDeviceUser | null>(null)
  const [asideNote, setAsideNote] = useState('')

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

  function openAside(row: QuarantinedDeviceUser) {
    setAside(row)
    setAsideNote('')
    setDialogError(null)
  }

  async function submitAside() {
    if (!aside) return
    const request = dismissRequestFor(aside, asideNote)
    if (!request) {
      setDialogError(t('attendance.quarantine.asideNoteRequired'))
      return
    }
    setSaving(true)
    try {
      const result = await attendanceService.dismissDeviceQuarantine(request)
      notifications.show({
        message: t('attendance.quarantine.asideDone', { count: result.punchesDismissed, pin: aside.enrollPin }),
        color: 'green',
        autoClose: 4000,
      })
      setAside(null)
      await load()
      onMapped()
    } catch (err) {
      setDialogError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
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
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          <Button size="compact-sm" variant="subtle" leftSection={<IconUserCheck size={14} />} onClick={() => open(r)}>
                            {t('attendance.quarantine.map')}
                          </Button>
                          <Button size="compact-sm" variant="subtle" color="gray" leftSection={<IconArchive size={14} />} onClick={() => openAside(r)}>
                            {t('attendance.quarantine.aside')}
                          </Button>
                        </Group>
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

      {aside && (
        <Modal opened onClose={() => !saving && setAside(null)} title={t('attendance.quarantine.asideTitle', { pin: aside.enrollPin })} size={480} centered>
          <p style={{ marginTop: 0 }}>
            {t('attendance.quarantine.asideBody', {
              count: aside.punchCount,
              device: aside.deviceName || aside.serialNumber || `#${aside.deviceId}`,
            })}
          </p>
          <div className="form-field">
            <label className="form-label" htmlFor="quarantine-aside-note">
              {t('attendance.quarantine.asideNote')}
            </label>
            <Textarea
              id="quarantine-aside-note"
              value={asideNote}
              maxLength={DISMISS_NOTE_MAX}
              autosize
              minRows={2}
              disabled={saving}
              onChange={(e) => {
                const value = e.currentTarget.value
                setAsideNote(value)
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
            <Button variant="default" onClick={() => setAside(null)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button color="gray" onClick={() => void submitAside()} loading={saving}>
              {t('attendance.quarantine.aside')}
            </Button>
          </Group>
        </Modal>
      )}
    </div>
  )
}
