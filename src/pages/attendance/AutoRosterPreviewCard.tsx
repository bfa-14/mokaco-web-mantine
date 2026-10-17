import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import {
  IconAlertTriangle,
  IconCircleX,
  IconDeviceFloppy,
  IconInfoCircle,
  IconRefresh,
  IconSettings,
  IconX,
} from '@tabler/icons-react'
import type { AutoRosterIssue } from '../../types/attendance'
import { formatDayLabel } from './attendanceFormat'
import type { RosterDraft } from './useRosterDraft'

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 }

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'error') return <IconCircleX size={15} className="auto-issue-icon auto-issue-icon--error" />
  if (severity === 'warning') return <IconAlertTriangle size={15} className="auto-issue-icon auto-issue-icon--warning" />
  return <IconInfoCircle size={15} className="auto-issue-icon auto-issue-icon--info" />
}

/**
 * THE DRAFT'S CONTROL PANEL, sticky above the grid it is drawn on: what saving would do, what the
 * plan could not satisfy, and the four ways out — Save, Regenerate, Options…, Discard.
 *
 * Nothing on the grid is saved while this card is up. An issue is a link to its day: clicking it
 * scrolls the grid to the cell, because "Rami, 12/12: too many working days in a row" is only
 * actionable next to Rami's row. Issues are not translated sentences from the server but codes, so
 * the title reads in the page's language; the server's own sentence, with its figures, is the
 * tooltip.
 *
 * An ERROR blocks Save — the server would refuse it (400) — and the way out is to edit the days and
 * Regenerate, which is the only thing that re-checks them: edits are local until then, and the card
 * says so rather than showing issues that may no longer be true as if they were.
 */
