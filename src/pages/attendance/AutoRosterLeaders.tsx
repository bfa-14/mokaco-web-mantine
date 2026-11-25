import { useTranslation } from 'react-i18next'
import { Button, Loader, MultiSelect } from '@mantine/core'
import { IconDeviceFloppy } from '@tabler/icons-react'
import type { AutoRosterSetupStaff, RosterLeaders } from '../../types/attendance'
import { leaderIds, leaderOptions, rotationLeads } from './rosterLeaders'

/**
 * THE SHIFT LEADERS of the branch, inside the auto-roster drawer, for BOTH methods (script 123): the planner never puts
 * two of them on the same shift of a day while the day has shifts enough. It only edits; the drawer saves the list (by
 * this section's button, or first thing when Preview is pressed) and the server plans by what is stored.
 *
 * The rotation list's Lead 1 / Lead 2 stay as they are and count as leaders too: they are named under the picker.
 */
export function AutoRosterLeaders({
  staff,
  stored,
  loading,
  loadError,
  picks,
  onPicks,
  dirty,
  saving,
  error,
  onSave,
  disabled,
}: {
  /** The people of the month on screen (the setup's staff). */
  staff: AutoRosterSetupStaff[]
  /** The leaders as the server holds them; null until read (or when the read failed). */
  stored: RosterLeaders | null
  loading: boolean
  /** Why the leaders could not be read: the section shows it and offers nothing to edit. */
  loadError: string | null
  /** The picker's people (the branch's own list as edited). */
  picks: number[]
  onPicks: (ids: number[]) => void
  dirty: boolean
  saving: boolean
  /** The save's refusal, verbatim. */
  error: string | null
  onSave: () => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const leads = rotationLeads(stored?.leaders ?? [])

  return (
    <div className="form-section">
      <h3 className="form-section-title">{t('attendance.roster.auto.leaders.title')}</h3>
      {loading && (
        <div className="hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Loader size={14} />
          {t('attendance.roster.auto.leaders.loading')}
        </div>
      )}
      {!loading && loadError && (
        <div className="form-error">{t('attendance.roster.auto.leaders.loadFailed', { error: loadError })}</div>
      )}
      {!loading && !loadError && stored && (
        <>
          <MultiSelect
            aria-label={t('attendance.roster.auto.leaders.title')}
            placeholder={picks.length === 0 ? t('attendance.roster.auto.leaders.placeholder') : undefined}
            data={leaderOptions(staff, stored.leaders)}
            value={picks.map(String)}
            onChange={(values) => onPicks(leaderIds(values))}
            searchable
            clearable
            hidePickedOptions
            nothingFoundMessage={t('attendance.roster.auto.leaders.nobody')}
            disabled={disabled || saving}
          />
          <div className="hint" style={{ marginTop: 6 }}>
            {t('attendance.roster.auto.leaders.hint')}
            {leads.length > 0 && (
              <>
                {' '}
                {t('attendance.roster.auto.leaders.rotationLeads', {
                  // One lead or two: the line agrees in number with them (Arabic has a dual).
                  count: leads.length,
                  names: leads
                    .map((l) => `${l.fullName} (${t(`attendance.roster.auto.rotation.${l.leadSlot === 'L1' ? 'lead1' : 'lead2'}`)})`)
                    .join(t('attendance.roster.auto.leaders.separator')),
                })}
              </>
            )}
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="form-actions" style={{ justifyContent: 'flex-start', alignItems: 'center' }}>
            <Button
              variant="default"
              size="xs"
              leftSection={<IconDeviceFloppy size={14} />}
              loading={saving}
              disabled={!dirty || disabled}
              onClick={onSave}
            >
              {t('attendance.roster.auto.leaders.save')}
            </Button>
            {dirty && <span className="hint">{t('attendance.roster.auto.leaders.unsaved')}</span>}
          </div>
        </>
      )}
    </div>
  )
}
