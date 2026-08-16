import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { chainsService, meService } from '../../services/workflowService'
import { employeesService } from '../../services/hrService'
import type { EmployeeListItem } from '../../types/hr'
import type {
  ActiveDefinitionStep,
  MyEmployee,
  RaisableRequestType,
} from '../../types/workflow'
import { WF } from '../../types/workflow'
import { t } from '../../i18n/t'

/**
 * What a typed request FORM BODY hands back to <NewRequestShell>.
 *
 * The shell owns everything a request needs whatever its kind — which kind, who it is for, the chain
 * that will run, the title, the submit button and the errors. A body owns only the fields peculiar to
 * ITS type, and reports the three things the shell cannot work out for itself: what the request will
 * be called, what is still missing, and how to raise it.
 *
 * Bodies are HOOKS rather than components because the shell needs `autoTitle` and `missing` while it
 * renders — a component reporting them upward through an effect would always be one render stale, and
 * the submit button would enable a beat late.
 */
export interface RequestFormBody {
  /** The type's own fields, rendered by the shell inside its ValidationGroup. */
  node: React.ReactNode

  /**
   * The title the STORED PROCEDURE will compose, mirrored exactly so the live preview cannot drift
   * from what is actually stored. Null until the body has enough filled in to compose one.
   */
  autoTitle: string | null

  /**
   * The FIRST genuinely-missing required field, named — so the submit button can say why it is off
   * instead of sitting there dead. Null when the body is ready.
   */
  missing: string | null

  /** True for types whose subject is a branch, not a person. */
  hidesEmployee?: boolean

  /**
   * Raise it. Returns the new request; throws with the API's message on refusal.
   *
   * NULLABLE because a {@link RequestFormBody.hidesEmployee} type has no subject employee to pass —
   * its procedure derives the person from the token instead. Bodies that DO need one say so in their
   * own incomplete-form guard, which is where TypeScript then narrows it back to a number.
   */
  submit: (employeeId: number | null, title: string | null) => Promise<SubmitResult>
}

/**
 * What raising a request produced.
 *
 * `notice` is the case a plain id could not express: the request WAS accepted, and something about
 * it is still worth saying — leave raised at shorter notice than the type prefers, for instance. It
 * is not a refusal and must never read as one, so it travels to the request it created and is shown
 * there rather than as a toast that disappears while the page is still loading.
 */
export interface SubmitResult {
  requestId: number
  notice?: string | null
}

/**
 * Everything shared by every "raise a request" screen: what may be raised, who it may be raised for,
 * and the chain that will actually run for the chosen person.
 *
 * Held in a hook rather than inside the shell so a BODY can read the same selection (leave needs the
 * employee to fetch their balance) without the shell and the bodies having to talk to each other.
 */
export interface RaiseContext {
  loading: boolean
  types: RaisableRequestType[]
  me: MyEmployee | null
  employees: EmployeeListItem[]
  canRaiseOthers: boolean
  /** A self-service user with no linked employee record: there is no id to file against. */
  selfBlocked: boolean

  type: string | null
  setType: (code: string | null) => void
  employeeId: number | null
  setEmployeeId: (id: number | null) => void

  /** The active chain per type code, read FOR the selected employee. */
  chains: Record<string, ActiveDefinitionStep[]>
  /** The selected type's chain. */
  chain: ActiveDefinitionStep[]
  /** Step 1 resolves to the requester themselves and will be skipped — worth saying before they submit. */
  willSkipStep1: boolean
}

/**
 * WHICH GROUP EACH TYPE SITS UNDER in the picker.
 *
 * One line per type, in one place — adding a type is a single entry here, and a type that is NOT
 * listed still appears, under "Other". That fallback is deliberate: a new type showing up in a
 * visible group nobody chose is a prompt to file it properly, whereas silently dropping it from the
 * list would make a published chain look broken.
 */
export const TYPE_GROUPS: Record<string, string> = {
  EXIT_PERMISSION: 'Time',
  LEAVE_REQUEST: 'Time',
  OVERTIME: 'Time',
  SHIFT_SWAP: 'Schedule',
  AVAILABILITY_CHANGE: 'Schedule',
  ROSTER_APPROVAL: 'Schedule',
  ONBOARDING: 'People',
  SEPARATION: 'People',
  TIP_DISTRIBUTION: 'Money',
  EXPENSE_REIMBURSEMENT: 'Money',
  PAYROLL_ADJUSTMENT: 'Money',
  SALARY_ADVANCE: 'Money',
}

/** The order groups appear in. Anything unlisted lands in the trailing catch-all. */
export const GROUP_ORDER = ['Time', 'Schedule', 'Money', 'People', 'Other'] as const

export function groupOfType(code: string): string {
  return TYPE_GROUPS[code] ?? 'Other'
}

/** The group's heading, translated. The code — 'Money', 'Time' — stays the stable key. */
export function groupLabel(group: string): string {
  return t(`workflow.typeGroup.${group}`)
}

/** The query parameter that deep-links a type: /requests/new?type=OVERTIME. */
export const TYPE_QUERY_PARAM = 'type'

/**
 * The type named in the URL, or null.
 *
 * Read from window.location rather than a router hook so it can be consulted once inside the load
 * effect — the selection has to be settled in the same pass that resolves the raisable list, or the
 * single-type auto-select would win first and then be overridden a render later.
 */
function typeFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(TYPE_QUERY_PARAM)
}

