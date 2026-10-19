/**
 * Attendance API models. Mirrors the backend DTOs in MokaCo.HRMS.Model/Attendance
 * (serialized camelCase). Dates and times are always `string`, never `Date`.
 *
 * The one rule that explains most of this file: ATTENDANCE REPORTS, WORKFLOW
 * AUTHORIZES, HR DECIDES. Nothing here decides what anyone is paid — overtime is
 * detected and left alone, and an exit that ran long is measured and handed to a human.
 */

/* ── Permission codes (security.PERMISSION, module 'Attendance') ── */

export const PERMISSIONS = {
  /** Read attendance, rosters, devices and summaries. */
  view: 'ATTENDANCE_VIEW',
  /** Run the processor, mark absentees, edit rosters and shifts. Never a pay-bearing edit. */
  manage: 'ATTENDANCE_MANAGE',
  /** HR ONLY: manual entry, corrections, exit approvals and dispositions, day adjustments. Changes pay. */
  correct: 'ATTENDANCE_CORRECT',
  /** Upload device spreadsheets and map unresolved PINs. */
  import: 'ATTENDANCE_IMPORT',
  /** Add/edit devices and enrollments, issue device API keys. */
  devices: 'DEVICE_MANAGE',
  /** Change the policy values that decide what a working day IS. */
  settings: 'SETTING_MANAGE',
} as const

/* ── Settings ── */

/** core.SETTING — GET /api/settings. */
export interface Setting {
  settingKey: string
  settingValue: string
  dataType: string
  description: string | null
  modifiedAt: string | null
  modifiedBy: number | null
}

/** PUT /api/settings/{key}. */
export interface SettingUpsertRequest {
  settingValue: string
  dataType: string
  description?: string | null
}

/* ── Devices & enrollment ── */

/** attendance.DEVICE — GET /api/devices. */
export interface Device {
  deviceId: number
  serialNumber: string
  /** Human label — "Verdun front door". Null when nobody has named it; fall back to the serial. */
  name: string | null
  branchId: number
  branchName: string
  departmentId: number | null
  departmentName: string | null
  isActive: boolean
  /** Last CONTACT of any kind, including the terminal's few-second command poll. */
  lastSyncUtc: string | null
  /**
   * The PUSH HEARTBEAT: the last time this terminal delivered punches ITSELF over iclock/ADMS.
   * A diagnostic about the push link, and null forever on a machine we poll instead — which is
   * why it is no longer what the "Last punch" column reads. Kept because it is still the way to
   * tell "the machine is pushing" from "we are fetching".
   */
  lastPushUtc: string | null
  /**
   * The newest punch we HOLD from this terminal, by whichever path carried it — pull, push or a
   * spreadsheet. This is what the "Last punch" column shows: it answers "when did anybody last
   * punch here", which is the question a person is actually asking, on every kind of machine.
   */
  lastPunchUtc: string | null
  /** Punches recorded on this terminal today, counted on the punch's own timestamp. */
  punchesToday: number

  /* ── Pull: the SERVER calling the terminal, instead of waiting to be called ──
     Push (above) is the machine reaching us over iclock/ADMS. Pull is us opening a TCP
     socket to the machine and reading its log on a timer. They are alternatives, not a
     sequence, and both may be on at once — the server's dedup hash is what makes that
     harmless rather than double-counting. A terminal whose firmware has no ADMS menu is
     reachable ONLY this way, which is why these fields exist. */

  /** The machine's LAN address, e.g. '192.168.45.12'. Null means it is never called. */
  pullIp: string | null
  /** The ZK protocol port — 4370 on every unit anyone ships. */
  pullPort: number
  /** The machine's own device password. 0 = none, the factory default. */
  pullCommKey: number
  /** Whether the polling worker has this machine on its worklist. */
  pullEnabled: boolean
  /** When a pull was last ATTEMPTED — success or failure. Read with `lastPullError`. */
  lastPullUtc: string | null
  /**
   * Why the last pull failed, or null if it worked. The only place a machine that has
   * dropped off the network becomes visible: it cannot tell us itself, and a pull failing
   * every five minutes is otherwise completely silent.
   */
  lastPullError: string | null
}

/**
 * One raw punch, resolved for reading — GET /api/attendance/punches.
 *
 * The RAW log, not attendance: a punch appears here the second it lands, hours before the nightly
 * processor gives it meaning, and a punch on an unmapped PIN appears here with `fullName: null` —
 * which is exactly the diagnosis somebody is looking for when they ask "did my punch arrive".
 */
export interface RawPunch {
  rawLogId: number
  /** The TERMINAL'S own wall clock, stored unconverted by every ingestion path. */
  punchTimeUtc: string
  /** 0 = in, 1 = out. Anything else is a device key the processor does not model. */
  punchType: number
  /** Pull / Device / Excel / Manual — how the punch reached us. */
  source: string
  /** True once the processor has consumed it into an employee-day. False is normal for today. */
  isProcessed: boolean
  enrollPin: string
  employeeId: number | null
  /** Null = this PIN is mapped to nobody. Waiting on Unresolved PINs, not lost. */
  fullName: string | null
  deviceId: number
  serialNumber: string
  deviceName: string | null
  branchId: number
  branchName: string
  /**
   * When the row was WRITTEN, as opposed to when the punch happened. On a pulled machine the two
   * differ by up to one poll interval, and that gap is what separates "the machine never recorded
   * it" from "we have not collected it yet".
   */
  createdUtc: string
}

