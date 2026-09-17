import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ActionIcon,
  Button,
  Checkbox,
  Loader,
  NumberInput,
  Select,
  TextInput,
} from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconPlus } from '@tabler/icons-react'
import { DirectionalIcon } from '../../components/dxIcons'
import { PageHelp } from '../../components/PageHelp'
import { getErrorMessage } from '../../api/errorMessage'
import { chainsService } from '../../services/workflowService'
import { employeesService } from '../../services/hrService'
import { rolesService, usersService } from '../../services/securityService'
import type { Role, UserListItem } from '../../types/security'
import type {
  ApproverRole,
  DefinitionCopySource,
  WorkflowDefinition,
  WorkflowStep,
} from '../../types/workflow'
import { MIN_TIER_EVERYONE } from '../../types/workflow'
import { useApprovalTiers } from '../../hr/useApprovalTiers'
import { approverText } from './workflowFormat'

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

const APPROVER_TYPES = [
  {
    value: 'BranchManager',
    label: 'Branch manager',
    help: 'The manager of the branch the requester belongs to. Managers of other branches cannot sign.',
  },
  {
    value: 'Role',
    label: 'Role',
    help: 'Anyone holding this role, in any branch.',
  },
  {
    value: 'SpecificUser',
    label: 'Specific user',
    help: 'One named person. Avoid: it breaks when they leave.',
  },
  {
    value: 'LineManager',
    label: 'Line manager',
    help: "The requester's own superior, resolved from who they report to. Set how many levels up.",
  },
]

