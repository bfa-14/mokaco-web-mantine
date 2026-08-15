import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Loader, NumberInput, Switch, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { SettingRow, SettingRows, SettingsCard } from './SettingsCard'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { devicesService } from '../../services/attendanceService'
import { settingsService } from '../../services/settingsService'
import { formatDate, formatTime } from '../attendance/attendanceFormat'
import { DEVICE_PULL_DEFAULTS, type Device } from '../../types/attendance'
import {
  MACHINE_PULL_AUTO_PROCESS_KEY,
  MACHINE_PULL_ENABLED_KEY,
  MACHINE_PULL_MINUTES_KEY,
  type Setting,
} from '../../types/settings'

const DEVICE_MANAGE = 'DEVICE_MANAGE'

/** The proc consumes only unprocessed punches and then rewrites the day from just those — so a
 *  mid-day run after the IN has already been consumed recomputes the day from the OUT alone and
 *  writes it back as Absent. Verified against the live database, not inferred. */
const AUTO_PROCESS_UNAVAILABLE =
  'Unavailable: the attendance processor rebuilds a day from the punches it has not yet consumed, ' +
  'so running it before the day is over would rewrite a present employee as Absent. Pulled punches ' +
  'are stored immediately and become attendance on the nightly run, or when you process a day by ' +
  'hand from the Daily attendance page.'

const MINUTES_MIN = 1
const MINUTES_MAX = 60

const PORT_MIN = 1
const PORT_MAX = 65535

/**
 * Is this something the server could dial — an IPv4 address or a hostname?
 *
 * Deliberately NOT a strict RFC check. The job here is to catch the typo that would otherwise be
 * saved, poll silently for a week and be blamed on the machine — "192.168.45" or a pasted
 * "http://192.168.45.12". Anything that could plausibly resolve is let through, because a site
 * that names its terminals by DHCP reservation is doing a reasonable thing and a validator that
 * refuses hostnames would force them back onto an address that is allowed to change.
 */
function isDialableHost(value: string): boolean {
  const host = value.trim()
  if (host.length === 0 || host.length > 253) return false

  const octets = host.split('.')
  if (octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o))) {
    return octets.every((o) => Number(o) <= 255)
  }

  // A hostname: dot-separated labels of letters, digits and inner hyphens.
  return host
    .split('.')
    .every((label) => /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label) && label.length <= 63)
}

/** Reads one setting out of the list the page already loaded. */
function find(settings: Setting[], key: string): Setting | undefined {
  return settings.find((s) => s.settingKey === key)
}

function isOn(setting: Setting | undefined): boolean {
  return setting?.settingValue === 'true' || setting?.settingValue === '1'
}

/**
 * One machine's connection, editable in place.
 *
 * THIS IS THE PRIMARY PLACE THE ADDRESS IS CHANGED, and the reason is a workflow: a terminal that
 * moves between networks — the shop's LAN one week, a VPN address the next — needs one field
 * changed and nothing else. Making that a trip into a per-device popup on another page, for a
 * value that changes far more often than anything else on the device record, is the friction this
 * section removes. The comm key stays on the Devices page: it belongs to the hardware and
 * essentially never changes.
 *
 * The save sends the device's WHOLE current record with only these fields replaced. The update
 * endpoint is a full replace, so sending a partial payload here would blank the name, the branch
 * and the active flag — an edit to an IP must not be able to retire a terminal.
 */
