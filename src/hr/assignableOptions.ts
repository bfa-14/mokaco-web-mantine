import { t } from '../i18n/t'
import type { Branch, Department, Position } from '../types/hr'

/**
 * Options for a Select that ASSIGNS one of the org lookups (branch, department, position) to a
 * record.
 *
 * THE RULE: only active items may be CHOSEN. Deactivating a branch is how the register says "stop
 * putting people here", and a picker that keeps offering it quietly undoes that — the lookup admin
 * screens turn the flag off and every assignment form then has to honour it.
 *
 * THE EXCEPTION, and the reason this is a shared helper rather than a `.filter()` at each call
 * site: on EDIT, whatever the record ALREADY holds stays in the list even when it has since been
 * deactivated. A Mantine Select whose value is absent from its data renders BLANK, so filtering
 * without this would make an existing assignment look unset — and saving that blank would erase a
 * posting nobody meant to touch. The kept option is labelled "(inactive)" so it reads as a state of
 * the record rather than as a still-offered choice; picking anything else drops it for good, which
 * is exactly what choosing a different branch should mean.
 *
 * DISPLAY IS NOT ASSIGNMENT. Grids, report filters and "which branch am I looking at" pickers keep
 * listing everything — a decommissioned branch still has history worth reading, and hiding it there
 * would hide the data, not prevent a change.
 *
 * Pass `current` as the value the form currently holds (null when creating). Same `t` reasoning as
 * every other non-component module: LanguageProvider remounts the tree on a switch, so there is no
 * cached label left in yesterday's language.
 */
export interface AssignableItem {
  value: number
  label: string
  isActive: boolean
}

export function assignableOptions(
  items: AssignableItem[],
  current: number | null | undefined,
): { value: string; label: string }[] {
  return items
    .filter((item) => item.isActive || item.value === current)
    .map((item) => ({
      value: String(item.value),
      label: item.isActive ? item.label : t('common.inactiveOption', { name: item.label }),
    }))
}

/* The three concrete lookups, so a call site reads as the thing it is picking rather than as a
   mapping exercise. Each is the only place that knows which field carries that lookup's id. */

export const branchOptions = (rows: Branch[], current: number | null | undefined) =>
  assignableOptions(
    rows.map((b) => ({ value: b.branchId, label: b.name, isActive: b.isActive })),
    current,
  )

export const departmentOptions = (rows: Department[], current: number | null | undefined) =>
  assignableOptions(
    rows.map((d) => ({ value: d.departmentId, label: d.name, isActive: d.isActive })),
    current,
  )

export const positionOptions = (rows: Position[], current: number | null | undefined) =>
  assignableOptions(
    rows.map((p) => ({ value: p.positionId, label: p.title, isActive: p.isActive })),
    current,
  )
