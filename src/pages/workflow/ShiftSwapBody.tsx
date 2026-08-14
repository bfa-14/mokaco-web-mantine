import { useEffect, useMemo, useState } from 'react'
import { Checkbox, Select } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { shiftSwapsService } from '../../services/workflowService'
import { rosterService } from '../../services/attendanceService'
import { employeesService } from '../../services/hrService'
import type { EmployeeListItem } from '../../types/hr'
import { employeeLabel } from '../../types/hr'
import type { ShiftAssignment } from '../../types/attendance'
import type { RequestFormBody } from './newRequestShared'
import { t } from '../../i18n/t'

/** Module-level, so an empty counterpart list keeps ONE identity across renders. */
const NO_EMPLOYEES: EmployeeListItem[] = []

function todayYMD(): string {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

/** The one-line reading of a fetched assignment: the shift, a rest day, or nothing known. */
function assignmentHint(a: ShiftAssignment | null | undefined): string | null {
  if (a === undefined) return null // not fetched yet / unreadable — say nothing
  if (a === null || a.isRestDay || !a.shiftId) return t('body.shiftSwap.noShift')
  return t('body.shiftSwap.rostered', {
    shift: a.shiftName,
    from: a.startTime?.slice(0, 5),
    to: a.endTime?.slice(0, 5),
  })
}

/**
 * The SHIFT SWAP form body — two people in the same role trade one rostered day each.
 * CONSENT IS ASSERTED, NOT COLLECTED: the checkbox is a hard gate here and the procedure refuses
 * without it. SAME ROLE is display-filtered here; the procedure re-checks PositionId and rules.
 * Roster hints follow the tagged-fetch pattern. (Unchanged.)
 */
export function useShiftSwapForm(employeeId: number | null, saving: boolean): RequestFormBody {
  const [employees, setEmployees] = useState<EmployeeListItem[]>([])
  const [counterpartId, setCounterpartId] = useState<number | null>(null)
  const [requesterDate, setRequesterDate] = useState<string | null>(null) // yyyy-MM-dd
  const [counterpartDate, setCounterpartDate] = useState<string | null>(null) // yyyy-MM-dd
  const [agreed, setAgreed] = useState(false)
  const [reqFetched, setReqFetched] = useState<{ key: string; row: ShiftAssignment | null } | null>(null)
  const [cptFetched, setCptFetched] = useState<{ key: string; row: ShiftAssignment | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    employeesService
      .getAll()
      .then((e) => {
        if (!cancelled) setEmployees(e)
      })
      .catch(() => {
        /* no list: the counterpart dropdown stays empty and missing() names it */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const requester = useMemo(
    () => employees.find((e) => e.employeeId === employeeId) ?? null,
    [employees, employeeId],
  )

  /** Counterparts: same position, active, not the requester. */
  const counterparts = useMemo(
    () =>
      requester
        ? employees.filter(
            (e) =>
              e.employeeId !== requester.employeeId &&
              e.position === requester.position &&
              !e.terminationDate,
          )
        : NO_EMPLOYEES,
    [employees, requester],
  )

  /** What an empty counterpart list MEANS — the rule, not just the absence. */
  const noCounterpartText = requester
    ? t('body.shiftSwap.noCounterpart', { role: requester.position })
    : t('body.shiftSwap.chooseEmployeeFirst')

  /** A counterpart chosen under a previous requester may no longer qualify — derive, don't reset. */
  const chosenCounterpart = useMemo(
    () => (counterparts.some((c) => c.employeeId === counterpartId) ? counterpartId : null),
    [counterparts, counterpartId],
  )

  const reqYMD = requesterDate
  const cptYMD = counterpartDate

  useEffect(() => {
    if (!employeeId || !reqYMD) return
    const key = `${employeeId}|${reqYMD}`
    let cancelled = false
    rosterService
      .forEmployee(employeeId, reqYMD, reqYMD)
      .then((rows) => {
        if (!cancelled) setReqFetched({ key, row: rows[0] ?? null })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [employeeId, reqYMD])

  useEffect(() => {
    if (!chosenCounterpart || !cptYMD) return
    const key = `${chosenCounterpart}|${cptYMD}`
    let cancelled = false
    rosterService
      .forEmployee(chosenCounterpart, cptYMD, cptYMD)
      .then((rows) => {
        if (!cancelled) setCptFetched({ key, row: rows[0] ?? null })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [chosenCounterpart, cptYMD])

  const reqAssignment =
    employeeId && reqYMD && reqFetched?.key === `${employeeId}|${reqYMD}`
      ? reqFetched.row
      : undefined
  const cptAssignment =
    chosenCounterpart && cptYMD && cptFetched?.key === `${chosenCounterpart}|${cptYMD}`
      ? cptFetched.row
      : undefined

  const counterpartName =
    counterparts.find((c) => c.employeeId === chosenCounterpart)?.fullName ?? null

  // Mirrors usp_ShiftSwap_Create's CONCAT: "Swap: A d1 <-> B d2".
  const autoTitle =
    requester && counterpartName && reqYMD && cptYMD
      ? `Swap: ${requester.fullName} ${reqYMD} <-> ${counterpartName} ${cptYMD}`
      : null

  const missing = !chosenCounterpart
    ? t('body.shiftSwap.missingCounterpart')
    : !reqYMD
      ? t('body.shiftSwap.missingYourDate')
      : !cptYMD
        ? t('body.shiftSwap.missingTheirDate')
        : !agreed
          ? t('body.shiftSwap.missingAgreement')
          : null

  const node = (
    <>
      <div className="form-field">
        <Select
          label={t('body.shiftSwap.counterpart')}
          data={counterparts.map((c) => ({ value: String(c.employeeId), label: employeeLabel(c) }))}
          value={chosenCounterpart != null ? String(chosenCounterpart) : null}
          searchable
          placeholder={
            requester
              ? t('body.shiftSwap.sameRole', { role: requester.position })
              : t('body.shiftSwap.chooseEmployeeFirst')
          }
          nothingFoundMessage={noCounterpartText}
          disabled={saving || !requester}
          onChange={(v) => setCounterpartId(v != null ? Number(v) : null)}
        />
      </div>

      <div className="form-grid">
        <div className="form-field">
          {/* Both dates are required, so neither is clearable; `min` → `minDate`, same string. */}
          <DatePickerInput
            label={t('body.shiftSwap.yourDate')}
            valueFormat="DD/MM/YYYY"
            leftSection={<IconCalendar size={14} />}
            minDate={todayYMD()}
            value={requesterDate}
            disabled={saving}
            onChange={(v) => setRequesterDate(v || null)}
          />
          {assignmentHint(reqAssignment) && (
            <div className="hint">{assignmentHint(reqAssignment)}</div>
          )}
        </div>

        <div className="form-field">
          <DatePickerInput
            label={t('body.shiftSwap.theirDate')}
            valueFormat="DD/MM/YYYY"
            leftSection={<IconCalendar size={14} />}
            minDate={todayYMD()}
            value={counterpartDate}
            disabled={saving}
            onChange={(v) => setCounterpartDate(v || null)}
          />
          {assignmentHint(cptAssignment) && (
            <div className="hint">{assignmentHint(cptAssignment)}</div>
          )}
        </div>
      </div>

      <div className="form-field">
        <Checkbox
          checked={agreed}
          label={t('body.shiftSwap.agreed')}
          disabled={saving}
          onChange={(e) => setAgreed(e.currentTarget.checked)}
        />
        <div className="hint">{t('body.shiftSwap.agreedHint')}</div>
      </div>
    </>
  )

  return {
    node,
    autoTitle,
    missing,
    async submit(empId, title) {
      if (empId == null || !chosenCounterpart || !reqYMD || !cptYMD)
        throw new Error(t('common.formIncomplete'))
      const created = await shiftSwapsService.create({
        employeeId: empId,
        counterpartEmployeeId: chosenCounterpart,
        requesterDate: reqYMD,
        counterpartDate: cptYMD,
        counterpartHasAgreed: agreed,
        title: title ?? undefined,
      })
      return {
        requestId: created.requestInstanceId,
        notice: created.noticeShorterThanRecommended
          ? t('body.shiftSwap.noticeShortNotice')
          : null,
      }
    },
  }
}