function MachineRow({
  device,
  canManage,
  onChanged,
}: {
  device: Device
  canManage: boolean
  onChanged: () => Promise<void> | void
}) {
  const [testing, setTesting] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  /**
   * Null means "not edited" — the fields echo the server.
   *
   * The same override-that-clears-on-success shape as the interval box above, and for the same
   * reason: a draft copied into state by an effect keeps showing what was typed even when the
   * write was refused, because nothing tells it the value never landed. Clearing the draft on
   * success makes the row fall back to what the server actually holds, which after the refetch
   * is the truth.
   */
  const [draft, setDraft] = useState<{
    pullIp: string
    pullPort: number
    pullEnabled: boolean
  } | null>(null)

  const saved = {
    pullIp: device.pullIp ?? '',
    pullPort: device.pullPort || DEVICE_PULL_DEFAULTS.port,
    pullEnabled: device.pullEnabled,
  }
  const current = draft ?? saved
  const dirty =
    draft != null &&
    (draft.pullIp !== saved.pullIp ||
      draft.pullPort !== saved.pullPort ||
      draft.pullEnabled !== saved.pullEnabled)

  function edit(patch: Partial<typeof saved>) {
    setFormError(null)
    setDraft((d) => ({ ...(d ?? saved), ...patch }))
  }

  const busy = testing || pulling || saving
  // Test and Pull now both act on what the SERVER holds, not on what is in these boxes. Running
  // either against an unsaved address would report on the old machine while the user reads the
  // new one — so both wait for a save. (The brief names Test; Pull now lies in exactly the same
  // way, so it is gated identically.)
  const mustSaveFirst = dirty
  const noAddress = !device.pullIp
  const label =
    device.name && device.name.trim().length > 0 ? device.name : device.serialNumber

  async function save() {
    const address = current.pullIp.trim()

    if (current.pullEnabled && address.length === 0) {
      setFormError('Pulling is on for this machine, but it has no address. Enter its IP.')
      return
    }
    if (address.length > 0 && !isDialableHost(address)) {
      setFormError('That is not a valid IP address or hostname.')
      return
    }
    if (current.pullPort < PORT_MIN || current.pullPort > PORT_MAX) {
      setFormError(`The port must be between ${PORT_MIN} and ${PORT_MAX} (4370 on a ZK terminal).`)
      return
    }

    setFormError(null)
    setSaving(true)
    try {
      // The device's full current record, with only the connection replaced — see the note above
      // on why a partial payload here would be destructive.
      await devicesService.update(device.deviceId, {
        serialNumber: device.serialNumber,
        name: device.name,
        branchId: device.branchId,
        departmentId: device.departmentId,
        isActive: device.isActive,
        pullIp: address.length > 0 ? address : null,
        pullPort: current.pullPort,
        // Untouched: the comm key is not editable here, so it must be echoed back exactly or the
        // save would silently reset it to the factory 0 and the next pull would be refused.
        pullCommKey: device.pullCommKey,
        pullEnabled: current.pullEnabled,
      })
      notifications.show({
        message: 'Saved — next pull uses the new address',
        color: 'green',
        autoClose: 4000,
      })
      setDraft(null)
      await onChanged()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true)
    try {
      const result = await devicesService.testConnection(device.deviceId)
      if (result.ok && result.deviceTime) {
        notifications.show({
          message: `${label} answered. Machine time: ${formatDate(result.deviceTime)} ${formatTime(result.deviceTime)}.`,
          color: 'green',
          autoClose: 4000,
        })
      } else {
        notifications.show({
          message: result.error ?? `${label} did not answer.`,
          color: 'red',
          autoClose: 6000,
        })
      }
      await onChanged()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setTesting(false)
    }
  }

  async function pull() {
    setPulling(true)
    try {
      const result = await devicesService.pullNow(device.deviceId)
      if (result.error) {
        notifications.show({ message: result.error, color: 'red', autoClose: 6000 })
      } else {
        notifications.show({
          message:
            result.inserted === 0
              ? `${label}: nothing new — all ${result.received} punch(es) already recorded.`
              : `${label}: ${result.inserted} new punch(es), ${result.duplicates} already recorded.`,
          color: 'green',
          autoClose: 5000,
        })
      }
      await onChanged()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setPulling(false)
    }
  }

  /** One reason a button is unavailable, in the order the user should act on it. */
  function actionTitle(action: string): string {
    if (mustSaveFirst) return 'Save first'
    if (noAddress) return 'This machine has no address yet.'
    return action
  }

  return (
    <div className="machine-row">
      <div className="machine-row-main">
        <div className="machine-row-name">{label}</div>
        <div className="hint">{device.serialNumber}</div>
      </div>

      {canManage ? (
        <div className="machine-row-edit">
          <div className="machine-field">
            <label className="form-label" htmlFor={`machine-ip-${device.deviceId}`}>
              Machine IP
            </label>
            <TextInput
              id={`machine-ip-${device.deviceId}`}
              value={current.pullIp}
              onChange={(event) => {
                const value = event.currentTarget.value
                edit({ pullIp: value })
              }}
              placeholder="192.168.45.12"
              disabled={saving}
              w={170}
            />
          </div>

          <div className="machine-field">
            <label className="form-label" htmlFor={`machine-port-${device.deviceId}`}>
              Port
            </label>
            <NumberInput
              id={`machine-port-${device.deviceId}`}
              value={current.pullPort}
              // Mantine emits a string while typing and '' for a cleared box; neither may reach
              // the request as NaN, so anything non-numeric falls back to the factory port.
              onChange={(value) =>
                edit({
                  pullPort:
                    typeof value === 'number'
                      ? value
                      : Number(value) || DEVICE_PULL_DEFAULTS.port,
                })
              }
              min={PORT_MIN}
              max={PORT_MAX}
              step={1}
              allowDecimal={false}
              disabled={saving}
              w={110}
            />
          </div>

          <div className="machine-field">
            <Switch
              checked={current.pullEnabled}
              label="Pull"
              disabled={saving}
              onChange={(event) => {
                const checked = event.currentTarget.checked
                edit({ pullEnabled: checked })
              }}
            />
          </div>

          <Button size="compact-sm" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      ) : (
        <div className="machine-row-edit">
          <span className={device.pullEnabled ? 'badge badge--on' : 'badge badge--muted'}>
            {device.pullEnabled ? 'Pulling' : 'Not pulled'}
          </span>
          <span className="hint">
            {device.pullIp ? `${device.pullIp}:${device.pullPort}` : 'no address'}
          </span>
        </div>
      )}

      <div className="machine-row-status">
        {device.lastPullError ? (
          <span className="badge badge--off" title={device.lastPullError}>
            ⚠ Last attempt failed
          </span>
        ) : device.lastPullUtc ? (
          <span className="hint">
            Last pull {formatDate(device.lastPullUtc)} {formatTime(device.lastPullUtc)}
          </span>
        ) : (
          <span className="hint">Never pulled</span>
        )}
      </div>

      {canManage && (
        <div className="machine-row-actions">
          <Button
            variant="default"
            size="compact-sm"
            disabled={busy || noAddress || mustSaveFirst}
            title={actionTitle(`Connect to ${device.pullIp} and read its clock.`)}
            onClick={() => void test()}
          >
            {testing ? 'Testing…' : 'Test'}
          </Button>
          <Button
            variant="default"
            size="compact-sm"
            disabled={busy || noAddress || mustSaveFirst}
            title={actionTitle('Read this machine now instead of waiting for the timer.')}
            onClick={() => void pull()}
          >
            {pulling ? 'Pulling…' : 'Pull now'}
          </Button>
        </div>
      )}

      {formError && (
        <div className="machine-row-error alert alert--error" role="alert">
          {formError}
        </div>
      )}
    </div>
  )
}

