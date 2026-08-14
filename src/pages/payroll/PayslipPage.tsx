/* src/pages/payroll/PayslipPage.tsx — the document, on screen and on paper. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, Select, TextInput } from '@mantine/core'
import { IconPrinter } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { payslipsService } from '../../services/payrollService'
import type { PayslipDetail, PayslipLine } from '../../types/payroll'
import './payroll.css'

const METHODS = ['Bank', 'Cash']
const fmt = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const CATEGORY_ORDER: PayslipLine['category'][] = ['Earning', 'Deduction', 'EmployerCost']
const CATEGORY_TITLES: Record<PayslipLine['category'], string> = {
  Earning: 'Earnings',
  Deduction: 'Deductions',
  EmployerCost: 'Employer cost (not part of net pay)',
}

/** Where a line's source can be inspected. Request-backed types get a badge;
 *  advance/adjustment link to their admin pages. */
function sourceBadge(l: PayslipLine, period: string) {
  switch (l.sourceType) {
    case 'Advance':
      return <Link className="pr-src" to="/payroll/advances">advance #{l.sourceId}</Link>
    case 'Adjustment':
      return <Link className="pr-src" to={`/payroll/adjustments?period=${period}`}>adjustment #{l.sourceId}</Link>
    case 'Salary': return <span className="pr-src">salary</span>
    case 'Statutory': return <span className="pr-src">statutory</span>
    case 'Attendance': return <span className="pr-src">attendance</span>
    default:
      return <span className="pr-src">{l.sourceType.toLowerCase()} #{l.sourceId ?? ''}</span>
  }
}

