import { beforeEach, describe, expect, it } from 'vitest'
import {
  dismissMonthlyReportReviewReminder,
  generateMonthlyModerationReport,
  getLatestGeneratedMonthlyReport,
  getMonthlyStarterPackStats,
  recordStarterPackModerationStats,
  shouldShowMonthlyReportReviewReminder,
} from './monthlyReport'

function createMemoryStorage(): Storage {
  const map = new Map<string, string>()

  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },
    key(index: number) {
      return [...map.keys()][index] ?? null
    },
    removeItem(key: string) {
      map.delete(key)
    },
    setItem(key: string, value: string) {
      map.set(key, value)
    },
  }
}

describe('monthly moderation report', () => {
  beforeEach(() => {
    const localStorage = createMemoryStorage()
    ;(globalThis as unknown as { window: { localStorage: Storage } }).window = { localStorage }
  })

  it('accumulates starter pack moderation metrics for the month', () => {
    recordStarterPackModerationStats({
      scopeId: 'pubkey-1',
      monthKey: '2026-05',
      candidatePackIds: ['pack-a', 'pack-b'],
      blockedAuthorPackIds: ['pack-a'],
      blockedProfilePubkeys: ['profile-x'],
    })

    recordStarterPackModerationStats({
      scopeId: 'pubkey-1',
      monthKey: '2026-05',
      candidatePackIds: ['pack-b', 'pack-c'],
      blockedAuthorPackIds: ['pack-c'],
      blockedProfilePubkeys: ['profile-x', 'profile-y'],
    })

    const stats = getMonthlyStarterPackStats('pubkey-1', '2026-05')

    expect(stats.evaluatedPackCount).toBe(3)
    expect(stats.blockedPackAuthorCount).toBe(2)
    expect(stats.blockedProfileCount).toBe(2)
    expect(typeof stats.lastComputedAt).toBe('number')
  })

  it('generates and stores monthly report text', () => {
    recordStarterPackModerationStats({
      scopeId: 'pubkey-2',
      monthKey: '2026-05',
      candidatePackIds: ['pack-a'],
      blockedAuthorPackIds: [],
      blockedProfilePubkeys: ['profile-1'],
    })

    const report = generateMonthlyModerationReport({
      scopeId: 'pubkey-2',
      monthKey: '2026-05',
      activeFilterCount: 4,
      totalFilterCount: 7,
      mutedUsersCount: 3,
      hideNsfwTaggedPostsEnabled: true,
      warningSources: {
        aiLabelsEnabled: true,
        networkReportWarningsEnabled: false,
        networkLabelWarningsEnabled: true,
      },
    })

    expect(report.reportText).toContain('Monthly Moderation Report - May 2026')
    expect(report.reportText).toContain('Overview')
    expect(report.reportText).toContain('Active keyword filters: 4 (7 total configured)')
    expect(report.reportText).toContain('Muted users: 3')
    expect(report.reportText).toContain('Hide explicit tags enabled: yes')
    expect(report.reportText).toContain('Warning sources')
    expect(report.reportText).toContain('AI labels: enabled')
    expect(report.reportText).toContain('Network report warnings: disabled')
    expect(report.reportText).toContain('Network label warnings: enabled')
    expect(report.reportText).toContain('Starter pack moderation impact')
    expect(report.reportText).toContain('Candidate packs evaluated: 1')
    expect(report.reportText).toContain('Pack authors filtered out: 0')
    expect(report.reportText).toContain('Pack member accounts filtered out: 1')
    expect(report.reportText).toContain('Last pack moderation snapshot:')

    const latest = getLatestGeneratedMonthlyReport('pubkey-2', '2026-05')
    expect(typeof latest.generatedAt).toBe('number')
    expect(latest.reportText).toContain('Active keyword filters: 4')
  })

  it('persists monthly report reminder dismissal per month', () => {
    const scopeId = 'pubkey-3'
    const monthKey = '2026-05'

    generateMonthlyModerationReport({
      scopeId,
      monthKey,
      activeFilterCount: 1,
      totalFilterCount: 2,
      mutedUsersCount: 0,
      hideNsfwTaggedPostsEnabled: false,
      warningSources: {
        aiLabelsEnabled: true,
        networkReportWarningsEnabled: true,
        networkLabelWarningsEnabled: true,
      },
    })

    expect(shouldShowMonthlyReportReviewReminder(scopeId, monthKey)).toBe(true)

    dismissMonthlyReportReviewReminder(scopeId, monthKey)
    expect(shouldShowMonthlyReportReviewReminder(scopeId, monthKey)).toBe(false)

    generateMonthlyModerationReport({
      scopeId,
      monthKey,
      activeFilterCount: 3,
      totalFilterCount: 5,
      mutedUsersCount: 1,
      hideNsfwTaggedPostsEnabled: true,
      warningSources: {
        aiLabelsEnabled: false,
        networkReportWarningsEnabled: false,
        networkLabelWarningsEnabled: true,
      },
    })

    expect(shouldShowMonthlyReportReviewReminder(scopeId, monthKey)).toBe(false)

    const nextMonth = '2026-06'
    generateMonthlyModerationReport({
      scopeId,
      monthKey: nextMonth,
      activeFilterCount: 1,
      totalFilterCount: 1,
      mutedUsersCount: 0,
      hideNsfwTaggedPostsEnabled: false,
      warningSources: {
        aiLabelsEnabled: true,
        networkReportWarningsEnabled: true,
        networkLabelWarningsEnabled: true,
      },
    })

    expect(shouldShowMonthlyReportReviewReminder(scopeId, nextMonth)).toBe(true)
  })

  it('does not suppress first reminder when dismissed before report exists', () => {
    const scopeId = 'pubkey-4'
    const monthKey = '2026-07'

    expect(shouldShowMonthlyReportReviewReminder(scopeId, monthKey)).toBe(false)

    dismissMonthlyReportReviewReminder(scopeId, monthKey)
    expect(shouldShowMonthlyReportReviewReminder(scopeId, monthKey)).toBe(false)

    generateMonthlyModerationReport({
      scopeId,
      monthKey,
      activeFilterCount: 2,
      totalFilterCount: 3,
      mutedUsersCount: 1,
      hideNsfwTaggedPostsEnabled: false,
      warningSources: {
        aiLabelsEnabled: true,
        networkReportWarningsEnabled: false,
        networkLabelWarningsEnabled: true,
      },
    })

    expect(shouldShowMonthlyReportReviewReminder(scopeId, monthKey)).toBe(true)
  })

  it('keeps reminder dismissal isolated by scope', () => {
    const monthKey = '2026-08'
    const scopeA = 'pubkey-a'
    const scopeB = 'pubkey-b'

    generateMonthlyModerationReport({
      scopeId: scopeA,
      monthKey,
      activeFilterCount: 1,
      totalFilterCount: 1,
      mutedUsersCount: 0,
      hideNsfwTaggedPostsEnabled: false,
      warningSources: {
        aiLabelsEnabled: true,
        networkReportWarningsEnabled: true,
        networkLabelWarningsEnabled: true,
      },
    })
    generateMonthlyModerationReport({
      scopeId: scopeB,
      monthKey,
      activeFilterCount: 1,
      totalFilterCount: 1,
      mutedUsersCount: 0,
      hideNsfwTaggedPostsEnabled: false,
      warningSources: {
        aiLabelsEnabled: true,
        networkReportWarningsEnabled: true,
        networkLabelWarningsEnabled: true,
      },
    })

    dismissMonthlyReportReviewReminder(scopeA, monthKey)

    expect(shouldShowMonthlyReportReviewReminder(scopeA, monthKey)).toBe(false)
    expect(shouldShowMonthlyReportReviewReminder(scopeB, monthKey)).toBe(true)
  })
})
