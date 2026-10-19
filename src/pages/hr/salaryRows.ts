/**
 * THE SALARY TAB ON THE HISTORY-PRESERVING PATH (QA3 PAY-6 / REL-2).
 *
 * A salary is never edited in place any more. "Change" sets what a component is worth FROM a date
 * (PUT /api/employees/{id}/salary-components: the standing row is closed the day before and a new one
 * opens, a locked month is refused with the earliest date that works); "End" closes a standing row on a
 * date (POST /api/salary-components/{id}/end). Closed rows are history — read-only, never deleted — so a
 * month already paid keeps saying what it paid. The raw POST / PUT / DELETE routes are gone from the API.
 *
 * Which types may be assigned by hand: the active ones that payroll does not write itself — every type
 * with no system code, and the basic salary (BASIC is a system type, and it IS assigned). Overtime, NSSF,
 * tax and the other computed types come from the run.
 *
 * No imports but types, and nothing that reads the browser: `npm test` runs this with Node alone.
 */
import type { ComponentType, EmployeeSalaryComponent } from '../../types/hr'

export type SalaryRowState = 'current' | 'scheduled' | 'ended'

/** Where a row stands on `today` (YYYY-MM-DD): ended (closed before today), scheduled (starts later), current. */
export function salaryRowState(
  row: Pick<EmployeeSalaryComponent, 'effectiveFrom' | 'effectiveTo'>,
  today: string,
): SalaryRowState {
  const from = row.effectiveFrom.slice(0, 10)
  const to = row.effectiveTo ? row.effectiveTo.slice(0, 10) : null
  if (to != null && to < today) return 'ended'
  if (from > today) return 'scheduled'
  return 'current'
}

/** A row can be changed from a date or ended only while it is OPEN (no end date): closed rows are history. */
export function isOpenRow(row: Pick<EmployeeSalaryComponent, 'effectiveTo'>): boolean {
  return row.effectiveTo == null
}

/** The basic salary type: by its system code, or — an API that does not send codes — by its name. */
export function isBasicType(type: Pick<ComponentType, 'name' | 'systemCode'> | undefined): boolean {
  if (!type) return false
  if (type.systemCode) return type.systemCode === 'BASIC'
  return /\bbasic\b/i.test(type.name)
}

/** A type payroll writes on its own (overtime, NSSF, tax…) — never assigned by hand. BASIC is the exception. */
export function isComputedType(type: Pick<ComponentType, 'systemCode' | 'isSystem'>): boolean {
  const system = type.isSystem ?? !!type.systemCode
  return system && type.systemCode !== 'BASIC'
}

/**
 * The types the Change / Add form offers: active and assignable. `keepId` stays in the list whatever its
 * state, so a row being changed never blanks its own box.
 */
export function assignableTypes<T extends Pick<ComponentType, 'componentTypeId' | 'systemCode' | 'isSystem' | 'isActive'>>(
  types: readonly T[],
  keepId?: number | null,
): T[] {
  return types.filter((t) =>
    t.componentTypeId === keepId || ((t.isActive ?? true) && !isComputedType(t)))
}

/** Open rows first (by component), then the history newest first — the order the tab lists them in. */
export function sortSalaryRows<T extends Pick<EmployeeSalaryComponent, 'componentName' | 'effectiveFrom' | 'effectiveTo' | 'salaryComponentId'>>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const openA = a.effectiveTo == null ? 0 : 1
    const openB = b.effectiveTo == null ? 0 : 1
    if (openA !== openB) return openA - openB
    if (openA === 0) {
      const byName = a.componentName.localeCompare(b.componentName)
      if (byName !== 0) return byName
    }
    const byFrom = b.effectiveFrom.slice(0, 10).localeCompare(a.effectiveFrom.slice(0, 10))
    return byFrom !== 0 ? byFrom : b.salaryComponentId - a.salaryComponentId
  })
}

/**
 * The end date an End can take: on or after the row's start. Anything else is refused by the procedure
 * too — this only keeps an impossible date out of the picker.
 */
export function canEndOn(row: Pick<EmployeeSalaryComponent, 'effectiveFrom' | 'effectiveTo'>, date: string): boolean {
  return isOpenRow(row) && date.slice(0, 10) >= row.effectiveFrom.slice(0, 10)
}

/**
 * A system component type (QA3 PAY-10): payroll writes it on every payslip, so the Component types page
 * offers no rename, no deactivation and no delete for it — the procedures refuse all three anyway.
 */
export function isSystemType(type: Pick<ComponentType, 'systemCode' | 'isSystem'>): boolean {
  return type.isSystem ?? !!type.systemCode
}
