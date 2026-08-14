import { useCallback, useEffect, useState } from 'react'
import { notifications } from '@mantine/notifications'
import { getErrorMessage } from '../../api/errorMessage'
import { attachmentsService } from '../../services/workflowService'
import type { Attachment } from '../../types/workflow'
import { dateTime, fileSize } from './workflowFormat'

/**
 * The request's own supporting documents — the ones the requester attached to the request itself
 * (stepNo null, attachedTo 'Request'). It sits ABOVE the chain, because it is context for the whole
 * request, not proof of one decision (that lives inside its step).
 *
 * The list is metadata only — a file's bytes are fetched from its own bearer-gated URL, and only when
 * someone actually opens it. Adding and removing are possible only while the request is still open;
 * once it closes, its documents are part of the record and the compose row disappears.
 */
export function RequestDocuments({
  requestId,
  canEdit,
}: {
  requestId: number
  /** True only while the request is open — a closed request's documents are read-only history. */
  canEdit: boolean
}) {
  const [docs, setDocs] = useState<Attachment[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const all = await attachmentsService.forRequest(requestId).catch(() => [] as Attachment[])
    // Request-level documents only. Decision proof (stepNo set) belongs inside its step.
    setDocs(all.filter((a) => a.stepNo == null))
  }, [requestId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function add(file: File) {
    setBusy(true)
    try {
      await attachmentsService.upload(requestId, file, { stepNo: null })
      await load()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 5000 })
    } finally {
      setBusy(false)
    }
  }

  async function remove(attachmentId: number) {
    setBusy(true)
    try {
      await attachmentsService.remove(attachmentId)
      await load()
    } catch (err) {
      // e.g. "Only the person who attached it can remove it." — shown verbatim.
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 5000 })
    } finally {
      setBusy(false)
    }
  }

  // Nothing to show and nothing to add: don't draw an empty card at all.
  if (docs && docs.length === 0 && !canEdit) return null

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title">Documents</div>

      {docs && docs.length > 0 ? (
        <ul className="wf-doc-list">
          {docs.map((d) => (
            <li key={d.attachmentId} className="wf-doc">
              <span className="wf-doc-icon" aria-hidden>
                📄
              </span>
              <div className="wf-doc-body">
                <button
                  type="button"
                  className="wf-doc-name"
                  onClick={() => void attachmentsService.open(d.attachmentId)}
                >
                  {d.fileName}
                </button>
                <div className="wf-doc-meta">
                  {fileSize(d.byteSize)} · {d.uploadedByUsername ?? 'someone'} ·{' '}
                  {dateTime(d.uploadedAt)}
                </div>
                {d.caption && <div className="wf-doc-caption">{d.caption}</div>}
              </div>
              {/* Removable only while the request is open — and the API still has the final say on who. */}
              {canEdit && (
                <button
                  type="button"
                  className="wf-doc-remove wf-no-print"
                  onClick={() => void remove(d.attachmentId)}
                  disabled={busy}
                  title="Remove"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        docs && <p className="hint">No documents attached.</p>
      )}

      {/* PORT NOTE: the source already used a styled native <input type="file"> (not DX FileUploader),
          so the same native input is kept — Mantine FileInput would change the compose row's look. */}
      {canEdit && (
        <div className="wf-doc-add wf-no-print">
          <label className="wf-doc-add-btn">
            {busy ? 'Uploading…' : '+ Add a document'}
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              disabled={busy}
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void add(f)
                // Let the same file be chosen again after a remove.
                e.target.value = ''
              }}
            />
          </label>
        </div>
      )}
    </div>
  )
}
