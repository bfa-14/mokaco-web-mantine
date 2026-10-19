/* src/pages/payroll/MyPayslipsPage.tsx — the signed-in person's own payslips (QA3 PAY-12 / WEB-15). */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ActionIcon, Loader, Table } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { useLive } from '../../live/useLive'
import { useLiveEnabled } from '../../live/useLiveSettings'
import { payslipsService } from '../../services/payrollService'
import type { MyPayslip } from '../../types/payroll'
import { fmtLocalDate } from '../hr/hrFormat'
import { netParts } from './payrollRunRules'
import './payroll.css'

const fmt = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * MY PAYSLIPS — open to everybody signed in, because everybody is paid.
 *
 * GET /api/me/payslips resolves the employee from the TOKEN, not from a number in the address, and returns
 * APPROVED runs only: a draft still changes, and a number once seen is remembered as a promise. Each row
 * opens the payslip document, which the server lets its own employee read once the run is approved — the
 * payroll pages themselves stay PAYROLL_VIEW. An account not linked to an employee gets an empty list.
 */
export default function MyPayslipsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [rows, setRows] = useState<MyPayslip[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    payslipsService
      .mine()
      .then((r) => { setRows(r); setError(null) })
      .catch((e) => setError(getErrorMessage(e)))
  }, [])
  useEffect(refresh, [refresh])
  // LIVE: a month approved, or a payment recorded, changes this list.
  useLive(['payroll'], refresh, useLiveEnabled('payroll'))

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('payroll.mine.title')}</h1>
          <p className="page-subtitle">{t('payroll.mine.subtitle')}</p>
        </div>
        <div className="page-head-actions">
          <ActionIcon variant="default" size="lg" aria-label={t('common.refresh')} onClick={refresh}>
            <IconRefresh size={16} />
          </ActionIcon>
        </div>
      </div>

      {error && <div className="wf-balance-warn">{error}</div>}

      {rows == null && !error ? (
        <div className="page-loading"><Loader size={36} /></div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <Table highlightOnHover verticalSpacing="xs" fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('payroll.mine.period')}</Table.Th>
                <Table.Th>{t('payroll.mine.run')}</Table.Th>
                <Table.Th>{t('payroll.mine.net')}</Table.Th>
                <Table.Th>{t('payroll.mine.payment')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(rows ?? []).length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <div className="empty-hint" style={{ padding: 16 }}>{t('payroll.mine.empty')}</div>
                  </Table.Td>
                </Table.Tr>
              ) : (
                (rows ?? []).map((p) => {
                  const nets = netParts(p)
                  return (
                    <Table.Tr
                      key={p.payslipId}
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/payroll/payslips/${p.payslipId}`)}
                    >
                      <Table.Td>{p.periodYearMonth}</Table.Td>
                      <Table.Td>
                        {p.runType === 'Supplemental' ? t('payroll.mine.supplemental') : t('payroll.mine.primary')}
                      </Table.Td>
                      {/* Two currencies, two figures — never merged into one number. */}
                      <Table.Td>
                        {nets.length === 0
                          ? t('payroll.mine.nothing')
                          : nets.map((n) => <div key={n.currency}><b>{fmt(n.amount)}</b> {n.currency}</div>)}
                      </Table.Td>
                      <Table.Td>
                        {p.paidAt
                          ? t('payroll.mine.paidBy', {
                              method: p.paymentMethod === 'Cash' || p.paymentMethod === 'Bank'
                                ? t(`payroll.mine.method.${p.paymentMethod}`)
                                : (p.paymentMethod ?? ''),
                              // UTC from the API: the LOCAL date it fell on (23:30 UTC is tomorrow in Beirut).
                              date: fmtLocalDate(p.paidAt),
                            })
                          : t('payroll.mine.notPaid')}
                      </Table.Td>
                    </Table.Tr>
                  )
                })
              )}
            </Table.Tbody>
          </Table>
        </div>
      )}
    </div>
  )
}
