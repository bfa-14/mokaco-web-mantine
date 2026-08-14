import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ActionIcon, Button, Loader, Modal } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconRefresh } from '@tabler/icons-react'
import { DirectionalIcon } from '../../components/dxIcons'
import { PageHelp } from '../../components/PageHelp'
import { getErrorMessage } from '../../api/errorMessage'
import {
  branchManagerService,
  chainsService,
} from '../../services/workflowService'
import type {
  BranchWithManager,
  RequestType,
  WorkflowDefinition,
  WorkflowStep,
} from '../../types/workflow'
import { chainPopulationLabel } from '../../types/workflow'
import { ChainFlow, StatusChip } from './workflowShared'
import { approverText, shortDate, toFlowSteps } from './workflowFormat'

/**
 * notify(msg, type, ms) → Mantine notifications, adapted once so every call site below
 * stays byte-identical to the original.
 */
function notify(message: string, type: 'success' | 'error', ms: number) {
  notifications.show({ message, color: type === 'success' ? 'green' : 'red', autoClose: ms })
}

/**
 * DevExtreme's `confirm(message, title)` dialog, rebuilt as a promise-backed Mantine Modal
 * so the call site keeps its original `const ok = await …; if (!ok) return` shape.
 * Closing the dialog any other way answers "no".
 */
interface ConfirmState {
  title: string
  message: React.ReactNode
  resolve: (proceed: boolean) => void
}

/**
 * The query parameter that deep-links one type: /workflow/chains?type=OVERTIME.
 *
 * The dashboard's coverage-gap card names the types nobody can raise and links each one here. It
 * cannot link to a chain BUILDER, because the whole complaint is that no chain exists to build on —
 * so it links to the type's card, where "New version" starts one.
 */
const TYPE_QUERY_PARAM = 'type'

function typeCardId(code: string): string {
  return `chain-type-${code}`
}

