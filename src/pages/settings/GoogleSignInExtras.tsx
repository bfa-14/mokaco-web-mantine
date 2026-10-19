import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionIcon, Button, Group, Switch, Table, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { Modal } from '../../components/dialogs'
import { getErrorMessage } from '../../api/errorMessage'
import { accessService } from '../../services/accessService'
import { dateTime } from '../workflow/workflowFormat'
import { SettingsCard } from './SettingsCard'
import { ConfirmDialog, ServerText } from './GoogleSignInDialogs'
import type { GateExtraEmail } from '../../types/access'

interface ExtraForm {
  email: string
  note: string
  isActive: boolean
}

/**
 * The procedure's own shape test, run first so an obvious slip is caught without a round trip:
 * one @, something before it, a dot somewhere after it. The procedure still decides.
 */
function looksLikeEmail(value: string): boolean {
  const at = value.indexOf('@')
  return at > 0 && at === value.lastIndexOf('@') && value.slice(at + 1).includes('.')
}

/**
 * EXTRA GOOGLE ACCOUNTS — people who may open the HRMS without being employees: the owner, the
 * accountant. Add, edit, switch off, remove.
 *
 * Switching one off keeps it on the list (and in the sign-in log's history) — remove is for an
 * address that was a mistake. Both take effect at the next check, within seconds.
 */
