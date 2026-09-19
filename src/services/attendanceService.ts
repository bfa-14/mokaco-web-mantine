import { apiRequest } from '../api/client'
import type {
  AnomalyDecideAllRequest,
  AnomalyDecideAllResult,
  AnomalyDecisionRequest,
  AnomalyDecisionResult,
  AttendanceAnomaly,
  AttendanceBranchSummary,
  AttendanceDetail,
  AttendanceRecord,
  AttendanceSummary,
  Correction,
  CorrectionCreateRequest,
  Device,
  DeviceApiKeyResult,
  DeviceCreateRequest,
  DevicePullResult,
  DeviceTestResult,
  DeviceUpdateRequest,
  EmployeeDevice,
  EmployeePatternDay,
  EnrollmentMapRequest,
  EnrollmentMapResult,
  MachineClearResult,
  RawPunch,
  ExitApprovalRequest,
  ExitDispositionRequest,
  ExitVariance,
  HrAdjustDayRequest,
  ImportBatch,
  ImportBatchDetail,
  ImportPreviewResult,
  ImportResult,
  ManualAttendanceRequest,
  MarkAbsenteesResult,
  PayrollReadiness,
  ProcessResult,
  RawLog,
  RosterApplyPatternRequest,
  RosterBulkResult,
  RosterCopyPeriodRequest,
  RosterDayRequest,
  RosterGap,
  RosterGenerateBulkRequest,
  RosterGenerateRequest,
  RosterGenerateResult,
  RosterMonthStatus,
  RosterClearResult,
  Setting,
  SettingUpsertRequest,
  Shift,
  ShiftAssignment,
  ShiftCreateRequest,
  ShiftPattern,
  ShiftPatternUpsertRequest,
  ShiftUpdateRequest,
  QuarantinedDeviceUser,
  QuarantineMapRequest,
  QuarantineMapResult,
  WorkedWithoutRoster,
} from '../types/attendance'