export function AutoRosterPreviewCard({
  draft,
  monthLabel,
  branchName,
  employeeName,
  stale,
  onSave,
  onRegenerate,
  onOptions,
  onIssue,
}: {
  draft: RosterDraft
  monthLabel: string
  branchName: string
  employeeName: (employeeId: number) => string
  /** Days of the saved roster that moved under the draft since its preview (0 = none). */
  stale: number
  onSave: () => void
  onRegenerate: () => void
  onOptions: () => void
  /** Scroll the grid to the issue's day. */
  onIssue: (issue: AutoRosterIssue) => void
}) {
  const { t } = useTranslation()
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const issues = useMemo(
    () =>
      [...draft.issues].sort(
        (a, b) =>
          (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3) ||
          (a.date ?? '').localeCompare(b.date ?? '') ||
          (a.employeeId ?? 0) - (b.employeeId ?? 0),
      ),
    [draft.issues],
  )
  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 }
    for (const issue of draft.issues) {
      if (issue.severity === 'error') c.error++
      else if (issue.severity === 'warning') c.warning++
      else c.info++
    }
    return c
  }, [draft.issues])

  const { summary } = draft
  const busy = draft.busy != null
  const blocked = counts.error > 0
  const mode = draft.request ? t(`attendance.roster.auto.mode.${draft.request.mode}`) : ''

  function discard() {
    if (draft.editCount > 0 && !confirmDiscard) {
      setConfirmDiscard(true)
      return
    }
    setConfirmDiscard(false)
    draft.discard()
    notifications.show({ message: t('attendance.roster.auto.card.discarded'), color: 'gray', autoClose: 2500 })
  }

  return (
    <div className="card auto-roster-card" role="region" aria-label={t('attendance.roster.auto.card.title')}>
      <div className="auto-roster-card-head">
        <div>
          <strong>{t('attendance.roster.auto.card.title')}</strong>
          <div className="hint">
            {t('attendance.roster.auto.card.subtitle', { month: monthLabel, branch: branchName, mode })}
          </div>
        </div>
        <div className="auto-roster-card-actions">
          <Tooltip label={t('attendance.roster.auto.card.saveBlocked')} disabled={!blocked} withArrow multiline w={260}>
            {/* A span so the tooltip still fires over a disabled button. */}
            <span>
              <Button
                leftSection={<IconDeviceFloppy size={16} />}
                onClick={onSave}
                loading={draft.busy === 'commit'}
                disabled={blocked || busy}
              >
                {draft.busy === 'commit' ? t('attendance.roster.auto.card.saving') : t('attendance.roster.auto.card.save')}
              </Button>
            </span>
          </Tooltip>
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            onClick={onRegenerate}
            loading={draft.busy === 'preview'}
            disabled={busy}
          >
            {t('attendance.roster.auto.card.regenerate')}
          </Button>
          <Button variant="default" leftSection={<IconSettings size={16} />} onClick={onOptions} disabled={busy}>
            {t('attendance.roster.auto.card.options')}
          </Button>
          <Button variant="default" color="red" leftSection={<IconX size={16} />} onClick={discard} disabled={busy}>
            {t('attendance.roster.auto.card.discard')}
          </Button>
        </div>
      </div>

      {confirmDiscard && (
        <div className="alert alert--warning auto-roster-confirm" role="alert">
          <span>{t('attendance.roster.auto.card.discardConfirm', { count: draft.editCount })}</span>
          <span className="auto-roster-confirm-actions">
            <Button size="xs" variant="default" onClick={() => setConfirmDiscard(false)}>
              {t('attendance.roster.auto.card.keepEditing')}
            </Button>
            <Button size="xs" color="red" onClick={discard}>
              {t('attendance.roster.auto.card.discard')}
            </Button>
          </span>
        </div>
      )}

      <div className="auto-roster-chips">
        <span className="auto-chip auto-chip--insert">{t('attendance.roster.auto.card.inserts', { count: summary.inserts })}</span>
        {summary.updates > 0 && (
          <span className="auto-chip auto-chip--update">{t('attendance.roster.auto.card.updates', { count: summary.updates })}</span>
        )}
        {summary.deletes > 0 && (
          <span className="auto-chip auto-chip--delete">{t('attendance.roster.auto.card.deletes', { count: summary.deletes })}</span>
        )}
        {summary.unchanged > 0 && (
          <span className="auto-chip">{t('attendance.roster.auto.card.unchanged', { count: summary.unchanged })}</span>
        )}
        {summary.kept > 0 && (
          <span className="auto-chip">{t('attendance.roster.auto.card.kept', { count: summary.kept })}</span>
        )}
        {draft.editCount > 0 && (
          <span className="auto-chip auto-chip--edit">{t('attendance.roster.auto.card.edits', { count: draft.editCount })}</span>
        )}
      </div>

      {draft.error && (
        <div className="alert alert--error" role="alert" style={{ marginTop: 10, marginBottom: 0 }}>
          {draft.error}
        </div>
      )}
      {draft.editedSincePreview && (
        <div className="hint" style={{ marginTop: 8 }}>{t('attendance.roster.auto.card.edited')}</div>
      )}
      {stale > 0 && (
        <div className="alert alert--warning" style={{ marginTop: 8, marginBottom: 0 }}>
          {t('attendance.roster.auto.card.stale', { count: stale })}
        </div>
      )}

      <div className="auto-issues">
        <div className="auto-issues-head">
          <strong>{t('attendance.roster.auto.issues.title')}</strong>
          {counts.error > 0 && (
            <span className="auto-issues-count auto-issues-count--error">
              {t('attendance.roster.auto.issues.errors', { count: counts.error })}
            </span>
          )}
          {counts.warning > 0 && (
            <span className="auto-issues-count auto-issues-count--warning">
              {t('attendance.roster.auto.issues.warnings', { count: counts.warning })}
            </span>
          )}
          {counts.info > 0 && (
            <span className="auto-issues-count">{t('attendance.roster.auto.issues.infos', { count: counts.info })}</span>
          )}
          <span className="hint auto-issues-payroll">{t('attendance.roster.auto.card.payroll')}</span>
        </div>
        {draft.issuesFromSave && <div className="form-error" style={{ margin: '0 0 6px' }}>{t('attendance.roster.auto.issues.refused')}</div>}
        {issues.length === 0 ? (
          <div className="hint">{t('attendance.roster.auto.issues.none')}</div>
        ) : (
          <ul className="auto-issues-list">
            {issues.map((issue, index) => {
              const title = t(`attendance.roster.auto.issue.${issue.code}`, { defaultValue: issue.message || issue.code })
              const where = [
                issue.employeeId != null ? employeeName(issue.employeeId) : null,
                issue.date ? formatDayLabel(issue.date) : null,
              ]
                .filter(Boolean)
                .join(' · ')
              const jumpable = issue.employeeId != null || issue.date != null
              return (
                <li key={`${issue.code}|${issue.employeeId ?? ''}|${issue.date ?? ''}|${index}`}>
                  <button
                    type="button"
                    className={`auto-issue auto-issue--${issue.severity}`}
                    title={issue.message}
                    onClick={() => onIssue(issue)}
                    disabled={!jumpable}
                    aria-label={`${t(`attendance.roster.auto.severity.${issue.severity}`, { defaultValue: issue.severity })}: ${title}${where ? ` — ${where}` : ''}. ${t('attendance.roster.auto.issues.jump')}`}
                  >
                    <SeverityIcon severity={issue.severity} />
                    <span className="auto-issue-title">{title}</span>
                    {where && <span className="auto-issue-where">{where}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
