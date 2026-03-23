import { useState } from 'react'
import type {
  SyndicationDocument,
  SyndicationDocumentFormat,
} from '@/lib/syndication/types'

interface SyndicationExportBarProps {
  onGenerate: () => Promise<SyndicationDocument[]>
  className?: string
}

const EXPORT_FORMATS: Array<{
  format: SyndicationDocumentFormat
  label: string
}> = [
  { format: 'rss', label: 'RSS' },
  { format: 'atom', label: 'Atom' },
  { format: 'json', label: 'JSON Feed' },
]

function downloadDocument(feedDocument: SyndicationDocument): void {
  const blob = new Blob([feedDocument.content], { type: feedDocument.mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = feedDocument.fileName
  anchor.rel = 'noopener'
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export function SyndicationExportBar({
  onGenerate,
  className = '',
}: SyndicationExportBarProps) {
  const [documents, setDocuments] = useState<SyndicationDocument[] | null>(null)
  const [loadingFormat, setLoadingFormat] = useState<SyndicationDocumentFormat | null>(null)
  const [error, setError] = useState<string | null>(null)

  const exportDocument = async (format: SyndicationDocumentFormat) => {
    setLoadingFormat(format)
    setError(null)

    try {
      const generated = documents ?? await onGenerate()
      if (!documents) setDocuments(generated)

      const match = generated.find((candidate) => candidate.format === format)
      if (!match) {
        setError(`Could not generate ${format.toUpperCase()} export.`)
        return
      }

      downloadDocument(match)
    } catch {
      setError('Feed export failed.')
    } finally {
      setLoadingFormat(null)
    }
  }

  return (
    <section
      className={`
        rounded-ios-2xl border border-[rgb(var(--color-fill)/0.10)]
        bg-[rgb(var(--color-bg-secondary))] px-4 py-4
        ${className}
      `}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-tertiary))]">
            Syndication
          </p>
          <h2 className="mt-1 text-[17px] font-semibold text-[rgb(var(--color-label))]">
            Export this post
          </h2>
          <p className="mt-1 text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
            Generate portable RSS, Atom, and JSON Feed documents from this Nostr page.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {EXPORT_FORMATS.map(({ format, label }) => {
          const loading = loadingFormat === format
          return (
            <button
              key={format}
              type="button"
              disabled={loadingFormat !== null}
              onClick={() => void exportDocument(format)}
              className={[
                'rounded-full px-3.5 py-2 text-[13px] font-medium transition-colors',
                loading
                  ? 'bg-[rgb(var(--color-fill)/0.16)] text-[rgb(var(--color-label-secondary))]'
                  : 'bg-[rgb(var(--color-fill)/0.08)] text-[rgb(var(--color-label))] active:opacity-80',
                loadingFormat !== null ? 'disabled:cursor-not-allowed disabled:opacity-70' : '',
              ].join(' ')}
            >
              {loading ? `Generating ${label}…` : `Download ${label}`}
            </button>
          )
        })}
      </div>

      {error && (
        <p className="mt-3 text-[13px] text-[rgb(var(--color-system-red))]">
          {error}
        </p>
      )}
    </section>
  )
}
