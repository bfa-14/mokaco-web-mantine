import { useTranslation } from 'react-i18next'
import { ActionIcon, SegmentedControl, Select, TextInput } from '@mantine/core'
import { IconChevronDown, IconChevronUp, IconX } from '@tabler/icons-react'
import type { AutoRosterSetupShift } from '../../types/attendance'
import { formatDayLabel } from './attendanceFormat'
import { daysOffInWeek, mondayOnOrBefore, moveLine, weekdayOf } from './rotationSetup'
import type { RotationLine } from './rotationSetup'

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

/**
 * THE FIXED ROTATION's setup, inside the auto-roster drawer: where the rotation starts, its morning and evening
 * shift, and the list - in order, each person's lead, group and days off. It only edits; the drawer saves it (with
 * the preview, or by its own button) and the server plans by what is stored.
 *
 * Each line shows the days off the rule gives in the first week of the month on screen, so the manager can check a
 * line against the sheet before planning anything.
 */
export function AutoRosterRotation({
  shifts,
  startDate,
  onStartDate,
  morningShiftId,
  onMorningShift,
  eveningShiftId,
  onEveningShift,
  lines,
  onLines,
  onRemove,
  firstMonday,
  disabled,
}: {
  shifts: AutoRosterSetupShift[]
  startDate: string | null
  onStartDate: (day: string | null) => void
  morningShiftId: number | null
  onMorningShift: (shiftId: number | null) => void
  eveningShiftId: number | null
  onEveningShift: (shiftId: number | null) => void
  lines: RotationLine[]
  onLines: (lines: RotationLine[]) => void
  /** Takes somebody off the list (the drawer also takes them off rotation for the run). */
  onRemove: (employeeId: number) => void
  /** The Monday of the first week of the month being planned ('yyyy-MM-dd'). */
  firstMonday: string
  disabled: boolean
}) {
  const { t } = useTranslation()
  const day = (weekday: number) => t(`attendance.roster.auto.rotation.day.${weekday}`)
  const shiftOptions = shifts.map((s) => ({ value: String(s.shiftId), label: s.name }))
  const dayOptions = WEEKDAYS.map((d) => ({ value: String(d), label: day(d) }))
  // A pair that starts on Sunday is Monday AND Sunday of the same week (the rule keeps both days inside one week).
  const pairOptions = WEEKDAYS.map((d) => ({
    value: String(d),
    label: d === 6 ? t('attendance.roster.auto.rotation.splitPair', { first: day(0), second: day(6) }) : `${day(d)} + ${day(d + 1)}`,
  }))
  const startIsMonday = startDate != null && weekdayOf(startDate) === 0

  function change(index: number, patch: Partial<RotationLine>) {
    onLines(lines.map((line, i) => (i === index ? { ...line, ...patch, isNew: false } : line)))
  }

  /** One L1 and one L2: giving a slot to somebody takes it from whoever had it. */
  function setLead(index: number, slot: 'L1' | 'L2' | null) {
    onLines(
      lines.map((line, i) =>
        i === index
          ? { ...line, leadSlot: slot, isNew: false }
          : slot != null && line.leadSlot === slot
            ? { ...line, leadSlot: null }
            : line,
      ),
    )
  }

  return (
    <div className="form-section">
      <h3 className="form-section-title">{t('attendance.roster.auto.rotation.title')}</h3>
      <p className="hint" style={{ marginBottom: 10 }}>
        {t('attendance.roster.auto.rotation.intro')}
      </p>

      <div className="rotation-top">
        <div className="form-field">
          <label className="form-label" htmlFor="rotation-start">
            {t('attendance.roster.auto.rotation.start')}
          </label>
          <TextInput
            id="rotation-start"
            type="date"
            value={startDate ?? ''}
            // Any day picked becomes the Monday of its week: the rotation counts whole weeks.
            onChange={(e) => onStartDate(e.currentTarget.value ? mondayOnOrBefore(e.currentTarget.value) : null)}
            disabled={disabled}
          />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="rotation-morning">
            {t('attendance.roster.auto.rotation.morning')}
          </label>
          <Select
            id="rotation-morning"
            data={shiftOptions}
            value={morningShiftId != null ? String(morningShiftId) : null}
            onChange={(v) => onMorningShift(v != null ? Number(v) : null)}
            placeholder={t('attendance.roster.auto.rotation.chooseShift')}
            allowDeselect={false}
            disabled={disabled}
          />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="rotation-evening">
            {t('attendance.roster.auto.rotation.evening')}
          </label>
          <Select
            id="rotation-evening"
            data={shiftOptions}
            value={eveningShiftId != null ? String(eveningShiftId) : null}
            onChange={(v) => onEveningShift(v != null ? Number(v) : null)}
            placeholder={t('attendance.roster.auto.rotation.chooseShift')}
            allowDeselect={false}
            disabled={disabled}
          />
        </div>
      </div>
      <div className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
        {startDate
          ? t('attendance.roster.auto.rotation.startHint', { date: formatDayLabel(startDate) })
          : t('attendance.roster.auto.rotation.startMissing')}
      </div>

      {lines.length === 0 ? (
        <div className="hint">{t('attendance.roster.auto.rotation.noPeople')}</div>
      ) : (
        <ol className="rotation-list">
          {lines.map((line, index) => {
            const off = startIsMonday ? daysOffInWeek(startDate as string, line, firstMonday) : null
            return (
              <li key={line.employeeId} className={line.isNew ? 'rotation-line rotation-line--new' : 'rotation-line'}>
                <div className="rotation-line-head">
                  <span className="rotation-order">
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      aria-label={t('attendance.roster.auto.rotation.moveUp', { name: line.fullName })}
                      disabled={disabled || index === 0}
                      onClick={() => onLines(moveLine(lines, index, -1))}
                    >
                      <IconChevronUp size={14} />
                    </ActionIcon>
                    <span className="rotation-number">{index + 1}</span>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      aria-label={t('attendance.roster.auto.rotation.moveDown', { name: line.fullName })}
                      disabled={disabled || index === lines.length - 1}
                      onClick={() => onLines(moveLine(lines, index, 1))}
                    >
                      <IconChevronDown size={14} />
                    </ActionIcon>
                  </span>
                  <span className="rotation-name">
                    <span className="auto-roster-name">{line.fullName}</span>
                    {line.position && <span className="auto-roster-sub"> · {line.position}</span>}
                    {line.isNew && <span className="auto-roster-flag">{t('attendance.roster.auto.rotation.isNew')}</span>}
                  </span>
                  <SegmentedControl
                    size="xs"
                    value={line.leadSlot ?? ''}
                    onChange={(v) => setLead(index, v === 'L1' || v === 'L2' ? v : null)}
                    data={[
                      { value: '', label: t('attendance.roster.auto.rotation.staff') },
                      { value: 'L1', label: t('attendance.roster.auto.rotation.lead1') },
                      { value: 'L2', label: t('attendance.roster.auto.rotation.lead2') },
                    ]}
                    disabled={disabled}
                    aria-label={`${t('attendance.roster.auto.rotation.role')}: ${line.fullName}`}
                  />
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label={t('attendance.roster.auto.rotation.remove', { name: line.fullName })}
                    title={t('attendance.roster.auto.rotation.remove', { name: line.fullName })}
                    disabled={disabled}
                    onClick={() => onRemove(line.employeeId)}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </div>
                <div className="rotation-line-body">
                  <div className="rotation-cell">
                    <span className="rotation-label">{t('attendance.roster.auto.rotation.group')}</span>
                    <SegmentedControl
                      size="xs"
                      value={String(line.group)}
                      onChange={(v) => change(index, { group: Number(v) })}
                      data={[
                        { value: '0', label: 'A' },
                        { value: '1', label: 'B' },
                      ]}
                      disabled={disabled}
                      aria-label={`${t('attendance.roster.auto.rotation.group')}: ${line.fullName}`}
                    />
                  </div>
                  <div className="rotation-cell">
                    <span className="rotation-label">{t('attendance.roster.auto.rotation.single')}</span>
                    <Select
                      size="xs"
                      w={120}
                      data={dayOptions}
                      value={String(line.singleRestDay)}
                      onChange={(v) => v != null && change(index, { singleRestDay: Number(v) })}
                      allowDeselect={false}
                      disabled={disabled}
                      aria-label={`${t('attendance.roster.auto.rotation.single')}: ${line.fullName}`}
                    />
                  </div>
                  <div className="rotation-cell">
                    <span className="rotation-label">{t('attendance.roster.auto.rotation.pair')}</span>
                    <Select
                      size="xs"
                      w={150}
                      data={pairOptions}
                      value={String(line.pairRestDay)}
                      onChange={(v) => v != null && change(index, { pairRestDay: Number(v) })}
                      allowDeselect={false}
                      disabled={disabled}
                      aria-label={`${t('attendance.roster.auto.rotation.pair')}: ${line.fullName}`}
                    />
                  </div>
                </div>
                {off && (
                  <div className="rotation-week">
                    {t('attendance.roster.auto.rotation.offThisWeek', {
                      date: formatDayLabel(firstMonday),
                      days: off.map(day).join(', '),
                    })}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
      <div className="hint" style={{ marginTop: 8 }}>
        {t('attendance.roster.auto.rotation.listHint')}
      </div>
    </div>
  )
}
