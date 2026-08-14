import { useTranslation } from 'react-i18next'
import { Alert } from '@mantine/core'
import { IconTransform } from '@tabler/icons-react'

/**
 * The honest placeholder for a page that has not been ported off DevExtreme yet.
 *
 * Every route from the original app is registered from day one, so the side nav is complete and a
 * deep link never 404s — a page that is not here yet SAYS so, and names itself, rather than
 * pretending the route does not exist. COVERAGE.md tracks which routes still render this.
 */
export function NotYetPorted({ title }: { title: string }) {
  const { t } = useTranslation()
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
        </div>
      </div>
      <Alert
        icon={<IconTransform size={18} />}
        color="desert"
        title={t('port.notYetTitle', { defaultValue: 'Not ported yet' })}
      >
        {t('port.notYetBody', {
          defaultValue:
            'This page has not been rebuilt in the new interface yet. Until it is, use the current application for this screen — everything else here works against the same data.',
        })}
      </Alert>
    </div>
  )
}