/**
 * ATTENDANCE MACHINES — the schedule on which the server calls the terminals, plus the machines
 * it will call.
 *
 * WHY THE THREE KEYS LIVE HERE rather than in the generic settings list: a bare
 * "MachinePullMinutes" card tells nobody which machines it polls, or whether any machine is
 * configured at all. The schedule is only meaningful next to its worklist, so the two are shown
 * together and the keys are excluded from the list above.
 *
 * The ADDRESS is deliberately NOT editable here. It is a fact about one piece of hardware and it
 * lives on the device record; duplicating the editor would create two places to change it and one
 * of them would eventually be wrong.
 */
export function AttendanceMachinesSection({
  settings,
  onSaved,
}: {
  settings: Setting[]
  onSaved: () => Promise<void> | void
}) {
  const { hasPermission } = useAuth()
  const canManageDevices = hasPermission(DEVICE_MANAGE)

  const enabledSetting = find(settings, MACHINE_PULL_ENABLED_KEY)
  const minutesSetting = find(settings, MACHINE_PULL_MINUTES_KEY)
  const autoProcessSetting = find(settings, MACHINE_PULL_AUTO_PROCESS_KEY)

  const [devices, setDevices] = useState<Device[]>([])
  const [loadingDevices, setLoadingDevices] = useState(true)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  /**
   * Null means "not edited" — the box shows the server's value.
   *
   * Deliberately NOT an effect that copies the setting into state on every change. That version
   * keeps showing what was typed even when the write was refused, because nothing tells it the
   * value it echoed never landed. Treating the draft as an override that clears on success means
   * the box always falls back to what the server actually holds.
   */
  const [minutesDraft, setMinutesDraft] = useState<number | null>(null)
  const serverMinutes = Number(minutesSetting?.settingValue) || 5
  const minutes = minutesDraft ?? serverMinutes
  const minutesDirty = minutesDraft != null && minutesDraft !== serverMinutes

  async function loadDevices() {
    setLoadingDevices(true)
    try {
      setDevices(await devicesService.getAll())
      setDeviceError(null)
    } catch (err) {
      setDeviceError(getErrorMessage(err))
    } finally {
      setLoadingDevices(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      try {
        const list = await devicesService.getAll()
        if (!cancelled) {
          setDevices(list)
          setDeviceError(null)
        }
      } catch (err) {
        if (!cancelled) setDeviceError(getErrorMessage(err))
      } finally {
        if (!cancelled) setLoadingDevices(false)
      }
    }
    void initialLoad()
    return () => {
      cancelled = true
    }
  }, [])

  // Nothing to configure if the keys are not deployed. Say which script is missing rather than
  // rendering an empty card that looks like a broken page.
  if (!enabledSetting && !minutesSetting && !autoProcessSetting) {
    return (
      <SettingsCard title="Attendance machines">
        <div className="empty-hint">
          <div className="empty-hint-main">
            Machine pulling is not configured on the server.
          </div>
          The MachinePull settings are missing from core.SETTING. Run
          <code> 10_device_pull.sql</code>, then press Refresh.
        </div>
      </SettingsCard>
    )
  }

  async function save(setting: Setting, value: string) {
    setSavingKey(setting.settingKey)
    try {
      await settingsService.update(setting.settingKey, {
        // The dataType and description belong to the database, not to this screen.
        settingValue: value,
        dataType: setting.dataType,
        description: setting.description,
      })
      // Drop the override so the box goes back to echoing the server. Only on SUCCESS — a
      // refused write must leave what the user typed in front of them.
      if (setting.settingKey === MACHINE_PULL_MINUTES_KEY) setMinutesDraft(null)
      await onSaved()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 4000 })
    } finally {
      setSavingKey(null)
    }
  }

  const pullEnabled = isOn(enabledSetting)
  const configured = devices.filter((d) => d.pullEnabled)
  const failing = configured.filter((d) => d.lastPullError)

  return (
    <SettingsCard
      title="Attendance machines"
      description="Instead of waiting for a terminal to send its punches, the server can call the machine and read its log. This is the only way to collect from firmware that has no cloud-server menu — and it is safe to run alongside pushing, because a punch that arrives both ways is recognised as one punch."
    >
      {/* -- the schedule --
          The three pull keys as three rows of one control block, rather than three stacked
          form-fields each as tall as a card. They are one schedule and they read as one now. */}
      <SettingRows>
        {enabledSetting && (
          <SettingRow
            label="Pull punches from machines automatically"
            hint={
              pullEnabled
                ? 'On — every machine below with pulling switched on is called on the interval.'
                : 'Off — no machine is called on a timer. Pull now still works by hand.'
            }
            control={
              <Switch
                checked={pullEnabled}
                disabled={savingKey === enabledSetting.settingKey}
                aria-label="Pull punches from machines automatically"
                onChange={(event) => {
                  const checked = event.currentTarget.checked
                  void save(enabledSetting, checked ? 'true' : 'false')
                }}
              />
            }
          />
        )}

        {minutesSetting && (
          <SettingRow
            htmlFor="machine-pull-minutes"
            label="Every N minutes"
            hint={`How often each machine is called, between ${MINUTES_MIN} and ${MINUTES_MAX} minutes. A pull re-reads the machine's whole buffer, so a short interval costs network traffic rather than duplicate punches.`}
            control={
              <>
                <NumberInput
                  id="machine-pull-minutes"
                  value={minutes}
                  // Mantine hands back '' for a cleared box and a string while typing — never let
                  // either reach the request as NaN; an empty box means "back to the minimum".
                  onChange={(value) =>
                    setMinutesDraft(
                      typeof value === 'number' ? value : Number(value) || MINUTES_MIN,
                    )
                  }
                  min={MINUTES_MIN}
                  max={MINUTES_MAX}
                  step={1}
                  allowDecimal={false}
                  w={140}
                  disabled={!pullEnabled || savingKey === minutesSetting.settingKey}
                />
                <Button
                  disabled={
                    !pullEnabled || savingKey === minutesSetting.settingKey || !minutesDirty
                  }
                  onClick={() => void save(minutesSetting, String(minutes))}
                >
                  {savingKey === minutesSetting.settingKey ? 'Saving…' : 'Save'}
                </Button>
              </>
            }
          />
        )}

        {autoProcessSetting && (
          <SettingRow
            label="Process into attendance immediately"
            hint={AUTO_PROCESS_UNAVAILABLE}
            control={
              /* Disabled rather than removed: the setting exists in the database and somebody
                 looking for it deserves to find it, together with the reason it does nothing. */
              <Switch
                checked={false}
                disabled
                aria-label="Process into attendance immediately"
              />
            }
          />
        )}
      </SettingRows>

      {/* -- the worklist -- */}
      <h3 className="set-subhead">Machines</h3>
      <p className="hint" style={{ marginBottom: 12 }}>
        Changes apply on the next pull cycle automatically — press Pull now to apply immediately.
        A machine that moves networks needs only its address changed here.{' '}
        <Link to="/attendance/devices">Edit machines</Link> for the serial, branch and comm key.
      </p>

      {deviceError && (
        <div className="alert alert--error" role="alert">
          {deviceError}
        </div>
      )}

      {loadingDevices ? (
        <div className="page-loading">
          <Loader size={28} />
        </div>
      ) : devices.length === 0 ? (
        <div className="empty-hint">
          <div className="empty-hint-main">No terminals are registered.</div>
          Nothing can be pulled until a machine exists to pull from.{' '}
          <Link to="/attendance/devices">Register a device</Link>, then give it an address.
        </div>
      ) : (
        <>
          {pullEnabled && configured.length === 0 && (
            <div className="alert alert--error" role="alert">
              Automatic pulling is on, but no machine has pulling switched on — so nothing is
              being called. Open a device and fill in its Connection section.
            </div>
          )}
          {failing.length > 0 && (
            <div className="alert alert--error" role="alert">
              {failing.length} machine(s) failed their last pull. A machine that has dropped off
              the network cannot report it itself — hover the warning for what it said.
            </div>
          )}
          <div className="machine-list">
            {devices.map((device) => (
              <MachineRow
                key={device.deviceId}
                device={device}
                canManage={canManageDevices}
                onChanged={loadDevices}
              />
            ))}
          </div>
        </>
      )}
    </SettingsCard>
  )
}
