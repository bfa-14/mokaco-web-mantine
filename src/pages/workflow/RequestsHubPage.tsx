import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button, Loader, Popover, SegmentedControl, Select } from '@mantine/core'
import { DateRangeField } from '../../components/DateRangeField'
import { useDateRangeParams } from '../../components/useDateRangeParams'
import { notifications } from '@mantine/notifications'
import {
  IconCheck,
  IconLayoutGrid,
  IconLayoutList,
  IconPlus,
  IconRefresh,
} from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { PageHelp } from '../../components/PageHelp'
import { useLive } from '../../live/useLive'
import { useLiveEnabled } from '../../live/useLiveSettings'
import { getErrorMessage } from '../../api/errorMessage'
import { requestsService, chainsService, meService } from '../../services/workflowService'
import type {
  ForUserRequest,
  MySignature,
  RequestCounts,
  RequestType,
  SignatureRequirement,
} from '../../types/workflow'
import { StatusChip, StepChip, TypeDot } from './workflowShared'
import { RequestsGrid } from './RequestsGrid'
import { DEFAULT_HUB_VIEW, hubViewPref } from './hubViewPref'
import { DecidePopup } from './DecidePopup'
import type { HubView } from './hubViewPref'
import { ageing, shortDate, statusLabel } from './workflowFormat'
import { currentLocale } from '../../i18n'
import { arrowReturn } from '../../i18n/physical'
import { referenceName } from '../../i18n/referenceName'
import { t as tr } from '../../i18n/t'

type Tab = 'handle' | 'mine' | 'involved'
type StatusFilter = 'Open' | 'On hold' | 'Approved' | 'Rejected' | 'Cancelled' | 'All'

const STATUS_OPTIONS: StatusFilter[] = [
  'Open',
  'On hold',
  'Approved',
  'Rejected',
  'Cancelled',
  'All',
]

const TABS: Tab[] = ['handle', 'mine', 'involved']

/**
 * THE OPENING QUERY — /requests?tab=handle&type=OVERTIME&status=Open. Read ONCE, from
 * window.location rather than a router hook: these are the state the page STARTS in. The filter
 * bar is authoritative from then on and deliberately does NOT write back. (Unchanged.)
 */
function openingQuery(): URLSearchParams {
  return new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
}

function openingTab(query: URLSearchParams): Tab | null {
  const value = query.get('tab')
  return TABS.find((t) => t === value) ?? null
}

function openingStatus(query: URLSearchParams): StatusFilter | null {
  const value = query.get('status')
  return STATUS_OPTIONS.find((s) => s === value) ?? null
}

/**
 * Translate the status filter into API parameters — "Open" sends no status (Pending+OnHold),
 * "All" sends includeClosed, a named status names itself. Dates apply to CLOSED rows only.
 * (Unchanged.)
 */
function buildOpts(
  status: StatusFilter,
  from: string | null,
  to: string | null,
  typeId: number | null,
) {
  const opts: {
    status?: string
    includeClosed?: boolean
    requestTypeId?: number
    from?: string
    to?: string
  } = {}
  if (status === 'Open') {
    /* no status → Pending + OnHold */
  } else if (status === 'On hold') opts.status = 'OnHold'
  else if (status === 'All') opts.includeClosed = true
  else opts.status = status
  if (from) opts.from = from.slice(0, 10)
  if (to) opts.to = to.slice(0, 10)
  if (typeId != null) opts.requestTypeId = typeId
  return opts
}

/**
 * Slice the one /for-me response into the three tabs. The buckets OVERLAP by design; membership is
 * about how I am attached, never about whether it is my turn — that is WaitingOnMe's job. The
 * API's ORDER IS THE ORDER; only my own drafts are lifted, stably. (Unchanged.)
 */
function bucketize(rows: ForUserRequest[]) {
  const handle = rows
    .filter((r) => r.waitingOnMe)
    .sort((a, b) => Number(b.hasMyDraft ?? false) - Number(a.hasMyDraft ?? false))
  const mine = rows.filter((r) => r.isMine || r.raisedByMe)
  const involved = rows.filter((r) => !r.isMine && !r.raisedByMe)
  return { handle, mine, involved }
}

function statusFilterLabel(value: StatusFilter): string {
  if (value === 'On hold') return statusLabel('OnHold')
  return tr(`workflow.status.${value}`)
}

