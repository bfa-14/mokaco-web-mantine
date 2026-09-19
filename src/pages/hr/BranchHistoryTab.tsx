import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, Group, Loader, Table } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { Modal } from '../../components/dialogs'
import { employeesService } from '../../services/hrService'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import { fmtDate } from './hrFormat'
import type { EmployeeBranchHistoryRow } from '../../types/hr'

/** Today in Beirut as yyyy-MM-dd — "current" and "planned" are read against the company's day, not the browser's. */
function beirutToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(new Date())
}

/**
 * WHERE THE EMPLOYEE BELONGED, AND FROM WHEN (D7). A branch change is a transfer with a date: rosters, attendance and
 * payroll read the branch AS OF the day they are about, so the rows here are what those screens are answering from.
 * The transfer itself is made on the Edit form (branch + "effective from"); the only action here is taking back one
 * that has not started yet — history that has happened is not edited.
 */
export function BranchHistoryTab({ employeeId, reloadKey, onChanged }: { employeeId: number; reloadKey?: number; onChanged?: () => void }) {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canEdit = hasPermission(PERMISSION.EMP_EDIT)

  const [rows, setRows] = useState<EmployeeBranchHistoryRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<EmployeeBranchHistoryRow | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setRows(await employeesService.getBranchHistory(employeeId))
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err, t('hr.branchHistory.loadFailed')))
    }
  }, [employeeId, t])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  async function confirmCancel() {
    if (!cancelling) return
    setBusy(true)
    try {
      await employeesService.cancelFutureTransfer(employeeId, cancelling.employeeBranchHistoryId)
      notifications.show({ message: t('hr.branchHistory.cancelled'), color: 'green', autoClose: 2500 })
      setCancelling(null)
      await load()
      onChanged?.()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err, t('hr.branchHistory.cancelFailed')), color: 'red', autoClose: 6000 })
    } finally {
      setBusy(false)
    }
  }

  if (error) return <div className="card error-text">{error}</div>
  if (rows == null) return <Loader size="sm" />

  const today = beirutToday()

  return (
    <div className="card">
      <p className="hint" style={{ marginTop: 0 }}>
        {t('hr.branchHistory.intro')}
      </p>
      {rows.length === 0 ? (
        <p className="hint">{t('hr.branchHistory.empty')}</p>
      ) : (
        <Table.ScrollContainer minWidth={640}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('hr.branchHistory.branch')}</Table.Th>
                <Table.Th>{t('hr.branchHistory.from')}</Table.Th>
                <Table.Th>{t('hr.branchHistory.to')}</Table.Th>
                <Table.Th>{t('hr.branchHistory.note')}</Table.Th>
                <Table.Th>{t('hr.branchHistory.recordedBy')}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => {
                const from = r.effectiveFrom.slice(0, 10)
                const to = r.effectiveTo?.slice(0, 10) ?? null
                const planned = from > today
                const current = !planned && (to == null || to >= today)
                return (
                  <Table.Tr key={r.employeeBranchHistoryId}>
                    <Table.Td>
                      {r.branchName}{' '}
                      {current && (
                        <Badge size="sm" color="green" variant="light">
                          {t('hr.branchHistory.current')}
                        </Badge>
                      )}
                      {planned && (
                        <Badge size="sm" color="blue" variant="light">
                          {t('hr.branchHistory.planned')}
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>{fmtDate(r.effectiveFrom)}</Table.Td>
                    <Table.Td>{to ? fmtDate(to) : '—'}</Table.Td>
                    <Table.Td>{r.note ?? ''}</Table.Td>
                    <Table.Td>{r.createdByName ?? ''}</Table.Td>
                    <Table.Td style={{ textAlign: 'end' }}>
                      {planned && canEdit && (
                        <Button size="compact-sm" variant="subtle" color="red" onClick={() => setCancelling(r)}>
                          {t('hr.branchHistory.cancel')}
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal opened={cancelling != null} onClose={() => (busy ? undefined : setCancelling(null))} title={t('hr.branchHistory.cancelTitle')} size={420} centered>
        {cancelling && (
          <p>{t('hr.branchHistory.cancelBody', { branch: cancelling.branchName, date: fmtDate(cancelling.effectiveFrom) })}</p>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setCancelling(null)} disabled={busy}>
            {t('hr.branchHistory.keep')}
          </Button>
          <Button color="red" onClick={() => void confirmCancel()} loading={busy}>
            {t('hr.branchHistory.cancel')}
          </Button>
        </Group>
      </Modal>
    </div>
  )
}
