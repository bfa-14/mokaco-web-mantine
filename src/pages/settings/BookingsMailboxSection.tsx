import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, PasswordInput, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { getErrorMessage } from '../../api/errorMessage'
import { settingsService } from '../../services/settingsService'
import { TEST_MAIL_RECIPIENTS_KEY, type MailGuardState, type MailTestResult, type Setting } from '../../types/settings'
import { SettingRow, SettingRows, SettingsCard } from './SettingsCard'

/**
 * THE BOOKINGS MAILBOX, and a way to try both mail accounts.
 *
 * Two cards on Settings > Notifications:
 *   1. "Bookings mailbox": the address booking e-mails are sent from and its own login. Six rows of
 *      core.SETTING shown as ONE form with one Save, because they are one decision, and saved through the
 *      ordinary settings call, which also creates the rows a database does not have yet.
 *   2. "Send a test message": one message now, through the HR account or the bookings mailbox, with the
 *      SAVED settings, and the mail server's own answer on the screen. It exists because "no e-mail arrived"
 *      has four different causes and none of them was visible from HRMS.
 *
 * A PASSWORD IS NEVER SHOWN: its box starts empty, and empty means "keep the saved one".
 *
 * ON A TEST SYSTEM (a copy of production: real staff, real guests) the API writes only to the recipients
 * listed in the second card, whatever the mail settings say. The live system never shows that list.
 */

type Field = 'BookingFromEmail' | 'BookingFromName' | 'BookingSmtpUser' | 'BookingSmtpHost' | 'BookingSmtpPort'
const FIELDS: Field[] = ['BookingFromEmail', 'BookingFromName', 'BookingSmtpUser', 'BookingSmtpHost', 'BookingSmtpPort']
const PASSWORD_KEY = 'BookingSmtpPassword'

/** The words a newly created row carries in the database (the generic list shows a row's description). */
const DESCRIPTIONS: Record<string, string> = {
  BookingFromEmail: 'Bookings mailbox: the address booking e-mails are sent from.',
  BookingFromName: 'Bookings mailbox: the name guests see as the sender.',
  BookingSmtpUser: 'Bookings mailbox: its login at the mail provider.',
  BookingSmtpPassword: 'Bookings mailbox: its password at the mail provider.',
  BookingSmtpHost: 'Bookings mailbox: its mail server. Empty = the HR mail server.',
  BookingSmtpPort: 'Bookings mailbox: its port. Empty = the HR port.',
}

function valueOf(settings: Setting[], key: string): string {
  return (settings.find((s) => s.settingKey === key)?.settingValue ?? '').trim()
}

