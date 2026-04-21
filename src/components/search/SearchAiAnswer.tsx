import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { createLiteRtSession, type LiteRtSession } from '@/lib/llm/litert'
import { enhanceSearchQuery, isGeminiEnhancerActive } from '@/lib/llm/geminiEnhancer'
import { buildSearchGroundedAnswerPrompt } from '@/lib/search/groundedAnswer'
import type { NostrEvent, Profile } from '@/types'

interface SearchAiAnswerProps {
  query: string
  events: NostrEvent[]
  profiles: Profile[]
}

export function SearchAiAnswer({ query, events, profiles }: SearchAiAnswerProps) {
  const [status, setStatus] = useState('Idle')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [session, setSession] = useState<LiteRtSession | null>(null)
  // Gemini-enhanced query (falls back to raw query when enhancer is off or times out)
  const [enhancedQuery, setEnhancedQuery] = useState(query)
  const enhanceAbortRef = useRef<boolean>(false)

  useEffect(() => {
    setEnhancedQuery(query)
    if (!isGeminiEnhancerActive()) return
    enhanceAbortRef.current = false
    void enhanceSearchQuery(query).then((result) => {
      if (!enhanceAbortRef.current) setEnhancedQuery(result)
    })
    return () => { enhanceAbortRef.current = true }
  }, [query])

  const prompt = useMemo(
    () => buildSearchGroundedAnswerPrompt(enhancedQuery, events, profiles),
    [events, profiles, enhancedQuery],
  )
  const sourceCount = useMemo(
    () => Math.min(profiles.length, 2) + Math.min(events.length, Math.max(0, 6 - Math.min(profiles.length, 2))),
    [events.length, profiles.length],
  )

  useEffect(() => {
    setAnswer('')
    setStatus('Idle')
  }, [prompt, query])

  useEffect(() => () => {
    void session?.close?.()
  }, [session])

  const runSummary = async () => {
    if (!prompt) {
      setStatus('No grounded context available')
      return
    }

    setLoading(true)
    setStatus('Generating grounded answer…')

    let activeSession = session
    try {
      if (!activeSession) {
        activeSession = await createLiteRtSession({
          maxTokens: 320,
          topK: 8,
          temperature: 0.2,
        })
        setSession(activeSession)
      }

      const response = await activeSession.generateResponse(prompt)
      setAnswer(response.trim())
      setStatus('Ready')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(`Grounded answer failed: ${message}`)
    } finally {
      setLoading(false)
    }
  }

  const resetSummary = async () => {
    if (session?.close) {
      await session.close()
    }
    setSession(null)
    setAnswer('')
    setStatus('Idle')
  }

  if (!prompt) return null

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="app-panel rounded-ios-xl p-4 card-elevated"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-[rgb(var(--color-label))]">AI Search Summary</h2>
          <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
            Experimental grounded answer built from the current search results.
          </p>
        </div>
        <div className="text-right text-[12px] font-mono text-[rgb(var(--color-label-secondary))]">
          <div>{sourceCount} sources</div>
          <div>{status}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => { void runSummary() }}
          disabled={loading}
          className="rounded-full px-4 py-2 text-[13px] font-medium bg-[rgb(var(--color-system-blue))] text-white disabled:opacity-50"
        >
          Generate summary
        </button>
        <button
          type="button"
          onClick={() => { void resetSummary() }}
          disabled={loading && !answer}
          className="rounded-full px-4 py-2 text-[13px] font-medium app-panel-muted text-[rgb(var(--color-label))] disabled:opacity-50"
        >
          Reset
        </button>
      </div>

      <pre className="mt-3 whitespace-pre-wrap text-[13px] text-[rgb(var(--color-label-secondary))] min-h-[96px]">
        {answer || 'No summary generated yet.'}
      </pre>
    </motion.section>
  )
}
