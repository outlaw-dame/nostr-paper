/**
 * usePublishEvent — Publish state machine for Nostr events
 *
 * Wraps any publish action with a clean lifecycle:
 *   idle → publishing → done | error
 *
 * Safety guarantees:
 * - One AbortController per publish call; previous in-flight call is cancelled
 *   when a new publish begins.
 * - Cleanup on unmount cancels any in-flight publish and prevents stale
 *   setState calls via the abort guard.
 * - Error messages are classified into user-facing strings.
 */

import { useState, useCallback, useRef, useEffect } from 'react'

export type PublishStatus = 'idle' | 'publishing' | 'done' | 'error'

interface PublishState {
  status: PublishStatus
  publishedId: string | null
  error: string | null
}

const IDLE: PublishState = { status: 'idle', publishedId: null, error: null }

export interface UsePublishEventReturn extends PublishState {
  /** True while a publish is in-flight. */
  isPublishing: boolean
  /**
   * Execute a publish action.
   * The action receives an AbortSignal; propagate it to the underlying
   * publish function so cancellation is honoured end-to-end.
   *
   * Returns the published event id on success, or null if the action
   * failed or was cancelled.
   */
  publish: (action: (signal: AbortSignal) => Promise<{ id: string }>) => Promise<string | null>
  /** Reset to idle state and cancel any in-flight publish. */
  reset: () => void
}

export function usePublishEvent(): UsePublishEventReturn {
  const [state, setState] = useState<PublishState>(IDLE)
  const abortRef = useRef<AbortController | null>(null)

  // Cancel in-flight publish on unmount to prevent stale state updates.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const publish = useCallback(async (
    action: (signal: AbortSignal) => Promise<{ id: string }>,
  ): Promise<string | null> => {
    // Cancel any previous in-flight operation before starting a new one.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState({ status: 'publishing', publishedId: null, error: null })

    try {
      const result = await action(controller.signal)
      // Guard against state update after abort (unmount or superseded publish).
      if (controller.signal.aborted) return null
      setState({ status: 'done', publishedId: result.id, error: null })
      return result.id
    } catch (err) {
      if (controller.signal.aborted) return null
      setState({ status: 'error', publishedId: null, error: classifyError(err) })
      return null
    }
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState(IDLE)
  }, [])

  return {
    ...state,
    isPublishing: state.status === 'publishing',
    publish,
    reset,
  }
}

// ── Internal ──────────────────────────────────────────────────

function classifyError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'Publish cancelled.'
  }
  if (err instanceof Error) return err.message
  return 'Failed to publish. Please try again.'
}
