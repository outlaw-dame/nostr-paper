import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  clearBootDiagnosticsForDebug,
  readBootSessionForDebug,
  readLastBootFailureForDebug,
  readLastBootSuccessForDebug,
} from '@/lib/runtime/startupDiagnostics'

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
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [exportStatus, setExportStatus] = useState<'idle' | 'shared' | 'downloaded' | 'failed'>('idle')

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
            aria-label="Go back"
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
            Debug
          </h1>
        </div>
      </div>

      <div className="space-y-8 pb-10 pt-2">
        <section>
          <h2 className="section-kicker px-1 mb-3">Diagnostics</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-4">
            <div className="rounded-[14px] bg-[rgb(var(--color-bg-secondary))] p-3">
              <p className="text-[12px] uppercase tracking-[0.08em] text-[rgb(var(--color-label-tertiary))]">Current session</p>
              <p className="mt-1 text-[14px] text-[rgb(var(--color-label-secondary))]">
                {diagnostics.session
                  ? `Stage: ${diagnostics.session.stage} · Started ${formatTime(diagnostics.session.startedAt)}`
                  : 'No active boot session found.'}
              </p>
            </div>

            <div className="rounded-[14px] bg-[rgb(var(--color-bg-secondary))] p-3">
              <p className="text-[12px] uppercase tracking-[0.08em] text-[rgb(var(--color-label-tertiary))]">Last failure</p>
              {diagnostics.lastFailure ? (
                <div className="mt-1 space-y-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                  <p>Stage: {diagnostics.lastFailure.stage}</p>
                  <p>When: {formatTime(diagnostics.lastFailure.timestamp)}</p>
                  <p className="break-words">Reason: {diagnostics.lastFailure.reason}</p>
                </div>
              ) : (
                <p className="mt-1 text-[14px] text-[rgb(var(--color-label-secondary))]">No boot failure recorded.</p>
              )}
            </div>

            <div className="rounded-[14px] bg-[rgb(var(--color-bg-secondary))] p-3">
              <p className="text-[12px] uppercase tracking-[0.08em] text-[rgb(var(--color-label-tertiary))]">Last success</p>
              {diagnostics.lastSuccess ? (
                <div className="mt-1 space-y-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                  <p>Stage: {diagnostics.lastSuccess.stage}</p>
                  <p>When: {formatTime(diagnostics.lastSuccess.timestamp)}</p>
                  <p>Duration: {diagnostics.lastSuccess.durationMs} ms</p>
                </div>
              ) : (
                <p className="mt-1 text-[14px] text-[rgb(var(--color-label-secondary))]">No boot success recorded yet.</p>
              )}
            </div>

            <label className="block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]">
              Raw payload
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
                Refresh
              </button>

              <button
                type="button"
                onClick={async () => {
                  const ok = await copyText(diagnosticsJson)
                  setCopyStatus(ok ? 'copied' : 'failed')
                  setTimeout(() => setCopyStatus('idle'), 1800)
                }}
                className="rounded-[12px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] font-medium text-[rgb(var(--color-label))]"
              >
                Copy JSON
              </button>

              <button
                type="button"
                onClick={async () => {
                  const result = await shareOrDownloadDiagnostics(diagnosticsJson)
                  setExportStatus(result)
                  setTimeout(() => setExportStatus('idle'), 2200)
                }}
                className="rounded-[12px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] font-medium text-[rgb(var(--color-label))]"
              >
                Export
              </button>

              <button
                type="button"
                onClick={() => {
                  clearBootDiagnosticsForDebug()
                  setRefreshTick((value) => value + 1)
                }}
                className="rounded-[12px] border border-[rgb(var(--color-system-red)/0.24)] bg-[rgb(var(--color-system-red)/0.08)] px-3 py-2 text-[13px] font-medium text-[rgb(var(--color-system-red))]"
              >
                Clear Diagnostics
              </button>
            </div>

            {copyStatus === 'copied' && (
              <p className="text-[12px] text-[rgb(var(--color-system-green))]">Copied diagnostics JSON.</p>
            )}
            {copyStatus === 'failed' && (
              <p className="text-[12px] text-[rgb(var(--color-system-red))]">Failed to copy diagnostics JSON.</p>
            )}
            {exportStatus === 'shared' && (
              <p className="text-[12px] text-[rgb(var(--color-system-green))]">Shared diagnostics via system sheet.</p>
            )}
            {exportStatus === 'downloaded' && (
              <p className="text-[12px] text-[rgb(var(--color-system-green))]">Downloaded diagnostics JSON file.</p>
            )}
            {exportStatus === 'failed' && (
              <p className="text-[12px] text-[rgb(var(--color-system-red))]">Failed to export diagnostics.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
