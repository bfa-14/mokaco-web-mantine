import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { Button, Switch, TextInput } from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { notifications } from '@mantine/notifications'
import { getErrorMessage } from '../../api/errorMessage'
import { settingsService, systemService } from '../../services/settingsService'
import { useAuth } from '../../auth/useAuth'
import {
  ALLOW_SYSTEM_RESET_KEY,
  RESET_CONFIRM_PHRASE,
  SYSTEM_RESET_PERMISSION,
} from '../../types/settings'
import type { Setting, SystemResetSummaryRow } from '../../types/settings'

/**
 * THE DANGER ZONE — reset all data.
 *
 * Everything here is arranged around one idea: the destructive act should be easy to understand and
 * hard to do by accident. That means TWO INDEPENDENT GATES, not one confirmation with more red on
 * it: a toggle that must be armed deliberately (and disarms itself after every use), and a phrase
 * that must be typed exactly. Both are enforced by the stored procedure, so neither is theatre —
 * the toggle is a real row the procedure reads, and skipping the dialog would not skip the check.
 *
 * The panel refuses to guess. It never says "this will delete N things"; it says what SURVIVES,
 * both before (in the dialog) and after (from the procedure's own count), because that is the
 * question someone actually has before pressing it.
 */
export function DangerZone({
  armedSetting,
  onArmedChanged,
}: {
  /** The AllowSystemReset row, or null if the settings list could not be read. */
  armedSetting: Setting | null
  /** Reload the settings list, so the toggle reflects what is stored — including after a reset disarms it. */
  onArmedChanged: () => Promise<void> | void
}) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { hasPermission, logout } = useAuth()

  const [arming, setArming] = useState(false)
  /**
   * THE ARMED VALUE SETTLES FROM THE SAVE, NOT FROM A REFETCH.
   *
   * The toggle used to render `armedSetting.settingValue` directly — server state and nothing else.
   * So a click wrote the PUT, the page reloaded its settings, and if that read had been issued
   * before the write landed it put the OLD value back. The switch flicked and returned, and people
   * learned to click it twice.
   *
   * Null means "no local choice — show what the server says". Once a choice is made it outranks the
   * incoming prop, so a refetch mid-flight cannot undo it.
   */
  const [armedChoice, setArmedChoice] = useState<boolean | null>(null)
  /** Read synchronously by the guard below; state would not be visible to a same-tick re-render. */
  const savingArm = useRef(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  /** The API's refusal, shown verbatim IN the dialog with the phrase left as typed. */
  const [error, setError] = useState<string | null>(null)
  /** What survived. Once this is set the reset has happened and the panel becomes a report. */
  const [summary, setSummary] = useState<SystemResetSummaryRow[] | null>(null)

  // Absent entirely without the permission — an act this destructive should not even be visible to
  // someone who cannot perform it.
  if (!hasPermission(SYSTEM_RESET_PERMISSION)) return null

  /** The local choice wins while it exists; otherwise the stored value. */
  const armed = armedChoice ?? armedSetting?.settingValue === '1'
  const phraseMatches = phrase === RESET_CONFIRM_PHRASE

  async function setArmed(next: boolean) {
    if (!armedSetting || savingArm.current || next === armed) return

    const previous = armed
    savingArm.current = true
    setArming(true)
    // Optimistic, and the control is disabled below for the length of the PUT — so nothing can be
    // toggled over a write that has not landed.
    setArmedChoice(next)

    try {
      await settingsService.update(ALLOW_SYSTEM_RESET_KEY, {
        settingValue: next ? '1' : '0',
        dataType: armedSetting.dataType,
        description: armedSetting.description,
      })
      // The settings PUT returns no body, so the SAVED value is the one just sent — it is kept as
      // the authority rather than re-read. The reload below refreshes the rest of the page; if it
      // brings back a stale AllowSystemReset, armedChoice still outranks it.
      setArmedChoice(next)
      await onArmedChanged()
    } catch (err) {
      // Revert to exactly what was there, and say why — a switch that springs back with no
      // explanation is the bug this replaced.
      setArmedChoice(previous)
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 6000 })
    } finally {
      savingArm.current = false
      setArming(false)
    }
  }

  async function reset() {
    setBusy(true)
    setError(null)
    try {
      const result = await systemService.reset(phrase)
      setSummary(result)
      setDialogOpen(false)
      setPhrase('')
      // The reset disarmed itself server-side, so the local choice must step aside and let the
      // fresh read through — otherwise the switch would still show ARMED after a reset.
      setArmedChoice(null)
      await onArmedChanged()
    } catch (err) {
      // "System reset is not armed…" / "Confirmation phrase does not match…" — both tell the user
      // exactly what to do, and both left every row untouched. Shown verbatim, dialog kept open.
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  /** Sessions were cleared server-side, so the only honest next step is a fresh login. */
  async function goToLogin() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="danger-zone">
      <div className="danger-zone-head">
        <h2 className="danger-zone-title">{t('settings.danger.title')}</h2>
      </div>

      {summary ? (
        /* AFTER THE RESET. The panel stops offering the act and reports it instead — there is
           nothing left to reset, and the session it was done from is already invalid. */
        <>
          <p className="danger-zone-text">
            <Trans i18nKey="settings.danger.doneLead" components={{ strong: <strong /> }} />
          </p>
          <table className="danger-summary">
            <thead>
              <tr>
                <th>{t('settings.danger.kept')}</th>
                <th className="danger-summary-count">{t('settings.danger.rows')}</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row, i) => {
                // The procedure's column is Item; an older version aliased it Kept. Read whichever
                // is actually there — a row that resolves to neither is DROPPED rather than rendered
                // as a lonely number, which is exactly how this bug looked before.
                const name = row.item ?? row.kept
                if (!name) return null
                return (
                  <tr key={`${name}-${i}`}>
                    <td>{name}</td>
                    <td className="danger-summary-count">{row.rows}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="danger-zone-text">{t('settings.danger.sessionsCleared')}</p>
          <Button color="red" onClick={() => void goToLogin()}>
            {t('settings.danger.goToSignIn')}
          </Button>
        </>
      ) : (
        <>
          <p className="danger-zone-text">{t('settings.danger.intro')}</p>

          <div className="danger-zone-arm">
            {/* Mantine's Switch carries its own label element, so the text rides on the control
                rather than on a wrapping <label> as before — same click target, same reading. */}
            <Switch
              label={t('settings.danger.arm')}
              checked={armed}
              disabled={arming || !armedSetting}
              onChange={(e) => void setArmed(e.currentTarget.checked)}
            />
            <div className="hint">{t('settings.danger.armHint')}</div>
            {!armedSetting && <div className="hint">{t('settings.danger.armUnreadable')}</div>}
          </div>

          <Button
            variant="outline"
            color="red"
            disabled={busy}
            onClick={() => {
              setPhrase('')
              setError(null)
              setDialogOpen(true)
            }}
          >
            {t('settings.danger.open')}
          </Button>
          {/* The button stays ENABLED while disarmed on purpose: the refusal explains the toggle far
              better than a dead button does, and it costs nothing — the server changes nothing. */}
        </>
      )}

      {dialogOpen && (
        <Modal
          opened
          onClose={() => setDialogOpen(false)}
          title={t('settings.danger.dialogTitle')}
          size={520}
          centered
          // The original Popup only closed from its X button — a shading click did nothing.
          closeOnClickOutside={false}
        >
          <p style={{ marginTop: 0 }}>{t('settings.danger.dialogDeletes')}</p>
          <p>{t('settings.danger.dialogRemains')}</p>
          <p>
            <Trans
              i18nKey="settings.danger.typePhrase"
              values={{ phrase: RESET_CONFIRM_PHRASE }}
              components={{ strong: <strong /> }}
            />
          </p>

          <TextInput
            value={phrase}
            onChange={(e) => setPhrase(e.currentTarget.value)}
            placeholder={RESET_CONFIRM_PHRASE}
            disabled={busy}
            aria-label={t('settings.danger.typeAria', { phrase: RESET_CONFIRM_PHRASE })}
            autoComplete="off"
          />

          {error && (
            <div className="alert alert--error" role="alert" style={{ marginTop: 12 }}>
              {error}
              {/* The not-armed refusal names the setting; point at where that switch actually is. */}
              {error.includes('not armed') && (
                <div style={{ marginTop: 6 }}>
                  <Trans
                    i18nKey="settings.danger.notArmedHelp"
                    values={{ arm: t('settings.danger.arm') }}
                    components={{ strong: <strong /> }}
                  />
                </div>
              )}
            </div>
          )}

          <div className="form-actions">
            <Button variant="default" onClick={() => setDialogOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button
              color="red"
              // The ONLY thing that enables it is an exact match. The server checks the same phrase,
              // so this is a courtesy against slips, never the safeguard itself.
              disabled={busy || !phraseMatches}
              onClick={() => void reset()}
            >
              {busy ? t('settings.danger.deleting') : t('settings.danger.confirm')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