export function GoogleSignInExtras({
  extras,
  onChanged,
}: {
  extras: GateExtraEmail[]
  onChanged: () => Promise<void> | void
}) {
  const { t } = useTranslation()

  /** The address being edited, 'new' for the add dialog, or null when no dialog is open. */
  const [editing, setEditing] = useState<GateExtraEmail | 'new' | null>(null)
  const [form, setForm] = useState<ExtraForm>({ email: '', note: '', isActive: true })
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [removing, setRemoving] = useState<GateExtraEmail | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  /** The row whose Active switch is saving. */
  const [toggling, setToggling] = useState<number | null>(null)

  function openAdd() {
    setForm({ email: '', note: '', isActive: true })
    setFormError(null)
    setEditing('new')
  }

  function openEdit(extra: GateExtraEmail) {
    setForm({ email: extra.email, note: extra.note ?? '', isActive: extra.isActive })
    setFormError(null)
    setEditing(extra)
  }

  async function submit() {
    const email = form.email.trim()
    if (!looksLikeEmail(email)) {
      setFormError(t('googleGate.extras.emailRequired'))
      return
    }
    const note = form.note.trim() || null
    setBusy(true)
    setFormError(null)
    try {
      if (editing === 'new') {
        await accessService.addExtra({ email, note })
        notifications.show({ message: t('googleGate.extras.added', { email }), color: 'green', autoClose: 2500 })
      } else if (editing) {
        await accessService.updateExtra(editing.gateExtraEmailId, { email, note, isActive: form.isActive })
        notifications.show({ message: t('googleGate.extras.saved', { email }), color: 'green', autoClose: 2500 })
      }
      setEditing(null)
      await onChanged()
    } catch (err) {
      // "This Gmail is already on the list." — the database's sentence, in the dialog, form kept.
      setFormError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function setActive(extra: GateExtraEmail, isActive: boolean) {
    setToggling(extra.gateExtraEmailId)
    try {
      await accessService.updateExtra(extra.gateExtraEmailId, {
        email: extra.email,
        note: extra.note,
        isActive,
      })
      await onChanged()
    } catch (err) {
      notifications.show({ message: <ServerText text={getErrorMessage(err)} />, color: 'red', autoClose: 6000 })
    } finally {
      setToggling(null)
    }
  }

  async function remove() {
    if (!removing) return
    setBusy(true)
    setRemoveError(null)
    try {
      await accessService.removeExtra(removing.gateExtraEmailId)
      notifications.show({
        message: t('googleGate.extras.removed', { email: removing.email }),
        color: 'green',
        autoClose: 2500,
      })
      setRemoving(null)
      await onChanged()
    } catch (err) {
      setRemoveError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard
      title={t('googleGate.extras.title')}
      description={t('googleGate.extras.description')}
      headExtra={
        <Button size="xs" leftSection={<IconPlus size={14} />} onClick={openAdd}>
          {t('googleGate.extras.add')}
        </Button>
      }
    >
      {extras.length === 0 ? (
        <div className="empty-hint">{t('googleGate.extras.empty')}</div>
      ) : (
        <Table.ScrollContainer minWidth={600}>
          <Table striped withTableBorder verticalSpacing="xs" fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('googleGate.extras.cols.email')}</Table.Th>
                <Table.Th>{t('googleGate.extras.cols.note')}</Table.Th>
                <Table.Th style={{ width: 80 }}>{t('googleGate.extras.cols.active')}</Table.Th>
                <Table.Th>{t('googleGate.extras.cols.lastSignIn')}</Table.Th>
                <Table.Th style={{ width: 96 }}>{t('googleGate.extras.cols.actions')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {extras.map((extra) => (
                <Table.Tr key={extra.gateExtraEmailId}>
                  <Table.Td>
                    <bdi className="gate-email">{extra.email}</bdi>
                  </Table.Td>
                  <Table.Td>{extra.note || t('common.dash')}</Table.Td>
                  <Table.Td>
                    <Switch
                      checked={extra.isActive}
                      disabled={toggling != null}
                      onChange={(e) => void setActive(extra, e.currentTarget.checked)}
                      aria-label={t('googleGate.extras.activeAria', { email: extra.email })}
                    />
                  </Table.Td>
                  <Table.Td>
                    {extra.lastSignInAt ? dateTime(extra.lastSignInAt) : t('googleGate.people.never')}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <ActionIcon
                        variant="subtle"
                        onClick={() => openEdit(extra)}
                        aria-label={t('googleGate.extras.editAria', { email: extra.email })}
                        title={t('common.edit')}
                      >
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() => {
                          setRemoveError(null)
                          setRemoving(extra)
                        }}
                        aria-label={t('googleGate.extras.removeAria', { email: extra.email })}
                        title={t('googleGate.extras.remove')}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal
        opened={editing != null}
        onClose={() => !busy && setEditing(null)}
        title={editing === 'new' ? t('googleGate.extras.addTitle') : t('googleGate.extras.editTitle')}
        size={440}
        centered
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          noValidate
        >
          <div className="form-field">
            <TextInput
              id="gate-extra-email"
              type="email"
              label={t('googleGate.extras.emailLabel')}
              placeholder={t('googleGate.extras.emailPlaceholder')}
              value={form.email}
              onChange={(e) => {
                const value = e.currentTarget.value
                setForm((f) => ({ ...f, email: value }))
              }}
              autoComplete="off"
              dir="ltr"
              required
              disabled={busy}
              data-autofocus
            />
          </div>
          <div className="form-field">
            <TextInput
              id="gate-extra-note"
              label={t('googleGate.extras.noteLabel')}
              placeholder={t('googleGate.extras.notePlaceholder')}
              value={form.note}
              onChange={(e) => {
                const value = e.currentTarget.value
                setForm((f) => ({ ...f, note: value }))
              }}
              maxLength={200}
              disabled={busy}
            />
          </div>
          {editing !== 'new' && (
            <div className="form-field">
              <Switch
                label={t('googleGate.extras.activeLabel')}
                checked={form.isActive}
                onChange={(e) => {
                  const checked = e.currentTarget.checked
                  setForm((f) => ({ ...f, isActive: checked }))
                }}
                disabled={busy}
              />
            </div>
          )}

          {formError && (
            <div className="alert alert--error" role="alert">
              <ServerText text={formError} />
            </div>
          )}

          <div className="form-actions">
            <Button variant="default" onClick={() => setEditing(null)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={busy}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        opened={removing != null}
        title={t('googleGate.extras.removeTitle')}
        confirmLabel={t('googleGate.extras.remove')}
        danger
        busy={busy}
        error={removeError}
        onConfirm={() => void remove()}
        onClose={() => setRemoving(null)}
      >
        {removing && t('googleGate.extras.removeBody', { email: removing.email })}
      </ConfirmDialog>
    </SettingsCard>
  )
}
