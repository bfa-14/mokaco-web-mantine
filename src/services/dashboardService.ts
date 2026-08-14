import { apiRequest } from '../api/client'
import type { Dashboard } from '../types/dashboard'

/**
 * The home page, in ONE call.
 *
 * One request rather than ten because the page is a single statement about a single moment: separate
 * reads would let the "3 waiting on you" headline come from one instant and the three rows under it
 * from another, and a user watching the two disagree stops trusting the number that matters most.
 *
 * No permission is needed — everybody has a dashboard. What differs between callers is the CONTENT,
 * and the procedure decides that from the token's own user id.
 */
export const dashboardService = {
  get: () => apiRequest<Dashboard>('/api/dashboard'),
}