export default function ChainBuilderPage() {
  const { definitionId } = useParams()
  const defId = Number(definitionId)
  const navigate = useNavigate()
  const { t } = useTranslation()

  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null)
  const [steps, setSteps] = useState<WorkflowStep[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [users, setUsers] = useState<UserListItem[]>([])
  // Approver roles WITH their active-member counts — the deputy picker warns from these.
  const [approverRoles, setApproverRoles] = useState<ApproverRole[]>([])
  // The deepest current reporting line, fetched once — a Line-manager step past it skips for everyone.
  // Null while unknown (not yet loaded, or the read failed): treat unknown as "don't warn".
  const [maxDepth, setMaxDepth] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // New-step form.
  const [name, setName] = useState('')
  const [approverType, setApproverType] = useState('BranchManager')
  const [roleId, setRoleId] = useState<number | null>(null)
  const [userId, setUserId] = useState<number | null>(null)
  // For a LineManager step: how many levels up the reporting line (1 = the requester's direct manager).
  const [escalationLevels, setEscalationLevels] = useState<number>(1)
  // Per-step options — all default OFF, exactly what the procedure defaults to when untouched.
  const [canAdjust, setCanAdjust] = useState(false)
  const [requiresComment, setRequiresComment] = useState(false)
  const [requiresSignature, setRequiresSignature] = useState(false)
  const [deputyRoleId, setDeputyRoleId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const nameRef = useRef<string>('')

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

  /* ── Start from an existing chain ──────────────────────────────────────────────────────────
     Read once; the list changes only when someone publishes elsewhere, and a stale entry costs a
     refusal rather than a wrong copy. Memoised where it feeds a control, per the tip-form rules. */
  const [copySources, setCopySources] = useState<DefinitionCopySource[]>([])
  const [copySourceId, setCopySourceId] = useState<number | null>(null)
  const [copying, setCopying] = useState(false)
  /** The API's refusal, verbatim. Cleared on every new attempt and on changing the source. */
  const [copyError, setCopyError] = useState<string | null>(null)
  /**
   * Said after a copy whose SOURCE served a different audience from this draft. Not a warning about
   * a mistake — the copy did exactly what it should — but the one thing about it that is easy to
   * assume wrongly, so it is stated rather than left to be discovered at publish time.
   */
  const [copyAudienceNote, setCopyAudienceNote] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    chainsService
      .getCopySources()
      .then((list) => {
        if (!cancelled) setCopySources(list)
      })
      .catch((err) => {
        // NEVER SWALLOWED. This used to be an empty catch, and the cost was a dropdown reading
        // "No data to display" whether there was genuinely nothing to copy or the request had
        // 404'd against a stale API — two very different problems wearing the same face. Now the
        // reason is on screen, so the next person reads it instead of guessing.
        if (!cancelled) setCopyError(getErrorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const copySource = useMemo(
    () => copySources.find((c) => c.workflowDefinitionId === copySourceId) ?? null,
    [copySources, copySourceId],
  )

  /**
   * A FLAT list, memoised, bound straight from what the fetch resolved.
   *
   * It was grouped — DevExtreme's { key, items } shape with `grouped` — but that is a second thing
   * that can silently render "No data to display" when the shape is a hair off, and it is the one
   * part of this control I cannot see to check. The label now reads
   * "Shift Swap · v1 (active) · Everyone", so it already names its type; grouping was buying
   * ordering the procedure's ORDER BY gives for free, at the price of a failure mode.
   */
  const copySourceItems = useMemo(
    () =>
      copySources.map((c) => ({
        value: String(c.workflowDefinitionId),
        label: c.label,
      })),
    [copySources],
  )

  /**
   * Each row: the label, with its steps beneath as help text. A template, so it is a useCallback —
   * an inline render prop is a new identity every render, which is what makes a template manager
   * rebuild endlessly. Pure: it reads its argument and returns markup, nothing else.
   */
  const renderCopySourceItem = useCallback(
    (item: DefinitionCopySource) => (
      <div className="wf-copy-source-item">
        <div>{item.label}</div>
        {item.stepsPreview && <div className="hint">{item.stepsPreview}</div>}
      </div>
    ),
    [],
  )

  /**
   * Only the "this draft already has steps" refusal may be retried, and only by an explicit press.
   * Every other refusal — published target, self-copy, empty source — is a dead end that Replace
   * would not fix, so offering it there would be a button that lies.
   */
  const canReplace = copyError != null && copyError.includes('already has')

  const onCopySourceChanged = useCallback((value: string | null) => {
    const next = value != null ? Number(value) : null
    setCopySourceId((prev) => (prev === next ? prev : next))
    setCopyError((prev) => (prev === null ? prev : null))
  }, [])

  const load = useCallback(async () => {
    try {
      const [defs, stepList, roleList, userList, approverList, depth] = await Promise.all([
        chainsService.getDefinitions(),
        chainsService.getSteps(defId),
        rolesService.getRoles().catch(() => [] as Role[]),
        usersService.getAll().catch(() => [] as UserListItem[]),
        chainsService.getApprovers().catch(() => [] as ApproverRole[]),
        // Advisory only — a failed read just means no depth warning, never a broken builder.
        employeesService.getOrgMaxDepth().catch(() => null),
      ])
      // Sets definition.minRequesterTier freely — including a value that predates a save still in
      // flight. That is safe BY CONSTRUCTION: once a choice has been made, `tierChoice` is tagged
      // with this defId and outranks this field everywhere it is read (see shownTier). The refetch
      // is ignored by derivation rather than by a flag, so there is no window to get the order wrong.
      setDefinition(defs.find((d) => d.workflowDefinitionId === defId) ?? null)
      setSteps(stepList)
      setRoles(roleList)
      setUsers(userList)
      setApproverRoles(approverList)
      setMaxDepth(depth)
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [defId])

  useEffect(() => {
    // Mount-time fetch. load() is async and setStates only after its awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  /**
   * "APPLIES TO" SETTLES FROM THE SAVE, NEVER FROM A REFETCH.
   *
   * It used to bind straight to definition.minRequesterTier, which made the control show server
   * state and nothing else. Two things then fought the user: the chosen value was not visible until
   * the PUT came back (so the box appeared to snap straight back), and any refetch that was already
   * in flight — addStep() calls load(), which re-reads every definition — could land afterwards and
   * put the PRE-SAVE value back for good. People learned to pick the value repeatedly and fast.
   *
   * So the chosen value is held HERE, tagged with the definition it belongs to, and it wins over
   * anything a refetch brings in. Tagging rather than clearing on navigation means no reset effect:
   * open a different chain and the tag stops matching, so the override simply stops applying.
   */
  const [tierChoice, setTierChoice] = useState<{ defId: number; value: number } | null>(null)
  const [tierSaving, setTierSaving] = useState(false)

  /**
   * The tier dictionary, for the "Applies to" control and the subtitle that echoes it.
   *
   * The options are the default population followed by every tier in seniority order — tier 1, the
   * head, first. Previously this was a fixed three-entry constant naming tiers 2 and 3, so a
   * renamed tier, a new one, or the fourth a company actually uses could never be chosen here.
   */
  const { options: tierOptions, populationLabel } = useApprovalTiers()
  const appliesToOptions = [
    { value: String(MIN_TIER_EVERYONE), label: t('workflow.tiers.everyoneDefault') },
    ...tierOptions,
  ]
  /** The API's refusal, shown verbatim beside the control that just reverted. */
  const [tierError, setTierError] = useState<string | null>(null)
  /**
   * In-flight flag read synchronously, so a second change cannot start before the first has
   * finished writing. A ref and not state because it must be true for the rest of THIS tick — a
   * state update would not be visible to the re-entrant onValueChanged that follows immediately.
   */
  const savingTier = useRef(false)

  /**
   * WHAT THE CONTROL SHOWS. The tagged local choice outranks the fetched definition, which is what
   * makes a refetch harmless: from the instant a choice is made (before the PUT is even sent) the
   * tag matches this defId and the server field stops being consulted. On a fresh page load there
   * is no choice yet, so it falls back to what was actually persisted — which is what proves the
   * save stuck rather than merely looking like it did.
   *
   * 0 stands for "everyone" (null server-side) so the select has a real key to bind to. `??` and
   * not `||`, because 0 is a legitimate choice and must not fall through to the server value.
   */
  const shownTier =
    tierChoice?.defId === defId ? tierChoice.value : (definition?.minRequesterTier ?? 0)

  async function changeMinTier(selected: number) {
    // Re-entrancy guard. DevExtreme raised onValueChanged for PROGRAMMATIC changes too, so the
    // optimistic set below and the revert both echoed back through here; neither is a new instruction.
    if (savingTier.current || selected === shownTier) return

    const previous = shownTier
    savingTier.current = true
    setTierSaving(true)
    setTierError(null)
    // Optimistic: the choice is on screen immediately, and the control is disabled below while the
    // PUT is in flight, so nothing can be typed over a save that has not landed.
    setTierChoice({ defId, value: selected })

    try {
      const res = await chainsService.setMinTier(defId, selected === 0 ? null : selected)
      // BOUND FROM THE RESPONSE — the endpoint returns what it actually stored, so this is the one
      // authoritative value. No refetch of the draft for this control, and no remount.
      setTierChoice({ defId, value: res.minRequesterTier ?? 0 })
      // Keep the definition in step so the rest of the page agrees, without re-reading anything.
      setDefinition((d) => (d ? { ...d, minRequesterTier: res.minRequesterTier } : d))
    } catch (err) {
      // Revert to exactly what was there before, and say why right next to the control — a value
      // that jumps back with no explanation reads as the bug this replaced.
      setTierChoice({ defId, value: previous })
      // Draft-only: a published version refuses with a message that says to draft a new version.
      setTierError(getErrorMessage(err))
    } finally {
      savingTier.current = false
      setTierSaving(false)
    }
  }

  /**
   * Copy the chosen chain's steps in. Called first with replace=false — the refusal that comes back
   * when the draft already has steps is what earns the Replace button, so the destructive option is
   * never the first thing offered.
   *
   * On success the whole draft is REFETCHED rather than patched: the copied steps land with all
   * their options, and "The chain so far" must show what is actually stored, not what was sent.
   */
  async function copySteps(replaceExisting: boolean) {
    if (copySourceId == null) return
    setCopying(true)
    setCopyError(null)
    setCopyAudienceNote(null)
    try {
      // Captured BEFORE the reload clears the selection — it is the source's audience, and the
      // source is about to stop being selected.
      const sourceAppliesTo = copySource?.appliesTo ?? null
      const draftAppliesTo = populationLabel(shownTier === MIN_TIER_EVERYONE ? null : shownTier)

      const result = await chainsService.copyStepsFrom(defId, copySourceId, replaceExisting)
      await load()
      setCopySourceId(null)

      // APPLIES-TO IS NEVER COPIED. When the two differ, say so once, plainly — the steps arriving
      // unchanged makes it very easy to assume the audience arrived with them.
      if (sourceAppliesTo && sourceAppliesTo !== draftAppliesTo) {
        setCopyAudienceNote(
          `Copied from a chain for ${sourceAppliesTo}. This draft applies to ${draftAppliesTo} — ` +
            'the steps came along, the audience did not.',
        )
      }
      notify(
        result.stepsReplaced > 0
          ? `Replaced ${result.stepsReplaced} step(s) with ${result.stepsCopied} copied step(s).`
          : `Copied ${result.stepsCopied} step(s). Edit them freely — the other chain is untouched.`,
        'success',
        4000,
      )
    } catch (err) {
      // Verbatim, and kept ON the control: "This draft already has 2 step(s). Copying replaces
      // them." is the sentence the Replace button is answering.
      setCopyError(getErrorMessage(err))
    } finally {
      setCopying(false)
    }
  }

  async function addStep() {
    if (!name.trim()) {
      notify('Give the step a name.', 'error', 3000)
      return
    }
    if (approverType === 'Role' && roleId == null) {
      notify('Pick the role for this step.', 'error', 3000)
      return
    }
    if (approverType === 'SpecificUser' && userId == null) {
      notify('Pick the user for this step.', 'error', 3000)
      return
    }

    setAdding(true)
    try {
      await chainsService.addStep(defId, {
        stepNo: steps.length + 1,
        name: name.trim(),
        approverType,
        approverRoleId: approverType === 'Role' ? roleId : null,
        approverUserId: approverType === 'SpecificUser' ? userId : null,
        isMandatory: true,
        // A LineManager step carries how many levels up to climb; every other type sends null.
        escalationLevels: approverType === 'LineManager' ? escalationLevels : null,
        // The four per-step options, straight from the form. All default off / no deputy — exactly
        // what the procedure defaults to — so an untouched form adds a plain endorsing step.
        deputyRoleId,
        canAdjust,
        requiresComment,
        requiresSignature,
      })
      setName('')
      setRoleId(null)
      setUserId(null)
      setEscalationLevels(1)
      setCanAdjust(false)
      setRequiresComment(false)
      setRequiresSignature(false)
      setDeputyRoleId(null)
      nameRef.current = ''
      await load()
    } catch (err) {
      // The engine refuses this on a published version, and refuses a deputy role with no active
      // members ("… could never sign anything") — that message comes through here verbatim.
      notify(getErrorMessage(err), 'error', 5000)
    } finally {
      setAdding(false)
    }
  }

  async function publish() {
    const ok = await askConfirm(
      <>
        This becomes the chain for NEW requests from now on.
        <br />
        <br />
        Requests already in progress keep the chain they started on — you can move them
        individually from “Requests on old chains”.
      </>,
      'Publish this chain?',
    )
    if (!ok) return

    try {
      await chainsService.publish(defId)
      notify('Published.', 'success', 2500)
      navigate('/workflow/chains')
    } catch (err) {
      notify(getErrorMessage(err), 'error', 4500)
    }
  }

  if (loading) {
    return (
      <div className="page-loading">
        <Loader size={40} />
      </div>
    )
  }

  const isDraft = definition?.status === 'Draft'
  const chosen = APPROVER_TYPES.find((t) => t.value === approverType)
  const deputy = approverRoles.find((r) => r.roleId === deputyRoleId) ?? null

  return (
    <div>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Back"
            onClick={() => navigate('/workflow/chains')}
          >
            <DirectionalIcon name="back" size={16} />
          </ActionIcon>
          <div>
            <h1 className="page-title">Chain builder</h1>
            <p className="page-subtitle">
              {definition
                ? // shownTier, not definition.minRequesterTier: one source of truth, so the subtitle
                  // cannot disagree with the dropdown while a save is in flight.
                  `${definition.requestTypeName} · v${definition.version} · ${definition.status} · ${populationLabel(shownTier === MIN_TIER_EVERYONE ? null : shownTier)}`
                : ''}
            </p>
          </div>
        </div>

        {/* Applies to — which population this DRAFT chain serves, editable next to the version. Only
            on a draft (the tier is frozen at publish); a published version shows it read-only in the
            subtitle above. */}
        {isDraft && definition && (
          <div className="wf-applies-to">
            <label className="form-label" htmlFor="wf-applies-to">
              Applies to
            </label>
            <Select
              id="wf-applies-to"
              // Built from the dictionary, in seniority order (tier 1 — the head — first), with
              // the default population at the top. No tier is named in this file.
              data={appliesToOptions}
              // The local choice, which outranks anything a refetch brings in — see changeMinTier.
              value={String(shownTier)}
              w={260}
              allowDeselect={false}
              // Disabled for the length of the PUT: a second change mid-save would desync the
              // control's own value from the one being written.
              disabled={tierSaving}
              onChange={(v) => void changeMinTier(v != null ? Number(v) : MIN_TIER_EVERYONE)}
            />
            <p className="hint" style={{ marginTop: 6 }}>
              {t('workflow.tiers.minTierHelp')}
            </p>
            {tierSaving && <div className="hint">Saving…</div>}
            {tierError && (
              <div className="wf-applies-to-error" role="alert">
                {tierError}
              </div>
            )}
          </div>
        )}
      </div>

      <PageHelp>
        Steps run in order. Each one names a KIND of approver, not a person, so the chain
        keeps working when people change roles.
      </PageHelp>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {/* A published version is read-only — no builder controls at all. */}
      {!isDraft && definition && (
        <div className="wf-setup-note">
          This version is <strong>{definition.status}</strong> and cannot be edited. To
          change the chain, create a new version from the Approval chains page.
        </div>
      )}

      {/* Live preview — each step with its options as small tags, so the whole chain can be read
          and checked before publishing. A step with no options shows no tags at all; a clean row is
          the common case and should look clean. */}
      <div className="card">
        <div className="card-title">The chain so far</div>
        {steps.length === 0 ? (
          <p className="hint" style={{ marginBottom: 0 }}>
            No steps yet. A chain needs at least one before it can be published.
          </p>
        ) : (
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
                        <span className="wf-build-tag">deputy: {s.fallbackRoleName}</span>
                      )}
                      {s.canAdjust && <span className="wf-build-tag">may adjust</span>}
                      {s.requiresComment && (
                        <span className="wf-build-tag">comment required</span>
                      )}
                      {s.requiresSignature && <span className="wf-build-tag">🔒 signed</span>}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* START FROM AN EXISTING CHAIN — above "Add a step", because it is the thing you do FIRST or
          not at all. Offered only on a draft; a published version cannot take steps at all. */}
      {isDraft && definition && (
        <div className="card" style={{ marginTop: 16, maxWidth: 560 }}>
          <div className="card-title">
            Start from an existing chain <span className="form-optional">(optional)</span>
          </div>

          <div className="form-field">
            <Select
              data={copySourceItems}
              value={copySourceId != null ? String(copySourceId) : null}
              // Each row shows its steps beneath the label — see renderCopySourceItem.
              renderOption={({ option }) => {
                const item =
                  copySources.find((c) => String(c.workflowDefinitionId) === option.value) ?? null
                return item ? renderCopySourceItem(item) : option.label
              }}
              searchable
              nothingFoundMessage="No chains with steps to copy from yet."
              placeholder="Choose a chain to copy…"
              disabled={copying}
              onChange={onCopySourceChanged}
            />
            {/* The chosen chain's steps, in a line — what you are about to get, before you get it. */}
            {copySource?.stepsPreview && (
              <div className="hint">{copySource.stepsPreview}</div>
            )}
          </div>

          {/* The semantics, verbatim and always visible — not behind a tooltip. Someone deciding
              whether to copy is deciding exactly this question. */}
          <p className="hint" style={{ marginTop: 0 }}>
            This copies the steps. Later changes to either chain do not affect the other.
          </p>

          {/* Amber, not red: the copy SUCCEEDED. This is the one thing about it worth saying out loud. */}
          {copyAudienceNote && (
            <div className="wf-balance-warn" role="status">
              {copyAudienceNote}
            </div>
          )}

          {copyError && (
            <div className="alert alert--error" role="alert">
              {copyError}
              {/* The refusal that means "you already have steps" is the only one worth offering a
                  way past — and only as a deliberate second act, never as an automatic retry. */}
              {canReplace && (
                <div style={{ marginTop: 8 }}>
                  <Button
                    variant="outline"
                    color="red"
                    disabled={copying}
                    onClick={() => void copySteps(true)}
                  >
                    {copying ? 'Replacing…' : 'Replace existing steps'}
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="form-actions">
            <Button
              variant="default"
              disabled={copying || copySourceId == null}
              onClick={() => void copySteps(false)}
            >
              {copying ? 'Copying…' : 'Copy steps'}
            </Button>
          </div>
        </div>
      )}

      {isDraft && (
        <div className="card" style={{ marginTop: 16, maxWidth: 560 }}>
          <div className="card-title">Add a step</div>
          <div className="form-field">
            <label className="form-label">Step name</label>
            <TextInput
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="e.g. HR approval"
              disabled={adding}
            />
          </div>

          <div className="form-field">
            <label className="form-label">Approver</label>
            <Select
              data={APPROVER_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              value={approverType}
              allowDeselect={false}
              disabled={adding}
              onChange={(v) => setApproverType(v ?? 'BranchManager')}
            />
            {/* Explain the choice where it is made, not on a help page. */}
            {chosen && <div className="hint">{chosen.help}</div>}
            {/* Rejection behaviour is no longer a per-step choice — it lives on the role now. */}
            {approverType === 'Role' && (
              <div className="hint">A rejection here follows this role's setting — see Settings.</div>
            )}
          </div>

          {approverType === 'Role' && (
            <div className="form-field">
              <label className="form-label">Which role</label>
              <Select
                data={roles.map((r) => ({ value: String(r.roleId), label: r.name }))}
                value={roleId != null ? String(roleId) : null}
                allowDeselect={false}
                disabled={adding}
                onChange={(v) => setRoleId(v != null ? Number(v) : null)}
              />
            </div>
          )}

          {approverType === 'SpecificUser' && (
            <div className="form-field">
              <label className="form-label">Which user</label>
              <Select
                data={users.map((u) => ({ value: String(u.userId), label: u.username }))}
                value={userId != null ? String(userId) : null}
                searchable
                allowDeselect={false}
                disabled={adding}
                onChange={(v) => setUserId(v != null ? Number(v) : null)}
              />
            </div>
          )}

          {approverType === 'LineManager' && (
            <div className="form-field">
              <label className="form-label" htmlFor="wf-levels">
                Level
              </label>
              <NumberInput
                id="wf-levels"
                value={escalationLevels}
                min={1}
                max={10}
                w={120}
                disabled={adding}
                onChange={(v) => setEscalationLevels(typeof v === 'number' ? v : 1)}
              />
              <div className="hint">
                1 = the requester's direct manager, 2 = their manager's manager, and so on.
              </div>
              {/* Advisory, never a block: a chain built for a taller org is legal — the engine skips
                  the step harmlessly today. Only warns when we actually know the depth. */}
              {maxDepth != null && escalationLevels > maxDepth && (
                <div className="wf-setup-note wf-setup-note--warn" role="status">
                  The deepest reporting line is {maxDepth} level{maxDepth === 1 ? '' : 's'}. At level{' '}
                  {escalationLevels} this step will skip for every current employee.
                </div>
              )}
            </div>
          )}

          {/* The per-step options the procedure accepts. Each explains what it does and when to leave
              it off, so the choice is made with its consequence in view. */}
          <div className="form-field wf-step-option">
            <Checkbox
              checked={canAdjust}
              label="May adjust the requested figure"
              disabled={adding}
              onChange={(e) => setCanAdjust(e.currentTarget.checked)}
            />
            <div className="hint">
              This approver can grant less than was asked (e.g. 120 of 180 minutes). Steps that only
              endorse should leave this off.
            </div>
          </div>

          <div className="form-field wf-step-option">
            <Checkbox
              checked={requiresComment}
              label="A comment is required with every decision here"
              disabled={adding}
              onChange={(e) => setRequiresComment(e.currentTarget.checked)}
            />
            <div className="hint">
              Otherwise a comment is only forced when something is changed or rejected.
            </div>
          </div>

          <div className="form-field wf-step-option">
            <Checkbox
              checked={requiresSignature}
              label="Every decision at this step must be signed with a password"
              disabled={adding}
              onChange={(e) => setRequiresSignature(e.currentTarget.checked)}
            />
            <div className="hint">
              Whoever signs, regardless of their role's own signature setting. Use for the final step
              of high-stakes chains. Role-based signing is configured in Settings and still applies
              either way.
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">
              Deputy role <span className="form-optional">(optional)</span>
            </label>
            <Select
              // "{Name} ({n} members)" — the member count is the whole point of this list, so it is
              // shown on every option, not only in the warning after one is picked.
              data={approverRoles.map((r) => ({
                value: String(r.roleId),
                label: `${r.name} (${r.activeMemberCount} member${r.activeMemberCount === 1 ? '' : 's'})`,
              }))}
              value={deputyRoleId != null ? String(deputyRoleId) : null}
              placeholder="Select a role…"
              clearable
              disabled={adding}
              onChange={(v) => setDeputyRoleId(v != null ? Number(v) : null)}
              // Independent of the chosen Approver type — a deputy can back any step.
              nothingFoundMessage="No roles are marked usable as an approver yet — set that on the Roles page."
            />
            <div className="hint">
              Anyone with this role can also sign this step, whoever it normally goes to. Leave empty
              for no deputy.
            </div>
            {/* Warn from the role's active-member count. Zero is fatal — the API refuses the add —
                so it reads as an error; one is a fragility worth flagging, not blocking. */}
            {deputy && deputy.activeMemberCount === 0 && (
              <div className="wf-setup-note wf-setup-note--warn">
                Nobody holds this role, so nobody could ever sign as deputy. The chain builder will
                refuse it — give the role a member first, or choose another.
              </div>
            )}
            {deputy && deputy.activeMemberCount === 1 && (
              <div className="hint">Only one person holds this role.</div>
            )}
          </div>

          <div className="form-actions">
            <Button
              variant="default"
              leftSection={<IconPlus size={16} />}
              onClick={() => void addStep()}
              disabled={adding}
            >
              {adding ? 'Adding…' : 'Add step'}
            </Button>
          </div>
        </div>
      )}

      {isDraft && (
        <div className="grid-actions" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <Button
            leftSection={<IconCheck size={16} />}
            onClick={() => void publish()}
            disabled={steps.length === 0}
          >
            Publish this chain
          </Button>
        </div>
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
