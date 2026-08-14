import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, FileInput, Loader } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { getErrorMessage } from '../../api/errorMessage'
import { meService } from '../../services/workflowService'
import type { MySignature } from '../../types/workflow'
import { PageHelp } from '../../components/PageHelp'
import { dateTime, fileSize } from '../../pages/workflow/workflowFormat'
import { ChangePasswordCard } from './ChangePasswordCard'

/** Matches the server's cap. Checked here too, so an oversized file fails instantly instead of after an upload. */
const MAX_BYTES = 1024 * 1024

/**
 * "Your signature" — the caller's own signature image, set once and then shown wherever they sign.
 *
 * WHAT THIS IS NOT: it is not what authorises a decision. A decision is signed with a PASSWORD,
 * verified server-side; this image is the visual convention that appears beside the record. Which is
 * why having none is a perfectly ordinary state — everything still works, the decision just shows a
 * name and a timestamp instead of a picture. Nothing here may present its absence as a problem.
 */
function MySignaturePanel() {
  const [info, setInfo] = useState<MySignature | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  /**
   * The FileInput's controlled value — cleared after every attempt, which is the Mantine equivalent
   * of the original's `fileInput.current.value = ''`: picking the same file twice must fire twice.
   */
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  // Held so the object URL from the PREVIOUS image can be revoked when it is replaced or removed.
  const urlRef = useRef<string | null>(null)
  const setImageUrl = useCallback((next: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = next
    setUrl(next)
  }, [])

  /**
   * `justSavedAt` is the updatedAt the UPLOAD ITSELF reported. It is passed straight after a save so
   * the image is fetched against the version we know was just written, rather than against whatever
   * the metadata read below happens to return — and so the first-ever upload still shows an image
   * even if that read has not caught up.
   */
  const load = useCallback(
    async (justSavedAt?: string) => {
      setLoading(true)
      try {
        const mine = await meService.signature()
        setInfo(mine)
        // Only fetch bytes when there is something to fetch.
        const hasImage = mine?.hasSignature === true || justSavedAt != null
        setImageUrl(
          hasImage
            ? await meService.signatureImageObjectUrl(justSavedAt ?? mine?.updatedAt)
            : null,
        )
      } catch (err) {
        notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 5000 })
      } finally {
        setLoading(false)
      }
    },
    [setImageUrl],
  )

  useEffect(() => {
    // Wrapped rather than called bare: load() resolves asynchronously and only then sets state.
    async function initial() {
      await load()
    }
    void initial()
  }, [load])

  // The last object URL outlives the last render, so it is revoked on unmount or it leaks.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  async function upload(file: File) {
    if (file.size > MAX_BYTES) {
      notifications.show({
        message: `That file is ${fileSize(file.size)}. The limit is 1 MB.`,
        color: 'red',
        autoClose: 5000,
      })
      setPendingFile(null)
      return
    }
    setBusy(true)
    try {
      // The response carries the new updatedAt, so the preview is refetched against the version the
      // SAVE reported — no reliance on a second read to have moved on, and no hard refresh.
      const saved = await meService.uploadSignature(file)
      await load(saved.updatedAt)
      notifications.show({ message: 'Signature saved.', color: 'green', autoClose: 2500 })
    } catch (err) {
      // The server checks the type from the file's own bytes; its refusal names the real reason.
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 6000 })
    } finally {
      setBusy(false)
      setPendingFile(null)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await meService.removeSignature()
      await load()
      notifications.show({
        message: 'Signature removed. You can still sign with your password.',
        color: 'green',
        autoClose: 3500,
      })
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 5000 })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="card-title">Your signature</div>

      {loading ? (
        <div className="page-loading">
          <Loader size={32} />
        </div>
      ) : (
        <>
          {url ? (
            <div className="wf-my-sig" style={{ display: 'inline-flex' }}>
              <img className="wf-sig-img" src={url} alt="Your signature" />
            </div>
          ) : (
            <p className="hint" style={{ marginTop: 0 }}>
              No signature image on file. You can still sign decisions with your password — the
              record will show your name and the time instead of an image.
            </p>
          )}

          {info?.hasSignature && (
            <div className="hint">
              {info.fileName ?? 'Signature'}
              {info.byteSize != null ? ` · ${fileSize(info.byteSize)}` : ''}
              {info.updatedAt ? ` · updated ${dateTime(info.updatedAt)}` : ''}
            </div>
          )}

          <div className="grid-actions" style={{ marginTop: 12, justifyContent: 'flex-start' }}>
            <FileInput
              value={pendingFile}
              accept="image/png,image/jpeg"
              disabled={busy}
              placeholder="Choose an image…"
              aria-label="Signature image"
              w={240}
              clearable={false}
              onChange={(file) => {
                setPendingFile(file)
                if (file) void upload(file)
              }}
            />
            {info?.hasSignature && (
              <Button
                variant="outline"
                color="red"
                onClick={() => void remove()}
                disabled={busy}
              >
                {busy ? 'Working…' : 'Remove'}
              </Button>
            )}
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            PNG or JPEG, up to 1 MB.
          </p>
        </>
      )}
    </div>
  )
}

/** The signed-in user's own profile — what they can set about themselves, needing no permission. */
export default function MyProfilePage() {
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">My profile</h1>
          <p className="page-subtitle">Settings that are yours alone.</p>
        </div>
      </div>

      <PageHelp>
        Your signature image appears beside decisions you sign. It is a convention, not a
        credential — what actually signs a decision is your password.
      </PageHelp>

      <MySignaturePanel />

      {/* Below the signature deliberately. The signature is the thing people come to this page to
          set up; the password is the thing they come back to change, and putting it first would put
          a rarely-touched form above the one that is actually being visited. */}
      <ChangePasswordCard />
    </div>
  )
}