/** The factory settings of a ZK-family terminal. Mirrors DevicePullDefaults on the server. */
export const DEVICE_PULL_DEFAULTS = {
  port: 4370,
  commKey: 0,
} as const

export interface DeviceCreateRequest {
  serialNumber: string
  name: string | null
  branchId: number
  departmentId: number | null
  /* Connection — how the server reaches this machine. */
  pullIp: string | null
  pullPort: number
  pullCommKey: number
  pullEnabled: boolean
}

export interface DeviceUpdateRequest extends DeviceCreateRequest {
  isActive: boolean
}

/**
 * POST /api/devices/{id}/pull — one pull, run now.
 *
 * `duplicates` being large is the NORMAL steady state, not a fault: the machine's buffer is
 * never cleared, so every pull re-reads its whole history and the dedup hash discards what we
 * already hold.
 */
export interface DevicePullResult {
  received: number
  inserted: number
  duplicates: number
  unresolvedPins: number
  /** Null when the pull worked. Set means nothing was read, and this is what to show. */
  error: string | null
}

/**
 * POST /api/devices/{id}/test-connection — reachability plus the machine's own clock.
 *
 * The clock is half the point. Punches are stored exactly as the terminal stamps them, so a
 * machine running forty minutes fast writes forty minutes onto everybody's day and nothing
 * downstream can detect it.
 */
export interface DeviceTestResult {
  ok: boolean
  deviceTime: string | null
  error: string | null
}

/**
 * POST /api/devices/{id}/clear-machine-log — rescue then erase.
 *
 * `cleared: false` with an `error` is NOT a request failure: it is the safety check refusing,
 * and the machine is untouched. The two must read differently to a user, because "we could not
 * do it" and "we chose not to, here is what would have been lost" are different situations.
 */
export interface MachineClearResult {
  /** The rescue pull that ran first. Populated even when the clear was then refused. */
  pulledBeforeClear: {
    received: number
    inserted: number
    duplicates: number
    unresolvedPins: number
  }
  cleared: boolean
  error: string | null
}

/**
 * attendance.EMPLOYEE_DEVICE — GET /api/devices/enrollments.
 * A PIN is unique only WITHIN one device, so somebody who punches at two branches
 * needs one row per device.
 */
export interface EmployeeDevice {
  employeeDeviceId: number
  employeeId: number
  fullName: string
  deviceId: number
  serialNumber: string
  branchName: string
  enrollPin: string
}

/** POST /api/devices/enrollments. */
export interface EnrollmentMapRequest {
  employeeId: number
  deviceId: number
  enrollPin: string
}

/**
 * Mapping a PIN is RETROACTIVE — punches that were waiting on it are claimed on the
 * spot. This count is how the user sees the fix actually recovered something.
 */
export interface EnrollmentMapResult {
  orphanPunchesResolved: number
}

/** POST /api/devices/{id}/api-key. The plaintext key exists only in this response. */
export interface DeviceApiKeyResult {
  deviceId: number
  serialNumber: string
  apiKey: string
}

/* ── Shifts ── */

/** attendance.SHIFT — GET /api/shifts. */
export interface Shift {
  shiftId: number
  name: string
  startTime: string
  endTime: string
  /** Arriving within this many minutes of the start is not late at all. null = use the AttendanceToleranceMinutes setting. */
  graceMinutes: number | null
  /** An overnight shift (22:00–06:00) belongs to the day it STARTS on. */
  crossesMidnight: boolean
  /** Unpaid break, charged once: from the mid-day gap if there was one, otherwise off gross. */
  breakMinutes: number
  isActive: boolean
}

/**
 * One day of an employee's current weekly template — GET /api/employees/{id}/shift-pattern.
 *
 * ALWAYS SEVEN ROWS, whether or not the employee has a pattern on file. That is the point of it: the
 * roster's own pattern read returns only the rows that exist, so a form built on that would silently
 * offer a three-day week to somebody with three configured days. `noPatternRow` marks the days that
 * were filled in for the shape rather than read from a setting.
 *
 * `isAvailable` is the derived answer: false for a rest day OR a day with no shift, true otherwise —
 * including a day with no row at all, since an unconfigured employee is not thereby unavailable.
 */
export interface EmployeePatternDay {
  /** ISO: 1 = Monday .. 7 = Sunday. */
  dayOfWeek: number
  isAvailable: boolean
  shiftId: number | null
  shiftName: string | null
  startTime: string | null
  endTime: string | null
  /** No row exists for this day — the values beside it are defaults, not settings. */
  noPatternRow: boolean
}

export interface ShiftCreateRequest {
  name: string
  startTime: string
  endTime: string
  /** null = use the AttendanceToleranceMinutes setting. */
  graceMinutes: number | null
  crossesMidnight: boolean
  breakMinutes: number
}

export interface ShiftUpdateRequest extends ShiftCreateRequest {
  isActive: boolean
}

/* ── Roster ── */

/**
 * attendance.SHIFT_ASSIGNMENT — GET /api/roster. What each person was SUPPOSED to work.
 * Without a row here the system cannot tell late from early, or absent from a day off.
 */
export interface ShiftAssignment {
  shiftAssignmentId: number
  employeeId: number
  fullName: string
  /** null on a rest day — a rest day is an assignment with no shift, not the absence of one. */
  shiftId: number | null
  shiftName: string | null
  startTime: string | null
  endTime: string | null
  workDate: string
  isRestDay: boolean
}

