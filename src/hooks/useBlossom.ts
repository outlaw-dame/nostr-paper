/**
 * useBlossom — File upload hook for Blossom media servers
 *
 * Orchestrates:
 *   1. SHA-256 hashing of the selected file (Web Crypto)
 *   2. BUD-11 auth token creation per Blossom server (signed by NIP-07 extension)
 *   3. Sequential upload to configured servers so signer prompts do not overlap
 *   4. Local blob metadata caching in SQLite
 *
 * Usage:
 *   const { state, upload, reset } = useBlossomUpload()
 *   const blob = await upload(file)   // returns null on failure
 */

import { useState, useCallback } from 'react'
import { sha256File }          from '@/lib/blossom/hash'
import { createBlossomAuth, createNIP98Auth } from '@/lib/blossom/auth'
import {
  BlossomError,
  blossomBlobUrl,
  blossomUpload,
  blossomUploadRequirements,
} from '@/lib/blossom/client'
import { discoverNip96Server, nip96Upload } from '@/lib/blossom/nip96'
import { getBlossomServers, cacheBlob } from '@/lib/db/blossom'
import {
  deriveMediaDimensions,
  normalizeNip94Tags,
  parseFileMetadataEvent,
  publishFileMetadata,
} from '@/lib/nostr/fileMetadata'
import { getNDK }              from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'
import type { BlossomBlob, BlossomUploadDiagnostic, BlossomUploadState } from '@/types'