/** One request type's chains: the active version drawn as a flow, plus its earlier versions. */
function TypeCard({
  type,
  definitions,
  focused,
  onNewVersion,
  onEditDraft,
  onPublish,
  onDelete,
}: {
  type: RequestType
  definitions: WorkflowDefinition[]
  /** Arrived at from a link that named this type — marked so the eye lands on the right card. */
  focused: boolean
  onNewVersion: () => void
  onEditDraft: (definitionId: number) => void
  onPublish: (definitionId: number) => void
  onDelete: (definitionId: number, version: number) => void
}) {
  // There can be MORE THAN ONE active chain per type now — a default plus a management/executive
  // one — and that is normal, not a conflict. Shown lowest population first (everyone, then up).
  const actives = definitions
    .filter((d) => d.status === 'Active')
    .sort((a, b) => (a.minRequesterTier ?? 1) - (b.minRequesterTier ?? 1))
  const others = definitions.filter((d) => d.status !== 'Active')
  const [activeStepsById, setActiveStepsById] = useState<Record<number, WorkflowStep[]>>({})
  const [showOthers, setShowOthers] = useState(false)

  // Retired and draft versions are viewable, not editable: expanding one lazily loads its steps and
  // shows them read-only. GetSteps works for any status, so the same call serves every version here.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set())
  const [otherStepsById, setOtherStepsById] = useState<Record<number, WorkflowStep[]>>({})
  const [loadingStepIds, setLoadingStepIds] = useState<Set<number>>(() => new Set())

  async function toggleExpand(definitionId: number) {
    const wasOpen = expandedIds.has(definitionId)
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(definitionId)) next.delete(definitionId)
      else next.add(definitionId)
      return next
    })
    // Fetch the steps the first time it opens; keep them cached for later toggles.
    if (!wasOpen && !(definitionId in otherStepsById)) {
      setLoadingStepIds((prev) => new Set(prev).add(definitionId))
      try {
        const steps = await chainsService.getSteps(definitionId)
        setOtherStepsById((prev) => ({ ...prev, [definitionId]: steps }))
      } catch {
        // An empty draft simply has no steps; a failed read shows the same "No steps yet." — never an error box.
        setOtherStepsById((prev) => ({ ...prev, [definitionId]: [] }))
      } finally {
        setLoadingStepIds((prev) => {
          const next = new Set(prev)
          next.delete(definitionId)
          return next
        })
      }
    }
  }

  useEffect(() => {
    let cancelled = false
    const activeDefs = definitions.filter((d) => d.status === 'Active')
    Promise.all(
      activeDefs.map(
        async (a) =>
          [
            a.workflowDefinitionId,
            await chainsService.getSteps(a.workflowDefinitionId).catch(() => [] as WorkflowStep[]),
          ] as const,
      ),
    ).then((pairs) => {
      if (!cancelled) setActiveStepsById(Object.fromEntries(pairs))
    })
    return () => {
      cancelled = true
    }
  }, [definitions])

  return (
    <div
      id={typeCardId(type.code)}
      className={focused ? 'card wf-type-card--focus' : 'card'}
      style={{ marginBottom: 16 }}
    >
      <div className="tab-toolbar">
        <div>
          <div className="card-title" style={{ marginBottom: 2 }}>
            {type.name}
          </div>
          <span className="hint">
            {actives.length > 0
              ? `${actives.length} active chain${actives.length === 1 ? '' : 's'}`
              : 'No published chain yet'}
          </span>
        </div>
        <Button
          variant="default"
          leftSection={<IconPlus size={16} />}
          onClick={onNewVersion}
        >
          New version
        </Button>
      </div>

      {actives.length > 0 ? (
        <div className="wf-active-list">
          {actives.map((a) => (
            <div key={a.workflowDefinitionId} className="wf-active-chain">
              {/* Which population this chain serves, tagged — so two active chains read clearly. */}
              <div className="wf-active-head">
                <span className="wf-pop-tag">{chainPopulationLabel(a.minRequesterTier)}</span>
                <span className="hint">
                  v{a.version} · published {shortDate(a.publishedAt)}
                </span>
              </div>
              <ChainFlow steps={toFlowSteps(activeStepsById[a.workflowDefinitionId] ?? [])} />
            </div>
          ))}
        </div>
      ) : (
        <div className="hint">
          Nothing is published, so requests of this type cannot be raised. Create a version
          and publish it.
        </div>
      )}

      {others.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Button variant="subtle" size="xs" onClick={() => setShowOthers((v) => !v)}>
            {showOthers ? 'Hide earlier versions' : `Earlier versions (${others.length})`}
          </Button>
          {showOthers && (
            <div style={{ marginTop: 8 }}>
              {others
                .sort((a, b) => b.version - a.version)
                .map((d) => {
                  const open = expandedIds.has(d.workflowDefinitionId)
                  const steps = otherStepsById[d.workflowDefinitionId]
                  const stepsLoading = loadingStepIds.has(d.workflowDefinitionId)
                  return (
                    <div
                      key={d.workflowDefinitionId}
                      style={{ borderTop: '1px solid var(--border)' }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '6px 0',
                        }}
                      >
                        {/* The version identity is the toggle — click it to view the (read-only) steps. */}
                        <button
                          type="button"
                          onClick={() => void toggleExpand(d.workflowDefinitionId)}
                          aria-expanded={open}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            flex: 1,
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            font: 'inherit',
                            color: 'inherit',
                            cursor: 'pointer',
                            textAlign: 'start',
                          }}
                        >
                          <span
                            aria-hidden
                            className="hint"
                            style={{ width: 12, display: 'inline-block' }}
                          >
                            {open ? '▾' : '▸'}
                          </span>
                          <strong style={{ minWidth: 44 }}>v{d.version}</strong>
                          <StatusChip status={d.status} />
                          <span className="hint">
                            {d.stepCount} step{d.stepCount === 1 ? '' : 's'}
                          </span>
                        </button>
                        {/* Only a Draft is editable or deletable — Active and Retired are history. */}
                        {d.status === 'Draft' && (
                          <>
                            <Button
                              variant="subtle"
                              size="xs"
                              color="gray"
                              onClick={() => onEditDraft(d.workflowDefinitionId)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="subtle"
                              size="xs"
                              onClick={() => onPublish(d.workflowDefinitionId)}
                            >
                              Publish
                            </Button>
                            <Button
                              variant="subtle"
                              size="xs"
                              color="gray"
                              onClick={() => onDelete(d.workflowDefinitionId, d.version)}
                            >
                              Delete
                            </Button>
                          </>
                        )}
                      </div>
                      {open && (
                        <div style={{ padding: '2px 0 10px 24px' }}>
                          {stepsLoading ? (
                            <Loader size={20} />
                          ) : steps && steps.length > 0 ? (
                            <ol className="wf-build-list">
                              {steps.map((s) => (
                                <li key={s.workflowStepId} className="wf-build-step">
                                  <span className="wf-build-num">{s.stepNo}</span>
                                  <div className="wf-build-body">
                                    <div className="wf-build-head">
                                      <span className="wf-build-name">{s.name}</span>
                                      <span className="wf-build-approver">
                                        {approverText({
                                          approverType: s.approverType,
                                          approverRoleName: s.approverRoleName,
                                          resolvedUsername: s.approverUsername,
                                          escalationLevels: s.escalationLevels,
                                        })}
                                      </span>
                                    </div>
                                    {(s.fallbackRoleName ||
                                      s.canAdjust ||
                                      s.requiresComment ||
                                      s.requiresSignature) && (
                                      <div className="wf-build-tags">
                                        {s.fallbackRoleName && (
                                          <span className="wf-build-tag">
                                            deputy: {s.fallbackRoleName}
                                          </span>
                                        )}
                                        {s.canAdjust && (
                                          <span className="wf-build-tag">may adjust</span>
                                        )}
                                        {s.requiresComment && (
                                          <span className="wf-build-tag">comment required</span>
                                        )}
                                        {s.requiresSignature && (
                                          <span className="wf-build-tag">🔒 signed</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <p className="hint" style={{ margin: 0 }}>
                              No steps yet.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ChainsPage() {
  const navigate = useNavigate()
  // The type this page was opened ON, if any. Read once, and held as state rather than a ref because
  // it is consulted DURING render to mark the card — which is what a ref may not be used for.
  const [focusCode] = useState<string | null>(() =>
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get(TYPE_QUERY_PARAM),
  )
  const [types, setTypes] = useState<RequestType[]>([])
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([])
  const [branches, setBranches] = useState<BranchWithManager[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /** The confirm dialog currently on screen, if any — see ConfirmState. */
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  const askConfirm = useCallback(
    (message: React.ReactNode, title: string): Promise<boolean> =>
      new Promise<boolean>((resolve) => setConfirmState({ title, message, resolve })),
    [],
  )

  function settleConfirm(proceed: boolean) {
    confirmState?.resolve(proceed)
    setConfirmState(null)
  }

  const load = useCallback(async () => {
    try {
      const [typeList, defList, branchList] = await Promise.all([
        chainsService.getRequestTypes(),
        chainsService.getDefinitions(),
        branchManagerService.getAll().catch(() => [] as BranchWithManager[]),
      ])
      setTypes(typeList)
      setDefinitions(defList)
      setBranches(branchList)
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Mount-time fetch. load() is async and setStates only after its awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  // Bring the named type into view once its card exists. Every type is listed, so a link that lands
  // at the top of a long page has technically worked and practically has not.
  useEffect(() => {
    if (loading || !focusCode) return
    document
      .getElementById(typeCardId(focusCode))
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [loading, focusCode])

  async function newVersion(requestTypeId: number) {
    try {
      const draft = await chainsService.createDraft(requestTypeId)
      notify(`Draft v${draft.version} created. Add its steps, then publish.`, 'success', 3000)
      navigate(`/workflow/chains/${draft.workflowDefinitionId}`)
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4000)
    }
  }

  async function publish(definitionId: number) {
    try {
      await chainsService.publish(definitionId)
      notify('Published. It is now the chain for new requests; those in progress keep theirs.', 'success', 3500)
      await load()
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4500)
    }
  }

  async function deleteDraft(definitionId: number, version: number) {
    const ok = await askConfirm(
      `Delete draft v${version}? Its steps are discarded. This cannot be undone.`,
      'Delete draft',
    )
    if (!ok) return
    try {
      await chainsService.deleteDraft(definitionId)
      notify('Draft deleted.', 'success', 2500)
      await load()
    } catch (err) {
      // The procedure refuses anything but a Draft — its message is shown verbatim, never generic.
      notify(getErrorMessage(err), 'error', 5000)
    }
  }

  const branchesWithoutManager = branches.filter(
    (b) => b.isActive && b.managerEmployeeId == null,
  )

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Approval chains</h1>
          <p className="page-subtitle">How each kind of request gets approved.</p>
        </div>
        <div className="page-head-actions">
          <ActionIcon
            variant="default"
            size="lg"
            title="Refresh"
            aria-label="Refresh"
            onClick={() => {
              setLoading(true)
              void load()
            }}
          >
            <IconRefresh size={16} />
          </ActionIcon>
        </div>
      </div>

      <PageHelp>
        Approval chains are settings, not code. Changing one publishes a new version.
        Requests already in progress keep the chain they started on.
      </PageHelp>

      <div className="wf-setup-note">
        A published chain is never edited. To change one, create a new version, build its
        steps, and publish it — new requests follow the new chain, and requests already in
        flight keep the one they started on.
      </div>

      {/* The single most likely reason a chain looks broken: a branch with no manager. */}
      {branchesWithoutManager.length > 0 && (
        <div className="card" style={{ borderInlineStart: '4px solid #d69e2e', marginBottom: 16 }}>
          <div className="empty-hint-main">
            {branchesWithoutManager.length} branch
            {branchesWithoutManager.length === 1 ? ' has' : 'es have'} no manager assigned.
          </div>
          <p className="hint" style={{ marginTop: 4 }}>
            Any step that needs a branch manager will be skipped on requests from those
            branches.
          </p>
          <Button
            variant="default"
            leftSection={<DirectionalIcon name="arrowright" size={16} />}
            onClick={() => navigate('/workflow/branch-managers')}
          >
            Assign managers
          </Button>
        </div>
      )}

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : (
        types.map((type) => (
          <TypeCard
            key={type.requestTypeId}
            type={type}
            definitions={definitions.filter((d) => d.requestTypeId === type.requestTypeId)}
            focused={type.code === focusCode}
            onNewVersion={() => void newVersion(type.requestTypeId)}
            onEditDraft={(defId) => navigate(`/workflow/chains/${defId}`)}
            onPublish={(defId) => void publish(defId)}
            onDelete={(defId, version) => void deleteDraft(defId, version)}
          />
        ))
      )}

      {/* The confirm dialog — devextreme/ui/dialog's confirm(), as a Mantine Modal. */}
      {confirmState && (
        <Modal
          opened
          onClose={() => settleConfirm(false)}
          title={confirmState.title}
          size={480}
          centered
        >
          <div>{confirmState.message}</div>
          <div className="form-actions">
            <Button variant="default" onClick={() => settleConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={() => settleConfirm(true)}>OK</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
