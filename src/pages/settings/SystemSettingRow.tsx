import { Button, Checkbox, NumberInput, PasswordInput, Select, Switch, TextInput } from '@mantine/core'
import { useTranslation } from 'react-i18next'
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

/** The tabs a SECTION can be filed under. Anything unlisted falls to Advanced. */
export type SettingTab =
  | 'preferences'
  | 'attendance'
  | 'leave'
  | 'payroll'
  | 'workflow'
  | 'notifications'
  | 'advanced'
  | 'danger'

/**
 * SECTION → TAB, and the ONLY thing that decides where a setting renders.
 *
 * THIS REPLACED A PER-KEY MAP, and the per-key map was the bug. It listed the handful of keys
 * somebody had written copy for and sent everything else to Advanced — where the page then grouped
 * by Section anyway. So an Attendance row nobody had listed appeared under an "Attendance" heading
 * INSIDE Advanced, beside a real Attendance tab holding the two keys that were listed. The same
 * kind of setting rendered in two places, and which one you got depended on whether a developer had
 * happened to name it here.
 *
 * A key now has exactly one home, derived from one field, with no second opinion to disagree with.
 * An UNKNOWN section is not an error and is not dropped: it lands in Advanced with its own name as
 * the band heading, which is what keeps "a new setting is a database row" true.
 */
const SECTION_TABS: Record<string, SettingTab> = {
  preferences: 'preferences',
  attendance: 'attendance',
  // Tabs of their own since QA2: what a leave costs and what payroll pays are not "rarely touched", and four plus
  // seven rows under Advanced were being looked for under Attendance.
  leave: 'leave',
  payroll: 'payroll',
  workflow: 'workflow',
  notifications: 'notifications',
  advanced: 'advanced',
  danger: 'danger',
}

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
  {
    title: string
    min?: number
    max?: number
    step?: number
    /**
     * A bool that reads better as a SWITCH than a checkbox, and the i18n key of the sentence beside
     * it. A checkbox says "this box is ticked"; a switch says "this behaviour is on", which is what
     * a setting actually is — but only where there is a sentence worth putting next to it, so this
     * is opt-in per key rather than a blanket change to every bool on the page.
     */
    switchLabel?: string
  }
> = {
  StandardWorkDayHours: {
    title: 'Standard work day',
    min: 1,
    max: 24,
    step: 0.5,
  },
  ExitLeaveBasis: { title: 'Exit leave basis' },
  /* THE TOLERANCE. A punch this many minutes or more past the shift start (or before its end) is
     an anomaly for HR to decide; inside it, nothing is flagged. A shift's own Grace overrides it
     when set. The row itself comes from core.SETTING (Section = Attendance, DataType = int); this
     entry only supplies the title and stops a typo like 600 from flagging nobody ever. */
  AttendanceToleranceMinutes: {
    title: 'Attendance tolerance (minutes)',
    min: 0,
    max: 240,
    step: 1,
  },
  FullDayThreshold: {
    title: 'Full day threshold',
    min: 0,
    max: 1,
    step: 0.05,
  },
  /* PAYROLL. The annual family deduction the income-tax table applies per dependant, in USD.
     Arrives from core.SETTING (Section = Payroll, DataType = decimal) and files itself under
     Advanced by its section; this entry only names it and stops a negative from being typed. */
  TaxFamilyDeductionAnnualUsd: {
    title: 'Family tax deduction (annual, USD)',
    min: 0,
    step: 1,
  },
  /* QA2 (scripts 82–86). The rows come from core.SETTING — Section 'Leave' and 'Payroll', each its own tab —
     with their descriptions; these entries only give the titles a person would say and keep a typo from
     paying a holiday at 20x or carrying over minus three days. */
  HolidayWorkRate: { title: 'Holiday work rate (× the day rate)', min: 1, max: 5, step: 0.25 },
  LeavePayoutOnTermination: { title: 'Pay the leave balance on termination' },
  LeaveCountsRestDays: { title: 'Leave counts rest days and holidays' },
  LeaveAllowNegativeBalance: { title: 'Allow a negative leave balance' },
  LeaveCarryOverMaxDays: { title: 'Carry-over cap (days; blank = no cap)', min: 0, max: 365, step: 0.5 },
  LeaveCarryOverExpiresOn: { title: 'Carried-over days expire on (MM-DD; blank = never)' },
  // A per-person choice about the reader's own screen. Its PLACEMENT is core.SETTING's to state —
  // the row's Section is 'Preferences' — and this entry now only supplies the friendlier title.
  [SHOW_PAGE_HELP_KEY]: { title: 'Show page help' },

  /* THE MAIL SERVER. Titled by hand for the one thing a derived title cannot do: say "SMTP" and
     "URL" in capitals. The keys read Smtp*, so humanise() can only ever produce "Smtp host" —
     and these seven sit together under their own heading, where short labels read as one form to
     fill in rather than seven unrelated values that happen to share a prefix. */
  SmtpHost: { title: 'Mail server' },
  SmtpPort: { title: 'Port', min: 1, max: 65535, step: 1 },
  SmtpUser: { title: 'User name' },
  SmtpPassword: { title: 'Password' },
  SmtpFromEmail: { title: 'From address' },
  SmtpFromName: { title: 'From name' },
  // The one setting on this page that turns a BACKGROUND BEHAVIOUR on and off rather than naming a
  // value, so it is the one that gets a switch and a sentence: "Port" needs no explanation, "email
  // on a closed request" set to false does.
  NotifyOnRequestClosed: {
    title: 'Email on a closed request',
    switchLabel: 'settings.notifications.notifyOnRequestClosed',
  },

  /* WHATSAPP. Same reasoning as the SMTP block: hand-written titles because a derived one can only
     ever produce "Whats app api url". They arrive under the same Notifications heading, from the
     same core.SETTING rows, with no routing written here. */
  WhatsAppEnabled: {
    title: 'WhatsApp messages',
    switchLabel: 'settings.notifications.whatsAppEnabled',
  },
  WhatsAppApiUrl: { title: 'Cloud API URL' },
  WhatsAppPhoneNumberId: { title: 'Sending number id' },
  WhatsAppAccessToken: { title: 'Access token' },
  WhatsAppTemplateName: { title: 'Template name' },
}

