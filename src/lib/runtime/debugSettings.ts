const THREAD_INSPECTOR_KEY = 'nostr-paper.debug.threadInspector'

export function isThreadInspectorEnabled(): boolean {
  try {
    return localStorage.getItem(THREAD_INSPECTOR_KEY) === '1'
  } catch {
    return false
  }
}

export function setThreadInspectorEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(THREAD_INSPECTOR_KEY, enabled ? '1' : '0')
  } catch {
    // Ignore storage failures in private mode or restricted contexts.
  }
}