/** An employee-day with NO roster row at all. Distinct from a rest day, which IS rostered. */
export interface RosterGap {
  employeeId: number
  fullName: string
  workDate: string
  /**
   * QA3 (ROS-8): the branch the employee belonged to ON that day — the gap belongs to that branch's month.
   * Absent from an older API.
   */
  branchId?: number | null
}

/**
 * GET /api/roster/leave-days (QA3 ROS-4 / LEV-5) — who is on APPROVED leave, by day: the days an approved leave request
 * covers (FromDate..ApprovedToDate), a half day as 0.5. Read from the requests, not the ledger: the ledger books a
 * month of leave on one date and also holds exit-permission minutes converted to leave.
 */
export interface RosterLeaveDay {
  employeeId: number
  /** 'yyyy-MM-ddT00:00:00' from the API. */
  date: string
  /** 1 = the whole day, 0.5 = half of it. */
  daysOnLeave: number
}

/** POST /api/roster/rederive-month (QA3 REL-16): one branch-month's completed days derived again. */
export interface RosterRederiveRequest {
  branchId: number
  /** 'yyyy-MM'. */
  yearMonth: string
}

export interface RosterRederiveResult {
  daysRederived: number
}

/**
 * WHERE ONE BRANCH-MONTH OF ROSTER HAS GOT TO — GET /api/attendance/roster-month.
 *
 * Three states and no others: `Draft` (nobody has put it up yet), `Pending` (a ROSTER_APPROVAL
 * request is open on it) and `Approved` (it has been signed off). Typed as a plain string rather
 * than a union on purpose — an unrecognised state from a newer server must render as itself, the
 * way {@link StatusBadge} treats an unknown attendance status, not crash the page it appears on.
 */
export interface RosterMonthStatus {
  branchId: number
  /** The month asked for, echoed back as its first day: 'yyyy-MM-01'. */
  monthDate: string
  /** Draft · Pending · Approved. */
  status: string
  /** The request carrying it. Null while Draft — there is nothing to link to yet. */
  requestInstanceId: number | null
  /** When it was signed off. Null unless Approved. */
  approvedAt?: string | null
  /** The open request's own state, when the month carries one. */
  requestStatus?: string | null

  /* ── WHAT "SUBMIT FOR APPROVAL" NEEDS. Absent from an older build, so every reader treats a
     missing field as "nothing known" and the button stays enabled — the server's 409 is the rule
     either way; these only let the page say the reason BEFORE the click. ── */

  /** The ROSTER_APPROVAL request still waiting on this month, if any. */
  openRequestId?: number | null
  /** 'Pending' | 'OnHold' while openRequestId is set. */
  openRequestStatus?: string | null
  /** When the last approval was signed. Null when never approved. */
  lastApprovedAt?: string | null
  /** True once anything on the roster moved after lastApprovedAt — the only reason to resubmit. */
  changedSinceApproval?: boolean
  lastChangedUtc?: string | null
  /** QA3 (ROS-2): when the month's attendance days were last derived against its roster (approval, nightly, by hand). */
  rederivedAt?: string | null
}

/** DELETE /api/attendance/rosters — what clearing one branch-month removed. */
export interface RosterClearResult {
  rowsDeleted: number
  headerDeleted: boolean
}

/** attendance.EMPLOYEE_SHIFT_PATTERN — an employee's default week (a template, no dates). */
export interface ShiftPattern {
  patternId: number
  employeeId: number
  /** ISO: 1 = Monday .. 7 = Sunday. */
  dayOfWeek: number
  shiftId: number | null
  shiftName: string | null
  isRestDay: boolean
  isActive: boolean
}

/** PUT /api/roster/day — one calendar cell. */
export interface RosterDayRequest {
  employeeId: number
  workDate: string
  shiftId: number | null
  isRestDay: boolean
}

/** POST /api/roster/generate. Days outside the weekday mask become REST DAYS, so the roster is complete. */
export interface RosterGenerateRequest {
  employeeId: number
  fromDate: string
  toDate: string
  shiftId: number
  /** 7 chars, Monday first: '1111100' = Mon–Fri. */
  weekdays: string
  /** OFF by default: leaving it off keeps manual changes already made. */
  overwrite: boolean
  /** QA3 (ROS-14): only the days the employee belongs to this branch. Null = every branch the caller may plan. */
  branchId?: number | null
}

/** POST /api/roster/generate-bulk. */
export interface RosterGenerateBulkRequest {
  employeeIds: number[]
  fromDate: string
  toDate: string
  shiftId: number
  weekdays: string
  overwrite: boolean
  /** QA3 (ROS-14): only the days each employee belongs to this branch. Null = every branch the caller may plan. */
  branchId?: number | null
}

/**
 * POST /api/roster/copy-period. Weekday-aligned: a Monday shift lands on a Monday.
 * QA3 (ROS-3): ONE branch — the days each employee belongs to it, in the source month and in the target month.
 */
export interface RosterCopyPeriodRequest {
  sourceYearMonth: string
  targetYearMonth: string
  employeeId: number | null
  overwrite: boolean
  branchId: number
}

/** POST /api/roster/apply-pattern. QA3 (ROS-3): ONE branch, like the copy. */
export interface RosterApplyPatternRequest {
  yearMonth: string
  employeeId: number | null
  overwrite: boolean
  branchId: number
}

/** PUT /api/roster/patterns/{employeeId} — the editor always sends all seven days. */
export interface ShiftPatternUpsertRequest {
  dayOfWeek: number
  shiftId: number | null
  isRestDay: boolean
}

export interface RosterGenerateResult {
  rowsInserted: number
}