export function useRaiseContext(): RaiseContext {
  const { hasPermission } = useAuth()
  const canRaiseOthers = hasPermission(WF.raiseOthers)

  const [types, setTypes] = useState<RaisableRequestType[]>([])
  const [chains, setChains] = useState<Record<string, ActiveDefinitionStep[]>>({})
  const [type, setType] = useState<string | null>(null)
  const [me, setMe] = useState<MyEmployee | null>(null)
  const [employees, setEmployees] = useState<EmployeeListItem[]>([])
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function initial() {
      const [typeList, employee, emps] = await Promise.all([
        // RAISABLE, not the full catalogue: types without a published chain are excluded (raising one
        // always fails), and unlike the catalogue this is readable without WORKFLOW_CONFIGURE — an
        // employee raising a request is not an administrator.
        chainsService.getRaisableRequestTypes().catch(() => [] as RaisableRequestType[]),
        meService.employee().catch(() => null),
        canRaiseOthers
          ? employeesService.getAll().catch(() => [] as EmployeeListItem[])
          : Promise.resolve([] as EmployeeListItem[]),
      ])
      if (cancelled) return

      setTypes(typeList)
      setMe(employee)
      setEmployees(emps)
      setEmployeeId(employee?.employeeId ?? null)

      // THE DEEP LINK WINS, when it names something actually raisable. Settled here rather than in
      // a later effect so there is no flash of the wrong selection: a ?type= that has no published
      // chain simply does not match, and the ordinary rules below apply instead.
      const wanted = typeFromUrl()
      const deepLinked = wanted && typeList.some((t) => t.code === wanted) ? wanted : null
      // With exactly one type, pre-select it — but the list still shows, so what is being raised is
      // never implicit.
      setType(deepLinked ?? (typeList.length === 1 ? typeList[0].code : null))
      setLoading(false)
    }
    void initial()
    return () => {
      cancelled = true
    }
  }, [canRaiseOthers])

  // The preview must be the chain that WILL ACTUALLY RUN for the person the request is for — which
  // depends on THEIR tier, not just the type. So it is re-fetched with the selected employeeId, and
  // again whenever that selection changes: pick a tier-2 employee and the shorter chain appears.
  useEffect(() => {
    if (types.length === 0) return
    let cancelled = false
    async function loadChains() {
      const pairs = await Promise.all(
        types.map(
          async (t) =>
            [
              t.code,
              await chainsService
                .getActive(t.code, employeeId)
                .catch(() => [] as ActiveDefinitionStep[]),
            ] as const,
        ),
      )
      if (!cancelled) setChains(Object.fromEntries(pairs))
    }
    void loadChains()
    return () => {
      cancelled = true
    }
  }, [types, employeeId])

  /**
   * Selecting a type also rewrites ?type= — with replaceState, NOT a navigation.
   *
   * A pushState per click would fill the back button with type changes, so leaving the page would
   * mean pressing Back once per type the user looked at. replaceState keeps the URL shareable and
   * the history honest: one entry for "I was raising a request".
   */
  const selectType = useCallback((code: string | null) => {
    setType((prev) => (prev === code ? prev : code))
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (code) url.searchParams.set(TYPE_QUERY_PARAM, code)
    else url.searchParams.delete(TYPE_QUERY_PARAM)
    window.history.replaceState(window.history.state, '', url)
  }, [])

  const chain = type ? (chains[type] ?? []) : []

  // If the caller is raising for THEMSELVES and they manage their own branch, step 1 resolves to them
  // and will be skipped.
  const raisingForSelf = employeeId === me?.employeeId
  const step1IsBranchManager = chain[0]?.approverType === 'BranchManager'

  return {
    loading,
    types,
    me,
    employees,
    canRaiseOthers,
    selfBlocked: !canRaiseOthers && !me,
    type,
    setType: selectType,
    employeeId,
    setEmployeeId,
    chains,
    chain,
    willSkipStep1: raisingForSelf && me?.isBranchManager === true && step1IsBranchManager,
  }
}

/**
 * Inclusive calendar-day count between two yyyy-MM-dd dates — the SAME arithmetic as the procedure's
 * DATEDIFF(DAY, from, to) + 1, so the count shown is the count stored. Null when the order is wrong.
 *
 * Parsed as UTC on purpose: a local-midnight Date shifts across DST boundaries and would drop or add
 * a day in exactly the cases people notice.
 */
export function inclusiveDays(fromYMD: string, toYMD: string): number | null {
  const from = Date.parse(`${fromYMD}T00:00:00Z`)
  const to = Date.parse(`${toYMD}T00:00:00Z`)
  if (Number.isNaN(from) || Number.isNaN(to)) return null
  const days = Math.round((to - from) / 86_400_000) + 1
  return days > 0 ? days : null
}

/** "6 days" / "1 day" — the day count in words, for the live line under the dates. */
export function dayCountText(days: number): string {
  return t('common.days', { count: days })
}

/** A decimal day figure as it should read in a balance line: "8.5 days", "8 days", "−2 days". */
export function balanceDaysText(days: number): string {
  const rounded = Math.round(days * 100) / 100
  // A SEPARATE key from common.days, because the plural category has to follow the MAGNITUDE while
  // the text shows the SIGN: Intl.PluralRules puts every negative in 'other', so a −1 balance would
  // otherwise read as 'minus one days'. count picks the wording, value is what gets printed.
  return t('common.daysSigned', { count: Math.abs(rounded), value: rounded })
}
