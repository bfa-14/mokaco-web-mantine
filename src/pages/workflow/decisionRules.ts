/**
 * The decision dialog's own small rules, kept out of the component so `npm test` can hold them:
 *
 *   - "Ask the employee" is a hold WAITING ON THE REQUESTER — the decision says so, and the hold must
 *     carry it (QA3 WEB-6: it was always sent as an ordinary hold, so the employee was never asked).
 *   - "Hand to someone else" needs somebody to hand to (QA3 WEB-7: it always sent user 0 and failed).
 *     The dialog picks from the people the server lists; with nobody to pick, the option is not offered.
 *
 * No imports but types: run with Node alone.
 */
import type { DecisionOption, DelegateCandidate } from '../../types/workflow'

/** Whether a Hold decision parks the request waiting on the employee's answer. */
export function holdWaitsOnRequester(decision: Pick<DecisionOption, 'waitingOnRequester'>): boolean {
  return decision.waitingOnRequester === true
}

/** The decisions worth offering: a hand-over is dropped when there is nobody it could go to. */
export function offerableDecisions<T extends Pick<DecisionOption, 'engineAction'>>(
  decisions: T[],
  candidateCount: number,
): T[] {
  return candidateCount > 0 ? decisions : decisions.filter((d) => d.engineAction !== 'Delegate')
}

/** Whether any of the decisions is a hand-over — only then are the candidates worth reading. */
export function offersDelegate(decisions: Pick<DecisionOption, 'engineAction'>[]): boolean {
  return decisions.some((d) => d.engineAction === 'Delegate')
}

/** How a person reads in the picker: their name, with the account to tell namesakes apart. */
export function candidateLabel(candidate: DelegateCandidate): string {
  const name = candidate.fullName?.trim()
  return name ? `${name} (${candidate.username})` : candidate.username
}