export interface RosterBulkResult {
  employeesProcessed: number
  /** QA3 (ROS-13): the days actually written. Absent from an older API. */
  rowsInserted?: number
}

/* ── Processed attendance ── */

/**
 * attendance.ATTENDANCE_RECORD — GET /api/attendance. One row per employee per day.
 * THIS, never the raw punch log, is what payroll reads.
 */
export interface AttendanceRecord {
  attendanceId: number
  employeeId: number
  fullName: string
  shiftAssignmentId: number | null
  workDate: string

  firstInUtc: string | null
  lastOutUtc: string | null
  /** Complete in/out intervals. An IN with no OUT is not a pair — it is an anomaly. */
  punchPairs: number

  /**
   * Sum of the PAIRED intervals — NOT first-in to last-out. 08:00–12:00 plus 14:00–17:00
   * is 420 minutes, not 540; otherwise a two-hour mid-day absence would be paid.
   */
  workedMinutes: number
  /** What a full day means for THIS person on THIS date: the rostered shift minus its break. */
  standardMinutes: number
  /**
   * worked / standard, capped at 1.00. Payroll sums these, so leaving 2h early counts 0.75 of a day.
   * null on a RestDay / Leave / Holiday row — there is no standard to divide by, so render "—".
   */
  dayFraction: number | null
  isFullDay: boolean
  shortfallMinutes: number
  /** Minutes past (shift start + grace). Zero with no rostered shift — you cannot be late for a shift nobody assigned. */
  lateMinutes: number
  /** DETECTED only. Attendance never pays this; pay only what an approved overtime request authorises. */
  overtimeMinutes: number

  /** What the punches SHOW they were away for, beyond their break. Observed fact. */
  exitActualMinutes: number
  /** What was AUTHORISED. Independent of the actual — neither ever overwrites the other. */
  exitApprovedMinutes: number
  /** actual − approved. Positive = away longer than allowed; negative = came back early. */
  exitVarianceMinutes: number
  /** What comes off the leave balance. Default: the ACTUAL minutes taken. */
  exitLeaveMinutes: number
  /** HR's ruling: UnpaidAbsence | Overtime | Ignore. null = undecided, and payroll is blocked. */
  exitVarianceDisposition: string | null

  /** Present | Absent | RestDay | Leave. */
  status: string
  /** Device | Excel | Manual. */
  source: string
  branchId: number | null
  branchName: string | null

  /** The punches did not add up. Not a judgement — the machine asking a human to look. */
  hasAnomaly: boolean
  /** HR entered or corrected this day. The processor must never touch it again. */
  isManual: boolean
  hrNote: string | null
}

/** attendance.ATTENDANCE_INTERVAL — one paired in/out stretch. The audit trail behind worked time. */
export interface AttendanceInterval {
  intervalId: number
  seqNo: number
  inTimeUtc: string
  outTimeUtc: string
  minutes: number
  /** Minutes clocked OUT until the next interval. The break, and then the exit, come out of this. */
  gapAfterMins: number
}

/** GET /api/attendance/{id} — the day plus the intervals that explain it. */
export interface AttendanceDetail extends AttendanceRecord {
  grossMinutes: number
  gapMinutes: number
  breakApplied: number
  /** exitLeaveMinutes as DAYS: with an 8h day, a 2-hour exit is 0.25 days. */
  leaveDaysToDeduct: number
  intervals: AttendanceInterval[]
}

/** GET /api/attendance/exit-variances — HR's decision queue. */
export interface ExitVariance {
  attendanceId: number
  employeeId: number
  fullName: string
  workDate: string
  exitActualMinutes: number
  exitApprovedMinutes: number
  exitVarianceMinutes: number
  exitLeaveMinutes: number
  exitVarianceDisposition: string | null
  /** Overtime detected the same day — what HR could offset the variance against. */
  overtimeMinutes: number
  leaveDaysToDeduct: number
  hrNote: string | null
}

/** attendance.RAW_DEVICE_LOG — what the machine actually said, before any processing. */
export interface RawLog {
  rawLogId: number
  deviceId: number
  serialNumber: string
  enrollPin: string
  punchTimeUtc: string
  /** 0 = IN, 1 = OUT. */
  punchType: number
  source: string
  dedupHash: string
  isProcessed: boolean
  importBatchId: number | null
  createdUtc: string
}

/* ── HR overrides ── */

export interface ManualAttendanceRequest {
  employeeId: number
  workDate: string
  firstInUtc: string | null
  lastOutUtc: string | null
  exitMinutes: number
  exitApprovedMins: number
  status: string | null
  branchId: number | null
  hrNote: string | null
}

export interface ExitApprovalRequest {
  exitApprovedMinutes: number
  exitPermissionId: number | null
  /** For an exit that was approved but never punched for, so attendance sees no gap at all. */
  alsoSetActual: boolean
  hrNote: string | null
}

export interface ExitDispositionRequest {
  /** UnpaidAbsence | Overtime | Ignore. */
  disposition: string
  /** Sets exactly how many minutes come off leave, overriding the configured basis. */
  exitLeaveMinutesOverride: number | null
  hrNote: string | null
}

export interface HrAdjustDayRequest {
  workedMinutes: number | null
  dayFraction: number | null
  status: string | null
  /** Required. This changes pay, and somebody will ask why. */
  hrNote: string
}

/* ── Anomalies (tolerance-based late / early / missing punch, decided by HR) ── */

/**
 * LateArrival | EarlyDeparture | MissingPunch | HalfDayAbsence. The last is a half-day-leave day (D3) whose WORKED half
 * shows no punch: minutes to rule on like a late arrival — Excused covers them, Deducted takes them off the day.
 */
