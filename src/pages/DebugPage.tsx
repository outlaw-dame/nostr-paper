import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { tApp } from '@/lib/i18n/app'
import {
  clearBootDiagnosticsForDebug,
  readBootSessionForDebug,
  readLastBootFailureForDebug,
  readLastBootSuccessForDebug,
} from '@/lib/runtime/startupDiagnostics'
import { isThreadInspectorEnabled, setThreadInspectorEnabled } from '@/lib/runtime/debugSettings'

function formatTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString()
  } catch {
    return String(timestamp)
  }
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

async function shareOrDownloadDiagnostics(payload: string): Promise<'shared' | 'downloaded' | 'failed'> {
  const fileName = `nostr-paper-diagnostics-${Date.now()}.json`

  try {
    if (typeof navigator.share === 'function') {
      const file = new File([payload], fileName, { type: 'application/json' })
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Nostr Paper Diagnostics',
          files: [file],
        })
        return 'shared'
      }

      await navigator.share({
        title: 'Nostr Paper Diagnostics',
        text: payload,
      })
      return 'shared'
    }
  } catch {
    // Fall through to downloadable file path.
  }

  try {
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return 'downloaded'
  } catch {
    return 'failed'
  }
}

export default function DebugPage() {
  const navigate = useNavigate()
  const [refreshTick, setRefreshTick] = useState(0)
  const [threadInspectorEnabled, setThreadInspectorState] = useState(() => isThreadInspectorEnabled())
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [exportStatus, setExportStatus] = useState<'idle' | 'shared' | 'downloaded' | 'failed'>('idle')
  const copyTimerRef = useRef<number | null>(null)
  const exportTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
      if (exportTimerRef.current !== null) {
        window.clearTimeout(exportTimerRef.current)
      }
    }
  }, [])

  const diagnostics = useMemo(() => {
    const session = readBootSessionForDebug()
    const lastFailure = readLastBootFailureForDebug()
    const lastSuccess = readLastBootSuccessForDebug()

    return { session, lastFailure, lastSuccess }
  }, [refreshTick])

  const diagnosticsJson = useMemo(() => {
    return JSON.stringify(
      {
        session: diagnostics.session,
        lastFailure: diagnostics.lastFailure,
        lastSuccess: diagnostics.lastSuccess,
      },
      null,
      2,
    )
  }, [diagnostics])

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe">
      <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 pt-safe backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="
              app-panel-muted
              h-10 w-10 rounded-full
              text-[rgb(var(--color-label))]
              flex items-center justify-center
              active:opacity-80
            "
            aria-label={tApp('debugGoBack')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M9.5 3.25L4.75 8l4.75 4.75"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <h1 className="text-[20px] font-semibold text-[rgb(var(--color-label))]">
            {tApp('debugTitle')}
          </h1>
        </div>
      </div>

      <div className="space-y-8 pb-10 pt-2">
        <section>
          <h2 className="section-kicker px-1 mb-3">{tApp('debugDeveloperOptionsSection')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  {tApp('debugThreadInspectorLabel')}
                </p>
                <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                  {tApp('debugThreadInspectorHint')}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={threadInspectorEnabled}
                onClick={() => {
                  const next = !threadInspectorEnabled
                  setThreadInspectorState(next)
                  setThreadInspectorEnabled(next)
                }}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${threadInspectorEnabled
                  ? 'border-[rgb(var(--color-system-green)/0.5)] bg-[rgb(var(--color-system-green)/0.28)]'
                  : 'border-[rgb(var(--color-fill)/0.24)] bg-[rgb(var(--color-fill)/0.14)]'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${threadInspectorEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">{tApp('debugDiagnosticsSection')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-4">
            <div className="rounded-[14px] bg-[rgb(var(--color-bg-secondary))] p-3">
              <p className="text-[12px] uppercase tracking-[0.08em] text-[rgb(var(--color-label-tertiary))]">{tApp('debugCurrentSessionLabel')}</p>
              <p className="mt-1 text-[14px] text-[rgb(var(--color-label-secondary))]">
                {diagnostics.session
                  ? tApp('debugSessionSummary', { stage: diagnostics.session.stage, time: formatTime(diagnostics.session.startedAt) })
                  : tApp('debugNoActiveSession')}
              </p>
            </div>

            <div className="rounded-[14px] bg-[rgb(var(--color-bg-secondary))] p-3">
              <p className="text-[12px] uppercase tracking-[0.08em] text-[rgb(var(--color-label-tertiary))]">{tApp('debugLastFailureLabel')}</p>
              {diagnostics.lastFailure ? (
                <div className="mt-1 space-y-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                  <p>{tApp('debugFailureStage', { stage: diagnostics.lastFailure.stage })}</p>
                  <p>{tApp('debugFailureWhen', { when: formatTime(diagnostics.lastFailure.timestamp) })}</p>
                  <p className="break-words">{tApp('debugFailureReason', { reason: diagnostics.lastFailure.reason })}</p>
                </div>
              ) : (
                <p className="mt-1 text-[14px] text-[rgb(var(--color-label-secondary))]">{tApp('debugNoBootFailure')}</p>
              )}
            </div>

            <div className="rounded-[14px] bg-[rgb(var(--color-bg-secondary))] p-3">
              <p className="text-[12px] uppercase tracking-[0.08em] text-[rgb(var(--color-label-tertiary))]">{tApp('debugLastSuccessLabel')}</p>
              {diagnostics.lastSuccess ? (
                <div className="mt-1 space-y-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                  <p>{tApp('debugSuccessStage', { stage: diagnostics.lastSuccess.stage })}</p>
                  <p>{tApp('debugSuccessWhen', { when: formatTime(diagnostics.lastSuccess.timestamp) })}</p>
                  <p>{tApp('debugSuccessDuration', { ms: diagnostics.lastSuccess.durationMs })}</p>
                </div>
              ) : (
                <p className="mt-1 text-[14px] text-[rgb(var(--color-label-secondary))]">{tApp('debugNoBootSuccess')}</p>
              )}
            </div>

            <label className="block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]">
              {tApp('debugRawPayloadLabel')}
            </label>
            <textarea
              value={diagnosticsJson}
              readOnly
              rows={12}
              className="w-full resize-y rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2.5 font-mono text-[12px] leading-5 text-[rgb(var(--color-label))]"
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setRefreshTick((value) => value + 1)}
                className="rounded-[12px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] font-medium text-[rgb(var(--color-label))]"
              >
                {tApp('debugRefresh')}
              </button>

              <button
                type="button"
                onClick={async () => {
                  const ok = await copyText(diagnosticsJson)
                  setCopyStatus(ok ? 'copied' : 'failed')
                  if (copyTimerRef.current !== null) {
                    window.clearTimeout(copyTimerRef.current)
                  }
                  copyTimerRef.current = window.setTimeout(() => setCopyStatus('idle'), 1800)
                }}
                className="rounded-[12px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] font-medium text-[rgb(var(--color-label))]"
              >
                {tApp('debugCopyJson')}
              </button>

              <button
                type="button"
                onClick={async () => {
                  const result = await shareOrDownloadDiagnostics(diagnosticsJson)
                  setExportStatus(result)
                  if (exportTimerRef.current !== null) {
                    window.clearTimeout(exportTimerRef.current)
                  }
                  exportTimerRef.current = window.setTimeout(() => setExportStatus('idle'), 2200)
                }}
                className="rounded-[12px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] font-medium text-[rgb(var(--color-label))]"
              >
                {tApp('debugExport')}
              </button>

              <button
                type="button"
                onClick={() => {
                  clearBootDiagnosticsForDebug()
                  setRefreshTick((value) => value + 1)
                }}
                className="rounded-[12px] border border-[rgb(var(--color-system-red)/0.24)] bg-[rgb(var(--color-system-red)/0.08)] px-3 py-2 text-[13px] font-medium text-[rgb(var(--color-system-red))]"
              >
                {tApp('debugClearDiagnostics')}
              </button>
            </div>

            {copyStatus === 'copied' && (
              <p className="text-[12px] text-[rgb(var(--color-system-green))]">{tApp('debugCopied')}</p>
            )}
            {copyStatus === 'failed' && (
              <p className="text-[12px] text-[rgb(var(--color-system-red))]">{tApp('debugCopyFailed')}</p>
            )}
            {exportStatus === 'shared' && (
              <p className="text-[12px] text-[rgb(var(--color-system-green))]">{tApp('debugShared')}</p>
            )}
            {exportStatus === 'downloaded' && (
              <p className="text-[12px] text-[rgb(var(--color-system-green))]">{tApp('debugDownloaded')}</p>
            )}
            {exportStatus === 'failed' && (
              <p className="text-[12px] text-[rgb(var(--color-system-red))]">{tApp('debugExportFailed')}</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
