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
        const policy = decideRouterRuntime(query)
        if (policy.runtime !== activeSession.runtime) {
          await activeSession.close()
          activeSession = createRouterRuntimeSession(policy.runtime)
          await activeSession.init()
        }
        const intent = await activeSession.classify(query)
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
    respondError(error)
  }
})
