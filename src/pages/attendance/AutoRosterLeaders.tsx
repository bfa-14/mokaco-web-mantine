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
 * The picker offers only the people a save accepts (the API's candidates: the branch's people today), beside the
 * leaders already stored, so it never offers somebody the save would refuse.
 */
export function AutoRosterLeaders({
  staff,
  stored,
  loading,
  loadError,
  notReady,
  picks,
  onPicks,
  dirty,
  saving,
  error,
  onSave,
  disabled,
}: {
  /** The people of the month on screen (the setup's staff): the picker's order. */
  staff: AutoRosterSetupStaff[]
  /** The leaders as the server holds them; null until read (or when the read failed). */
  stored: RosterLeaders | null
  loading: boolean
  /** Why the leaders could not be read: the section shows it and offers nothing to edit. */
  loadError: string | null
  /** The read failed because the list is not there yet on the server: said in the reader's language, not the server's. */
  notReady: boolean
  /** The picker's people (the branch's own list as edited). */
  picks: number[]
  onPicks: (ids: number[]) => void
  dirty: boolean
  saving: boolean
  /** The save's refusal, in the reader's language when the drawer knows it, else verbatim. */
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
        <div className="form-error">
          {notReady
            ? t('attendance.roster.auto.leaders.notReady')
            : t('attendance.roster.auto.leaders.loadFailed', { error: loadError })}
        </div>
      )}
      {!loading && !loadError && stored && (
        <>
          <MultiSelect
            aria-label={t('attendance.roster.auto.leaders.title')}
            placeholder={picks.length === 0 ? t('attendance.roster.auto.leaders.placeholder') : undefined}
            data={leaderOptions(staff, stored.leaders, stored.candidates)}
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
            {stored.candidates && <> {t('attendance.roster.auto.leaders.candidatesHint')}</>}
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
