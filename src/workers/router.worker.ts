/**
 * Search intent router worker.
 *
 * Runs a small instruction-tuned language model in a dedicated Web Worker to
 * classify incoming search queries as 'lexical', 'semantic', or 'hybrid'.
 * The classification gates semantic embedding work in hybrid.ts so trivially
 * exact-match queries (hashtags, @mentions, npub keys) skip the ~200 ms
 * embedding pipeline entirely.
 */

import { createRouterRuntimeSession } from '@/lib/llm/routerHarness'
import { getRouterRuntime } from '@/lib/llm/runtimeSelector'
import { decideRouterRuntime } from '@/lib/ai/taskPolicy'
import { recordTaskPolicyOutcome } from '@/lib/ai/taskPolicyTelemetry'
import type { RouterWorkerRequest, RouterWorkerResponse, SearchIntent } from '@/types'

const ROUTER_RUNTIME = getRouterRuntime()
let activeSession = createRouterRuntimeSession(ROUTER_RUNTIME)

self.addEventListener('message', async (event: MessageEvent<RouterWorkerRequest>) => {
  const respond = (result: { intent?: SearchIntent; model?: string }) => {
    self.postMessage({ id: event.data.id, result } satisfies RouterWorkerResponse)
  }
  const respondError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ id: event.data.id, error: message } satisfies RouterWorkerResponse)
  }

  try {
    switch (event.data.type) {
      case 'init': {
        await activeSession.init()
        respond({ model: `${activeSession.runtime}:${activeSession.modelId}` })
        break
      }

      case 'classify': {
        const { query } = event.data.payload
        const startedAt = performance.now()
        const policy = decideRouterRuntime(query)
        if (policy.runtime !== activeSession.runtime) {
          await activeSession.close()
          activeSession = createRouterRuntimeSession(policy.runtime)
          await activeSession.init()
        }
        const intent = await activeSession.classify(query)
        recordTaskPolicyOutcome({
          task: 'search_intent',
          runtime: activeSession.runtime,
          success: true,
          latencyMs: Math.round(performance.now() - startedAt),
          context: {
            intent,
            queryLength: query.trim().length,
            switchedRuntime: policy.runtime !== ROUTER_RUNTIME,
          },
        })
        respond({ intent, model: `${activeSession.runtime}:${activeSession.modelId}` })
        break
      }

      case 'close': {
        const closingSession = activeSession
        await closingSession.close()
        activeSession = createRouterRuntimeSession(ROUTER_RUNTIME)
        respond({ model: `${closingSession.runtime}:${closingSession.modelId}` })
        break
      }

      default: {
        respondError(`Unknown router worker request: ${(event.data as { type: string }).type}`)
      }
    }
  } catch (error) {
    if (event.data.type === 'classify') {
      recordTaskPolicyOutcome({
        task: 'search_intent',
        runtime: activeSession.runtime,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    respondError(error)
  }
})
