import { useEffect, useState } from 'react'
import { signaturesService } from '../../services/securityService'

/**
 * A signature thumbnail.
 *
 * It fetches the image through the authenticated client (as an object URL) rather than pointing an
 * <img src> straight at the endpoint, because that endpoint needs a bearer token and a plain <img>
 * tag cannot send one. The `version` prop (the signature's updatedAt) is part of the effect key, so
 * replacing a signature re-fetches instead of showing the stale object URL.
 *
 * The object URL is revoked on unmount and whenever it is replaced — an un-revoked object URL is a
 * memory leak that a long-lived grid would accumulate one row at a time.
 */
export function SignatureThumb({
  userId,
  version,
  height = 34,
}: {
  userId: number
  /** Something that changes when the image changes (its updatedAt), so a replacement re-fetches. */
  version?: string | null
  height?: number
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false

    signaturesService
      // `version` keys the effect AND the URL. Re-running the fetch alone was not enough: the
      // address is keyed by user id, so the HTTP cache could answer the new fetch with the bytes
      // from before the replacement.
      .getImageObjectUrl(userId, version)
      .then((u) => {
        if (cancelled) {
          if (u) URL.revokeObjectURL(u)
          return
        }
        objectUrl = u
        setUrl(u)
        setFailed(false)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [userId, version])

  if (failed) {
    return <span className="badge badge--off">Failed</span>
  }
  if (!url) {
    // Briefly, while the blob loads. A dash rather than a spinner keeps the grid calm.
    return <span className="hint">…</span>
  }

  return (
    <img
      src={url}
      alt="Signature"
      style={{
        height,
        maxWidth: 160,
        objectFit: 'contain',
        // A signature is usually dark ink; a subtle checker hints that a transparent PNG is fine.
        background:
          'repeating-conic-gradient(#f0eee9 0% 25%, #fff 0% 50%) 50% / 12px 12px',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: 2,
        verticalAlign: 'middle',
      }}
    />
  )
}