export type AnomalyType = 'LateArrival' | 'EarlyDeparture' | 'MissingPunch' | 'HalfDayAbsence'

/** GET /api/attendance/worked-without-roster — punches on a day an APPROVED roster month gives the employee no row for. */
export interface WorkedWithoutRoster {
  employeeId: number
  employeeName: string
  /** The branch the employee belonged to ON that day (D7), not necessarily today's. */
  branchId: number
  branchName: string
  workDate: string
  firstPunch: string
  lastPunch: string
  punchCount: number
  workedMinutes: number
}

/** GET /api/attendance/device-quarantine — one unknown device user: a (device, PIN) enrolled to nobody, with punches waiting. */
export interface QuarantinedDeviceUser {
  deviceId: number
  serialNumber: string | null
  deviceName: string | null
  branchId: number | null
  branchName: string | null
  enrollPin: string
  punchCount: number
  firstPunch: string
  lastPunch: string
}

export interface QuarantineMapRequest {
  deviceId: number
  enrollPin: string
  employeeId: number
}

/** What "map to employee" did: punches handed over, days re-derived, and days left alone because they are already paid. */
export interface QuarantineMapResult {
  punchesResolved: number
  daysDerived: number
  daysAlreadyPaid: number
}

/**
 * POST /api/attendance/device-quarantine/dismiss (QA3): "this PIN belongs to nobody". The waiting punches are set
 * aside with the reason - kept (the terminal's next copy stays a duplicate), no longer waiting; mapping the PIN later
 * takes them back.
 */
export interface QuarantineDismissRequest {
  deviceId: number
  enrollPin: string
  note: string
}

export interface QuarantineDismissResult {
  punchesDismissed: number
}

/** null = undecided (the minutes are covered in pay meanwhile) | Excused | Deducted | Corrected. */
export type AnomalyDecision = 'Excused' | 'Deducted' | 'Corrected'

/**
 * One row of attendance.ATTENDANCE_ANOMALY joined to its day — GET /api/attendance/anomalies.
 *
 * A late arrival or early departure at or beyond the tolerance (the shift's grace, else the
 * AttendanceToleranceMinutes setting), or a missing punch, for HR to decide. The first block is
 * the day as the anomalies list has always shown it; the rest is the anomaly itself. A DAY CAN
 * CARRY SEVERAL ROWS (one per type), so the row key is `anomalyId`, never the attendance id.
 */
export interface AttendanceAnomaly {
  attendanceId: number
  employeeId: number
  fullName: string
  workDate: string
  firstInUtc: string | null
  lastOutUtc: string | null
  punchPairs: number
  status: string
  source: string

  anomalyId: number
  type: AnomalyType
  /** The late or early minutes, measured from the shift; zero for a missing punch. */
  minutes: number
  shiftStart: string | null
  shiftEnd: string | null
  punchIn: string | null
  punchOut: string | null

  decision: AnomalyDecision | null
  decidedByUserId: number | null
  /** The decider's name; null for an automatic decision (an exit permission covering the early departure). */
  decidedBy: string | null
  decidedAt: string | null
  note: string | null

  dayFraction: number | null
  workedMinutes: number
  coveredMinutes: number
  standardMinutes: number
  isManual: boolean
  hasAnomaly: boolean
  branchId: number | null
  branchName: string | null
}

/** POST /api/attendance/anomalies/{id}/decide. */
export interface AnomalyDecisionRequest {
  /** Excuse | Deduct | Correct. */
  decision: 'Excuse' | 'Deduct' | 'Correct'
  /** Required for Correct: the In of a late arrival, the Out of an early departure, the missing side of a missing punch. */
  correctedTime?: string | null
  note?: string | null
}

/** What the decide endpoint returns: the decided row and the day as re-derived with the decision. */
export interface AnomalyDecisionResult {
  anomalyId: number
  attendanceId: number
  employeeId: number
  workDate: string
  type: AnomalyType
  minutes: number
  decision: AnomalyDecision | null
  decidedByUserId: number | null
  decidedAt: string | null
  note: string | null
  firstInUtc: string | null
  lastOutUtc: string | null
  workedMinutes: number
  coveredMinutes: number
  standardMinutes: number
  dayFraction: number | null
  isFullDay: boolean
  lateMinutes: number
  lateDeductMinutes: number
  earlyExitMinutes: number
  earlyDeductMinutes: number
  isManual: boolean
  hasAnomaly: boolean
  status: string
}

/** POST /api/attendance/anomalies/decide-all — every undecided late arrival / early departure of a month. */
export interface AnomalyDecideAllRequest {
  /** 'yyyy-MM'. */
  month: string
  branchId?: number | null
  /** Excuse | Deduct — a correction needs a time per anomaly, so it is not offered in bulk. */
  decision: 'Excuse' | 'Deduct'
  note?: string | null
}

export interface AnomalyDecideAllResult {
  decided: number
  /** Missing-punch anomalies left alone: each needs its own corrected time. */
  skipped: number
  daysRecomputed: number
}

/* ── Corrections ── */


/**
 * attendance.ATTENDANCE_CORRECTION. A LOGGED change, not an edit: old and new values,
 * who asked, who approved, and why. The raw punches are never overwritten.
 */
export interface Correction {
  correctionId: number
  attendanceId: number
  workDate: string
  employeeId: number
  fullName: string

  oldFirstInUtc: string | null
  oldLastOutUtc: string | null
  oldExitMinutes: number | null
  oldStatus: string | null

