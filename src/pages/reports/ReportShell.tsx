import type { ReactNode } from 'react'
import { Button, Loader } from '@mantine/core'
import { IconPrinter } from '@tabler/icons-react'
import { PageHelp } from '../../components/PageHelp'
import { reportDateTime } from './reportShared'
import './reports.css'

/**
 * The frame every report page shares: the filter bar, the printable document (title block + body),
 * and the loading / empty / error states.
 *
 * The whole reason it exists is the PRINT boundary. The printable half — and only that half — sits
 * inside `.report-print-root`; the print stylesheet hides everything else on the page. So a report
 * cannot accidentally print with the nav, the filter bar or a stray button attached: those live
 * OUTSIDE the print root by construction, not by remembering to hide each one.
 */
export function ReportShell({
  help,
  filters,
  onPrint,
  canPrint,
  loading,
  error,
  isEmpty,
  landscape,
  children,
}: {
  help: ReactNode
  /** The filter controls. Rendered OUTSIDE the print root, so they never appear on paper. */
  filters: ReactNode
  onPrint: () => void
  /** A report can only be printed once it has been generated. */
  canPrint: boolean
  loading: boolean
  error: string | null
  /** True once a report has been fetched but has no rows. */
  isEmpty: boolean
  landscape?: boolean
  /** The printable document: the header block and the table. */
  children: ReactNode
}) {
  return (
    <div>
      {/* Everything from here to the print root is app chrome — it is gone on paper. */}
      <PageHelp>{help}</PageHelp>

      <div className="report-filters report-no-print">
        {filters}
        <div className="report-filter-actions">
          <Button
            leftSection={<IconPrinter size={16} />}
            onClick={onPrint}
            disabled={!canPrint || loading}
            title={
              canPrint
                ? 'Print just the report — no menus, no buttons.'
                : 'Generate the report first.'
            }
          >
            Print
          </Button>
        </div>
      </div>

      {error && (
        <div className="alert alert--error report-no-print" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="page-loading report-no-print">
          <Loader size={40} />
        </div>
      ) : !canPrint ? (
        <div className="card report-no-print">
          <div className="empty-hint">
            <div className="empty-hint-main">Choose your options and press Generate.</div>
            The report will appear here, ready to print.
          </div>
        </div>
      ) : isEmpty ? (
        <div className="card report-no-print">
          <div className="empty-hint">
            <div className="empty-hint-main">No data for this selection.</div>
            Nothing was recorded for these options. Try a different period or branch.
          </div>
        </div>
      ) : (
        // The ONLY thing that survives printing. Its content — header block + table — is the report.
        <div
          className={
            landscape
              ? 'report-print-root report-landscape'
              : 'report-print-root'
          }
        >
          <div className="report-doc">{children}</div>
        </div>
      )}
    </div>
  )
}

/** The document's title block: title, the run's parameters, and when it was generated. */
export function ReportDocHead({
  title,
  meta,
  generatedUtc,
}: {
  title: string
  /** Named parameters of this run — period, branch, and so on. */
  meta: { label: string; value: string }[]
  generatedUtc: string
}) {
  return (
    <div className="report-doc-head">
      <h1 className="report-title">{title}</h1>
      <div className="report-meta">
        {meta.map((item) => (
          <span key={item.label}>
            {item.label}: <strong>{item.value}</strong>
          </span>
        ))}
        <span>
          Generated on <strong>{reportDateTime(generatedUtc)}</strong>
        </span>
      </div>
    </div>
  )
}
