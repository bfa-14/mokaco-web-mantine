import { apiRequest } from '../api/client'
import type {
  AutoRosterCommitRequest,
  AutoRosterCommitResult,
  AutoRosterPreview,
  AutoRosterRequest,
  AutoRosterSetup,
  RosterCellInfo,
  RosterPinRequest,
  RosterRhythmDto,
  StaffingRequirementDto,
} from '../types/attendance'

/**
 * The auto-roster (6/5 rhythm, fair weekends) — api/roster/auto, docs/AUTO_ROSTER.md §4.
 * Read: ATTENDANCE_VIEW. Preview and every write: ATTENDANCE_MANAGE, for the branches the caller may see.
 *
 * PREVIEW WRITES NOTHING. The draft it returns is drawn over the roster grid and edited there; only
 * `commit` saves, in one atomic call, and every cell it sends carries the state the preview found.
 * A roster that moved in between is refused with a 409 ("The roster changed since the preview —
 * preview again.") rather than overwritten. A commit whose cells break a hard rule is a 400 whose
 * body also carries the issues ({ error, issues }), read from ApiError.data.
 */
export const autoRosterService = {
  /** `month` is 'yyyy-MM'. */
  setup: (branchId: number, month: string) =>
    apiRequest<AutoRosterSetup>(
      `/api/roster/auto/setup?branchId=${branchId}&month=${encodeURIComponent(month)}`,
    ),

  preview: (request: AutoRosterRequest) =>
    apiRequest<AutoRosterPreview>('/api/roster/auto/preview', {
      method: 'POST',
      body: JSON.stringify(request),
    }),

  commit: (request: AutoRosterCommitRequest) =>
    apiRequest<AutoRosterCommitResult>('/api/roster/auto/commit', {
      method: 'POST',
      body: JSON.stringify(request),
    }),

  /** Pins and auto markers of the SAVED days of one branch over a range. */
  cells: (branchId: number, from: string, to: string) =>
    apiRequest<RosterCellInfo[]>(
      `/api/roster/auto/cells?branchId=${branchId}` +
        `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),

  /** "Keep when regenerating" on a saved day. Changes no roster row, so it never needs re-approval. */
  setPin: (request: RosterPinRequest) =>
    apiRequest<void>('/api/roster/auto/pin', {
      method: 'PUT',
      body: JSON.stringify(request),
    }),

  /** Replaces the branch's minimum/target on duty rows. */
  saveStaffing: (branchId: number, rows: StaffingRequirementDto[]) =>
    apiRequest<void>(`/api/roster/auto/staffing?branchId=${branchId}`, {
      method: 'PUT',
      body: JSON.stringify(rows),
    }),

  saveRhythm: (rows: RosterRhythmDto[]) =>
    apiRequest<void>('/api/roster/auto/rhythm', {
      method: 'PUT',
      body: JSON.stringify(rows),
    }),
}
