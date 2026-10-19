/**
 * THE TIER A NEW EMPLOYEE STANDS ON (QA3 LEAD-1).
 *
 * Tier 1 is the HEAD of the organisation (decision D6) and a bigger number is more junior, so the
 * tier nobody chose is the LOWEST one — the highest number in the dictionary — never 1. Somebody who
 * silently became tier 1 was the head of every tier-scoped chain and of the salary band.
 *
 * Pure, so the rule is tested without a component (tests/tierDefault.test.ts).
 */

/** The lowest tier of the dictionary (the highest TierNo), or null while it is empty or still loading. */
export function lowestTier(tiers: readonly { tierNo: number }[]): number | null {
  let lowest: number | null = null
  for (const tier of tiers) if (lowest == null || tier.tierNo > lowest) lowest = tier.tierNo
  return lowest
}

/**
 * What the form shows and sends. A chosen tier always wins; on CREATE an untouched one is the lowest
 * tier; on EDIT nothing is invented (the record's own tier fills the form).
 */
export function effectiveTier(
  chosen: number | null,
  isEdit: boolean,
  tiers: readonly { tierNo: number }[],
): number | null {
  if (chosen != null) return chosen
  return isEdit ? null : lowestTier(tiers)
}
