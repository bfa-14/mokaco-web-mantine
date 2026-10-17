import { useCallback, useMemo, useState } from 'react'
import { ApiError } from '../../api/client'
import { getErrorMessage } from '../../api/errorMessage'
import { autoRosterService } from '../../services/autoRosterService'
import type {
  AutoRosterCommitCell,
  AutoRosterCommitResult,
  AutoRosterCommitRhythm,
  AutoRosterIssue,
  AutoRosterPreview,
  AutoRosterRequest,
  AutoRosterSetup,
  AutoRosterSummary,
} from '../../types/attendance'
import { periodRange } from './attendanceFormat'
import {
  applyEditTo,
  draftKey,
  editsToDraftCells,
  isFrozenOrigin,
  isSentCell,
  mergeEdit,
} from './rosterDraftCells'
import type { DraftCell, DraftEdit } from './rosterDraftCells'

/**
 * THE AUTO-ROSTER DRAFT: a preview drawn over the roster grid, edited there, saved in one call.
 *
 * Nothing in here writes a roster row until `commit`. The preview's cells cover the whole Monday–
 * Sunday window (the planner works in whole weeks); the grid draws only the month's, and only the
 * month's are ever sent back. The manager's edits are kept apart from the plan (`edits`) because
 * they outlive it: Regenerate sends them as draftCells, the planner treats each as fixed, and they
 * are laid over whatever comes back, so the button that fills in the rest never undoes a hand edit.
 */

export { draftKey } from './rosterDraftCells'
export type { DraftCell, DraftEdit } from './rosterDraftCells'

interface DraftState {
  request: AutoRosterRequest
  preview: AutoRosterPreview
  cells: Map<string, DraftCell>
  monthFrom: string
  monthTo: string
  /** The preview's issues — or, after a refused save, the ones the server refused it for. */
  issues: AutoRosterIssue[]
  /** `issues` are the refused save's, not the preview's. */
  refused: boolean
}

export interface RosterDraft {
  /** A preview is open over the grid. */
  active: boolean
  request: AutoRosterRequest | null
  preview: AutoRosterPreview | null
  cells: Map<string, DraftCell>
  issues: AutoRosterIssue[]
  /** The issues are the ones a save was refused for (400), not the preview's. */
  issuesFromSave: boolean
  /** The draft's effect on the month's rows, recounted after every edit. */
  summary: AutoRosterSummary
  /** Hand edits in this draft (they survive Regenerate). */
  editCount: number
  /** Edited since the last preview: the issues and the server's counters do not know about it yet. */
  editedSincePreview: boolean
  busy: 'preview' | 'commit' | null
  /** The last refusal, verbatim. */
  error: string | null
  clearError: () => void
  /** Run a preview for these options. Keeps the hand edits when it is the same branch and month. */
  start: (request: AutoRosterRequest) => Promise<boolean>
  regenerate: () => Promise<boolean>
  /** Apply the Set-day dialog to these keys. Frozen cells and cells the plan does not cover are skipped. */
  applyEdit: (keys: string[], edit: DraftEdit) => { applied: number; skipped: number }
  commit: (setup: AutoRosterSetup | null) => Promise<AutoRosterCommitResult | null>
  discard: () => void
}