  newFirstInUtc: string | null
  newLastOutUtc: string | null
  newExitMinutes: number | null
  newStatus: string | null

  reason: string
  approvalStatus: string
  requestedBy: number
  requestedByUser: string | null
  approvedBy: number | null
  approvedByUser: string | null
  requestedUtc: string
  actedUtc: string | null
}

export interface CorrectionCreateRequest {
  attendanceId: number
  newFirstInUtc: string | null
  newLastOutUtc: string | null
  newExitMinutes: number | null
  newStatus: string | null
  /** Required. A correction without one is an unexplained change to somebody's pay. */
  reason: string
}

/* ── Import ── */

/** attendance.ATTENDANCE_IMPORT_BATCH — one uploaded spreadsheet. */
export interface ImportBatch {
  importBatchId: number
  fileName: string
  rowCount: number
  status: string
  importedByUser: number | null
  importedByUsername: string | null
  importedUtc: string
  note: string | null
}

export interface ImportBatchDetail extends ImportBatch {
  /** The audit copy: what the file actually said. Never re-processed. */
  rawJson: string
}

/** A row the parser could not understand. Reported, never fatal. */
export interface ImportRowError {
  rowNumber: number
  message: string
}

/** A parsed row, with what WILL happen to it — predicted without writing anything. */
export interface ImportPreviewRow {
  rowNumber: number
  enrollPin: string
  employeeName: string | null
  punchTimeUtc: string
  punchType: number
  deviceSerial: string
  /** Already in the system; it will be skipped. Not an error. */
  willBeDuplicate: boolean
  /** Nobody is enrolled on this PIN. It will be KEPT and parked, not thrown away. */
  willBeUnresolved: boolean
  /** The serial is not registered, so this punch cannot be stored at all. */
  unknownDevice: boolean
  /** Plain-language explanation, written for an HR user. */
  reason: string | null
}

/** POST /api/attendance/import/preview — what an upload WOULD do. Writes nothing. */
export interface ImportPreviewResult {
  parsed: number
  willInsert: number
  duplicates: number
  unresolvedPins: number
  unknownDevices: number
  rows: ImportPreviewRow[]
  errors: ImportRowError[]
}

/** POST /api/attendance/import. Duplicates and unresolved PINs are outcomes, not failures. */
export interface ImportResult {
  importBatchId: number
  parsed: number
  inserted: number
  /** Punches already in the system, ignored. Re-uploading a file is safe by design. */
  duplicates: number
  /** Stored with nobody attached, waiting on the Unresolved PINs page. */
  unresolvedPins: number
  /** Could NOT be stored — the only outcome that actually loses data. */
  unknownDevices: number
  errors: ImportRowError[]
}

/* ── Payroll interface ── */

/**
 * GET /api/attendance/payroll-readiness. Payroll reads attendance, so an incomplete month
 * does not fail loudly — it pays the wrong amounts quietly. Every counter is a way the
 * month can still be lying to you.
 */
export interface PayrollReadiness {
  periodYearMonth: string
  periodStart: string
  periodEnd: string
  /** Punches nobody has processed — the days they belong to are missing entirely. */
  unprocessedPunches: number
  /** Punches on a PIN nobody is enrolled on. That person's days are missing. */
  unresolvedPinPunches: number
  /** Days the machine could not read confidently. The hours on them are not trustworthy. */
  openAnomalies: number
  /** The figures are about to change, so paying now pays the old ones. */
  pendingCorrections: number
  /** Rostered but produced no record at all — nothing to pay or deduct against. */
  rosteredDaysWithNoRecord: number
  /** HR has not said whether the extra time is unpaid, offset, or ignored. */
  undecidedExitVariances: number
  /**
   * Late arrivals, early departures and missing punches HR has not excused, deducted or corrected.
   * Until each is decided, payroll does not know what the day is worth.
   */
  undecidedAnomalies: number
  /** True only when every counter is zero. */
  isReady: boolean
}

/** GET /api/attendance/summary — the numbers payroll turns into pay lines. */
export interface AttendanceSummary {
  employeeId: number
  fullName: string
  periodYearMonth: string
  totalLateMinutes: number
  /** DETECTED overtime. Not automatically payable. */
  totalOvertimeMinutes: number
  totalWorkedMinutes: number
  totalShortfallMinutes: number
  /** FRACTIONAL days worked — leaving two hours early contributes 0.75, not 1. */
  daysWorked: number
  fullDaysWorked: number
  partialDays: number
  presentDays: number
  absentDays: number
  restDays: number
  leaveDays: number
  exitActualMinutes: number
  exitApprovedMinutes: number
  exitLeaveMinutes: number
  exitLeaveDays: number
  exitUnpaidMinutes: number
  exitOffsetMinutes: number
  approvedLeaveDays: number
  /** Absences NOT covered by approved leave. This is the deduction. */
  unpaidAbsenceDays: number
}

/** GET /api/attendance/summary/by-branch. */
export interface AttendanceBranchSummary {
  employeeId: number
  fullName: string
  branchId: number | null
  branchName: string | null
  days: number
  daysWorked: number
  workedMinutes: number
  overtimeMinutes: number
}

export interface ProcessResult {
  employeeDaysProcessed: number
}

export interface MarkAbsenteesResult {
  absenteesMarked: number
}

/* ── Auto-roster (6/5 rhythm, fair weekends) — api/roster/auto, docs/AUTO_ROSTER.md §4 ── */

