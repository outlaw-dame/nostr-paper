import type { AiTask, TaskPolicyDecision } from '@/lib/ai/taskPolicy'

const EVENT_NAME = 'nostr-paper:ai-task-policy'
const MAX_EVENTS = 300

export interface TaskPolicyTelemetryEvent {
  type: 'decision' | 'outcome'
  timestamp: number
  payload: Record<string, unknown>
}

const telemetryBuffer: TaskPolicyTelemetryEvent[] = []

function envString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isTelemetryEnabled(): boolean {
  const configured = envString(import.meta.env.VITE_AI_POLICY_TELEMETRY)
  if (configured) return configured === 'true'
  return import.meta.env.DEV
}

function pushEvent(event: TaskPolicyTelemetryEvent): void {
  telemetryBuffer.push(event)
  if (telemetryBuffer.length > MAX_EVENTS) telemetryBuffer.shift()
}

function emitEvent(event: TaskPolicyTelemetryEvent): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<TaskPolicyTelemetryEvent>(EVENT_NAME, { detail: event }))
}

function publish(event: TaskPolicyTelemetryEvent): void {
  if (!isTelemetryEnabled()) return
  pushEvent(event)
  emitEvent(event)
}

export function recordTaskPolicyDecision(decision: TaskPolicyDecision, context?: Record<string, unknown>): void {
  publish({
    type: 'decision',
    timestamp: Date.now(),
    payload: {
      ...decision,
      ...(context ?? {}),
    },
  })
}

export function recordTaskPolicyOutcome(input: {
  task: AiTask
  runtime: string
  success: boolean
  latencyMs?: number
  error?: string
  context?: Record<string, unknown>
}): void {
  publish({
    type: 'outcome',
    timestamp: Date.now(),
    payload: {
      task: input.task,
      runtime: input.runtime,
      success: input.success,
      ...(typeof input.latencyMs === 'number' ? { latencyMs: input.latencyMs } : {}),
      ...(input.error ? { error: input.error } : {}),
      ...(input.context ?? {}),
    },
  })
}

export function getTaskPolicyTelemetrySnapshot(): TaskPolicyTelemetryEvent[] {
  return [...telemetryBuffer]
}
