import type { ComponentType } from '../../types/hr.ts'

/**
 * The components a payroll adjustment can be raised against (QA3 WEB-10).
 *
 * Read from GET /api/component-types (EMP_VIEW — what the people who raise adjustments hold), not
 * from /api/payroll/component-types, which is PAYROLL_RUN's and left the box empty for them. A
 * DEACTIVATED type is not offered (an absent flag means active, as everywhere). Sorted as the old
 * list was — by category, then name — so earnings and deductions stay grouped.
 */
export function adjustmentComponentOptions(types: readonly ComponentType[]): ComponentType[] {
  return types
    .filter((ct) => ct.isActive !== false)
    .slice()
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}
