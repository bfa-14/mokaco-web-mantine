import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button, Select, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconSend, IconTrash } from '@tabler/icons-react'
import { Modal } from '../../components/dialogs'
import { rosterService } from '../../services/attendanceService'
import { rosterApprovalsService, meService } from '../../services/workflowService'
import { branchesService } from '../../services/hrService'
import { getErrorMessage } from '../../api/errorMessage'
import type { RosterMonthStatus } from '../../types/attendance'
import type { Branch } from '../../types/hr'
import { periodLabel } from './attendanceFormat'

/** The three states the endpoint answers with, folded to one key each. Anything else reads as Draft. */
type MonthState = 'draft' | 'pending' | 'approved'

function stateOf(status: string | null | undefined): MonthState {
  const value = (status ?? '').toLowerCase()
  if (value === 'approved') return 'approved'
  if (value === 'pending') return 'pending'
  return 'draft'
}

/** The accent stripe: neutral while it is nobody's problem, brand while it waits, green when signed. */
const ACCENT: Record<MonthState, string> = {
  draft: 'var(--ink-muted)',
  pending: 'var(--accent)',
  approved: '#4b6b3a',
}

/**
 * WHERE THIS MONTH'S ROSTER HAS GOT TO, for one branch — and the one button that moves it on.
 *
 * The roster grid is a whole month of decisions; this says whether anyone has SIGNED for them.
 * Draft means nobody has asked yet, Pending means a ROSTER_APPROVAL request is open on it,
 * Approved means it has been signed off. Submitting raises exactly the request the New Request
 * form raises — same endpoint, same payload — and then goes straight to it, because the next
 * thing anyone wants after submitting is to see who it is now waiting on.
 *
 * A BRANCH HAD TO BE CHOSEN. The roster grid is company-wide (everyone, down the side), but an
 * approval is per branch — so the branch lives here on the banner rather than filtering the grid
 * behind it, which would change what the page has always shown.
 *
 * IT HIDES ITSELF WHEN IT CANNOT ANSWER. If the status cannot be read — the endpoint is not
 * deployed, the caller may not see it — the banner renders nothing at all rather than an error
 * strip over a roster that is working perfectly well. A banner that cannot say anything true
 * about the month is worth less than the space it occupies.
 */