export function useRosterDraft(): RosterDraft {
  const [state, setState] = useState<DraftState | null>(null)
  const [edits, setEdits] = useState<Map<string, DraftEdit>>(new Map())
  const [editedSincePreview, setEditedSincePreview] = useState(false)
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (request: AutoRosterRequest, keptEdits: Map<string, DraftEdit>): Promise<boolean> => {
      setBusy('preview')
      setError(null)
      try {
        const sent: AutoRosterRequest = { ...request, draftCells: editsToDraftCells(keptEdits) }
        const preview = await autoRosterService.preview(sent)
        const { from, to } = periodRange(request.month)
        const cells = new Map<string, DraftCell>()
        for (const cell of preview.cells) {
          const key = draftKey(cell.employeeId, cell.workDate)
          cells.set(key, {
            employeeId: cell.employeeId,
            workDate: cell.workDate.slice(0, 10),
            state: cell.state,
            shiftId: cell.shiftId ?? null,
            origin: cell.origin,
            change: cell.change,
            reasonCode: cell.reasonCode ?? null,
            reasonArgs: cell.reasonArgs ?? null,
            expected: cell.expected ?? { exists: false },
            edited: false,
            isPinned: null,
            previewState: cell.state,
          })
        }
        // The plan already holds the edits (sent as draftCells); laying them over again is what keeps
        // the screen and the save honest if the planner ever answered a day differently.
        for (const [key, edit] of keptEdits) {
          const cell = cells.get(key)
          if (cell && !isFrozenOrigin(cell.origin)) cells.set(key, applyEditTo(cell, edit))
        }
        setState({ request, preview, cells, monthFrom: from, monthTo: to, issues: preview.issues ?? [], refused: false })
        setEdits(keptEdits)
        setEditedSincePreview(false)
        return true
      } catch (err) {
        setError(getErrorMessage(err))
        return false
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  const start = useCallback(
    (request: AutoRosterRequest) => {
      const sameMonth =
        state != null &&
        state.request.branchId === request.branchId &&
        state.request.month === request.month
      return run(request, sameMonth ? edits : new Map())
    },
    [state, edits, run],
  )

  const regenerate = useCallback(async () => {
    if (!state) return false
    return run(state.request, edits)
  }, [state, edits, run])

  const applyEdit = useCallback(
    (keys: string[], edit: DraftEdit) => {
      // A Regenerate or Save in flight replaces the cells and the edits with what it started from
      // when it returns, so an edit made meanwhile would vanish without a word. The page does not
      // offer the grid then; this is the same rule, for any other caller.
      if (!state || busy != null) return { applied: 0, skipped: keys.length }
      const cells = new Map(state.cells)
      const nextEdits = new Map(edits)
      let applied = 0
      for (const key of keys) {
        const cell = cells.get(key)
        const inMonth = cell != null && cell.workDate >= state.monthFrom && cell.workDate <= state.monthTo
        if (!cell || !inMonth || isFrozenOrigin(cell.origin)) continue
        cells.set(key, applyEditTo(cell, edit))
        nextEdits.set(key, mergeEdit(edits.get(key), edit))
        applied++
      }
      if (applied > 0) {
        setState({ ...state, cells })
        setEdits(nextEdits)
        setEditedSincePreview(true)
      }
      return { applied, skipped: keys.length - applied }
    },
    [state, edits, busy],
  )

  const commit = useCallback(
    async (setup: AutoRosterSetup | null): Promise<AutoRosterCommitResult | null> => {
      if (!state) return null
      const { request, preview, monthFrom, monthTo } = state

      /* THE CELLS: every month cell the plan may write, as it stands now. "kept" cells (facts, locked,
         pinned, an existing row inside a leave) are never sent — unless the manager edited a fact,
         which makes it theirs. An EMPTY leave day is sent: it gets its working row (D5). An unchanged
         PLANNED cell is sent too: nothing is written to the row, but the server records it as the
         generator's value, so the next "re-plan generated days" may move it. */
      const cells: AutoRosterCommitCell[] = []
      for (const cell of state.cells.values()) {
        if (!isSentCell(cell, monthFrom, monthTo)) continue
        cells.push({
          employeeId: cell.employeeId,
          workDate: cell.workDate,
          action: cell.state === 'none' ? 'delete' : 'upsert',
          shiftId: cell.state === 'work' ? cell.shiftId : null,
          isRestDay: cell.state === 'rest',
          expected: cell.expected,
          isAuto: !cell.edited && cell.origin !== 'draft' && cell.origin !== 'fact',
          reasonCode: cell.edited ? null : cell.reasonCode,
          isPinned: cell.isPinned,
        })
      }

      /* THE RHYTHMS: new or re-anchored ones from the plan, and every on-rotation flag the drawer
         changed. Someone taken off rotation who has never had a rhythm is stored with the flag alone
         (no anchor); if they come back, the next preview starts them on a 6-day week. */
      const off = new Set(request.offRotationEmployeeIds)
      const stored = new Map((setup?.staff ?? []).map((s) => [s.employeeId, s]))
      const rhythm: AutoRosterCommitRhythm[] = []
      for (const r of preview.rhythm ?? []) {
        const onRotation = !off.has(r.employeeId)
        const flagChanged = (stored.get(r.employeeId)?.onRotation ?? true) !== onRotation
        if (r.isNew || flagChanged) {
          rhythm.push({
            employeeId: r.employeeId,
            anchorWeekStart: r.anchorWeekStart.slice(0, 10),
            anchorWorkDays: r.anchorWorkDays,
            onRotation,
          })
        }
      }
      for (const employeeId of off) {
        if (rhythm.some((r) => r.employeeId === employeeId)) continue
        const staff = stored.get(employeeId)
        if (staff && !staff.onRotation) continue
        const anchorWeekStart = staff?.anchorWeekStart?.slice(0, 10)
        rhythm.push(
          anchorWeekStart && staff?.anchorWorkDays
            ? { employeeId, anchorWeekStart, anchorWorkDays: staff.anchorWorkDays, onRotation: false }
            : { employeeId, onRotation: false },
        )
      }

      setBusy('commit')
      setError(null)
      try {
        const result = await autoRosterService.commit({
          ...request,
          draftCells: editsToDraftCells(edits),
          cells,
          rhythm,
        })
        setState(null)
        setEdits(new Map())
        setEditedSincePreview(false)
        return result
      } catch (err) {
        /* A 400 carries the rule the cells break ({ error, issues }); those issues replace the
           preview's in the card, so the manager sees exactly what the save was refused for. */
        if (err instanceof ApiError && err.data && typeof err.data === 'object') {
          const refused = (err.data as { issues?: AutoRosterIssue[] }).issues
          if (Array.isArray(refused) && refused.length > 0) {
            setState((current) => (current ? { ...current, issues: refused, refused: true } : current))
          }
        }
        setError(getErrorMessage(err))
        return null
      } finally {
        setBusy(null)
      }
    },
    [state, edits],
  )

  const discard = useCallback(() => {
    setState(null)
    setEdits(new Map())
    setEditedSincePreview(false)
    setError(null)
  }, [])

  const summary = useMemo<AutoRosterSummary>(() => {
    const counts: AutoRosterSummary = { inserts: 0, updates: 0, deletes: 0, unchanged: 0, kept: 0 }
    if (!state) return counts
    for (const cell of state.cells.values()) {
      if (cell.workDate < state.monthFrom || cell.workDate > state.monthTo) continue
      if (cell.change === 'insert') counts.inserts++
      else if (cell.change === 'update') counts.updates++
      else if (cell.change === 'delete') counts.deletes++
      else if (cell.change === 'unchanged') counts.unchanged++
      else counts.kept++
    }
    return counts
  }, [state])

  return {
    active: state != null,
    request: state?.request ?? null,
    preview: state?.preview ?? null,
    cells: state?.cells ?? EMPTY_CELLS,
    issues: state?.issues ?? [],
    issuesFromSave: state?.refused ?? false,
    summary,
    editCount: edits.size,
    editedSincePreview,
    busy,
    error,
    clearError: () => setError(null),
    start,
    regenerate,
    applyEdit,
    commit,
    discard,
  }
}

const EMPTY_CELLS = new Map<string, DraftCell>()