/** Policy values that decide what a working day IS. All endpoints require SETTING_MANAGE. */
export const settingsService = {
  getAll: () => apiRequest<Setting[]>('/api/settings'),
  update: (key: string, request: SettingUpsertRequest) =>
    apiRequest<void>(`/api/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify(request),
    }),
}

/** Terminals and the (device, PIN) → employee map. Read: ATTENDANCE_VIEW. Write: DEVICE_MANAGE. */
export const devicesService = {
  getAll: () => apiRequest<Device[]>('/api/devices'),
  create: (request: DeviceCreateRequest) =>
    apiRequest<{ deviceId: number }>('/api/devices', {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  update: (id: number, request: DeviceUpdateRequest) =>
    apiRequest<void>(`/api/devices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(request),
    }),
  /** The plaintext key is in THIS RESPONSE AND NOWHERE ELSE — only its hash is stored. */
  issueApiKey: (id: number) =>
    apiRequest<DeviceApiKeyResult>(`/api/devices/${id}/api-key`, {
      method: 'POST',
    }),

  /**
   * Reachability plus the machine's own clock. Reads no punches and writes nothing, so it is
   * safe to press repeatedly while somebody is standing at the terminal changing its settings.
   */
  testConnection: (id: number) =>
    apiRequest<DeviceTestResult>(`/api/devices/${id}/test-connection`, {
      method: 'POST',
    }),

  /**
   * Runs one pull NOW, without waiting for the timer. Shares the server's per-machine lock with
   * the background worker, so pressing this while a scheduled pull is in flight queues behind it
   * rather than talking over it.
   *
   * The FIRST pull against a machine lands its entire stored history — up to 50,000 punches on a
   * unit that has never been read. That is intended: dedup makes it safe and it back-fills.
   */
  pullNow: (id: number) =>
    apiRequest<DevicePullResult>(`/api/devices/${id}/pull`, {
      method: 'POST',
    }),

  /**
   * Pulls anything still on the machine, then ERASES the machine's own attendance log. Enrolled
   * users and fingerprints are not touched, and punches already in the system are unaffected.
   *
   * `confirmSerial` must equal the device's serial — the server checks it too, so this is not
   * merely the dialog being careful. A response with `cleared: false` means the safety check
   * refused and the machine still holds everything.
   */
  clearMachineLog: (id: number, confirmSerial: string) =>
    apiRequest<MachineClearResult>(`/api/devices/${id}/clear-machine-log`, {
      method: 'POST',
      body: JSON.stringify({ confirmSerial }),
    }),

  getEnrollments: () => apiRequest<EmployeeDevice[]>('/api/devices/enrollments'),
  /** Retroactive: punches already waiting on this PIN are claimed immediately. */
  mapEnrollment: (request: EnrollmentMapRequest) =>
    apiRequest<EnrollmentMapResult>('/api/devices/enrollments', {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  unmapEnrollment: (id: number) =>
    apiRequest<void>(`/api/devices/enrollments/${id}`, { method: 'DELETE' }),
}

/** Shift definitions. Read: ATTENDANCE_VIEW. Write: ATTENDANCE_MANAGE. */
export const shiftsService = {
  getAll: () => apiRequest<Shift[]>('/api/shifts'),
  create: (request: ShiftCreateRequest) =>
    apiRequest<{ shiftId: number }>('/api/shifts', {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  update: (id: number, request: ShiftUpdateRequest) =>
    apiRequest<void>(`/api/shifts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(request),
    }),
}

/** The roster. Read: ATTENDANCE_VIEW. Write: ATTENDANCE_MANAGE. */
export const rosterService = {
  get: (from: string, to: string, employeeId?: number) =>
    apiRequest<ShiftAssignment[]>(
      `/api/roster?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` +
        (employeeId ? `&employeeId=${employeeId}` : ''),
    ),

  /**
   * ONE EMPLOYEE'S roster over a window, under /api/employees — gated on EMP_VIEW rather than
   * ATTENDANCE_VIEW, because the shift-swap form needs it and a barista raising a swap is not an
   * attendance administrator. Same rows, same procedure; only the door differs.
   *
   * Refetch after a swap is approved: final approval rewrites these rows.
   */
  forEmployee: (employeeId: number, from: string, to: string) =>
    apiRequest<ShiftAssignment[]>(
      `/api/employees/${employeeId}/assignments` +
        `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),

  /**
   * The employee's WEEKLY TEMPLATE as seven rows — what the availability-change form starts from.
   *
   * Under /api/employees and gated on REQUEST_RAISE_SELF rather than ATTENDANCE_MANAGE, like
   * forEmployee above and for the same reason: a barista asking to stop working Sundays is not a
   * roster administrator. Reading somebody ELSE's week still needs the right to act for them.
   *
   * Distinct from getPatterns below, which returns only the rows that exist. This one always answers
   * for all seven days and flags the invented ones, so "nobody configured this day" is visible rather
   * than looking like a considered decision.
   */
  patternForEmployee: (employeeId: number) =>
    apiRequest<EmployeePatternDay[]>(`/api/employees/${employeeId}/shift-pattern`),
  /** One calendar cell. */
  setDay: (request: RosterDayRequest) =>
    apiRequest<{ shiftAssignmentId: number }>('/api/roster/day', {
      method: 'PUT',
      body: JSON.stringify(request),
    }),
  remove: (id: number) =>
    apiRequest<void>(`/api/roster/${id}`, { method: 'DELETE' }),

  generate: (request: RosterGenerateRequest) =>
    apiRequest<RosterGenerateResult>('/api/roster/generate', {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  generateBulk: (request: RosterGenerateBulkRequest) =>
    apiRequest<RosterBulkResult>('/api/roster/generate-bulk', {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  /** Weekday-aligned: a Monday shift lands on a Monday, not on the same date number. */
  copyPeriod: (request: RosterCopyPeriodRequest) =>
    apiRequest<RosterGenerateResult>('/api/roster/copy-period', {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  applyPattern: (request: RosterApplyPatternRequest) =>
    apiRequest<RosterGenerateResult>('/api/roster/apply-pattern', {
      method: 'POST',
      body: JSON.stringify(request),
    }),

  /**
   * WHERE ONE BRANCH-MONTH HAS GOT TO — Draft, Pending or Approved.
   *
   * `month` is the month's FIRST DAY ('yyyy-MM-01'), the same string the ROSTER_APPROVAL create
   * takes, so the banner and the request are talking about the identical thing.
   */
  monthStatus: (branchId: number, month: string) =>
    apiRequest<RosterMonthStatus>(
      `/api/attendance/roster-month?branchId=${branchId}&month=${encodeURIComponent(month)}`,
    ),

  /**
   * CLEARS ONE BRANCH-MONTH OF ROSTER — every assignment of the branch's employees in the month,
   * and the month's header (ATTENDANCE_MANAGE). A month that is waiting for approval, approved, or
   * already has attendance recorded on it is refused with a 409 carrying the procedure's reason;
   * callers show that sentence verbatim.
   */
  clearMonth: (branchId: number, year: number, month: number) =>
    apiRequest<RosterClearResult>(
      `/api/attendance/rosters?branchId=${branchId}&year=${year}&month=${month}`,
      { method: 'DELETE' },
    ),

  /** Employee-days with NO roster row. These block payroll. */
  getGaps: (from: string, to: string) =>
    apiRequest<RosterGap[]>(
      `/api/roster/gaps?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),

  getPatterns: (employeeId: number) =>
    apiRequest<ShiftPattern[]>(`/api/roster/patterns/${employeeId}`),
  savePatterns: (employeeId: number, days: ShiftPatternUpsertRequest[]) =>
    apiRequest<void>(`/api/roster/patterns/${employeeId}`, {
      method: 'PUT',
      body: JSON.stringify(days),
    }),
  deletePatterns: (employeeId: number) =>
    apiRequest<void>(`/api/roster/patterns/${employeeId}`, { method: 'DELETE' }),
}

/**
 * Processed attendance, the processor, and the HR overrides.
 * Read: ATTENDANCE_VIEW. Processor: ATTENDANCE_MANAGE. Overrides: ATTENDANCE_CORRECT.
 */
export const attendanceService = {
  get: (from: string, to: string, employeeId?: number, branchId?: number) =>
    apiRequest<AttendanceRecord[]>(
      `/api/attendance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` +
        (employeeId ? `&employeeId=${employeeId}` : '') +
        (branchId ? `&branchId=${branchId}` : ''),
    ),
  /** The day plus the paired intervals that explain its worked time. */
  getById: (id: number) => apiRequest<AttendanceDetail>(`/api/attendance/${id}`),
  /**
   * One row PER ANOMALY (a day can carry several). ATTENDANCE_CORRECT, not VIEW: the list exists
   * to be decided from. `onlyUndecided` is the worklist; the full list shows who ruled what.
   */
  /** Rule 12: days someone punched while the APPROVED roster month has no row for them. Nothing is paid or deducted for these. */
  getWorkedWithoutRoster: (from: string, to: string, branchId?: number | null) =>
    apiRequest<WorkedWithoutRoster[]>(
      `/api/attendance/worked-without-roster?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` +
        (branchId ? `&branchId=${branchId}` : ''),
    ),
  /** D9: unknown device users — punches under a PIN enrolled to nobody, one line per (device, PIN). */
  getDeviceQuarantine: (branchId?: number | null) =>
    apiRequest<QuarantinedDeviceUser[]>(`/api/attendance/device-quarantine${branchId ? `?branchId=${branchId}` : ''}`),
  /** D9: enrols the PIN, hands the waiting punches to the employee and replays them (ATTENDANCE_IMPORT). */
  mapDeviceQuarantine: (request: QuarantineMapRequest) =>
    apiRequest<QuarantineMapResult>('/api/attendance/device-quarantine/map', {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  getAnomalies: (from: string, to: string, onlyUndecided = false, branchId?: number | null) =>
    apiRequest<AttendanceAnomaly[]>(
      `/api/attendance/anomalies?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` +
        `&onlyUndecided=${onlyUndecided}` +
        (branchId ? `&branchId=${branchId}` : ''),
    ),
  /**
   * HR's ruling on one anomaly. Excuse keeps the minutes covered, Deduct takes them off the day,
   * Correct stores the punch as it should have been (through the manual path) and re-derives the
   * day. The procedure's refusals ("a missing punch can only be corrected") arrive as a 400 whose
   * text is the whole message — never flatten it.
   */
  decideAnomaly: (anomalyId: number, request: AnomalyDecisionRequest) =>
    apiRequest<AnomalyDecisionResult>(`/api/attendance/anomalies/${anomalyId}/decide`, {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  /** The same ruling for every undecided late / early of a month (optionally one branch). Missing punches are skipped and counted. */
  decideAllAnomalies: (request: AnomalyDecideAllRequest) =>
    apiRequest<AnomalyDecideAllResult>('/api/attendance/anomalies/decide-all', {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  /** What the machine actually recorded, before processing or correction. */
  getRaw: (employeeId: number, date: string) =>
    apiRequest<RawLog[]>(`/api/attendance/raw/${employeeId}/${date}`),

  /** Omitting workDate consumes EVERYTHING outstanding. Safe to re-run. */
  process: (workDate?: string) =>
    apiRequest<ProcessResult>(
      '/api/attendance/process' +
        (workDate ? `?workDate=${encodeURIComponent(workDate)}` : ''),
      { method: 'POST' },
    ),
  /**
   * RE-derives one day from all of its punches, under the punch-interpretation settings in force
   * now.
   *
   * Not the same as `process(date)`. That one is incremental — it consumes only punches it has not
   * already consumed — so a day built under the old interpretation would never be revisited when
   * the interpretation changes. This rebuilds the day whole. Raw punches are never touched, and a
   * day somebody has corrected by hand is left alone.
   */
  reprocessDay: (date: string) =>
    apiRequest<ProcessResult>(
      `/api/attendance/reprocess?date=${encodeURIComponent(date)}`,
      { method: 'POST' },
    ),
  /** Run AFTER the processor: it writes records for people who were rostered but never punched. */
  markAbsentees: (workDate: string) =>
    apiRequest<MarkAbsenteesResult>(
      `/api/attendance/mark-absentees?workDate=${encodeURIComponent(workDate)}`,
      { method: 'POST' },
    ),

  manual: (request: ManualAttendanceRequest) =>
    apiRequest<AttendanceRecord>('/api/attendance/manual', {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  /** Records what was AUTHORISED. It never overwrites what the punches observed. */
  setExitApproval: (id: number, request: ExitApprovalRequest) =>
    apiRequest<AttendanceRecord>(`/api/attendance/${id}/exit-approval`, {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  /** HR's ruling on the difference. This is what payroll is blocked on. */
  setExitDisposition: (id: number, request: ExitDispositionRequest) =>
    apiRequest<AttendanceRecord>(`/api/attendance/${id}/exit-disposition`, {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  adjustDay: (id: number, request: HrAdjustDayRequest) =>
    apiRequest<AttendanceRecord>(`/api/attendance/${id}/adjust`, {
      method: 'POST',
      body: JSON.stringify(request),
    }),

  getExitVariances: (from: string, to: string, onlyUndecided = true) =>
    apiRequest<ExitVariance[]>(
      `/api/attendance/exit-variances?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&onlyUndecided=${onlyUndecided}`,
    ),

  /** Is this month safe to pay? Seven counters and a verdict. */
  getPayrollReadiness: (period: string) =>
    apiRequest<PayrollReadiness>(
      `/api/attendance/payroll-readiness?period=${encodeURIComponent(period)}`,
    ),
  getSummary: (period: string, employeeId: number) =>
    apiRequest<AttendanceSummary>(
      `/api/attendance/summary?period=${encodeURIComponent(period)}&employeeId=${employeeId}`,
    ),
  getSummaryAll: (period: string) =>
    apiRequest<AttendanceSummary[]>(
      `/api/attendance/summary/all?period=${encodeURIComponent(period)}`,
    ),
  getSummaryByBranch: (period: string, employeeId?: number) =>
    apiRequest<AttendanceBranchSummary[]>(
      `/api/attendance/summary/by-branch?period=${encodeURIComponent(period)}` +
        (employeeId ? `&employeeId=${employeeId}` : ''),
    ),
}

/** Ingestion. Upload/preview/PIN-mapping require ATTENDANCE_IMPORT. */
export const importService = {
  /**
   * Says what an upload WOULD do, writing nothing. Same parse and same dedup hash as the
   * real import, so the preview cannot disagree with the thing it is previewing.
   */
  preview: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return apiRequest<ImportPreviewResult>('/api/attendance/import/preview', {
      method: 'POST',
      body,
    })
  },
  /** Nothing here overwrites anything: known punches are ignored, unknown PINs are kept. */
  upload: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return apiRequest<ImportResult>('/api/attendance/import', {
      method: 'POST',
      body,
    })
  },
  getBatches: () => apiRequest<ImportBatch[]>('/api/attendance/imports'),
  /** Includes the audit copy of the file — what the spreadsheet actually said. */
  getBatch: (id: number) =>
    apiRequest<ImportBatchDetail>(`/api/attendance/imports/${id}`),
  /** Punches whose PIN belongs to nobody. They are waiting, not lost. */
  getUnresolved: () => apiRequest<RawLog[]>('/api/attendance/unresolved'),

  /**
   * Every punch recorded on ONE DAY, exactly as the machines reported it — newest first.
   *
   * This is the "did my punch arrive" call. It reads the raw log rather than attendance records,
   * so a punch shows up seconds after the machine is pulled, long before the nightly processor
   * turns it into worked hours. `unresolvedOnly` narrows it to punches on PINs nobody is enrolled
   * on, which is the count the pipeline card links to Unresolved PINs.
   *
   * The date is required by the server: the raw log grows forever, and an unbounded read of it is
   * a page that works today and times out in two years.
   */
  getPunches: (date: string, options?: { deviceId?: number; unresolvedOnly?: boolean }) => {
    const params = new URLSearchParams({ date })
    if (options?.deviceId != null) params.set('deviceId', String(options.deviceId))
    if (options?.unresolvedOnly) params.set('unresolvedOnly', 'true')
    return apiRequest<RawPunch[]>(`/api/attendance/punches?${params.toString()}`)
  },
}

/** Corrections. Read: ATTENDANCE_VIEW. Create/approve/reject: ATTENDANCE_CORRECT. */
export const correctionsService = {
  getPending: () => apiRequest<Correction[]>('/api/attendance/corrections/pending'),
  getByRecord: (attendanceId: number) =>
    apiRequest<Correction[]>(
      `/api/attendance/corrections/by-record/${attendanceId}`,
    ),
  create: (request: CorrectionCreateRequest) =>
    apiRequest<{ correctionId: number }>('/api/attendance/corrections', {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  /** Applies the new values and RECOMPUTES the day by the same rules as any other. */
  approve: (id: number) =>
    apiRequest<void>(`/api/attendance/corrections/${id}/approve`, {
      method: 'POST',
    }),
  reject: (id: number) =>
    apiRequest<void>(`/api/attendance/corrections/${id}/reject`, {
      method: 'POST',
    }),
}
