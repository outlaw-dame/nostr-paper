import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createLiteRtSession, getDefaultLiteRtOptions, type LiteRtSession } from '@/lib/llm/litert'
import { createRouterRuntimeSession } from '@/lib/llm/routerHarness'
import { getRouterRuntime, type LlmRuntime } from '@/lib/llm/runtimeSelector'
import {
  PROMPT_PRESETS,
  SEARCH_INTENT_EVAL_CASES,
} from '@/lib/llm/promptPlaybook'
import {
  getModelResponsibilityRows,
  type ModelResponsibilityRow,
} from '@/lib/llm/modelResponsibilities'
import { buildSearchGroundedAnswerPrompt } from '@/lib/search/groundedAnswer'
import {
  EXTREME_HARM_MODERATION_EVAL_CASES,
  buildExtremeHarmModerationPrompt,
} from '@/lib/moderation/prompts'
import { Kind, type NostrEvent, type Profile } from '@/types'

type RouterEvalResult = {
  runtime: LlmRuntime
  model: string
  passed: number
  total: number
  averageLatencyMs: number
  error?: string
  cases: Array<{
    query: string
    expected: string
    actual: string | null
    latencyMs: number
    passed: boolean
    error?: string
  }>
}

type ModerationEvalResult = {
  content: string
  expectedAction: string
  expectedReason: string | null
  actualAction: string | null
  actualReason: string | null
  passed: boolean
  latencyMs: number
  error?: string
}

function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return raw.slice(start, end + 1)
}

function parseModerationResponse(raw: string): { action: string | null; reason: string | null } {
  const jsonText = extractJsonObject(raw)
  if (!jsonText) return { action: null, reason: null }

  try {
    const parsed = JSON.parse(jsonText) as { action?: string; reason?: string | null }
    return {
      action: typeof parsed.action === 'string' ? parsed.action : null,
      reason: typeof parsed.reason === 'string' || parsed.reason === null ? (parsed.reason ?? null) : null,
    }
  } catch {
    return { action: null, reason: null }
  }
}

const PROTOTYPE_GROUNDED_PROFILES: Profile[] = [
  {
    pubkey: '4'.repeat(64),
    updatedAt: 1_720_000_120,
    name: 'Alice Relayrunner',
    about: 'Nostr wallet maintainer focused on Lightning UX and zaps.',
  },
]

const PROTOTYPE_GROUNDED_EVENTS: NostrEvent[] = [
  {
    id: '1'.repeat(64),
    pubkey: '2'.repeat(64),
    created_at: 1_720_000_200,
    kind: Kind.ShortNote,
    tags: [],
    content: 'A zap is a Lightning payment sent to a Nostr note or profile.',
    sig: '3'.repeat(128),
  },
  {
    id: '5'.repeat(64),
    pubkey: '6'.repeat(64),
    created_at: 1_720_000_300,
    kind: Kind.ShortNote,
    tags: [],
    content: 'Clients often show zap counts next to likes, replies, and reposts.',
    sig: '7'.repeat(128),
  },
]

function statusLabel(status: ModelResponsibilityRow['status']): string {
  switch (status) {
    case 'active':
      return 'active'
    case 'configured':
      return 'configured'
    case 'not-wired':
      return 'configured only'
    case 'missing':
      return 'missing'
    default:
      return status
  }
}

function statusClassName(status: ModelResponsibilityRow['status']): string {
  switch (status) {
    case 'active':
      return 'text-[#2F7D32]'
    case 'configured':
      return 'text-[rgb(var(--color-label-secondary))]'
    case 'not-wired':
      return 'text-[#C65D2E]'
    case 'missing':
      return 'text-[#C65D2E]'
    default:
      return 'text-[rgb(var(--color-label-secondary))]'
  }
}

