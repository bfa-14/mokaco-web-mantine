import { apiRequest } from '../api/client'
import { API_BASE_URL } from '../config'
import { tokenStorage } from '../auth/tokenStorage'
import type { PrepBook, PrepBookInfo } from '../pages/prepBook/prepBookTypes'

/**
 * The drink recipes (Recipes page). The guide is confidential, so everything comes from the API after sign-in:
 * reading needs PREP_BOOK_VIEW, uploading PREP_BOOK_MANAGE. Nothing of the book is in the website's own files.
 */
export const prepBookService = {
  /** The whole book, each drink's thumbnail inside. Null while no book has been uploaded (the API answers 204). */
  get: async () => (await apiRequest<PrepBook | undefined>('/api/prep-book')) ?? null,

  /** The book on file: size, when, by whom. Null when there is none. PREP_BOOK_MANAGE. */
  info: async () => (await apiRequest<PrepBookInfo | undefined>('/api/prep-book/info')) ?? null,

  /** Uploads the recipe book (.zip) and replaces the one on file. PREP_BOOK_MANAGE. */
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiRequest<PrepBookInfo>('/api/prep-book/upload', { method: 'POST', body: form })
  },

  /**
   * A scanned guide page or label as an object URL an <img> can show: the endpoint needs the bearer token, which a
   * plain <img src> cannot send. The caller must revoke the URL, or it leaks.
   *
   * A token that expired while the page sat open is renewed once (through an ordinary API call, which knows how)
   * and the scan asked for again.
   */
  async scanObjectUrl(kind: 'pages' | 'labels', number: number): Promise<string> {
    const ask = () => {
      const token = tokenStorage.getAccessToken()
      return fetch(`${API_BASE_URL}/api/prep-book/${kind}/${number}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
    }
    let res = await ask()
    if (res.status === 401) {
      await prepBookService.info().catch(() => prepBookService.get())
      res = await ask()
    }
    if (!res.ok) throw new Error(`The original page could not be loaded (${res.status}).`)
    return URL.createObjectURL(await res.blob())
  },
}
