import { useState } from 'react'
import { Switch, Textarea } from '@mantine/core'
import { DatePickerInput, TimePicker } from '@mantine/dates'
import { IconCalendar } from '@tabler/icons-react'
import { exitPermissionsService } from '../../services/workflowService'
import { minutesBetween, minutesWithDayFraction } from './workflowFormat'
import type { RequestFormBody } from './newRequestShared'
import { t } from '../../i18n/t'

/**
 * The EXIT PERMISSION form body — date, times, reason, convert-to-leave.
 * (Ported: native date/time inputs — state holds 'yyyy-MM-dd' and 'HH:mm' directly, so the
 * derivations lose their DevExtreme slicing; the submit still sends 'HH:mm:ss'.)
 */
export function useExitPermissionForm(saving: boolean): RequestFormBody {
  const [exitDate, setExitDate] = useState<string | null>(null) // yyyy-MM-dd
  const [fromTime, setFromTime] = useState<string | null>(null) // HH:mm
  const [toTime, setToTime] = useState<string | null>(null) // HH:mm
  const [reason, setReason] = useState('')
  const [convertToLeave, setConvertToLeave] = useState(true)

  const minutes = fromTime && toTime ? minutesBetween(fromTime, toTime) : null

  // Composed to match the stored procedure's format EXACTLY.
  const autoTitle =
    exitDate && fromTime && toTime && minutes != null
      ? `Exit permission ${exitDate} ${fromTime}-${toTime} (${minutes} min requested)`
      : null

  const missing = !exitDate
    ? t('body.exitPermission.missingDate')
    : !fromTime
      ? t('body.exitPermission.missingFrom')
      : !toTime
        ? t('body.exitPermission.missingTo')
        : !reason.trim()
          ? t('body.exitPermission.missingReason')
          : minutes == null
            ? t('body.exitPermission.missingOrder')
            : null

  const node = (
    <>
      {/* All three are REQUIRED (see the `missing` guard), so none is clearable. The states keep
          'yyyy-MM-dd' and 'HH:mm' exactly as before — TimePicker with withSeconds off speaks
          'HH:mm', and the submit still appends the ':00' the procedure wants. */}
      <div className="form-grid">
        <div className="form-field">
          <DatePickerInput
            label={t('common.date')}
            valueFormat="DD/MM/YYYY"
            leftSection={<IconCalendar size={14} />}
            value={exitDate}
            disabled={saving}
            onChange={(v) => setExitDate(v || null)}
          />
        </div>
        <div className="form-field" />
        <div className="form-field">
          <TimePicker
            label={t('common.from')}
            format="24h"
            withDropdown
            value={fromTime ?? ''}
            disabled={saving}
            onChange={(v) => setFromTime(v || null)}
          />
        </div>
        <div className="form-field">
          <TimePicker
            label={t('common.to')}
            format="24h"
            withDropdown
            value={toTime ?? ''}
            disabled={saving}
            onChange={(v) => setToTime(v || null)}
          />
        </div>
      </div>

      {/* Live feedback on the duration and its leave impact. */}
      {minutes != null && <p className="hint">{minutesWithDayFraction(minutes)}</p>}

      <div className="form-field">
        <Textarea
          label={t('common.reason')}
          value={reason}
          minRows={2}
          disabled={saving}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
      </div>

      <div className="form-field">
        <Switch
          checked={convertToLeave}
          label={t('body.exitPermission.convertToLeave')}
          disabled={saving}
          onChange={(e) => setConvertToLeave(e.currentTarget.checked)}
        />
        <div className="hint">
          {convertToLeave
            ? t('body.exitPermission.convertOn')
            : t('body.exitPermission.convertOff')}
        </div>
      </div>
    </>
  )

  return {
    node,
    autoTitle,
    missing,
    async submit(employeeId, title) {
      if (employeeId == null || !exitDate || !fromTime || !toTime)
        throw new Error(t('common.formIncomplete'))
      if (minutes == null) throw new Error(t('body.exitPermission.errorOrder'))

      const created = await exitPermissionsService.create({
        employeeId,
        exitDate,
        fromTime: `${fromTime}:00`,
        toTime: `${toTime}:00`,
        reason: reason.trim(),
        convertToLeave,
        title: title ?? undefined,
      })
      // No advisory: an exit permission is either accepted or refused outright.
      return { requestId: created.requestInstanceId }
    },
  }
}
