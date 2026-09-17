import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useTranslation } from 'react-i18next'
import { Modal } from './dialogs'
import { ApiError } from '../api/client'
import { getErrorMessage } from '../api/errorMessage'

/**
 * The two endings a reference row can have — see referenceEndings in hrService.
 * Any of the five setup services (branches, departments, positions, component types, leave types)
 * satisfies this.
 */
export interface ReferenceEndings {
  remove: (id: number) => Promise<void>
  setActive: (id: number, isActive: boolean) => Promise<void>
}

type DialogState =
  | { kind: 'confirm'; id: number; name: string }
  /** The API said no, with a sentence. `message` is that sentence, verbatim. */
  | { kind: 'refused'; id: number; name: string; message: string }

/**
 * DELETE, AND WHAT TO DO WHEN DELETE IS REFUSED — one flow for every setup table.
 *
 * Delete asks first (a confirm dialog), then calls DELETE. The interesting answer is the 409: the
 * row is still used by something, and the API says exactly what — "Cannot delete 'Cashier': it is
 * used by 7 employees and 340 payslip lines. Deactivate it instead." The dialog then shows that
 * sentence AS IS and offers the ending the sentence recommends: "Deactivate instead", which is
 * PATCH …/active { isActive: false } — the row keeps its history and leaves every pick-list. Any
 * other failure (404, 403) is a toast, since there is nothing further to offer.
 *
 * `setActive` is the same PATCH exposed directly, for the "Reactivate" action an inactive row
 * shows (and for a plain "Deactivate" where a page wants one without going through a refusal).
 *
 * Returns the actions and the dialog NODE; the page renders the node wherever it keeps its other
 * modals. Nothing here decides who may press the buttons — the page gates the actions column on
 * its manage permission, as it always did.
 */
export function useReferenceDelete(service: ReferenceEndings, reload: () => Promise<void> | void) {
  const { t } = useTranslation()
  const [state, setState] = useState<DialogState | null>(null)
  const [busy, setBusy] = useState(false)

  function requestDelete(id: number, name: string) {
    setState({ kind: 'confirm', id, name })
  }

  async function confirmDelete() {
    if (!state) return
    const { id, name } = state
    setBusy(true)
    try {
      await service.remove(id)
      notifications.show({ message: t('hr.reference.deleted', { name }), color: 'green', autoClose: 2500 })
      setState(null)
      await reload()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // The refusal replaces the question. Its text is the server's own sentence, untouched.
        setState({ kind: 'refused', id, name, message: getErrorMessage(err) })
      } else {
        notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 5000 })
        setState(null)
      }
    } finally {
      setBusy(false)
    }
  }

  async function setActive(id: number, name: string, isActive: boolean) {
    setBusy(true)
    try {
      await service.setActive(id, isActive)
      notifications.show({
        message: t(isActive ? 'hr.reference.reactivated' : 'hr.reference.deactivated', { name }),
        color: 'green',
        autoClose: 3000,
      })
      setState(null)
      await reload()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 5000 })
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    if (!busy) setState(null)
  }

  const dialog: ReactNode = state && (
    <Modal
      opened
      onClose={close}
      title={
        state.kind === 'confirm'
          ? t('hr.reference.deleteTitle', { name: state.name })
          : t('hr.reference.refusedTitle')
      }
      size={480}
      centered
    >
      {state.kind === 'confirm' ? (
        <>
          <p style={{ marginTop: 0 }}>{t('hr.reference.deleteConfirm')}</p>
          <div className="form-actions">
            <Button variant="default" onClick={close} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button color="red" loading={busy} onClick={() => void confirmDelete()}>
              {t('common.delete')}
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* The API's sentence, verbatim — it names the counts that make the row un-deletable. */}
          <div className="alert alert--error" role="alert">
            {state.message}
          </div>
          <p className="hint">{t('hr.reference.deactivateHint')}</p>
          <div className="form-actions">
            <Button variant="default" onClick={close} disabled={busy}>
              {t('common.close')}
            </Button>
            <Button loading={busy} onClick={() => void setActive(state.id, state.name, false)}>
              {t('hr.reference.deactivateInstead')}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )

  return { requestDelete, setActive, busy, dialog }
}
