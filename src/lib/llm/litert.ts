/* eslint-disable no-unused-vars */
export interface LiteRtSession {
  generateResponse(prompt: string, callback?: (partialResult: string, done: boolean) => void): Promise<string>
  close?: () => Promise<void> | void
}
/* eslint-enable no-unused-vars */

export interface LiteRtSessionOptions {
  modelPath?: string
  wasmRoot?: string
  maxTokens?: number
  topK?: number
  temperature?: number
}

export const DEFAULT_LITERT_MODEL_PATH = '/assets/gemma-3n-E2B-it-int4-Web.litertlm'
export const DEFAULT_LITERT_WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@latest/wasm'

export function getDefaultLiteRtOptions(): Required<LiteRtSessionOptions> {
  return {
    modelPath: import.meta.env.VITE_LITERT_MODEL_PATH ?? DEFAULT_LITERT_MODEL_PATH,
    wasmRoot: import.meta.env.VITE_LITERT_WASM_ROOT ?? DEFAULT_LITERT_WASM_ROOT,
    maxTokens: 512,
    topK: 40,
    temperature: 0.7,
  }
}

export async function createLiteRtSession(options: LiteRtSessionOptions = {}): Promise<LiteRtSession> {
  const resolved = {
    ...getDefaultLiteRtOptions(),
    ...options,
  }

  const { FilesetResolver, LlmInference } = await import('@mediapipe/tasks-genai')
  const genai = await FilesetResolver.forGenAiTasks(resolved.wasmRoot)
  const llm = await LlmInference.createFromOptions(genai, {
    baseOptions: { modelAssetPath: resolved.modelPath },
    maxTokens: resolved.maxTokens,
    topK: resolved.topK,
    temperature: resolved.temperature,
  })

  return llm as LiteRtSession
}