export function RosterApprovalBanner({
  period,
  canManage,
  onCleared,
}: {
  /** 'yyyy-MM' — the month the grid is showing. */
  period: string
  /** ATTENDANCE_MANAGE. A viewer sees the state and gets no button. */
  canManage: boolean
  /** Called after "Clear roster" succeeded — the grid behind has to refetch its month. */
  onCleared?: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchId] = useState<number | null>(null)
  const [status, setStatus] = useState<RosterMonthStatus | null>(null)
  /** The status could not be read — see the note above about hiding rather than shouting. */
  const [unreadable, setUnreadable] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  /** The server's refusal — "already approved", "already pending" — shown verbatim, on the banner. */
  const [error, setError] = useState<string | null>(null)

  /** "Clear roster": null (closed) → 'confirm' → in flight → a refusal's sentence, or closed. */
  const [clearState, setClearState] = useState<null | { refused: string | null }>(null)
  const [clearing, setClearing] = useState(false)

  /** The month as the endpoint and the request both spell it: its first day. */
  const monthDate = `${period}-01`

  useEffect(() => {
    let cancelled = false
    Promise.all([
      branchesService.getAll().catch(() => [] as Branch[]),
      meService.employee().catch(() => null),
    ]).then(([list, me]) => {
      if (cancelled) return
      const active = list.filter((b) => b.isActive)
      setBranches(active)
      // The reader's own branch is the one they came to look at; with a single branch there is
      // nothing to choose. Neither guess overrides a later, deliberate switch.
      const mine = me != null ? active.find((b) => b.branchId === me.branchId) : null
      const start = mine ?? (active.length === 1 ? active[0] : null)
      if (start) setBranchId((prev) => prev ?? start.branchId)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(() => {
    if (branchId == null) return () => {}
    let cancelled = false
    rosterService
      .monthStatus(branchId, monthDate)
      .then((result) => {
        if (cancelled) return
        // 204 — no header row yet (a fresh month, or one just cleared). That IS a draft: nothing
        // has been asked, so the month shows as such with Submit live, rather than no banner at all.
        setStatus(result ?? { branchId, monthDate, status: 'Draft', requestInstanceId: null })
        setUnreadable(false)
      })
      .catch(() => {
        if (cancelled) return
        setStatus(null)
        setUnreadable(true)
      })
    return () => {
      cancelled = true
    }
  }, [branchId, monthDate])

  useEffect(() => load(), [load])

  async function submit() {
    if (branchId == null) return
    setSubmitting(true)
    setError(null)
    try {
      const created = await rosterApprovalsService.create({ branchId, monthDate })
      // Straight to the request it raised — the chain it is now waiting on is the point.
      navigate(`/requests/${created.requestInstanceId}`)
    } catch (err) {
      // The refusals here are the useful ones ("already approved", "already pending"), so they
      // stay ON the banner rather than passing as a toast. The state is refreshed with them:
      // whoever else moved this month on is exactly what the reader now needs to see.
      setError(getErrorMessage(err))
      load()
    } finally {
      setSubmitting(false)
    }
  }

  async function clearRoster() {
    if (branchId == null) return
    const [year, month] = period.split('-').map(Number)
    setClearing(true)
    try {
      const result = await rosterService.clearMonth(branchId, year, month)
      notifications.show({
        message: t('attendance.rosterApproval.cleared', { count: result.rowsDeleted }),
        color: 'green',
        autoClose: 3000,
      })
      setClearState(null)
      setError(null)
      load()
      onCleared?.()
    } catch (err) {
      // The reason — waiting for approval, approved, attendance already recorded — stays in the
      // dialog the person is looking at, verbatim, rather than fading as a toast.
      setClearState({ refused: getErrorMessage(err) })
    } finally {
      setClearing(false)
    }
  }

  if (branchId == null || unreadable || status == null) return null

  const state = stateOf(status.status)
  const monthName = periodLabel(period)
  const requestId = status.requestInstanceId

  /* WHY "SUBMIT" IS OFF, when it is. Read off the status the guard endpoint now carries:
     a request still open on the month (Pending / OnHold), or an approval nothing has moved since.
     After a rejection, or once anything changed since the approval, there is something new to
     sign for and the button is live. A missing field (older API build) reads as "not blocked" for
     the open-request case and falls back to the month's own state for the approved one — the
     server's 409 is the rule either way; this only says the reason before the click. */
  const openRequestId =
    status.openRequestId ?? (state === 'pending' ? status.requestInstanceId : null)
  const blockedReason =
    openRequestId != null
      ? t('attendance.rosterApproval.blocked.pending', { id: openRequestId })
      : state === 'approved' && status.changedSinceApproval !== true
        ? t('attendance.rosterApproval.blocked.approvedUnchanged')
        : null
  const branchName = branches.find((b) => b.branchId === branchId)?.name ?? ''

  return (
    <div
      className="card"
      style={{ marginBottom: 16, borderInlineStart: `4px solid ${ACCENT[state]}` }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <strong>{t(`attendance.rosterApproval.state.${state}`, { month: monthName })}</strong>
          <div className="hint">{t(`attendance.rosterApproval.hint.${state}`)}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'end', gap: 8, flexWrap: 'wrap' }}>
          {branches.length > 1 && (
            <Select
              aria-label={t('common.branch')}
              data={branches.map((b) => ({ value: String(b.branchId), label: b.name }))}
              value={String(branchId)}
              w={180}
              allowDeselect={false}
              disabled={submitting}
              onChange={(v) => {
                if (v == null) return
                setBranchId(Number(v))
                setError(null)
              }}
            />
          )}

          {canManage && (
            <Tooltip label={blockedReason} disabled={blockedReason == null} withArrow>
              {/* A span so the tooltip still fires over a disabled button. */}
              <span>
                <Button
                  leftSection={<IconSend size={16} />}
                  loading={submitting}
                  disabled={blockedReason != null || clearing}
                  onClick={() => void submit()}
                >
                  {t('attendance.rosterApproval.submit')}
                </Button>
              </span>
            </Tooltip>
          )}

          {canManage && (
            <Button
              variant="default"
              color="red"
              leftSection={<IconTrash size={16} />}
              disabled={submitting}
              onClick={() => setClearState({ refused: null })}
            >
              {t('attendance.rosterApproval.clear')}
            </Button>
          )}

          {(openRequestId ?? (state !== 'draft' ? requestId : null)) != null && (
            <Button
              variant="default"
              onClick={() => navigate(`/requests/${openRequestId ?? requestId}`)}
            >
              {t('attendance.rosterApproval.viewRequest')}
            </Button>
          )}
        </div>
      </div>

      {canManage && blockedReason && (
        <div className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
          {blockedReason}
        </div>
      )}

      {error && (
        <div className="alert alert--error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {/* "Clear roster" — the question, then (if the server says no) its reason, in place. */}
      {clearState && (
        <Modal
          opened
          onClose={() => !clearing && setClearState(null)}
          title={
            clearState.refused
              ? t('attendance.rosterApproval.clearRefusedTitle')
              : t('attendance.rosterApproval.clearTitle', { month: monthName })
          }
          size={480}
          centered
        >
          {clearState.refused ? (
            <>
              <div className="alert alert--error" role="alert">
                {clearState.refused}
              </div>
              <div className="form-actions">
                <Button variant="default" onClick={() => setClearState(null)}>
                  {t('common.close')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                {t('attendance.rosterApproval.clearConfirm', {
                  month: monthName,
                  branch: branchName,
                })}
              </p>
              <div className="form-actions">
                <Button variant="default" onClick={() => setClearState(null)} disabled={clearing}>
                  {t('common.cancel')}
                </Button>
                <Button color="red" loading={clearing} onClick={() => void clearRoster()}>
                  {t('attendance.rosterApproval.clear')}
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  )
}