function firstNonEmpty(b: ReturnType<typeof bucketize>): Tab {
  if (b.handle.length > 0) return 'handle'
  if (b.mine.length > 0) return 'mine'
  if (b.involved.length > 0) return 'involved'
  return 'handle'
}

/** 'yyyy-MM-dd' → "1 Jun", parsed as a local date so it never slips a day. */
function chipDate(d: string): string {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString(currentLocale(), {
    day: 'numeric',
    month: 'short',
  })
}

/** The status wash class for a card — one source of truth: the status. (Unchanged.) */
function statusTintClass(status: string): string {
  switch (status) {
    case 'Pending':
      return 'wf-card--tint-pending'
    case 'OnHold':
      return 'wf-card--tint-onhold'
    case 'Approved':
      return 'wf-card--tint-approved'
    case 'Rejected':
      return 'wf-card--tint-rejected'
    case 'Cancelled':
      return 'wf-card--tint-cancelled'
    default:
      return 'wf-card--tint-cancelled'
  }
}

/**
 * A request card. Open ones are decisions — action buttons, ageing colour. Completed ones are
 * reference — dimmed, no buttons, and if the user acted on it, a line saying what they did.
 * (Unchanged apart from the Mantine button.)
 */
function RequestCard({
  item,
  onDecide,
  onWithdraw,
  onOpen,
  onDelegateDeputy,
  onReclaimDeputy,
}: {
  item: ForUserRequest
  onDecide: () => void
  onWithdraw: () => void
  onOpen: () => void
  /** Hand the CURRENT step to its deputy. Rendered on item.canDelegate and nothing else. */
  onDelegateDeputy: () => void
  /** Take it back. Rendered on item.canReclaim and nothing else. */
  onReclaimDeputy: () => void
}) {
  const { t } = useTranslation()
  /**
   * The "hand it over?" confirm, local to this card.
   *
   * Handing a step to somebody else is not undone by pressing Escape once it has happened, and the
   * button sits beside Decide on a card the whole row is a click target for — so the confirm is
   * doing real work here, not ceremony.
   */
  const [confirmDelegate, setConfirmDelegate] = useState(false)
  const held = item.status === 'OnHold'
  const open = item.status === 'Pending' || held
  const age = ageing(item.daysOpen)
  /**
   * MAY I HAND THIS ONE OVER? The server's canDelegate answers "am I this step's MAIN approver",
   * and that stays true on a request raised FOR me — so it is narrowed here by the rule the Decide
   * button already follows: never on a request I am the subject of, whatever role I hold on its
   * step. isMine is that question answered for this caller ("raised FOR me — I am the employee").
   *
   * Take back is deliberately NOT narrowed: it undoes a delegation that already happened, and a
   * step nobody can reclaim is worse than one that should never have been handed over.
   */
  const canDelegate = item.canDelegate && !item.isMine

  const noteBubble =
    item.noteCount > 0 ? (
      <span className="wf-note-bubble" title={t('requests.card.noteCount', { count: item.noteCount })}>
        💬 {item.noteCount}
      </span>
    ) : null

  if (!open) {
    return (
      <div className={`wf-card wf-card--done ${statusTintClass(item.status)}`} onClick={onOpen}>
        <div className="wf-card-head">
          <span className="wf-card-type">{item.requestTypeName}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {noteBubble}
            <StatusChip status={item.status} />
          </span>
        </div>
        <div className="wf-card-who">
          {item.employeeName} · {item.branchName}
        </div>
        {item.title && <div className="wf-card-payload">{item.title}</div>}
        {item.myStepStatus === 'Approved' && (
          <div className="wf-card-acted wf-card-acted--approved">
            ✓ {t('requests.card.approvedOn', { date: shortDate(item.myActedAt) })}
          </div>
        )}
        {item.myStepStatus === 'Rejected' && (
          <div className="wf-card-acted wf-card-acted--rejected">
            ✗ {t('requests.card.rejectedOn', { date: shortDate(item.myActedAt) })}
            {item.myComment
              ? ` — ${t('requests.card.withComment', { comment: item.myComment })}`
              : ''}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={`${item.waitingOnMe && !held ? age.cardClass : 'wf-card'} ${statusTintClass(item.status)}`}
      onClick={onOpen}
    >
      <div className="wf-card-head">
        <span className="wf-card-type">
          <TypeDot code={item.requestTypeCode} />
          {item.requestTypeName}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {noteBubble}
          {held ? (
            <StatusChip status={item.status} />
          ) : item.waitingOnMe ? (
            <span className={age.labelRed ? 'wf-card-age wf-card-age--red' : 'wf-card-age'}>
              {age.label}
            </span>
          ) : (
            <StatusChip status={item.status} />
          )}
        </span>
      </div>
      <div className="wf-card-who">
        {item.employeeName} · {item.branchName}
      </div>
      {item.title && <div className="wf-card-payload">{item.title}</div>}

      {item.hasMyDraft && (
        <div className="wf-card-draft">
          ✎{' '}
          {item.myDraftDecision
            ? t('requests.card.draftSavedAs', { decision: item.myDraftDecision })
            : t('requests.card.draftSaved')}
        </div>
      )}

      {held && item.holdReason && (
        <div className="wf-card-hold">
          ⏸{' '}
          {t('requests.card.onHold', {
            reason: item.holdReason.slice(0, 48) + (item.holdReason.length > 48 ? '…' : ''),
          })}
          <span className="wf-card-hold-days">
            {' '}
            · {t('common.daysShort', { count: item.daysOpen })}
          </span>
        </div>
      )}

      {!held && item.currentStepName && (
        <div className="wf-card-step">
          {t('requests.card.currentStep')} ·{' '}
          <StepChip stepNo={item.currentStepNo} stepName={item.currentStepName} />
        </div>
      )}

      {/* WITH THE DEPUTY — said on the card, because a request that has stopped moving otherwise
          looks exactly like one nobody has picked up yet. */}
      {item.delegatedToDeputyAt && item.fallbackRoleName && (
        <div className="wf-card-step">
          <span className="wf-deputy-badge">
            {t('requests.card.delegatedTo', { role: item.fallbackRoleName })}
          </span>
        </div>
      )}

      {/* The Decide button follows WaitingOnMe and NOTHING else — the tab decides what is listed;
          WaitingOnMe decides what can act. (Unchanged rule; see the PORT NOTE for where it goes.)

          THE DEPUTY BUTTONS FOLLOW THEIR OWN FLAGS, which is why the row opens on any of the three
          rather than on WaitingOnMe alone: canDelegate and canReclaim ask who the step's MAIN
          approver is, and WaitingOnMe asks who may SIGN — a question that is also true for the
          deputy. Gating the row on WaitingOnMe would hide Take back at exactly the moment the main
          approver wants it. */}
      {(item.waitingOnMe || canDelegate || item.canReclaim) && (
        <div className="wf-card-actions" onClick={(e) => e.stopPropagation()}>
          {item.waitingOnMe && (
            <Button size="sm" onClick={onDecide}>
              {t('requests.card.decide')}
            </Button>
          )}

          {/* OUTLINE, beside Decide: a real alternative to deciding, but the rarer one. The confirm
              names the role it is going to — "delegate to deputy" without saying to WHOM is a
              button people press to find out what it does. */}
          {canDelegate && item.fallbackRoleName && (
            <Popover
              opened={confirmDelegate}
              onChange={setConfirmDelegate}
              position="top"
              withArrow
              shadow="md"
              width={280}
            >
              <Popover.Target>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmDelegate(true)}
                >
                  {t('requests.card.delegateToDeputy')}
                </Button>
              </Popover.Target>
              <Popover.Dropdown onClick={(e) => e.stopPropagation()}>
                <div>
                  {t('requests.card.delegateConfirm', { role: item.fallbackRoleName })}
                </div>
                <p className="hint" style={{ marginTop: 6 }}>
                  {t('requests.card.delegateConfirmHint')}
                </p>
                <div className="form-actions">
                  <Button size="xs" variant="default" onClick={() => setConfirmDelegate(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="xs"
                    onClick={() => {
                      setConfirmDelegate(false)
                      onDelegateDeputy()
                    }}
                  >
                    {t('requests.card.delegateConfirmYes')}
                  </Button>
                </div>
              </Popover.Dropdown>
            </Popover>
          )}

          {/* No confirm on the way back: nothing was signed, and this undoes an act that had one. */}
          {item.canReclaim && (
            <Button size="sm" variant="outline" onClick={onReclaimDeputy}>
              {t('requests.card.takeBackFromDeputy')}
            </Button>
          )}
        </div>
      )}

      {item.iActedOnIt && (
        <div className="wf-step-withdraw" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="wf-withdraw-btn" onClick={onWithdraw}>
            {arrowReturn()} {t('requests.card.changeDecision')}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The Requests hub — everything the user is connected to, in any capacity, with a status/date/type
 * filter bar above three tabs. One /for-me call feeds the tabs; the filter bar reshapes that call.
 */
export default function RequestsHubPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [opening] = useState<URLSearchParams>(openingQuery)

  const [all, setAll] = useState<ForUserRequest[]>([])
  const [counts, setCounts] = useState<RequestCounts | null>(null)
  const [types, setTypes] = useState<RequestType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>(() => openingTab(opening) ?? 'handle')

  const { user } = useAuth()
  const userId = typeof user?.userId === 'number' ? user.userId : null
  const [chosenView, setChosenView] = useState<HubView | null>(() => hubViewPref.get(userId))

  // Per-user view preference, re-read when the signed-in user changes — adjusted during render,
  // the sanctioned shape for state derived from a changed prop. (Unchanged.)
  const [prefUserId, setPrefUserId] = useState<number | null>(userId)
  if (prefUserId !== userId) {
    setPrefUserId(userId)
    setChosenView(hubViewPref.get(userId))
  }

  const view: HubView = chosenView ?? DEFAULT_HUB_VIEW

  const chooseView = useCallback(
    (next: HubView) => {
      setChosenView(next)
      hubViewPref.set(userId, next)
    },
    [userId],
  )

  // Filters — session state only. Dates start EMPTY on purpose; status starts at "All" unless the
  // opening link named one. (Unchanged.)
  const [status, setStatus] = useState<StatusFilter>(() => openingStatus(opening) ?? 'All')
  /* An OPTIONAL period (no parameters = no date filter), kept in the URL so it survives a reload. */
  const { from: fromDate, to: toDate, setRange: setDateRange } = useDateRangeParams(null)
  const [typeId, setTypeId] = useState<number | null>(null)

  /** A ?type=CODE still to be resolved to an id — see the original's note on the raisable fallback. */
  const pendingTypeCode = useRef<string | null>(opening.get('type'))
  const [deepTypeName, setDeepTypeName] = useState<string | null>(null)

  const deepLinkedTab = useRef<boolean>(openingTab(opening) != null)

  /** The request whose Decide dialog is open, or null — everything else lives in DecidePopup. */
  const [decideFor, setDecideFor] = useState<ForUserRequest | null>(null)
  /** One delegation call in flight at a time, across every card on the page. */
  const [deputyBusy, setDeputyBusy] = useState(false)

  /**
   * Whether each to-handle request must be signed, read WITH THE HUB rather than when the dialog
   * opens — being asked for a password at the moment you commit reads as something going wrong.
   */
  const [signatures, setSignatures] = useState<Map<number, SignatureRequirement>>(new Map())

  /** The caller's own signature image, read once — it belongs to the PERSON, not the request. */
  const [mySignature, setMySignature] = useState<MySignature | null>(null)

  // A fact about the person, so read once rather than per card.
  useEffect(() => {
    let cancelled = false
    meService
      .signature()
      .then((s) => {
        if (!cancelled) setMySignature(s)
      })
      .catch(() => {
        /* no image on file is a normal state; it must never stop anyone signing */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const pickedTabOnce = useRef(false)
  const reqSeq = useRef(0)
  const tabRef = useRef<Tab>(tab)
  useEffect(() => {
    tabRef.current = tab
  }, [tab])

  // Types feed the type filter; loaded once. (Unchanged, incl. the raisable fallback for ?type=.)
  useEffect(() => {
    let cancelled = false
    async function loadTypes() {
      const catalogue = await chainsService.getRequestTypes().catch(() => null)
      if (cancelled) return
      if (catalogue) setTypes(catalogue.filter((t) => t.isActive))

      const code = pendingTypeCode.current
      if (!code) return
      pendingTypeCode.current = null

      const fromCatalogue = catalogue?.find((t) => t.code === code)
      if (fromCatalogue) {
        setDeepTypeName(fromCatalogue.name)
        setTypeId(fromCatalogue.requestTypeId)
        return
      }
      const raisable = await chainsService.getRaisableRequestTypes().catch(() => [])
      if (cancelled) return
      const match = raisable.find((t) => t.code === code)
      if (match) {
        setDeepTypeName(match.name)
        setTypeId(match.requestTypeId)
      }
    }
    void loadTypes()
    return () => {
      cancelled = true
    }
  }, [])

  const fetchData = useCallback(
    async (pickTab: boolean) => {
      const seq = ++reqSeq.current
      setLoading(true)
      try {
        const [rows, countData] = await Promise.all([
          requestsService.forMe(buildOpts(status, fromDate, toDate, typeId)),
          // Counts are the TRUE totals, deliberately UNFILTERED. (Unchanged.)
          requestsService.counts().catch(() => null),
        ])
        if (seq !== reqSeq.current) return // a newer fetch superseded this one
        setAll(rows)
        setCounts(countData)
        setError(null)
        const buckets = bucketize(rows)
        if (deepLinkedTab.current) {
          deepLinkedTab.current = false
        } else if (pickTab || (buckets[tabRef.current].length === 0 && rows.length > 0)) {
          const next = firstNonEmpty(buckets)
          setTab(next)
          tabRef.current = next
        }

        // Signature requirements for everything waiting on me, read NOW — so the password field
        // is part of the dialog from its first frame. Only the to-handle rows can open a decision.
        const waiting = rows.filter((r) => r.waitingOnMe)
        const sigs = new Map<number, SignatureRequirement>()
        if (waiting.length > 0) {
          const loaded = await Promise.all(
            waiting.map((r) =>
              requestsService
                .getSignatureRequirement(r.requestInstanceId)
                .then((sig) => [r.requestInstanceId, sig] as const)
                .catch(() => [r.requestInstanceId, null] as const),
            ),
          )
          if (seq !== reqSeq.current) return
          for (const [id, sig] of loaded) if (sig) sigs.set(id, sig)
        }
        setSignatures(sigs)
      } catch (err) {
        if (seq === reqSeq.current) setError(getErrorMessage(err))
      } finally {
        if (seq === reqSeq.current) setLoading(false)
      }
    },
    [status, fromDate, toDate, typeId],
  )

  /**
   * Hand a card’s CURRENT step to its deputy, or take it back.
   *
   * REFETCHES THE HUB rather than patching the row. Delegating changes canDelegate, canReclaim,
   * delegatedToDeputyAt AND waitingOnMe together — and waitingOnMe is what decides whether the
   * card is in "To handle" at all, so a patched row could sit in a tab it no longer belongs to,
   * showing a Decide button the server has just stopped accepting.
   *
   * DECLARED AFTER fetchData deliberately. fetchData is in this callback’s dependency array, and
   * a dependency array is evaluated the moment this line runs — putting this above it would read
   * a const still in its temporal dead zone, which is a crash on first render, not a lint warning.
   *
   * THE REFUSAL IS A RED TOAST: the act is one click from a popover that has already closed, so
   * there is no form left open to put an error into, and the sentence the procedure raises is the
   * whole value of the 400.
   */
  const deputyDelegation = useCallback(
    async (item: ForUserRequest, undo: boolean) => {
      if (deputyBusy || item.currentStepNo == null) return
      setDeputyBusy(true)
      try {
        if (undo) {
          await requestsService.reclaimFromDeputy(item.requestInstanceId, item.currentStepNo)
        } else {
          await requestsService.delegateToDeputy(item.requestInstanceId, item.currentStepNo)
        }
        await fetchData(false)
      } catch (err) {
        notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 5000 })
      } finally {
        setDeputyBusy(false)
      }
    },
    [deputyBusy, fetchData],
  )

  useEffect(() => {
    void fetchData(!pickedTabOnce.current)
    pickedTabOnce.current = true
  }, [fetchData])

  // LIVE: a colleague's decision changes what waits on this user; `false` keeps them on their tab.
  useLive(['workflow'], () => void fetchData(false), useLiveEnabled('workflow'))

  /** Memoised because the grid's dataSource is this array — stable identity per fetch. (Unchanged.) */
  const { handle, mine, involved } = useMemo(() => bucketize(all), [all])
  const rows = tab === 'handle' ? handle : tab === 'mine' ? mine : involved

  const openRequest = useCallback(
    (item: ForUserRequest) => navigate(`/requests/${item.requestInstanceId}`),
    [navigate],
  )

  const anyFilterActive =
    status !== 'All' || fromDate != null || toDate != null || typeId != null
  const dateRangeSet = fromDate != null || toDate != null

  function clearFilters() {
    setStatus('All')
    setDateRange(null, null)
    setTypeId(null)
  }

  function tabButton(key: Tab, label: string, count?: number) {
    return (
      <Button
        variant={tab === key ? 'filled' : 'subtle'}
        size="sm"
        onClick={() => setTab(key)}
      >
        {label}
        {count != null && count > 0 && <span className="wf-badge">{count}</span>}
      </Button>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('requests.title')}</h1>
          <p className="page-subtitle">{t('requests.subtitle')}</p>
        </div>
        <div className="page-head-actions">
          {/* Cards or grid — one click, no reading. SegmentedControl is Mantine's ButtonGroup. */}
          <SegmentedControl
            value={view}
            onChange={(v) => chooseView(v as HubView)}
            data={[
              {
                value: 'card',
                label: (
                  <IconLayoutList size={16} title={t('requests.cardView')} aria-label={t('requests.cardView')} />
                ),
              },
              {
                value: 'grid',
                label: (
                  <IconLayoutGrid size={16} title={t('requests.gridView')} aria-label={t('requests.gridView')} />
                ),
              },
            ]}
          />
          <Button
            variant="default"
            onClick={() => void fetchData(false)}
            leftSection={<IconRefresh size={16} />}
          >
            {t('common.refresh')}
          </Button>
          <Button leftSection={<IconPlus size={16} />} onClick={() => navigate('/requests/new')}>
            {t('requests.newRequest')}
          </Button>
        </div>
      </div>

      <PageHelp>{t('requests.help')}</PageHelp>

      {/* Filter bar. Dates start EMPTY on purpose. */}
      <div className="wf-filter-bar">
        <div className="wf-filter-field">
          <span className="wf-filter-label">{t('requests.filters.status')}</span>
          <Select
            data={STATUS_OPTIONS.map((s) => ({ value: s, label: statusFilterLabel(s) }))}
            value={status}
            w={150}
            onChange={(v) => setStatus((v as StatusFilter) ?? 'All')}
            allowDeselect={false}
          />
        </div>
{/* A FILTER, and one whose two ends were ALREADY nullable and already optional in the query —
            so this is the one sweep site where "cleared" has somewhere to go: both ends null is the
            state the page starts in, and the fetch below already omits the bounds for it. Clearing
            reloads the hub unfiltered, which is why `clearable` is on here and off on the
            attendance toolbars, where the endpoint requires both dates. */}
        <div className="wf-filter-field">
          <span className="wf-filter-label">{t('requests.filters.period')}</span>
          <DateRangeField
            clearable
            w={230}
            from={fromDate}
            to={toDate}
            onChange={setDateRange}
          />
        </div>
        {types.length > 1 && (
          <div className="wf-filter-field">
            <span className="wf-filter-label">{t('requests.filters.type')}</span>
            <Select
              data={types.map((rt) => ({
                value: String(rt.requestTypeId),
                label: referenceName(rt),
              }))}
              value={typeId != null ? String(typeId) : null}
              w={190}
              clearable
              placeholder={t('requests.filters.allTypes')}
              onChange={(v) => setTypeId(v != null ? Number(v) : null)}
            />
          </div>
        )}
      </div>

      {dateRangeSet && (
        <p className="hint" style={{ marginTop: 0 }}>
          {t('requests.filters.datesNote')}
        </p>
      )}

      {anyFilterActive && (
        <div className="wf-chips">
          {status !== 'All' && (
            <span className="wf-chip-filter">
              {statusFilterLabel(status)}
              <button
                type="button"
                aria-label={t('requests.filters.clearStatus')}
                onClick={() => setStatus('All')}
              >
                ×
              </button>
            </span>
          )}
          {fromDate && (
            <span className="wf-chip-filter">
              {t('requests.filters.chipFrom', { date: chipDate(fromDate) })}
              <button
                type="button"
                aria-label={t('requests.filters.clearFrom')}
                onClick={() => setDateRange(null, null)}
              >
                ×
              </button>
            </span>
          )}
          {toDate && (
            <span className="wf-chip-filter">
              {t('requests.filters.chipTo', { date: chipDate(toDate) })}
              <button
                type="button"
                aria-label={t('requests.filters.clearTo')}
                onClick={() => setDateRange(null, null)}
              >
                ×
              </button>
            </span>
          )}
          {typeId != null && (
            <span className="wf-chip-filter">
              {referenceName(types.find((rt) => rt.requestTypeId === typeId)) ||
                deepTypeName ||
                t('requests.filters.typeFallback')}
              <button
                type="button"
                aria-label={t('requests.filters.clearType')}
                onClick={() => setTypeId(null)}
              >
                ×
              </button>
            </span>
          )}
          <button type="button" className="wf-filter-clear" onClick={clearFilters}>
            {t('requests.filters.clearAll')}
          </button>
        </div>
      )}

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {/* Someone put a hold on their own request waiting for THEM — prominent, blue, one click. */}
      {(counts?.needsMyAnswer ?? 0) > 0 && (
        <button
          type="button"
          className="wf-answer-chip"
          onClick={() => {
            setStatus('On hold')
            setTab('mine')
          }}
        >
          ⏸ {t('requests.needsAnswer', { count: counts!.needsMyAnswer })}
        </button>
      )}

      <div className="tab-toolbar wf-tab-toolbar" style={{ gap: 6 }}>
        {tabButton('handle', t('requests.tabs.handle'), counts?.waitingOnMe)}
        {tabButton('mine', t('requests.tabs.mine'))}
        {tabButton('involved', t('requests.tabs.involved'))}
        {(counts?.onHoldWithMe ?? 0) > 0 && (
          <span className="wf-onhold-note">
            {t('requests.onHoldWithYou', { count: counts!.onHoldWithMe })}
          </span>
        )}
      </div>

      {loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : rows.length === 0 ? (
        anyFilterActive ? (
          <div className="card">
            <div className="empty-hint">
              <div className="empty-hint-main">{t('requests.noMatch')}</div>
              <div style={{ marginTop: 10 }}>
                <Button variant="default" onClick={clearFilters}>
                  {t('requests.filters.clearAll')}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <EmptyTab tab={tab} onNew={() => navigate('/requests/new')} />
        )
      ) : view === 'grid' ? (
        // The SAME `rows` the cards would draw — one fetch, one filter pass, one bucketize.
        <RequestsGrid rows={rows} onOpen={openRequest} />
      ) : (
        <div className="wf-cards">
          {rows.map((item) => (
            <RequestCard
              key={item.requestInstanceId}
              item={item}
              onDecide={() => setDecideFor(item)}
              onWithdraw={() => navigate(`/requests/${item.requestInstanceId}`)}
              onOpen={() => navigate(`/requests/${item.requestInstanceId}`)}
              onDelegateDeputy={() => void deputyDelegation(item, false)}
              onReclaimDeputy={() => void deputyDelegation(item, true)}
            />
          ))}
        </div>
      )}

      {/* THE decision dialog — the SAME component the request detail page opens. The only thing
          this caller supplies is what to refresh afterwards. */}
      {decideFor && (
        <DecidePopup
          requestId={decideFor.requestInstanceId}
          requestTypeCode={decideFor.requestTypeCode}
          signature={signatures.get(decideFor.requestInstanceId) ?? null}
          mySignature={mySignature}
          /* A card carries less context than the detail page, so the summary repeats it in full. */
          summary={
            <>
              <strong>{decideFor.requestTypeName}</strong>
              <br />
              {decideFor.employeeName} · {decideFor.branchName}
              {decideFor.title && (
                <>
                  <br />
                  {decideFor.title}
                </>
              )}
            </>
          }
          onClose={() => setDecideFor(null)}
          onDecided={() => fetchData(false)}
        />
      )}
    </div>
  )
}

/** Per-tab empty state for the UNFILTERED view. (Unchanged apart from the Mantine pieces.) */
function EmptyTab({ tab, onNew }: { tab: Tab; onNew: () => void }) {
  const { t } = useTranslation()
  const main = t(`requests.empty.${tab}`)

  return (
    <div className="card">
      <div className="empty-hint">
        {tab === 'handle' && (
          <IconCheck size={30} color="#2f855a" aria-hidden="true" />
        )}
        <div className="empty-hint-main" style={{ marginTop: tab === 'handle' ? 8 : 0 }}>
          {main}
        </div>
        {tab === 'handle' && t('requests.empty.handleHint')}
        {tab === 'mine' && (
          <div style={{ marginTop: 10 }}>
            <Button leftSection={<IconPlus size={16} />} onClick={onNew}>
              {t('requests.newRequest')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