export function useBlossomUpload() {
  const [state, setState] = useState<BlossomUploadState>({ status: 'idle' })

  const upload = useCallback(async (file: File): Promise<BlossomBlob | null> => {
    try {
      // ── 1. Hash ───────────────────────────────────────────
      setState({ status: 'hashing' })
      const sha256 = await sha256File(file)

      // ── 2. Get servers ────────────────────────────────────
      const servers = await getBlossomServers()
      if (servers.length === 0) {
        setState({
          status: 'error',
          error:  'No Blossom servers configured. Add one in Settings → Media Servers.',
        })
        return null
      }

      // ── 3. Upload to each server ──────────────────────────
      // Run sequentially so NIP-07 extension prompts don't overlap.
      let firstBlob: BlossomBlob | null = null
      const successfulServers: string[] = []
      const uploadErrors: string[]      = []
      const diagnostics: BlossomUploadDiagnostic[] = []
      let ndk: ReturnType<typeof getNDK>
      try { ndk = getNDK() } catch (_err) {
        setState({ status: 'error', error: 'NDK not initialised — cannot sign auth tokens.' })
        return null
      }

      for (let i = 0; i < servers.length; i++) {
        const server = servers[i]!
        setState({
          status:      'uploading',
          server:      server.url,
          serverIndex: i + 1,
          serverCount: servers.length,
          diagnostics,
        })

        try {
          const auth = await createBlossomAuth(ndk, {
            verb: 'upload',
            serverUrl: server.url,
            sha256,
            content: `Upload ${file.name || 'media'} with Blossom`,
          })

          let blob: BlossomBlob | null = null
          let transport: BlossomUploadDiagnostic['transport'] = 'blossom'

          try {
            const requirements = await blossomUploadRequirements(server.url, {
              sha256,
              size: file.size,
              type: file.type || 'application/octet-stream',
            }, auth)

            if (!requirements.ok) {
              throw new BlossomError(
                `Upload rejected by ${server.url} (${requirements.httpStatus}): ${requirements.reason ?? 'Upload not accepted.'}`,
                requirements.httpStatus,
                server.url,
              )
            }

            blob = await blossomUpload(server.url, file, sha256, auth)
          } catch (blossomErr) {
            const nip96 = await discoverNip96Server(server.url)
            if (!nip96) throw blossomErr
            transport = 'nip96'

            const nip96Auth = await createNIP98Auth(ndk, {
              url: nip96.apiUrl,
              method: 'POST',
              payload: sha256,
            })

            blob = await nip96Upload(nip96, file, nip96Auth, sha256)
          }

          if (!blob) throw new Error('Media upload failed unexpectedly.')
          diagnostics.push({
            server: server.url,
            transport,
            success: true,
          })

          if (!firstBlob) firstBlob = blob
          successfulServers.push(server.url)
        } catch (err) {
          const msg = err instanceof BlossomError
            ? `${err.httpStatus}: ${err.message}`
            : String(err)
          uploadErrors.push(`${server.url} — ${msg}`)
          diagnostics.push({
            server: server.url,
            transport: 'blossom',
            success: false,
            message: msg,
          })
          console.warn('[useBlossom] Upload failed:', server.url, err)
        }
      }

      // ── 4. Report results ─────────────────────────────────
      if (!firstBlob) {
        setState({
          status: 'error',
          error:  `Upload failed on all servers:\n${uploadErrors.join('\n')}`,
          diagnostics,
        })
        return null
      }

      const fallbackUrls = [...new Set(
        successfulServers
          .map(serverUrl => blossomBlobUrl(serverUrl, firstBlob!.sha256, firstBlob!.type))
          .filter(url => url !== firstBlob!.url),
      )]

      const derivedDim = firstBlob.nip94?.dim ?? await deriveMediaDimensions(file)
      const fallbackMetadata = normalizeNip94Tags({
        url: firstBlob.url,
        mimeType: firstBlob.type,
        fileHash: firstBlob.sha256,
        size: firstBlob.size,
        ...(firstBlob.nip94?.originalHash ? { originalHash: firstBlob.nip94.originalHash } : {}),
        ...(derivedDim ? { dim: derivedDim } : {}),
        ...(firstBlob.nip94?.magnet ? { magnet: firstBlob.nip94.magnet } : {}),
        ...(firstBlob.nip94?.torrentInfoHash ? { torrentInfoHash: firstBlob.nip94.torrentInfoHash } : {}),
        ...(firstBlob.nip94?.blurhash ? { blurhash: firstBlob.nip94.blurhash } : {}),
        ...(firstBlob.nip94?.thumb ? { thumb: firstBlob.nip94.thumb } : {}),
        ...(firstBlob.nip94?.thumbHash ? { thumbHash: firstBlob.nip94.thumbHash } : {}),
        ...(firstBlob.nip94?.image ? { image: firstBlob.nip94.image } : {}),
        ...(firstBlob.nip94?.imageHash ? { imageHash: firstBlob.nip94.imageHash } : {}),
        ...(firstBlob.nip94?.summary ? { summary: firstBlob.nip94.summary } : {}),
        ...(firstBlob.nip94?.alt ? { alt: firstBlob.nip94.alt } : {}),
        ...(fallbackUrls.length > 0 ? { fallbacks: fallbackUrls } : {}),
        ...(firstBlob.nip94?.service ? { service: firstBlob.nip94.service } : {}),
      }) ?? undefined

      let publishedBlob: BlossomBlob = {
        ...firstBlob,
        ...(fallbackMetadata ? { nip94: fallbackMetadata } : {}),
      }
      let publishWarning: string | null = null

      setState({ status: 'publishing' })
      try {
        const metadataEvent = await withRetry(
          async () => publishFileMetadata(ndk, firstBlob!, {
            ...(fallbackMetadata?.originalHash ? { originalHash: fallbackMetadata.originalHash } : {}),
            ...(fallbackMetadata?.size !== undefined ? { size: fallbackMetadata.size } : {}),
            ...(fallbackMetadata?.dim ? { dim: fallbackMetadata.dim } : {}),
            ...(fallbackMetadata?.magnet ? { magnet: fallbackMetadata.magnet } : {}),
            ...(fallbackMetadata?.torrentInfoHash ? { torrentInfoHash: fallbackMetadata.torrentInfoHash } : {}),
            ...(fallbackMetadata?.blurhash ? { blurhash: fallbackMetadata.blurhash } : {}),
            ...(fallbackMetadata?.thumb ? { thumb: fallbackMetadata.thumb } : {}),
            ...(fallbackMetadata?.thumbHash ? { thumbHash: fallbackMetadata.thumbHash } : {}),
            ...(fallbackMetadata?.image ? { image: fallbackMetadata.image } : {}),
            ...(fallbackMetadata?.imageHash ? { imageHash: fallbackMetadata.imageHash } : {}),
            ...(fallbackMetadata?.summary ? { summary: fallbackMetadata.summary } : {}),
            ...(fallbackMetadata?.alt ? { alt: fallbackMetadata.alt } : {}),
            ...(fallbackMetadata?.fallbacks ? { fallbacks: fallbackMetadata.fallbacks } : {}),
            ...(fallbackMetadata?.service ? { service: fallbackMetadata.service } : {}),
          }),
          {
            maxAttempts: 2,
            baseDelayMs: 1_000,
            maxDelayMs: 4_000,
          },
        )

        const parsedMetadata = parseFileMetadataEvent(metadataEvent)
        publishedBlob = {
          ...publishedBlob,
          ...(parsedMetadata ? { nip94: parsedMetadata.metadata } : {}),
          metadataEventId: metadataEvent.id,
        }
      } catch (err) {
        publishWarning = err instanceof Error
          ? `Upload succeeded but kind-1063 publish failed: ${err.message}`
          : 'Upload succeeded but kind-1063 publish failed.'
        console.warn('[useBlossom] NIP-94 publish failed:', err)
      }

      // Cache in local SQLite (fire-and-forget, non-blocking)
      cacheBlob(publishedBlob, successfulServers).catch(err =>
        console.warn('[useBlossom] Cache write failed:', err)
      )

      setState({
        status: 'done',
        blob: publishedBlob,
        successfulServers,
        diagnostics,
        ...(publishWarning ? { warning: publishWarning } : {}),
      })
      return publishedBlob
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setState({ status: 'error', error: message })
      return null
    }
  }, [])

  const reset = useCallback(() => setState({ status: 'idle' }), [])

  return { state, upload, reset }
}

// ── useBlossomList ────────────────────────────────────────────

import { useEffect } from 'react'
import { listCachedBlobs } from '@/lib/db/blossom'

/**
 * Read the locally cached blob list. Re-fetches when invalidated.
 *
 * Note: this is a simple point-in-time read. For a live feed
 * that reacts to new uploads, use invalidate() after upload completes.
 */
export function useBlossomMediaLibrary() {
  const [blobs, setBlobs]     = useState<BlossomBlob[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const results = await listCachedBlobs(200)
      setBlobs(results)
    } catch (err) {
      console.error('[useBlossomMediaLibrary] Failed to load blobs:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return { blobs, loading, refresh: load }
}