/*
 * What the drawer SENDS is typed as unions: the page only ever writes these values. What the
 * server SENDS BACK (a cell's state, origin and change, an issue's severity and code) is a plain
 * string, for the reason RosterMonthStatus gives: a value from a newer server must render as
 * itself, not break the grid it appears on.
 */

/** D11. FillEmpty: only empty days. ReplanAuto: also days still as the generator wrote them. ReplanAll: all but pinned/locked/leave. */
export type AutoRosterMode = 'FillEmpty' | 'ReplanAuto' | 'ReplanAll'

/** D2. Aligned: everyone's first planned week is a 6-day week. Staggered: half the team starts on 5. */
export type AutoRosterRhythmStart = 'Aligned' | 'Staggered'

/** How many people work one public holiday. A holiday not listed is closed (0). */
export interface AutoRosterHolidayCover {
  date: string
  count: number
}

/** "This week is a 5-day week": re-anchors one employee's rhythm; saved by the commit. */
export interface AutoRosterRhythmOverride {
  employeeId: number
  /** Any day of the week; the planner moves it back to that week's Monday. */
  weekStart: string
  /** 6 or 5. */
  workDays: number
}

/**
 * A day the manager set by hand in the draft. Regenerate plans AROUND these — each is fixed exactly
 * as sent. A rest day is isRestDay with no shift; no shift and not a rest day means "leave it empty".
 */
export interface AutoRosterDraftCell {
  employeeId: number
  workDate: string
  shiftId?: number | null
  isRestDay: boolean
  /** "Keep when regenerating" — saved as a pin by the commit. */
  isPinned?: boolean | null
}

/** POST api/roster/auto/preview. */
export interface AutoRosterRequest {
  branchId: number
  /** 'yyyy-MM'. */
  month: string
  mode: AutoRosterMode
  /** Null = the RosterRhythmStart setting. Only decides rhythms that are not stored yet. */
  rhythmStart?: AutoRosterRhythmStart | null
  defaultShiftId?: number | null
  holidayCover: AutoRosterHolidayCover[]
  /** The complete off-rotation list: the drawer always sends every staff member's state. */
  offRotationEmployeeIds: number[]
  rhythmOverrides: AutoRosterRhythmOverride[]
  draftCells: AutoRosterDraftCell[]
}

/** The row a cell had when the preview read it — echoed back by the commit as its concurrency check. */
export interface AutoRosterCellExpected {
  exists: boolean
  shiftId?: number | null
  isRestDay?: boolean | null
}

/** One employee-day of the draft (the whole Monday–Sunday window, not only the month). */
export interface AutoRosterCell {
  employeeId: number
  workDate: string
  /** work · rest · none (none = no row: a public holiday off, or nothing known). */
  state: string
  shiftId?: number | null
  /** planned · fact · locked · pinned · leave · holiday · draft · ghost · outside. */
  origin: string
  /** insert · update · delete · unchanged · kept. "kept" is never sent back to the commit. */
  change: string
  reasonCode?: string | null
  /** A small JSON object with the reason's figures, e.g. '{"owed":0.86}' or '{"shift":"Evening"}'. */
  reasonArgs?: string | null
  expected: AutoRosterCellExpected
}

/** An employee's 6/5 anchor: the week of anchorWeekStart has anchorWorkDays working days, then it alternates. */
export interface AutoRosterRhythm {
  employeeId: number
  /** A Monday. */
  anchorWeekStart: string
  anchorWorkDays: number
  /** Not stored yet, or changed by an override: the commit saves it. */
  isNew: boolean
}

/** One week of an employee's 6·5 strip. */
export interface AutoRosterWeekCounter {
  /** A Monday. */
  weekStart: string
  /** The rhythm's type for the week: 6 or 5. */
  workDays: number
  rests: number
  /** Rest days the week should hold — fewer than 7 − workDays when part of it is not employed. */
  quota: number
  /** Rests = quota, or the shortfall was absorbed by a leave. Drawn red when false. */
  ok: boolean
}

export interface AutoRosterEmployeeCounters {
  employeeId: number
  /** Working days in the month (D14: payroll still assumes 26; 6/5 gives about 24). */
  workDays: number
  restDays: number
  saturdaysOff: number
  sundaysOff: number
  /** Weekend fair-share balance after this plan: positive = owed days off, negative = had more than a fair share. */
  owedSaturday: number
  owedSunday: number
  weeks: AutoRosterWeekCounter[]
}

/** On duty on one shift a day must cover (D16), against that shift's minimum and target. */
export interface AutoRosterShiftCounter {
  shiftId: number
  onDuty: number
  min: number
  target?: number | null
}

/** The footer cell under a day. On a public holiday `min` is the cover asked for. */
export interface AutoRosterDayCounters {
  date: string
  onDuty: number
  min?: number | null
  target?: number | null
  /**
   * Each shift the day must cover (D16), in the order they start. Empty on a closed holiday, and
   * when the branch has no shift to cover.
   */
  shifts: AutoRosterShiftCounter[]
}

/** Something the plan could not satisfy, or a rule an edit breaks. An error blocks the save. */
export interface AutoRosterIssue {
  /** error · warning · info. */
  severity: string
  /** The §2.7 code (and D16's SHIFT_UNCOVERED) — translated under attendance.roster.auto.issue. */
  code: string
  employeeId?: number | null
  date?: string | null
  /** D16: the shift a SHIFT_UNCOVERED or per-shift SHORT_STAFFED issue is about — named on the card in the page's language. */
  shiftId?: number | null
  /** The server's English sentence with the figures; shown when the code is unknown here. */
  message: string
}

