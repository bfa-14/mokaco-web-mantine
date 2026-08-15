import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@mantine/core'

/**
 * "No access" — the one panel for every way a page can be closed to somebody.
 *
 * It is used in TWO places, on purpose, because to the reader they are the same event:
 *   · the route guard, when the map says this page is not theirs; and
 *   · a page whose PRIMARY load came back 403 — a deep link to a detail the API refuses.
 * The second is why this is a plain component rather than something the router owns: a page that
 * discovers the refusal only after asking has to be able to render it in its own body.
 *
 * It does NOT say which permission is missing. Naming the code would tell somebody exactly what to
 * ask for, which sounds helpful and is really a map of the system's gates handed to whoever is
 * furthest from being trusted with it. "Ask an administrator" is the honest route.
 */
export function AccessDenied({
  /** Set when this is a page's own body rather than a whole denied route — drops the outer spacing. */
  inline = false,
}: {
  inline?: boolean
} = {}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <div className={inline ? undefined : 'page-denied'}>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('access.deniedTitle')}</h1>
          <p className="page-subtitle">{t('access.deniedHint')}</p>
        </div>
      </div>

      <div className="card">
        <div className="empty-hint">
          <div className="empty-hint-main">{t('access.deniedTitle')}</div>
          {t('access.deniedHint')}
        </div>

        <div className="form-actions">
          <Button onClick={() => navigate('/')}>{t('access.backHome')}</Button>
        </div>
      </div>
    </div>
  )
}

export default AccessDenied
