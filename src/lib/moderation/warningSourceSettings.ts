const STORAGE_KEY_PREFIX = 'nostr-paper:moderation-warning-sources:v1:'

export const MODERATION_WARNING_SOURCES_UPDATED_EVENT = 'nostr-paper:moderation-warning-sources-updated'

export interface ModerationWarningSourceSettings {
  aiLabelsEnabled: boolean
  networkReportWarningsEnabled: boolean
  networkLabelWarningsEnabled: boolean
}

const DEFAULT_SETTINGS: ModerationWarningSourceSettings = {
  aiLabelsEnabled: true,
  networkReportWarningsEnabled: true,
  networkLabelWarningsEnabled: true,
}

function getStorageKey(scopeId?: string | null): string {
  const scope = scopeId && scopeId.trim().length > 0 ? scopeId.trim() : 'anon'
  return `${STORAGE_KEY_PREFIX}${scope}`
}

function emitUpdated(scopeId?: string | null): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(MODERATION_WARNING_SOURCES_UPDATED_EVENT, {
    detail: { scopeId: scopeId ?? 'anon' },
  }))
}

function normalizeSettings(raw: unknown): ModerationWarningSourceSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_SETTINGS }
  }

  const parsed = raw as Partial<ModerationWarningSourceSettings>
  return {
    aiLabelsEnabled: parsed.aiLabelsEnabled !== false,
    networkReportWarningsEnabled: parsed.networkReportWarningsEnabled !== false,
    networkLabelWarningsEnabled: parsed.networkLabelWarningsEnabled !== false,
  }
}

export function getModerationWarningSourceSettings(scopeId?: string | null): ModerationWarningSourceSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS }

  try {
    const raw = window.localStorage.getItem(getStorageKey(scopeId))
    if (!raw) return { ...DEFAULT_SETTINGS }
    return normalizeSettings(JSON.parse(raw) as unknown)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function setModerationWarningSourceSettings(
  next: Partial<ModerationWarningSourceSettings>,
  scopeId?: string | null,
): void {
  if (typeof window === 'undefined') return

  try {
    const current = getModerationWarningSourceSettings(scopeId)
    const merged = normalizeSettings({ ...current, ...next })
    window.localStorage.setItem(getStorageKey(scopeId), JSON.stringify(merged))
    emitUpdated(scopeId)
  } catch {
    // Best-effort persistence only.
  }
}
