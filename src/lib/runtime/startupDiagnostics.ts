const BOOT_SESSION_KEY = 'nostr-paper:boot:session'
const BOOT_LAST_FAILURE_KEY = 'nostr-paper:boot:last-failure'
const BOOT_LAST_SUCCESS_KEY = 'nostr-paper:boot:last-success'

export type BootStage =
  | 'main:start'
  | 'main:react-mounted'
  | 'bootstrap:start'
  | 'bootstrap:ready'
  | 'bootstrap:offline'
  | 'bootstrap:error'

export interface BootSession {
  sessionId: string
  startedAt: number
  stage: BootStage
  ua: string
  path: string
}

export interface BootFailureRecord {
  sessionId: string
  stage: BootStage
  reason: string
  timestamp: number
  ua: string
  path: string
}

export interface BootSuccessRecord {
  sessionId: string
  stage: BootStage
  durationMs: number
  timestamp: number
  ua: string
  path: string
}

let telemetryLogged = false

function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Ignore storage quota/private mode failures.
  }
}

function safeLocalStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Ignore storage quota/private mode failures.
  }
}

function readBootSession(): BootSession | null {
  const raw = safeLocalStorageGet(BOOT_SESSION_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as BootSession
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.sessionId !== 'string') return null
    if (typeof parsed.startedAt !== 'number') return null
    if (typeof parsed.stage !== 'string') return null
    if (typeof parsed.ua !== 'string') return null
    if (typeof parsed.path !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

function writeBootSession(session: BootSession): void {
  safeLocalStorageSet(BOOT_SESSION_KEY, JSON.stringify(session))
}

function createSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${Date.now()}-${rand}`
}

export function beginBootSession(): BootSession {
  const session: BootSession = {
    sessionId: createSessionId(),
    startedAt: Date.now(),
    stage: 'main:start',
    ua: navigator.userAgent,
    path: location.pathname,
  }

  telemetryLogged = false
  writeBootSession(session)
  return session
}

export function markBootStage(stage: BootStage): void {
  const existing = readBootSession()
  if (!existing) {
    beginBootSession()
  }

  const session = readBootSession()
  if (!session) return

  session.stage = stage
  writeBootSession(session)
}

export function recordBootFailure(stage: BootStage, reason: string): void {
  markBootStage(stage)
  const session = readBootSession()
  if (!session) return

  const record: BootFailureRecord = {
    sessionId: session.sessionId,
    stage,
    reason: reason.slice(0, 1_500),
    timestamp: Date.now(),
    ua: session.ua,
    path: session.path,
  }

  safeLocalStorageSet(BOOT_LAST_FAILURE_KEY, JSON.stringify(record))

  if (!telemetryLogged) {
    telemetryLogged = true
    console.error('[BootTelemetry] failure', record)
  }
}

export function recordBootSuccess(stage: Extract<BootStage, 'bootstrap:ready' | 'bootstrap:offline'>): void {
  markBootStage(stage)
  const session = readBootSession()
  if (!session) return

  const durationMs = Math.max(0, Date.now() - session.startedAt)
  const record: BootSuccessRecord = {
    sessionId: session.sessionId,
    stage,
    durationMs,
    timestamp: Date.now(),
    ua: session.ua,
    path: session.path,
  }

  safeLocalStorageSet(BOOT_LAST_SUCCESS_KEY, JSON.stringify(record))

  if (!telemetryLogged) {
    telemetryLogged = true
    console.info('[BootTelemetry] success', record)
  }
}

function parseBootFailureRecord(raw: string | null): BootFailureRecord | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as BootFailureRecord
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.sessionId !== 'string') return null
    if (typeof parsed.stage !== 'string') return null
    if (typeof parsed.reason !== 'string') return null
    if (typeof parsed.timestamp !== 'number') return null
    if (typeof parsed.ua !== 'string') return null
    if (typeof parsed.path !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

function parseBootSuccessRecord(raw: string | null): BootSuccessRecord | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as BootSuccessRecord
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.sessionId !== 'string') return null
    if (typeof parsed.stage !== 'string') return null
    if (typeof parsed.durationMs !== 'number') return null
    if (typeof parsed.timestamp !== 'number') return null
    if (typeof parsed.ua !== 'string') return null
    if (typeof parsed.path !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function readBootSessionForDebug(): BootSession | null {
  return readBootSession()
}

export function readLastBootFailureForDebug(): BootFailureRecord | null {
  return parseBootFailureRecord(safeLocalStorageGet(BOOT_LAST_FAILURE_KEY))
}

export function readLastBootSuccessForDebug(): BootSuccessRecord | null {
  return parseBootSuccessRecord(safeLocalStorageGet(BOOT_LAST_SUCCESS_KEY))
}

export function getLastBootFailureForDebug(): string | null {
  return safeLocalStorageGet(BOOT_LAST_FAILURE_KEY)
}

export function clearBootDiagnosticsForDebug(): void {
  safeLocalStorageRemove(BOOT_LAST_FAILURE_KEY)
  safeLocalStorageRemove(BOOT_LAST_SUCCESS_KEY)
}
