import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { approvalTiersService } from '../services/hrService'
import { useLanguage } from '../i18n/useLanguage'
import type { ApprovalTier } from '../types/hr'

/**
 * THE SENIORITY DICTIONARY, FETCHED ONCE PER SESSION AND SHARED.
 *
 * Tier names are printed on the employee list, the org chart, the employee form and anyone's own
 * profile — a page can easily want two hundred of them at once. A hook that fetched per component
 * would issue a request per screen and, worse, let two screens disagree for as long as one of them
 * held a stale copy. So the list lives in ONE module-level cache with subscribers, and the whole
 * app re-renders off the same array.
 *
 * WHY NOT A PROVIDER: this is read from leaf components all over the tree (a grid cell, a badge)
 * and has no per-user state. A provider would mean threading it through App.tsx and remounting the
 * tree on a language switch — which is exactly what LanguageProvider already does, and the socket
 * had to be moved outside it to survive. A plain store has neither problem.
 */

/** The shared copy. `null` means "never loaded", which is distinct from "loaded and empty". */
let cache: ApprovalTier[] | null = null
/** The in-flight request, so N components mounting together share ONE fetch rather than racing. */
let inFlight: Promise<ApprovalTier[]> | null = null

const subscribers = new Set<() => void>()

function publish() {
  for (const notify of subscribers) notify()
}

function load(): Promise<ApprovalTier[]> {
  if (inFlight) return inFlight

  inFlight = approvalTiersService
    .getAll()
    .then((list) => {
      /* SORTED ASCENDING, ONCE, HERE — so every consumer inherits the same order and none of them
         has to know what the order MEANS. Tier 1 is the head of the organisation and a bigger
         number is a lower role, so ascending is seniority order: the most senior first. Sorting at
         the source is also what stops a screen from quietly depending on the API's row order. */
      cache = [...list].sort((a, b) => a.tierNo - b.tierNo)
      return cache
    })
    .catch((err) => {
      // A failed load must not poison the cache — leaving it null means the next mount retries,
      // and tierName() falls back to "Tier N" in the meantime rather than rendering nothing.
      throw err
    })
    .finally(() => {
      inFlight = null
      publish()
    })

  return inFlight
}

/**
 * Drops the shared copy and re-fetches, then wakes every subscriber.
 *
 * Called after any edit on the Tiers page, so the badge on the employee list and the options in the
 * employee form change in the same breath as the dictionary — without a reload, and without each
 * screen having to know the edit happened.
 */
export async function invalidateApprovalTiers(): Promise<void> {
  cache = null
  inFlight = null
  try {
    await load()
  } catch {
    // The Tiers page reports its own save/delete failures; a failed REFRESH after a successful
    // write is not something to raise a second notification about.
  }
  publish()
}

/** Read the cache without subscribing — for the odd non-React caller. */
export function approvalTiersSnapshot(): ApprovalTier[] {
  return cache ?? []
}

export interface UseApprovalTiers {
  tiers: ApprovalTier[]
  loading: boolean
  /**
   * A tier number as the word for it, in the reader's language.
   *
   * Arabic falls back to the English name when a tier has no nameAr — a half-translated dictionary
   * should show the name somebody typed, not the number. An unknown number says "Tier N" rather
   * than guessing: data can hold a tier the dictionary has lost (a row deleted while somebody still
   * held it would be refused, but a restore or a direct UPDATE can still do it), and labelling an
   * elevated person as the lowest tier is worse than showing the raw number.
   */
  tierName: (tierNo: number) => string
  /**
   * Options for a Select, in seniority order (tier 1 — the head — first).
   *
   * Values are strings because that is what Mantine's Select binds to; callers turn them back into
   * numbers.
   */
  options: { value: string; label: string }[]
  /**
   * Which population a chain serves, from its MinRequesterTier.
   *
   * null = everyone. Otherwise the chain applies to that tier AND EVERYONE MORE SENIOR — which is
   * everyone with a SMALLER number, now that tier 1 is the head. This replaced a hard-coded
   * two-entry map ("Management+", "Executive") that both named the tiers itself and assumed a
   * bigger number was the more senior one; it was wrong on both counts the moment the dictionary
   * became editable.
   */
  populationLabel: (minRequesterTier: number | null) => string
  refetch: () => Promise<void>
}

export function useApprovalTiers(): UseApprovalTiers {
  const { language } = useLanguage()
  const { t } = useTranslation()
  const [, forceRender] = useState(0)

  useEffect(() => {
    const notify = () => forceRender((n) => n + 1)
    subscribers.add(notify)

    // First mount anywhere in the app starts the one fetch; later mounts join it or read the cache.
    if (cache === null && !inFlight) {
      void load().catch(() => {
        // Swallowed on purpose: a screen that merely PRINTS a tier name must not break because the
        // dictionary is unreachable. tierName() degrades to "Tier N" and the page still renders.
      })
    }

    return () => {
      subscribers.delete(notify)
    }
  }, [])

  const tiers = cache ?? []

  const tierName = useCallback(
    (tierNo: number): string => {
      const found = (cache ?? []).find((t) => t.tierNo === tierNo)
      if (!found) return `Tier ${tierNo}`
      if (language === 'ar') return found.nameAr?.trim() || found.name
      return found.name
    },
    [language],
  )

  const options = tiers.map((tier) => ({
    value: String(tier.tierNo),
    label: language === 'ar' ? tier.nameAr?.trim() || tier.name : tier.name,
  }))

  const populationLabel = useCallback(
    (minRequesterTier: number | null): string =>
      minRequesterTier == null
        ? t('workflow.tiers.everyone')
        : t('workflow.tiers.tierAndSenior', { tier: tierName(minRequesterTier) }),
    [t, tierName],
  )

  return {
    tiers,
    loading: cache === null,
    tierName,
    options,
    populationLabel,
    refetch: invalidateApprovalTiers,
  }
}
