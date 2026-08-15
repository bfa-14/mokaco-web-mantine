import { Button, Checkbox, NumberInput, Select, TextInput } from '@mantine/core'
import { SettingRow } from './SettingsCard'
import { SHOW_PAGE_HELP_KEY, type Setting } from '../../types/settings'

/**
 * The data-driven settings — one core.SETTING row, rendered as one row of a card.
 *
 * This file is the whole of what the page knows about individual keys, and it is deliberately
 * small. The page renders WHATEVER the API returns and picks a control from each setting's
 * DataType, so a new setting is a database row and not a code change. What is written down here is
 * only the extra that a database row cannot carry: which tab a known key belongs on, a friendlier
 * title than its key, and the bounds of its number box.
 */

/** The tabs a known key can be filed under. Anything unlisted falls to Advanced. */
export type SettingTab = 'preferences' | 'attendance' | 'advanced'

/**
 * Extra guidance for the keys we know about today.
 *
 * This map is an ENHANCEMENT, not a gate. A setting that is not listed here still renders — under
 * Advanced, using its own Description from the database as the explanation — which is what makes
 * adding a new setting a matter of inserting a row, with no frontend change at all. Only add an
 * entry here when a key needs more than its Description can say.
 */
const KNOWN: Record<
  string,
  { tab: SettingTab; title: string; min?: number; max?: number; step?: number }
> = {
  StandardWorkDayHours: {
    tab: 'attendance',
    title: 'Standard work day',
    min: 1,
    max: 24,
    step: 0.5,
  },
  ExitLeaveBasis: { tab: 'attendance', title: 'Exit leave basis' },
  FullDayThreshold: {
    tab: 'attendance',
    title: 'Full day threshold',
    min: 0,
    max: 1,
    step: 0.05,
  },
  // A per-person choice about the reader's own screen, so it belongs with the other personal
  // toggles rather than among the values that decide what people are paid. It is still a
  // core.SETTING row behind SETTING_MANAGE — only its placement moved.
  [SHOW_PAGE_HELP_KEY]: { tab: 'preferences', title: 'Show page help' },
}

/** Values a setting of this key may take, when it is a fixed choice rather than free text. */
const CHOICES: Record<string, string[]> = {
  ExitLeaveBasis: ['Actual', 'Approved'],
}

/** Which tab a key belongs on. Unrecognised keys land on Advanced — that is the point of it. */
export function tabOf(key: string): SettingTab {
  return KNOWN[key]?.tab ?? 'advanced'
}

export function titleOf(setting: Setting): string {
  return KNOWN[setting.settingKey]?.title ?? setting.settingKey
}

/**
 * Spells out what the value currently in the box actually MEANS, in real hours and minutes.
 *
 * This exists because FullDayThreshold is the one value here whose units are genuinely ambiguous:
 * it is a FRACTION of the day (1.00 = all of it, 0.90 = ninety per cent), NOT a percentage.
 * Somebody who reads "how much of the standard day" and types 90 has quietly broken payroll — the
 * day fraction it is compared against is capped at 1.00, so 90 can never be reached and NOBODY
 * would ever record a full day again. The number box refuses anything above 1, but the screen
 * should SAY what the number means rather than rely on being un-typeable.
 */
export function describeValue(
  key: string,
  value: string,
  standardHours: number | undefined,
): string | null {
  const numeric = Number(value)
  if (value === '' || Number.isNaN(numeric)) return null

  if (key === 'StandardWorkDayHours') {
    const hours = Math.floor(numeric)
    const mins = Math.round((numeric - hours) * 60)
    const label = mins === 0 ? `${hours}h` : `${hours}h ${mins}m`
    return `A ${label} day. A 2-hour exit permission costs ${(2 / numeric).toFixed(2)} of a leave day.`
  }

  if (key === 'FullDayThreshold') {
    const percent = Math.round(numeric * 100)
    const base = `This is a fraction of the day, not a percentage: ${numeric.toFixed(2)} means ${percent}%.`
    if (!standardHours) return base

    const requiredHours = numeric * standardHours
    const h = Math.floor(requiredHours)
    const m = Math.round((requiredHours - h) * 60)
    const label = m === 0 ? `${h}h` : `${h}h ${m}m`

    return numeric >= 1
      ? `${base} The whole ${standardHours}h day must be worked before it counts as full.`
      : `${base} With a ${standardHours}h standard day, working ${label} is enough to count as a full day.`
  }

  return null
}

/**
 * One setting, one row: what it is on the reading edge, what it is set to on the trailing edge.
 *
 * These used to be a card each — a full-width panel per value, which made three settings look like
 * three separate pages of policy and pushed the fourth below the fold. They are one decision each,
 * not one page each, and reading them side by side is how somebody checks that the standard day
 * and the full-day threshold agree with one another.
 *
 * SAVE SEMANTICS ARE UNCHANGED: a draft is held locally, the Save button is dead until it differs
 * from what the server holds, and the write sends the database's own dataType and description
 * back untouched. The control is still chosen from the setting's DataType, so a key nobody has
 * written any UI code for still gets an appropriate editor.
 */
export function SystemSettingRow({
  setting,
  draft,
  saving,
  standardHours,
  onDraftChange,
  onSave,
}: {
  setting: Setting
  draft: string
  saving: boolean
  /** The configured standard day, so a fraction can be shown as real hours rather than a bare decimal. */
  standardHours: number | undefined
  onDraftChange: (value: string) => void
  onSave: () => void
}) {
  const known = KNOWN[setting.settingKey]
  const choices = CHOICES[setting.settingKey]
  const dirty = draft !== setting.settingValue
  const example = describeValue(setting.settingKey, draft, standardHours)
  const inputId = `setting-${setting.settingKey}`

  const isBool = setting.dataType === 'bool'
  const isNumber = setting.dataType === 'int' || setting.dataType === 'decimal'

  const control = isBool ? (
    <Checkbox
      id={inputId}
      checked={draft === 'true'}
      onChange={(e) => onDraftChange(e.currentTarget.checked ? 'true' : 'false')}
      label={draft === 'true' ? 'On' : 'Off'}
      disabled={saving}
    />
  ) : choices ? (
    <Select
      id={inputId}
      data={choices}
      value={draft}
      onChange={(v) => onDraftChange(v ?? '')}
      allowDeselect={false}
      w={220}
      disabled={saving}
    />
  ) : isNumber ? (
    <NumberInput
      id={inputId}
      value={draft === '' ? '' : Number(draft)}
      onChange={(v) => onDraftChange(v == null || v === '' ? '' : String(v))}
      w={220}
      disabled={saving}
      min={known?.min}
      max={known?.max}
      step={known?.step ?? 1}
      // format '#0' / '#0.##' — whole numbers for int keys, up to two decimals otherwise.
      allowDecimal={setting.dataType !== 'int'}
      decimalScale={setting.dataType === 'int' ? 0 : 2}
    />
  ) : (
    <TextInput
      id={inputId}
      value={draft}
      onChange={(e) => onDraftChange(e.currentTarget.value)}
      w={320}
      disabled={saving}
    />
  )

  return (
    <SettingRow
      htmlFor={isBool ? undefined : inputId}
      label={titleOf(setting)}
      // The Description from the database IS the explanation. A setting nobody has written UI code
      // for is still fully usable, because this line always tells the user what it does.
      hint={setting.description}
      note={example}
      meta={
        <>
          <code>{setting.settingKey}</code>
          {setting.modifiedAt && <> · Last changed {setting.modifiedAt.slice(0, 10)}</>}
        </>
      }
      control={
        <>
          {control}
          <Button onClick={onSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    />
  )
}
