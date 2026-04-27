/**
 * BlossomUpload
 *
 * Drag-and-drop / click-to-upload component for Blossom media servers.
 * Shows hashing → uploading progress → done/error states.
 *
 * Returns the uploaded BlossomBlob to the parent via onUploaded().
 *
 * Accepted types default to images, videos, and audio.
 * Pass `accept` to restrict or expand (standard HTML input accept string).
 */

import React, { useRef, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useBlossomUpload } from '@/hooks/useBlossom'
import type { BlossomBlob } from '@/types'

interface BlossomUploadProps {
  onUploaded?: (blob: BlossomBlob, file?: File) => void
  accept?:     string
  disabled?:   boolean
  className?:  string
}

export function BlossomUpload({
  onUploaded,
  accept    = 'image/*,video/*,audio/*',
  disabled  = false,
  className = '',
}: BlossomUploadProps) {
  const { state, upload, reset } = useBlossomUpload()
  const inputRef  = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFile = useCallback(async (file: File) => {
    const blob = await upload(file)
    if (blob) onUploaded?.(blob, file)
  }, [upload, onUploaded])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
    // Reset input so the same file can be re-selected after an error
    e.target.value = ''
  }, [handleFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }, [disabled, handleFile])

  const handleDragOver  = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!disabled) setDragging(true)
  }, [disabled])

  const handleDragLeave = useCallback(() => setDragging(false), [])

  const isActive = state.status === 'hashing' || state.status === 'uploading' || state.status === 'publishing'

  return (
    <div className={className}>
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
      />

      {/* Drop zone */}
      <button
        type="button"
        disabled={disabled || isActive}
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={[
          'w-full rounded-2xl border-2 border-dashed',
          'flex flex-col items-center justify-center gap-2',
          'py-8 px-4 text-center transition-colors duration-150',
          dragging
            ? 'border-[#007AFF] bg-[#007AFF]/5'
            : 'border-[rgb(var(--color-fill)/0.3)] bg-[rgb(var(--color-bg-secondary))]',
          disabled || isActive ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer active:opacity-70',
        ].join(' ')}
        aria-label="Upload media file"
      >
        <UploadIcon active={isActive} />

        <AnimatePresence mode="wait">
          <motion.div
            key={state.status}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={   { opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            <StateLabel state={state} />
          </motion.div>
        </AnimatePresence>
      </button>

      {/* Error dismiss */}
      {state.status === 'error' && (
        <button
          type="button"
          onClick={reset}
          className="
            mt-2 text-[13px] text-[#007AFF]
            active:opacity-70 transition-opacity
          "
        >
          Try again
        </button>
      )}

      {(state.status === 'done' || state.status === 'error') && (state.diagnostics?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-xl border border-[rgb(var(--color-fill)/0.3)] bg-[rgb(var(--color-bg-secondary))] p-3 text-left">
          <p className="text-[12px] font-semibold text-[rgb(var(--color-label))]">Upload Diagnostics</p>
          <ul className="mt-2 space-y-1">
            {state.diagnostics?.map((diag) => (
              <li key={`${diag.server}:${diag.transport}:${diag.success ? 'ok' : 'err'}`} className="text-[12px] text-[rgb(var(--color-label-secondary))]">
                <span className={diag.success ? 'text-[#34C759]' : 'text-[#FF3B30]'}>{diag.success ? 'PASS' : 'FAIL'}</span>
                {' '}
                <span className="font-medium">{diag.transport.toUpperCase()}</span>
                {' '}
                <span className="opacity-80">{diag.server}</span>
                {diag.message ? <span className="block opacity-70">{diag.message}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────

function UploadIcon({ active }: { active: boolean }) {
  if (active) {
    return (
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        className="w-8 h-8 rounded-full border-2 border-[#007AFF] border-t-transparent"
      />
    )
  }

  return (
    <svg
      width="32" height="32" viewBox="0 0 32 32" fill="none"
      className="text-[rgb(var(--color-label-tertiary))]"
      aria-hidden
    >
      <path
        d="M16 22V10M16 10L11 15M16 10L21 15"
        stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round"
      />
      <path
        d="M8 26h16"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      />
    </svg>
  )
}

function StateLabel({ state }: { state: ReturnType<typeof useBlossomUpload>['state'] }) {
  switch (state.status) {
    case 'idle':
      return (
        <>
          <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
            Tap to upload
          </p>
          <p className="text-[13px] text-[rgb(var(--color-label-tertiary))]">
            or drag and drop a file
          </p>
        </>
      )

    case 'hashing':
      return (
        <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
          Computing checksum…
        </p>
      )

    case 'uploading':
      return (
        <>
          <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">
            Uploading ({state.serverIndex}/{state.serverCount})
          </p>
          <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] truncate max-w-[220px]">
            {state.server}
          </p>
        </>
      )

    case 'publishing':
      return (
        <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
          Publishing kind-1063 metadata…
        </p>
      )

    case 'done':
      return (
        <>
          <p className="text-[14px] font-medium text-[#34C759]">
            Uploaded successfully
          </p>
          {state.warning ? (
            <p className="text-[12px] leading-snug text-[#FF9F0A] max-w-[260px]">
              {state.warning}
            </p>
          ) : (
            <p className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
              {state.successfulServers.length} server{state.successfulServers.length !== 1 ? 's' : ''}
            </p>
          )}
        </>
      )

    case 'error':
      return (
        <p className="text-[13px] text-[#FF3B30] leading-snug max-w-[260px]">
          {state.error}
        </p>
      )
  }
}