export function BookingsMailboxSection({
  settings,
  onSaved,
  defaultRecipient,
}: {
  settings: Setting[]
  /** Reloads the page's settings after a save. */
  onSaved: () => Promise<void> | void
  /** The signed-in person's own address, offered as the test's recipient. */
  defaultRecipient?: string | null
}) {
  const { t } = useTranslation()

  /* ── 1. the mailbox ────────────────────────────────────────────────────────────────────── */
  const saved = Object.fromEntries(FIELDS.map((key) => [key, valueOf(settings, key)])) as Record<Field, string>
  const passwordSaved = valueOf(settings, PASSWORD_KEY) !== ''
  const hrHost = valueOf(settings, 'SmtpHost')
  const hrPort = valueOf(settings, 'SmtpPort') || '587'

  const [drafts, setDrafts] = useState<Partial<Record<Field, string>>>({})
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'save' | 'forget' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const shown = (key: Field) => drafts[key] ?? saved[key]
  /* The value is read NOW: by the time React runs the updater, the event no longer points at its input. */
  const set = (key: Field) => (event: { currentTarget: { value: string } }) => {
    const value = event.currentTarget.value
    setDrafts((current) => ({ ...current, [key]: value }))
  }

  const changed = FIELDS.filter((key) => drafts[key] !== undefined && drafts[key]!.trim() !== saved[key])
  const dirty = changed.length > 0 || password !== ''

  const port = shown('BookingSmtpPort').trim()
  const portProblem = port !== '' && !/^\d{1,5}$/.test(port)
  const fromProblem = shown('BookingFromEmail').trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shown('BookingFromEmail').trim())

  async function save() {
    setBusy('save')
    setError(null)
    try {
      for (const key of changed) {
        await settingsService.update(key, {
          settingValue: drafts[key]!.trim(),
          dataType: key === 'BookingSmtpPort' ? 'int' : 'string',
          description: DESCRIPTIONS[key],
        })
      }
      if (password !== '') {
        await settingsService.update(PASSWORD_KEY, { settingValue: password, dataType: 'string', description: DESCRIPTIONS[PASSWORD_KEY] })
      }
      setDrafts({})
      setPassword('')
      await onSaved()
      notifications.show({ color: 'green', message: t('settings.bookingMail.saved') })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function forgetPassword() {
    setBusy('forget')
    setError(null)
    try {
      await settingsService.update(PASSWORD_KEY, { settingValue: '', dataType: 'string', description: DESCRIPTIONS[PASSWORD_KEY] })
      setPassword('')
      await onSaved()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  /* What booking e-mail does with the SAVED values: the sentence under the card's title. */
  const ownAccount = saved.BookingSmtpUser !== '' && passwordSaved
  const sendHost = saved.BookingSmtpHost || hrHost
  const sendPort = saved.BookingSmtpPort || hrPort
  const state = !ownAccount
    ? hrHost
      ? t('settings.bookingMail.state.viaHr')
      : t('settings.bookingMail.state.nothing')
    : sendHost
      ? t('settings.bookingMail.state.own', { from: saved.BookingFromEmail || saved.BookingSmtpUser, server: `${sendHost}:${sendPort}` })
      : t('settings.bookingMail.state.noServer')
  const stateTone = ownAccount && sendHost ? 'alert--success' : 'alert--warning'

  /* ── the test-system guard: who this system may write to ───────────────────────────────── */
  const [guard, setGuard] = useState<MailGuardState | null>(null)
  const [guardTick, setGuardTick] = useState(0)
  const [recipientsDraft, setRecipientsDraft] = useState<string | null>(null)
  const [savingRecipients, setSavingRecipients] = useState(false)
  const [recipientsError, setRecipientsError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    settingsService
      .mailGuard()
      .then((state) => {
        if (!cancelled) setGuard(state)
      })
      .catch(() => {
        /* An older API has no guard to show: the card simply leaves the list out. */
      })
    return () => {
      cancelled = true
    }
  }, [guardTick])

  const recipientsSaved = guard?.recipients.join(', ') ?? ''
  const recipients = recipientsDraft ?? recipientsSaved

  async function saveRecipients() {
    setSavingRecipients(true)
    setRecipientsError(null)
    try {
      await settingsService.update(TEST_MAIL_RECIPIENTS_KEY, {
        settingValue: recipients.trim(),
        dataType: 'string',
        description: 'Test system only: the addresses (and WhatsApp numbers) it may write to. Ignored by the live system.',
      })
      setRecipientsDraft(null)
      setGuardTick((tick) => tick + 1)
      await onSaved()
    } catch (err) {
      setRecipientsError(getErrorMessage(err))
    } finally {
      setSavingRecipients(false)
    }
  }

  /* ── 2. the test ───────────────────────────────────────────────────────────────────────── */
  const [to, setTo] = useState(defaultRecipient ?? '')
  const [testing, setTesting] = useState<'hr' | 'booking' | null>(null)
  const [result, setResult] = useState<MailTestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const toOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())

  async function test(account: 'hr' | 'booking') {
    setTesting(account)
    setResult(null)
    setTestError(null)
    try {
      setResult(await settingsService.testMail(account, to.trim()))
    } catch (err) {
      setTestError(getErrorMessage(err))
    } finally {
      setTesting(null)
    }
  }

  const accountName = (account: string) => t(account === 'booking' ? 'settings.mailTest.booking' : 'settings.mailTest.hr')
  /* The page's own words for a problem, else the server's English sentence. */
  const explain = (r: MailTestResult) => (r.kind ? t(`settings.mailTest.kinds.${r.kind}`, { defaultValue: r.message ?? '' }) : (r.message ?? ''))

  return (
    <>
      <SettingsCard title={t('settings.bookingMail.title')} description={t('settings.bookingMail.description')}>
        <div className={`alert ${stateTone}`} role="status" data-testid="booking-mail-state">
          {state}
        </div>
        <SettingRows>
          <SettingRow
            label={t('settings.bookingMail.from')}
            hint={t('settings.bookingMail.fromHint')}
            htmlFor="bm-from"
            control={
              <TextInput id="bm-from" w={300} value={shown('BookingFromEmail')} onChange={set('BookingFromEmail')}
                placeholder="bookings@example.com" error={fromProblem ? t('settings.bookingMail.fromBad') : undefined} />
            }
          />
          <SettingRow
            label={t('settings.bookingMail.fromName')}
            hint={t('settings.bookingMail.fromNameHint')}
            htmlFor="bm-name"
            control={<TextInput id="bm-name" w={300} value={shown('BookingFromName')} onChange={set('BookingFromName')} />}
          />
          <SettingRow
            label={t('settings.bookingMail.user')}
            hint={t('settings.bookingMail.userHint')}
            htmlFor="bm-user"
            control={<TextInput id="bm-user" w={300} value={shown('BookingSmtpUser')} onChange={set('BookingSmtpUser')} autoComplete="off" />}
          />
          <SettingRow
            label={t('settings.bookingMail.password')}
            hint={t('settings.bookingMail.passwordHint')}
            note={passwordSaved ? t('settings.bookingMail.passwordSaved') : t('settings.bookingMail.passwordNone')}
            htmlFor="bm-password"
            control={
              <div className="bm-password">
                <PasswordInput id="bm-password" w={300} value={password} autoComplete="new-password"
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  placeholder={passwordSaved ? t('settings.bookingMail.passwordKeep') : ''} />
                {passwordSaved && (
                  <Button variant="subtle" color="red" size="compact-sm" loading={busy === 'forget'} disabled={busy !== null} onClick={forgetPassword}>
                    {t('settings.bookingMail.passwordForget')}
                  </Button>
                )}
              </div>
            }
          />
          <SettingRow
            label={t('settings.bookingMail.host')}
            hint={t('settings.bookingMail.hostHint')}
            htmlFor="bm-host"
            control={
              <TextInput id="bm-host" w={300} value={shown('BookingSmtpHost')} onChange={set('BookingSmtpHost')}
                placeholder={hrHost ? t('settings.bookingMail.hostSame', { server: hrHost }) : 'smtp.gmail.com'} />
            }
          />
          <SettingRow
            label={t('settings.bookingMail.port')}
            hint={t('settings.bookingMail.portHint')}
            htmlFor="bm-port"
            control={
              <TextInput id="bm-port" w={120} value={shown('BookingSmtpPort')} onChange={set('BookingSmtpPort')} inputMode="numeric"
                placeholder={hrPort} error={portProblem ? t('settings.bookingMail.portBad') : undefined} />
            }
          />
        </SettingRows>
        {error && (
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        )}
        <div className="bm-actions">
          <Button onClick={save} loading={busy === 'save'} disabled={!dirty || portProblem || fromProblem || busy !== null}>
            {t('settings.bookingMail.save')}
          </Button>
          {dirty && <span className="bm-unsaved">{t('settings.bookingMail.unsaved')}</span>}
        </div>
      </SettingsCard>

      {guard && !guard.production && (
        <SettingsCard title={t('settings.mailGuard.title')} description={t('settings.mailGuard.description')}>
          <div className={`alert ${guard.recipients.length > 0 ? 'alert--success' : 'alert--warning'}`} role="status" data-testid="mail-guard-state">
            {guard.recipients.length > 0
              ? t('settings.mailGuard.some', { list: guard.recipients.join(', ') })
              : t('settings.mailGuard.none')}
          </div>
          <div className="bm-test">
            <TextInput label={t('settings.mailGuard.label')} description={t('settings.mailGuard.hint')} w={460} value={recipients}
              onChange={(event) => setRecipientsDraft(event.currentTarget.value)} placeholder="you@example.com, colleague@example.com" />
            <Button onClick={saveRecipients} loading={savingRecipients} disabled={recipients.trim() === recipientsSaved || savingRecipients}>
              {t('settings.mailGuard.save')}
            </Button>
          </div>
          {recipientsError && (
            <div className="alert alert--error" role="alert">
              {recipientsError}
            </div>
          )}
        </SettingsCard>
      )}

      <SettingsCard title={t('settings.mailTest.title')} description={t('settings.mailTest.description')}>
        <div className="bm-test">
          <TextInput label={t('settings.mailTest.to')} w={320} value={to} onChange={(event) => setTo(event.currentTarget.value)}
            placeholder="you@example.com" type="email" />
          <Button variant="default" onClick={() => test('hr')} loading={testing === 'hr'} disabled={!toOk || testing !== null}>
            {t('settings.mailTest.testHr')}
          </Button>
          <Button onClick={() => test('booking')} loading={testing === 'booking'} disabled={!toOk || testing !== null || dirty}>
            {t('settings.mailTest.testBooking')}
          </Button>
        </div>
        {dirty && <p className="set-row-hint">{t('settings.mailTest.saveFirst')}</p>}
        {testing && <p className="set-row-hint">{t('settings.mailTest.waiting')}</p>}
        {testError && (
          <div className="alert alert--error" role="alert">
            {testError}
          </div>
        )}
        {result && (
          <div className={`alert ${result.ok ? 'alert--success' : 'alert--error'}`} role="status" data-testid="mail-test-result">
            <strong>
              {result.ok
                ? t('settings.mailTest.sent', { account: accountName(result.account), to: result.to })
                : t('settings.mailTest.failed', { account: accountName(result.account) })}
            </strong>
            {result.ok ? (
              <p className="bm-result-line">{t('settings.mailTest.sentDetail', { from: result.from, server: result.through })}</p>
            ) : (
              <>
                <p className="bm-result-line">{explain(result)}</p>
                {result.through && <p className="bm-result-line">{t('settings.mailTest.tried', { from: result.from, server: result.through })}</p>}
                {result.serverAnswer && (
                  <p className="bm-result-line">
                    {t('settings.mailTest.serverSaid')} <code dir="ltr">{result.serverAnswer}</code>
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </SettingsCard>
    </>
  )
}