/** What saving the draft would do to the month's rows. */
export interface AutoRosterSummary {
  inserts: number
  updates: number
  deletes: number
  unchanged: number
  kept: number
}

/** POST api/roster/auto/preview → the draft. Writes nothing. */
export interface AutoRosterPreview {
  branchId: number
  /** The 1st of the month. */
  monthDate: string
  /** Monday on/before the 1st. */
  windowFrom: string
  /** Sunday on/after the last day. */
  windowTo: string
  cells: AutoRosterCell[]
  rhythm: AutoRosterRhythm[]
  perEmployee: AutoRosterEmployeeCounters[]
  perDay: AutoRosterDayCounters[]
  issues: AutoRosterIssue[]
  summary: AutoRosterSummary
}

/** One month cell the commit writes: upsert a working/rest row, or delete the row (a holiday off). */
export interface AutoRosterCommitCell {
  employeeId: number
  workDate: string
  action: 'upsert' | 'delete'
  shiftId?: number | null
  isRestDay: boolean
  expected: AutoRosterCellExpected
  /** The planner chose it (ReplanAuto may change it later); false for the manager's own edit. */
  isAuto: boolean
  reasonCode?: string | null
  /** Null = leave the pin as it is. */
  isPinned?: boolean | null
}

/** A rhythm (and the on-rotation flag) the commit stores. */
export interface AutoRosterCommitRhythm {
  employeeId: number
  /** Left out (with anchorWorkDays) when only the on-rotation flag is stored. */
  anchorWeekStart?: string
  anchorWorkDays?: number
  onRotation: boolean
}

/** POST api/roster/auto/commit — the request, plus exactly the cells to write. */
export interface AutoRosterCommitRequest extends AutoRosterRequest {
  cells: AutoRosterCommitCell[]
  rhythm: AutoRosterCommitRhythm[]
}

export interface AutoRosterCommitResult {
  runId: number
  rowsInserted: number
  rowsUpdated: number
  rowsDeleted: number
}

/** The 'Roster' settings section (§3.2), keys in camelCase. */
export interface AutoRosterSettings {
  rosterRhythmStart: string
  rosterHolidayCountsAsRest: boolean
  rosterMaxConsecutiveWorkDays: number
  rosterPreferredMaxConsecutiveWorkDays: number
  rosterFairnessLookbackWeeks: number
  rosterPairRestDays: boolean
  rosterPatternRestDays: string
  rosterMinHoursBetweenShifts: number
  rosterMinWeeklyRestHours: number
}

/** A row of the drawer's staff list. */
export interface AutoRosterSetupStaff {
  employeeId: number
  fullName: string
  position?: string | null
  onRotation: boolean
  /** The stored anchor, if any. */
  anchorWeekStart?: string | null
  anchorWorkDays?: number | null
  /** 6 or 5: the month's first week as the planner would use it now. */
  firstWeekWorkDays: number
}

export interface AutoRosterSetupHoliday {
  date: string
  name: string
  isPaid: boolean
}

export interface AutoRosterSetupShift {
  shiftId: number
  name: string
}

/** Minimum (and target) on duty for a branch. dayOfWeek 1 = Monday .. 7 = Sunday, null = every day; shiftId null = any shift. */
export interface StaffingRequirementDto {
  dayOfWeek?: number | null
  shiftId?: number | null
  minOnDuty: number
  targetOnDuty?: number | null
}

/** GET api/roster/auto/setup — everything the drawer opens with. */
export interface AutoRosterSetup {
  branchId: number
  monthDate: string
  settings: AutoRosterSettings
  staff: AutoRosterSetupStaff[]
  /** The branch's stored rows, day-level and per shift, exactly as saved. */
  staffing: StaffingRequirementDto[]
  /**
   * D16 — the shifts every day must cover, as the planner will read them (active shifts only). The
   * branch's stored per-shift rows when it has any — a row with minOnDuty 0 is "this shift need not
   * be covered" — else the shifts it actually runs, found from its last 8 weeks of roster and weekly
   * patterns, each { dayOfWeek: null, minOnDuty: 1, targetOnDuty: null }.
   */
  shiftCover: StaffingRequirementDto[]
  /** shiftCover was found, not stored: the branch has no per-shift row. True with an empty list = nothing found. */
  shiftCoverDetected: boolean
  holidays: AutoRosterSetupHoliday[]
  /** Active shifts only — an inactive shift is never written. */
  shifts: AutoRosterSetupShift[]
  /** The branch's last saved run, as the drawer's defaults. Null before the first run. */
  lastParams?: AutoRosterRequest | null
  monthStatus?: string | null
  /** A roster approval waiting on the month: nothing may be planned until it is decided. */
  openRequestId?: number | null
}

/** GET api/roster/auto/cells — the pin and the auto marker of a saved day. */
export interface RosterCellInfo {
  employeeId: number
  workDate: string
  isPinned: boolean
  /** The row still equals what the generator wrote; any other writer makes it manual. */
  isAuto: boolean
  reasonCode?: string | null
}

/** PUT api/roster/auto/rhythm — on/off rotation, and optionally the anchor. */
export interface RosterRhythmDto {
  employeeId: number
  onRotation: boolean
  anchorWeekStart?: string | null
  anchorWorkDays?: number | null
}

/** PUT api/roster/auto/pin — pins a SAVED day; it writes no roster row. */
export interface RosterPinRequest {
  employeeId: number
  workDate: string
  isPinned: boolean
}