/**
 * Keys whose VALUE must not be readable over somebody’s shoulder.
 *
 * A set rather than a dataType, because "secret" is not a property of the type — SmtpPassword is
 * an ordinary string as far as the database is concerned, and the only thing that makes it
 * different is who is standing behind the screen. The masking is presentational and nothing more:
 * the value still travels and is still stored in plain text, so this hides a password from a
 * passer-by, not from anyone with the SETTING_MANAGE right or a look at core.SETTING.
 *
 * The WhatsApp access token belongs here for the same reason and one more: it is a BEARER token, so
 * anyone who reads it off the screen can send as this business until it is rotated.
 */
const SECRET_KEYS = new Set(['SmtpPassword', 'WhatsAppAccessToken'])

/**
 * THE TWO DIALECTS core.SETTING actually stores a bool in.
 *
 * The table holds both: AllowSystemReset and NotifyOnRequestClosed are '1', while ShowPageHelp and
 * MachinePullEnabled are 'true'. Reading only 'true' as on — which is what this file did — shows
 * every '1' row as OFF and, worse, writes 'true' the first time somebody touches it. That is not
 * cosmetic for NotifyOnRequestClosed: core.usp_Email_QueueClosedRequests tests `<> '1'` and RETURNS,
 * so a switch that saved 'true' would silently turn the automatic mail OFF while displaying it as on.
 */
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

/** Is this stored value the ON state, in either dialect? */
function isOn(value: string): boolean {
  return TRUE_VALUES.has(value.trim().toLowerCase())
}

/**
 * The new value to store, IN THE DIALECT THE ROW ALREADY USES — read from what the server holds, not
 * from the draft, so toggling twice returns the row to exactly the string it started with. A key
 * with no value yet has no dialect to keep, and gets 'true'/'false'.
 */
function boolValue(stored: string, on: boolean): string {
  const current = stored.trim()
  const numeric = current === '1' || current === '0'
  return numeric ? (on ? '1' : '0') : on ? 'true' : 'false'
}

/**
 * Values a setting of this key may take, when it is a fixed choice rather than free text.
 *
 * A CLOSED SET TYPED FREE-HAND IS A BROKEN SETTING, not a typo. "official" or "Offical" in
 * PayrollRateType does not match any rate the payroll run looks for, so the run finds no rate and
 * the failure surfaces days later as a number nobody can explain. A dropdown removes the state.
 *
 * This map is the fallback. Where the API describes the set itself — DataType 'enum:A|B|C' — that
 * wins, because a set the database declares cannot drift from the one the database enforces.
 */
const CHOICES: Record<string, string[]> = {
  ExitLeaveBasis: ['Actual', 'Approved'],
  PayrollRateType: ['Official', 'Market', 'NonOfficial'],
}

/**
 * 'enum:Official|Market|NonOfficial' → the three values; null for every other DataType.
 *
 * Nothing sends this yet. It is here so that when something does, the setting arrives as a dropdown
 * with no frontend change at all — the same promise the rest of this file makes, where a new setting
 * is a database row rather than a code edit.
 */