export default function LiteRtPrototypePage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('Idle')
  const [selectedPresetId, setSelectedPresetId] = useState(PROMPT_PRESETS[0]!.id)
  const [input, setInput] = useState(PROMPT_PRESETS[0]!.buildInput())
  const [output, setOutput] = useState('')
  const [promptLoading, setPromptLoading] = useState(false)
  const [routerEvalLoading, setRouterEvalLoading] = useState(false)
  const [moderationEvalLoading, setModerationEvalLoading] = useState(false)
  const [session, setSession] = useState<LiteRtSession | null>(null)
  const [routerEvalResults, setRouterEvalResults] = useState<RouterEvalResult[]>([])
  const [moderationEvalResults, setModerationEvalResults] = useState<ModerationEvalResult[]>([])
  const [groundedQuery, setGroundedQuery] = useState('what is a zap in nostr')
  const [groundedPromptStatus, setGroundedPromptStatus] = useState('')

  const liteRtOptions = useMemo(() => getDefaultLiteRtOptions(), [])
  const routerLitertModelPath = useMemo(() => (
    import.meta.env.VITE_ROUTER_LITERT_MODEL_PATH
    ?? import.meta.env.VITE_LITERT_MODEL_PATH
    ?? liteRtOptions.modelPath
  ), [liteRtOptions.modelPath])
  const routerSharesGroundedModel = useMemo(() => (
    getRouterRuntime() === 'litert' && routerLitertModelPath === liteRtOptions.modelPath
  ), [liteRtOptions.modelPath, routerLitertModelPath])
  const modelResponsibilities = useMemo(() => getModelResponsibilityRows(), [])
  const selectedPreset = useMemo(
    () => PROMPT_PRESETS.find((preset) => preset.id === selectedPresetId) ?? PROMPT_PRESETS[0]!,
    [selectedPresetId],
  )

  const initialize = async () => {
    if (session) return

    setPromptLoading(true)
    setStatus('Initializing LiteRT...')
    try {
      const llm = await createLiteRtSession(liteRtOptions)
      setSession(llm)
      setStatus('Ready')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(`Init failed: ${message}`)
    } finally {
      setPromptLoading(false)
    }
  }

  const runPrompt = async () => {
    if (!session) {
      setStatus('Initialize LiteRT first')
      return
    }

    setPromptLoading(true)
    setOutput('')
    setStatus('Generating...')

    try {
      const response = await session.generateResponse(input, (partial, done) => {
        setOutput((prev) => prev + partial)
        if (done) {
          setStatus('Ready')
        }
      })

      if (!response) {
        setStatus('Ready')
        return
      }

      setOutput(response)
      setStatus('Ready')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(`Generation failed: ${message}`)
    } finally {
      setPromptLoading(false)
    }
  }

  const resetSession = async () => {
    if (session?.close) {
      await session.close()
    }
    setSession(null)
    setOutput('')
    setStatus('Idle')
  }

  const runRouterEval = async () => {
    setRouterEvalLoading(true)
    setRouterEvalResults([])

    const nextResults: RouterEvalResult[] = []
    for (const runtime of ['transformers', 'webllm', 'litert'] as const) {
      const routerSession = createRouterRuntimeSession(runtime)
      const caseResults: RouterEvalResult['cases'] = []
      const startedAt = performance.now()

      try {
        await routerSession.init()
        for (const evalCase of SEARCH_INTENT_EVAL_CASES) {
          const caseStartedAt = performance.now()
          try {
            const actual = await routerSession.classify(evalCase.query)
            const latencyMs = performance.now() - caseStartedAt
            caseResults.push({
              query: evalCase.query,
              expected: evalCase.expectedIntent,
              actual,
              latencyMs,
              passed: actual === evalCase.expectedIntent,
            })
          } catch (error) {
            const latencyMs = performance.now() - caseStartedAt
            caseResults.push({
              query: evalCase.query,
              expected: evalCase.expectedIntent,
              actual: null,
              latencyMs,
              passed: false,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        nextResults.push({
          runtime,
          model: `${routerSession.runtime}:${routerSession.modelId}`,
          passed: caseResults.filter((entry) => entry.passed).length,
          total: caseResults.length,
          averageLatencyMs: caseResults.length > 0
            ? caseResults.reduce((total, entry) => total + entry.latencyMs, 0) / caseResults.length
            : 0,
          cases: caseResults,
        })
      } catch (error) {
        nextResults.push({
          runtime,
          model: `${routerSession.runtime}:${routerSession.modelId}`,
          passed: 0,
          total: SEARCH_INTENT_EVAL_CASES.length,
          averageLatencyMs: performance.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          cases: caseResults,
        })
      } finally {
        await routerSession.close().catch(() => {})
        setRouterEvalResults([...nextResults])
      }
    }

    setRouterEvalLoading(false)
  }

  const runModerationEval = async () => {
    setModerationEvalLoading(true)
    setModerationEvalResults([])
    setStatus('Running moderation evals...')

    let evalSession: LiteRtSession | null = null
    try {
      evalSession = await createLiteRtSession({
        ...liteRtOptions,
        maxTokens: 256,
        topK: 1,
        temperature: 0,
      })

      const results: ModerationEvalResult[] = []
      for (const evalCase of EXTREME_HARM_MODERATION_EVAL_CASES) {
        const startedAt = performance.now()
        try {
          const raw = await evalSession.generateResponse(buildExtremeHarmModerationPrompt(evalCase.content))
          const parsed = parseModerationResponse(raw)
          results.push({
            content: evalCase.content,
            expectedAction: evalCase.expected.action,
            expectedReason: evalCase.expected.reason,
            actualAction: parsed.action,
            actualReason: parsed.reason,
            passed: parsed.action === evalCase.expected.action && parsed.reason === evalCase.expected.reason,
            latencyMs: performance.now() - startedAt,
          })
        } catch (error) {
          results.push({
            content: evalCase.content,
            expectedAction: evalCase.expected.action,
            expectedReason: evalCase.expected.reason,
            actualAction: null,
            actualReason: null,
            passed: false,
            latencyMs: performance.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        setModerationEvalResults([...results])
      }

      setStatus('Ready')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(`Moderation eval failed: ${message}`)
    } finally {
      await evalSession?.close?.()
      setModerationEvalLoading(false)
    }
  }

  const loadGroundedFlowPrompt = () => {
    const prompt = buildSearchGroundedAnswerPrompt(
      groundedQuery,
      PROTOTYPE_GROUNDED_EVENTS,
      PROTOTYPE_GROUNDED_PROFILES,
    )

    if (!prompt) {
      setGroundedPromptStatus('Unable to build grounded prompt from the current sample context.')
      return
    }

    setSelectedPresetId('grounded-answer')
    setInput(prompt)
    setOutput('')
    setGroundedPromptStatus('Loaded grounded-answer prompt built from retrieval context.')
  }

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe">
      <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 pt-safe backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="app-panel-muted h-10 w-10 rounded-full text-[rgb(var(--color-label))] flex items-center justify-center active:opacity-80"
            aria-label="Go back"
          >
            ←
          </button>
          <h1 className="text-[20px] font-semibold text-[rgb(var(--color-label))]">AI Runtime Lab</h1>
        </div>
      </div>

      <div className="space-y-4 pb-10 pt-2">
        <section className="app-panel rounded-ios-xl p-4 card-elevated">
          <h2 className="text-[16px] font-semibold text-[rgb(var(--color-label))]">Runtime Info</h2>
          <p className="mt-2 text-[13px] text-[rgb(var(--color-label-secondary))]">
            Experimental lab for direct prompting, router evals, and moderation evals across in-browser runtimes.
          </p>
          <div className="mt-3 space-y-1 text-[12px] font-mono text-[rgb(var(--color-label-secondary))] break-all">
            <div>Default router runtime: {getRouterRuntime()}</div>
            <div>Router LiteRT model path: {routerLitertModelPath}</div>
            <div>LiteRT model path: {liteRtOptions.modelPath}</div>
            <div>LiteRT wasm root: {liteRtOptions.wasmRoot}</div>
            <div>Status: {status}</div>
          </div>
          {routerSharesGroundedModel && (
            <p className="mt-3 text-[12px] text-[#C65D2E]">
              Warning: router and grounded-answer are using the same LiteRT model path. Set
              VITE_ROUTER_LITERT_MODEL_PATH to a dedicated router model to avoid cross-purpose drift.
            </p>
          )}
        </section>

        <section className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
          <h3 className="text-[14px] font-semibold text-[rgb(var(--color-label))]">Model Responsibility Panel</h3>
          <p className="text-[12px] text-[rgb(var(--color-label-secondary))]">
            Live matrix of model responsibilities and wiring state. This is the anti-mixup map for routing,
            answering, moderation, and enhancement roles.
          </p>
          <div className="space-y-2">
            {modelResponsibilities.map((row) => (
              <div key={row.component} className="rounded-ios-lg border border-[rgb(var(--color-separator))] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[13px] font-medium text-[rgb(var(--color-label))]">{row.component}</div>
                  <div className={`text-[11px] uppercase tracking-[0.03em] ${statusClassName(row.status)}`}>
                    {statusLabel(row.status)}
                  </div>
                </div>
                <div className="mt-1 text-[11px] font-mono text-[rgb(var(--color-label-secondary))] break-all">runtime={row.runtime}</div>
                <div className="mt-1 text-[11px] font-mono text-[rgb(var(--color-label-secondary))] break-all">model={row.model}</div>
                <div className="mt-2 text-[12px] text-[rgb(var(--color-label-secondary))]">job={row.job}</div>
                <div className="text-[12px] text-[rgb(var(--color-label-secondary))]">output={row.output}</div>
                <div className="text-[11px] font-mono text-[rgb(var(--color-label-secondary))]">source={row.source}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
          <h3 className="text-[14px] font-semibold text-[rgb(var(--color-label))]">Grounded-Answer Flow</h3>
          <p className="text-[12px] text-[rgb(var(--color-label-secondary))]">
            Builds the prompt through the same retrieval-to-grounding path used by search:
            buildSearchGroundedAnswerPrompt(query, events, profiles).
          </p>
          <input
            value={groundedQuery}
            onChange={(event) => setGroundedQuery(event.target.value)}
            className="w-full rounded-ios-lg bg-[rgb(var(--color-bg-elevated))] border border-[rgb(var(--color-separator))] px-3 py-2 text-[14px] text-[rgb(var(--color-label))]"
            placeholder="Ask a grounded question"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadGroundedFlowPrompt}
              className="rounded-full px-4 py-2 text-[13px] font-medium app-panel-muted text-[rgb(var(--color-label))]"
            >
              Load grounded prompt
            </button>
            <button
              type="button"
              onClick={() => { void runPrompt() }}
              disabled={promptLoading || !session}
              className="rounded-full px-4 py-2 text-[13px] font-medium bg-[rgb(var(--color-system-blue))] text-white disabled:opacity-50"
            >
              Run grounded answer
            </button>
          </div>
          {groundedPromptStatus && (
            <p className="text-[12px] text-[rgb(var(--color-label-secondary))]">{groundedPromptStatus}</p>
          )}
        </section>

        <section className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
          <div className="space-y-2">
            <label className="block text-[13px] font-medium text-[rgb(var(--color-label))]" htmlFor="litert-prompt-preset">
              Prompt preset
            </label>
            <select
              id="litert-prompt-preset"
              value={selectedPresetId}
              onChange={(event) => {
                const nextId = event.target.value as typeof selectedPresetId
                setSelectedPresetId(nextId)
                const preset = PROMPT_PRESETS.find((candidate) => candidate.id === nextId)
                if (preset) {
                  setInput(preset.buildInput())
                  setOutput('')
                }
              }}
              className="w-full rounded-ios-lg bg-[rgb(var(--color-bg-elevated))] border border-[rgb(var(--color-separator))] px-3 py-2 text-[14px] text-[rgb(var(--color-label))]"
            >
              {PROMPT_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.title}</option>
              ))}
            </select>
            <p className="text-[12px] text-[rgb(var(--color-label-secondary))]">
              {selectedPreset.description}
            </p>
          </div>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="w-full min-h-[140px] rounded-ios-lg bg-[rgb(var(--color-bg-elevated))] border border-[rgb(var(--color-separator))] p-3 text-[14px] text-[rgb(var(--color-label))]"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { void initialize() }}
              disabled={promptLoading || !!session}
              className="rounded-full px-4 py-2 text-[13px] font-medium bg-[rgb(var(--color-system-blue))] text-white disabled:opacity-50"
            >
              Initialize LiteRT
            </button>
            <button
              type="button"
              onClick={() => { void runPrompt() }}
              disabled={promptLoading || !session}
              className="rounded-full px-4 py-2 text-[13px] font-medium bg-[rgb(var(--color-label))] text-[rgb(var(--color-bg))] disabled:opacity-50"
            >
              Generate
            </button>
            <button
              type="button"
              onClick={() => { void resetSession() }}
              disabled={promptLoading}
              className="rounded-full px-4 py-2 text-[13px] font-medium app-panel-muted text-[rgb(var(--color-label))] disabled:opacity-50"
            >
              Reset
            </button>
          </div>
        </section>

        <section className="app-panel rounded-ios-xl p-4 card-elevated">
          <h3 className="text-[14px] font-semibold text-[rgb(var(--color-label))]">Prompt Output</h3>
          <pre className="mt-2 whitespace-pre-wrap text-[13px] text-[rgb(var(--color-label-secondary))] min-h-[120px]">
            {output || 'No output yet.'}
          </pre>
        </section>

        <section className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-semibold text-[rgb(var(--color-label))]">Router Eval Runner</h3>
              <p className="mt-1 text-[12px] text-[rgb(var(--color-label-secondary))]">
                Runs the shared search-intent eval set across Transformers.js, WebLLM, and LiteRT.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { void runRouterEval() }}
              disabled={routerEvalLoading}
              className="rounded-full px-4 py-2 text-[13px] font-medium bg-[rgb(var(--color-system-blue))] text-white disabled:opacity-50"
            >
              {routerEvalLoading ? 'Running…' : 'Run router evals'}
            </button>
          </div>

          <div className="space-y-3">
            {routerEvalResults.length === 0 ? (
              <p className="text-[12px] text-[rgb(var(--color-label-secondary))]">No router eval results yet.</p>
            ) : routerEvalResults.map((result) => (
              <div key={result.runtime} className="rounded-ios-lg border border-[rgb(var(--color-separator))] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[rgb(var(--color-label-secondary))]">
                  <div className="font-medium text-[rgb(var(--color-label))]">{result.runtime}</div>
                  <div>{result.passed}/{result.total} passed</div>
                  <div>{result.averageLatencyMs.toFixed(1)} ms avg</div>
                </div>
                <div className="mt-1 text-[11px] font-mono text-[rgb(var(--color-label-secondary))] break-all">{result.model}</div>
                {result.error && (
                  <p className="mt-2 text-[12px] text-[#C65D2E]">{result.error}</p>
                )}
                <div className="mt-3 space-y-2">
                  {result.cases.map((entry) => (
                    <div key={`${result.runtime}:${entry.query}`} className="text-[12px] text-[rgb(var(--color-label-secondary))]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="truncate max-w-[70%]">{entry.query}</span>
                        <span className={entry.passed ? 'text-[#2F7D32]' : 'text-[#C65D2E]'}>{entry.passed ? 'pass' : 'fail'}</span>
                      </div>
                      <div className="font-mono text-[11px]">expected={entry.expected} actual={entry.actual ?? 'error'} latency={entry.latencyMs.toFixed(1)}ms</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-semibold text-[rgb(var(--color-label))]">Moderation Eval Runner</h3>
              <p className="mt-1 text-[12px] text-[rgb(var(--color-label-secondary))]">
                Runs the extreme-harm moderation eval cases through LiteRT using the structured moderation prompt.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { void runModerationEval() }}
              disabled={moderationEvalLoading}
              className="rounded-full px-4 py-2 text-[13px] font-medium bg-[rgb(var(--color-system-blue))] text-white disabled:opacity-50"
            >
              {moderationEvalLoading ? 'Running…' : 'Run moderation evals'}
            </button>
          </div>

          <div className="space-y-2">
            {moderationEvalResults.length === 0 ? (
              <p className="text-[12px] text-[rgb(var(--color-label-secondary))]">No moderation eval results yet.</p>
            ) : moderationEvalResults.map((result) => (
              <div key={result.content} className="rounded-ios-lg border border-[rgb(var(--color-separator))] p-3 text-[12px] text-[rgb(var(--color-label-secondary))]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="truncate max-w-[70%]">{result.content}</span>
                  <span className={result.passed ? 'text-[#2F7D32]' : 'text-[#C65D2E]'}>{result.passed ? 'pass' : 'fail'}</span>
                </div>
                <div className="mt-1 font-mono text-[11px]">
                  expected={result.expectedAction}:{result.expectedReason ?? 'null'} actual={result.actualAction ?? 'null'}:{result.actualReason ?? 'null'} latency={result.latencyMs.toFixed(1)}ms
                </div>
                {result.error && <div className="mt-1 text-[#C65D2E]">{result.error}</div>}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