export default function PayslipPage() {
  const { id } = useParams()
  const payslipId = Number(id)
  const [detail, setDetail] = useState<PayslipDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [method, setMethod] = useState<'Bank' | 'Cash'>('Bank')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    payslipsService.get(payslipId)
      .then(setDetail)
      .catch((e) => setError(getErrorMessage(e)))
  }, [payslipId])
  useEffect(refresh, [refresh])

  const p = detail?.payslip ?? null
  const lines = detail?.lines ?? []

  /** currency columns present on THIS payslip, in a stable order */
  const currencies = useMemo(() => {
    const set = new Set(lines.map((l) => l.currencyCode))
    return ['USD', 'LBP', ...[...set].filter((c) => c !== 'USD' && c !== 'LBP')].filter((c) => set.has(c))
  }, [lines])

  const recordPayment = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      await payslipsService.setPayment(payslipId, { paymentMethod: method, paymentReference: reference.trim() || null })
      refresh()
    } catch (e) { setError(getErrorMessage(e)) } finally { setBusy(false) }
  }, [payslipId, method, reference, refresh])

  if (!p) {
    return <div><div className="page-head"><h1 className="page-title">Payslip</h1></div>
      {error ? <div className="wf-balance-warn">{error}</div> : <p>Loading…</p>}</div>
  }

  return (
    <div className="pr-payslip">
      <div className="page-head no-print">
        <div>
          <h1 className="page-title">{p.employeeName} · {p.periodYearMonth}</h1>
          <p className="page-subtitle">
            <Link to={`/payroll/runs/${p.payrollRunId}`}>Run {p.periodYearMonth}</Link> · {p.runStatus}
          </p>
        </div>
        <div className="page-head-actions">
          <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>

      {/* the document */}
      <div className="pr-doc">
        <div className="pr-doc-head">
          <div>
            <div className="pr-doc-name">{p.employeeName}</div>
            <div>{p.positionTitle} · {p.branchName}</div>
            <div className="pr-muted">
              NSSF {p.nssfNumber ?? '—'} · hired {p.hireDate.slice(0, 10)}
            </div>
          </div>
          <div className="pr-doc-period">
            <div>Payslip · {p.periodYearMonth}</div>
            {p.lockedAt && <div className="pr-muted">Approved &amp; locked {new Date(p.lockedAt).toLocaleDateString()}</div>}
          </div>
        </div>

        <div className="pr-doc-att">
          Worked {fmt(p.paidDayFraction)} day(s)
          {p.paidLeaveDays ? <> · {fmt(p.paidLeaveDays)} paid leave</> : null}
          {p.unpaidLeaveDays ? <> · {fmt(p.unpaidLeaveDays)} unpaid</> : null}
          {p.overtimeMinutes ? <> · {p.overtimeMinutes} OT min</> : null}
        </div>
        {p.notes && p.notes.trim() !== '' && (
          <div className="wf-balance-warn">⚠ {p.notes}</div>
        )}

        {CATEGORY_ORDER.map((cat) => {
          const rows = lines.filter((l) => l.category === cat)
          if (rows.length === 0) return null
          return (
            <div key={cat} className="pr-lines-block">
              <div className="pr-card-title">{CATEGORY_TITLES[cat]}</div>
              <table className="pr-lines">
                <thead>
                  <tr><th>Component</th><th>Detail</th><th className="num">Qty</th>
                      <th className="num">Rate</th><th className="num">Amount</th><th>Ccy</th><th className="no-print">Source</th></tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.payslipLineId}>
                      <td>{l.componentName}</td>
                      <td className="pr-muted">{l.note ?? ''}</td>
                      <td className="num">{l.quantity ?? ''}</td>
                      <td className="num">{l.unitAmount != null ? fmt(l.unitAmount) : ''}</td>
                      <td className="num">{fmt(l.amount)}</td>
                      <td>{l.currencyCode}</td>
                      <td className="no-print">{sourceBadge(l, p.periodYearMonth)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}

        {/* totals per currency, never merged */}
        <table className="pr-totals pr-doc-totals">
          <thead><tr><th />{currencies.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            <tr><td>Gross</td>
              {currencies.map((c) => <td key={c}>{fmt(c === 'USD' ? p.grossUsd : c === 'LBP' ? p.grossLbp : 0)}</td>)}</tr>
            <tr><td>Deductions</td>
              {currencies.map((c) => <td key={c}>{fmt(c === 'USD' ? p.deductionsUsd : c === 'LBP' ? p.deductionsLbp : 0)}</td>)}</tr>
            <tr className="pr-totals-net"><td>Net pay</td>
              {currencies.map((c) => <td key={c}><b>{fmt(c === 'USD' ? p.netUsd : c === 'LBP' ? p.netLbp : 0)}</b></td>)}</tr>
          </tbody>
        </table>
        <div className="pr-muted">≈ {fmt(p.netPrimary)} comparable, at the run's frozen rate</div>

        {p.paidAt ? (
          <div className="pr-paid">Paid by {p.paymentMethod}
            {p.paymentReference ? <> · ref {p.paymentReference}</> : null} · {new Date(p.paidAt).toLocaleDateString()}</div>
        ) : p.runStatus === 'Approved' ? (
          <div className="pr-payment no-print">
            <div className="pr-card-title">Record payment</div>
            <div className="pr-actions">
              <Select data={METHODS} value={method} w={110} allowDeselect={false}
                onChange={(v) => setMethod((v as 'Bank' | 'Cash') ?? 'Bank')} />
              <TextInput value={reference} w={200} placeholder="Reference (optional)"
                onChange={(e) => setReference(e.currentTarget.value)} />
              <Button disabled={busy} onClick={() => void recordPayment()}>
                {busy ? 'Saving…' : 'Record payment'}
              </Button>
            </div>
            {error && <div className="wf-balance-warn">{error}</div>}
          </div>
        ) : null}

        {/* THE RECEIPT. Cash payroll needs a signature on paper, so this is part of the document
            rather than a print-only afterthought — what is on screen is what comes out.

            The two currencies are named separately and only when non-zero: a payslip in USD alone
            must read "— 500.00 USD.", never "— 500.00 USD and 0.00 LBP", and the joining word has
            to change with it, which is why the LBP clause chooses its own prefix. */}
        <div className="pr-sign">
          <div>
            I confirm receiving my salary for {p.periodYearMonth} as detailed above
            {p.netUsd > 0 && <> — {fmt(p.netUsd)} USD</>}
            {p.netLbp > 0 && <> {p.netUsd > 0 ? 'and' : '—'} {fmt(p.netLbp)} LBP</>}.
          </div>
          <div className="pr-sign-row">
            <div className="pr-sign-cell">
              <div className="pr-sign-line" />
              <div className="pr-sign-label">Employee signature — {p.employeeName}</div>
            </div>
            <div className="pr-sign-cell">
              <div className="pr-sign-line" />
              <div className="pr-sign-label">Date received</div>
            </div>
            <div className="pr-sign-cell">
              <div className="pr-sign-line" />
              <div className="pr-sign-label">Paid out by (name &amp; signature)</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