function enumChoices(dataType: string): string[] | null {
  if (!dataType.startsWith('enum:')) return null
  const values = dataType
    .slice('enum:'.length)
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean)
  return values.length > 0 ? values : null
}

/**
 * Which tab a setting belongs on — read from its SECTION and from nothing else.
 *
 * Matched case-insensitively on the trimmed value, because 'Attendance' and 'attendance' are the
 * same section to everyone except a lookup table. A blank or unrecognised section lands in Advanced,
 * which is the "there is always a home" rule that keeps an unlisted setting visible.
 */
export function tabOfSection(section: string | null | undefined): SettingTab {
  const key = (section ?? '').trim().toLowerCase()
  return SECTION_TABS[key] ?? 'advanced'
}

/**
 * A readable title for a key nobody has written copy for: "SmtpFromEmail" → "Smtp from email".
 *
 * The raw key was what showed before, and it is the one part of a data-driven settings page that
 * reads like a database rather than a screen. Splitting on the capitals costs nothing and means a
 * key added in SQL tomorrow arrives looking deliberate — which is the promise this page makes
 * everywhere else. An entry in KNOWN still wins, because a hand-written title beats a derived one.
 */
function humanise(key: string): string {
  const spaced = key
    // Split ONLY where a lower-case letter or digit meets a capital, so runs of capitals survive:
    // "NssfCeilingUsd" becomes "Nssf ceiling usd", never "N s s f".
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

export function titleOf(setting: Setting): string {
  return KNOWN[setting.settingKey]?.title ?? humanise(setting.settingKey)
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

  if (key === 'AttendanceToleranceMinutes') {
    const n = Math.round(numeric)
    if (n <= 0) return 'Zero: every minute past the shift start or before its end becomes an anomaly for HR to decide.'
    // Worked on a 07:00–15:00 example so the number is seen as a clock time, not an abstraction.
    const clock = (minutesOfDay: number) =>
      `${String(Math.floor(minutesOfDay / 60)).padStart(2, '0')}:${String(minutesOfDay % 60).padStart(2, '0')}`
    return `On a 07:00–15:00 shift: punching in at ${clock(7 * 60 + n)} or later, or out at ${clock(15 * 60 - n)} or earlier, becomes an anomaly for HR to decide. A shift with its own Grace uses that instead.`
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
  const { t } = useTranslation()
  const known = KNOWN[setting.settingKey]
  // The API's own declaration wins over the local fallback — see enumChoices.
  const choices = enumChoices(setting.dataType) ?? CHOICES[setting.settingKey]

  /**
   * The label for one choice. THE VALUE IS STORED AS-IS — only what the reader sees is translated,
   * so 'NonOfficial' stays 'NonOfficial' in core.SETTING however it is displayed.
   *
   * i18next returns the KEY when there is no translation, which is what makes an unrecognised enum
   * value from the API render as its own stored text rather than as a blank row.
   */
  const choiceLabel = (value: string): string => {
    const path = `settings.choices.${setting.settingKey}.${value}`
    const label = t(path)
    return label === path ? value : label
  }
  const dirty = draft !== setting.settingValue
  const example = describeValue(setting.settingKey, draft, standardHours)
  const inputId = `setting-${setting.settingKey}`

  const isBool = setting.dataType === 'bool'
  const isNumber = setting.dataType === 'int' || setting.dataType === 'decimal'
  const isSecret = SECRET_KEYS.has(setting.settingKey)

  const control = isSecret ? (
    // Masked, with Mantine’s own reveal toggle — somebody correcting a mistyped password has to be
    // able to SEE what they typed, and a field that can only ever be overwritten blind is how the
    // same wrong password gets entered three times in a row.
    <PasswordInput
      id={inputId}
      value={draft}
      onChange={(e) => onDraftChange(e.currentTarget.value)}
      w={220}
      disabled={saving}
      autoComplete="new-password"
    />
  ) : isBool && known?.switchLabel ? (
    <Switch
      id={inputId}
      checked={isOn(draft)}
      onChange={(e) => onDraftChange(boolValue(setting.settingValue, e.currentTarget.checked))}
      label={t(known.switchLabel)}
      disabled={saving}
    />
  ) : isBool ? (
    <Checkbox
      id={inputId}
      checked={isOn(draft)}
      onChange={(e) => onDraftChange(boolValue(setting.settingValue, e.currentTarget.checked))}
      label={isOn(draft) ? 'On' : 'Off'}
      disabled={saving}
    />
  ) : choices ? (
    <Select
      id={inputId}
      data={choices.map((value) => ({ value, label: choiceLabel(value) }))}
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
