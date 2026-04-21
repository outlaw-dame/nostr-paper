/**
 * MlDiagnosticsPanel
 *
 * Displays the active ML configuration at runtime — model IDs, dtype,
 * hybrid search weights, and moderation thresholds. Reads values directly
 * from import.meta.env so there's no desync with the live constants.
 *
 * Useful for tuning VITE_HYBRID_* and VITE_SEMANTIC_* env variables and
 * confirming which values are active without opening devtools.
 */

interface DiagRow {
  label: string
  value: string
  dim?: boolean
}

function envStr(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback
  return String(value)
}

function envNum(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function envThreshold(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(1, Math.max(0, parsed))
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`
}

function buildRows(): DiagRow[] {
  const env = import.meta.env

  // ── Semantic model ──────────────────────────────────────
  const modelId = envStr(env.VITE_SEMANTIC_MODEL_ID, 'Xenova/all-MiniLM-L6-v2')
  const modelDtype = envStr(env.VITE_SEMANTIC_MODEL_DTYPE, 'q8')
  const maxBatch = envNum(env.VITE_SEMANTIC_MAX_BATCH_SIZE, 16, 1, 64)
  const maxChars = envNum(env.VITE_SEMANTIC_MAX_TEXT_CHARS, 2000, 256, 12000)
  const minQuery = envNum(env.VITE_SEMANTIC_MIN_QUERY_CHARS, 3, 1, 24)

  // ── Hybrid search weights ───────────────────────────────
  const lexW = envNum(env.VITE_HYBRID_LEXICAL_WEIGHT, 0.6, 0, 1)
  const semW = envNum(env.VITE_HYBRID_SEMANTIC_WEIGHT, 0.4, 0, 1)
  const sum = lexW + semW
  const normLex = sum > 0 ? lexW / sum : 0.6
  const normSem = sum > 0 ? semW / sum : 0.4
  const gamma = envNum(env.VITE_HYBRID_SEMANTIC_GAMMA, 1.15, 0.5, 3)
  const minSemOnly = envNum(env.VITE_HYBRID_MIN_SEMANTIC_ONLY_SCORE, 0.45, 0, 1)
  const minLexShare = envNum(env.VITE_HYBRID_MIN_LEXICAL_SHARE, 0.5, 0, 1)

  // ── Search router ───────────────────────────────────────
  const routerEnabled = env.VITE_ENABLE_SEARCH_ROUTER === 'true'
  const routerRuntime = envStr(env.VITE_ROUTER_RUNTIME, 'transformers')
  const routerModelId = envStr(env.VITE_ROUTER_MODEL_ID, 'onnx-community/gemma-3-270m-it-ONNX')
  const routerDtype = envStr(env.VITE_ROUTER_MODEL_DTYPE, 'q4')
  const routerTimeout = envNum(env.VITE_ROUTER_TIMEOUT_MS, 5000, 500, 30000)

  // ── Moderation ──────────────────────────────────────────
  const nsfwModel = envStr(env.VITE_MEDIA_MODERATION_NSFW_MODEL_ID, 'onnx-community/nsfw_image_detection-ONNX')
  const violenceModel = envStr(env.VITE_MEDIA_MODERATION_VIOLENCE_MODEL_ID, 'onnx-community/vit-base-violence-detection-ONNX')
  const modDtype = envStr(env.VITE_MEDIA_MODERATION_MODEL_DTYPE, 'q8')
  const modConcurrency = envNum(env.VITE_MEDIA_MODERATION_CONCURRENCY, 2, 1, 6)
  const nsfwThreshold = envThreshold(env.VITE_MEDIA_MODERATION_NSFW_BLOCK_THRESHOLD, 0.96)
  const violenceThreshold = envThreshold(env.VITE_MEDIA_MODERATION_VIOLENCE_BLOCK_THRESHOLD, 0.97)

  return [
    // Semantic
    { label: 'Semantic model', value: modelId },
    { label: 'Model dtype', value: modelDtype },
    { label: 'Max batch', value: String(maxBatch) },
    { label: 'Max text chars', value: String(maxChars) },
    { label: 'Min query chars', value: String(minQuery) },
    // Hybrid
    { label: 'Lexical weight', value: `${pct(normLex)} (raw ${lexW.toFixed(2)})` },
    { label: 'Semantic weight', value: `${pct(normSem)} (raw ${semW.toFixed(2)})` },
    { label: 'Score gamma', value: gamma.toFixed(2) },
    { label: 'Min semantic-only', value: minSemOnly.toFixed(2) },
    { label: 'Min lexical share', value: pct(minLexShare) },
    // Moderation
    { label: 'NSFW model', value: nsfwModel },
    { label: 'Violence model', value: violenceModel },
    { label: 'Moderation dtype', value: modDtype },
    { label: 'Mod concurrency', value: String(modConcurrency) },
    { label: 'NSFW block threshold', value: nsfwThreshold.toFixed(2) },
    { label: 'Violence block threshold', value: violenceThreshold.toFixed(2) },
    // Search router
    { label: 'Router enabled', value: routerEnabled ? 'yes' : 'no', dim: !routerEnabled },
    { label: 'Router runtime', value: routerRuntime, dim: !routerEnabled },
    { label: 'Router model', value: routerModelId, dim: !routerEnabled },
    { label: 'Router dtype', value: routerDtype, dim: !routerEnabled },
    { label: 'Router timeout', value: `${routerTimeout} ms`, dim: !routerEnabled },
  ]
}

export function MlDiagnosticsPanel() {
  const rows = buildRows()

  // Group into four sections for readability
  const semanticRows = rows.slice(0, 5)
  const hybridRows = rows.slice(5, 10)
  const moderationRows = rows.slice(10, 16)
  const routerRows = rows.slice(16)

  const sectionStyle = 'mb-4 last:mb-0'
  const sectionHeaderStyle = 'text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--color-label-tertiary))] mb-2 px-1'
  const rowStyle = 'flex items-center justify-between py-1.5 px-1 border-b border-[rgb(var(--color-separator))] last:border-0'
  const labelStyle = 'text-[13px] text-[rgb(var(--color-label-secondary))]'
  const valueStyle = 'text-[13px] font-mono text-[rgb(var(--color-label))] ml-4 text-right break-all max-w-[60%]'
  const valueDimStyle = 'text-[13px] font-mono text-[rgb(var(--color-label-tertiary))] ml-4 text-right break-all max-w-[60%]'

  function Section({ title, items }: { title: string; items: DiagRow[] }) {
    return (
      <div className={sectionStyle}>
        <p className={sectionHeaderStyle}>{title}</p>
        {items.map(row => (
          <div key={row.label} className={rowStyle}>
            <span className={labelStyle}>{row.label}</span>
            <span className={row.dim ? valueDimStyle : valueStyle}>{row.value}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="app-panel rounded-ios-xl p-4 card-elevated">
      <Section title="Semantic Search" items={semanticRows} />
      <Section title="Hybrid Ranking" items={hybridRows} />
      <Section title="Media Moderation" items={moderationRows} />
      <Section title="Search Router" items={routerRows} />
      <p className="mt-3 text-[11px] text-[rgb(var(--color-label-tertiary))] px-1">
        Values reflect build-time env variables. Defaults shown when unset.
      </p>
    </div>
  )
}
