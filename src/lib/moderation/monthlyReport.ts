import type { ModerationWarningSourceSettings } from '@/lib/moderation/warningSourceSettings'

const STORAGE_KEY_PREFIX = 'nostr-paper:moderation-monthly-report:v1:'

interface MonthlyStarterPackStats {
  evaluatedPackIds: string[]
  blockedAuthorPackIds: string[]
  blockedProfilePubkeys: string[]
  lastComputedAt: number | null
}

interface StoredMonthlyReportData {
  monthKey: string
  starterPack: MonthlyStarterPackStats
  generatedAt: number | null
  generatedReport: string | null
  reviewReminderDismissedAt: number | null
}

interface StoredModerationReportRoot {
  version: 1
  months: Record<string, StoredMonthlyReportData>
}

export interface MonthlyModerationReportInput {
  scopeId?: string | null
  activeFilterCount: number
  totalFilterCount: number
  mutedUsersCount: number
  hideNsfwTaggedPostsEnabled: boolean
  warningSources: ModerationWarningSourceSettings
  monthKey?: string
}

export interface MonthlyModerationReport {
  monthKey: string
  generatedAt: number
  reportText: string
  starterPack: {
    evaluatedPackCount: number
    blockedPackAuthorCount: number
    blockedProfileCount: number
    lastComputedAt: number | null
  }
}

function currentMonthKey(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return `${yyyy}-${mm}`
}

function normalizeScopeId(scopeId?: string | null): string {
  return scopeId && scopeId.trim().length > 0 ? scopeId.trim() : 'anon'
}

function getStorageKey(scopeId?: string | null): string {
  return `${STORAGE_KEY_PREFIX}${normalizeScopeId(scopeId)}`
}

function emptyMonthData(monthKey: string): StoredMonthlyReportData {
  return {
    monthKey,
    starterPack: {
      evaluatedPackIds: [],
      blockedAuthorPackIds: [],
      blockedProfilePubkeys: [],
      lastComputedAt: null,
    },
    generatedAt: null,
    generatedReport: null,
    reviewReminderDismissedAt: null,
  }
}

function emptyRoot(): StoredModerationReportRoot {
  return {
    version: 1,
    months: {},
  }
}

function dedupeStrings(values: string[], max = 2048): string[] {
  const seen = new Set<string>()
  const next: string[] = []

  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    next.push(normalized)
    if (next.length >= max) break
  }

  return next
}

function readRoot(scopeId?: string | null): StoredModerationReportRoot {
  if (typeof window === 'undefined') return emptyRoot()

  try {
    const raw = window.localStorage.getItem(getStorageKey(scopeId))
    if (!raw) return emptyRoot()
    const parsed = JSON.parse(raw) as Partial<StoredModerationReportRoot>
    if (parsed?.version !== 1 || !parsed.months || typeof parsed.months !== 'object') {
      return emptyRoot()
    }

    const months: Record<string, StoredMonthlyReportData> = {}
    for (const [monthKey, value] of Object.entries(parsed.months)) {
      if (!value || typeof value !== 'object') continue
      const starterPackRaw = (value as Partial<StoredMonthlyReportData>).starterPack
      months[monthKey] = {
        monthKey,
        starterPack: {
          evaluatedPackIds: dedupeStrings(Array.isArray(starterPackRaw?.evaluatedPackIds) ? starterPackRaw.evaluatedPackIds : []),
          blockedAuthorPackIds: dedupeStrings(Array.isArray(starterPackRaw?.blockedAuthorPackIds) ? starterPackRaw.blockedAuthorPackIds : []),
          blockedProfilePubkeys: dedupeStrings(Array.isArray(starterPackRaw?.blockedProfilePubkeys) ? starterPackRaw.blockedProfilePubkeys : []),
          lastComputedAt: typeof starterPackRaw?.lastComputedAt === 'number' ? starterPackRaw.lastComputedAt : null,
        },
        generatedAt: typeof (value as Partial<StoredMonthlyReportData>).generatedAt === 'number'
          ? (value as Partial<StoredMonthlyReportData>).generatedAt as number
          : null,
        generatedReport: typeof (value as Partial<StoredMonthlyReportData>).generatedReport === 'string'
          ? (value as Partial<StoredMonthlyReportData>).generatedReport as string
          : null,
        reviewReminderDismissedAt: typeof (value as Partial<StoredMonthlyReportData>).reviewReminderDismissedAt === 'number'
          ? (value as Partial<StoredMonthlyReportData>).reviewReminderDismissedAt as number
          : null,
      }
    }

    return {
      version: 1,
      months,
    }
  } catch {
    return emptyRoot()
  }
}

function writeRoot(root: StoredModerationReportRoot, scopeId?: string | null): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(getStorageKey(scopeId), JSON.stringify(root))
  } catch {
    // Best-effort persistence only.
  }
}

function getMonthData(root: StoredModerationReportRoot, monthKey: string): StoredMonthlyReportData {
  return root.months[monthKey] ?? emptyMonthData(monthKey)
}

export function getMonthlyStarterPackStats(scopeId?: string | null, monthKey = currentMonthKey()): {
  monthKey: string
  evaluatedPackCount: number
  blockedPackAuthorCount: number
  blockedProfileCount: number
  lastComputedAt: number | null
} {
  const root = readRoot(scopeId)
  const month = getMonthData(root, monthKey)

  return {
    monthKey,
    evaluatedPackCount: month.starterPack.evaluatedPackIds.length,
    blockedPackAuthorCount: month.starterPack.blockedAuthorPackIds.length,
    blockedProfileCount: month.starterPack.blockedProfilePubkeys.length,
    lastComputedAt: month.starterPack.lastComputedAt,
  }
}

export function getLatestGeneratedMonthlyReport(scopeId?: string | null, monthKey = currentMonthKey()): {
  monthKey: string
  generatedAt: number | null
  reportText: string | null
} {
  const root = readRoot(scopeId)
  const month = getMonthData(root, monthKey)

  return {
    monthKey,
    generatedAt: month.generatedAt,
    reportText: month.generatedReport,
  }
}

export function recordStarterPackModerationStats(options: {
  scopeId?: string | null
  monthKey?: string
  candidatePackIds: string[]
  blockedAuthorPackIds: string[]
  blockedProfilePubkeys: string[]
}): void {
  const monthKey = options.monthKey ?? currentMonthKey()
  const root = readRoot(options.scopeId)
  const month = getMonthData(root, monthKey)

  month.starterPack = {
    evaluatedPackIds: dedupeStrings([...month.starterPack.evaluatedPackIds, ...options.candidatePackIds]),
    blockedAuthorPackIds: dedupeStrings([...month.starterPack.blockedAuthorPackIds, ...options.blockedAuthorPackIds]),
    blockedProfilePubkeys: dedupeStrings([...month.starterPack.blockedProfilePubkeys, ...options.blockedProfilePubkeys]),
    lastComputedAt: Date.now(),
  }

  root.months[monthKey] = month
  writeRoot(root, options.scopeId)
}

export function shouldShowMonthlyReportReviewReminder(scopeId?: string | null, monthKey = currentMonthKey()): boolean {
  const root = readRoot(scopeId)
  const month = getMonthData(root, monthKey)
  if (month.generatedAt === null || !month.generatedReport) return false
  return month.reviewReminderDismissedAt === null
}

export function dismissMonthlyReportReviewReminder(scopeId?: string | null, monthKey = currentMonthKey()): void {
  const root = readRoot(scopeId)
  const month = getMonthData(root, monthKey)
  if (month.generatedAt === null || !month.generatedReport) {
    return
  }
  month.reviewReminderDismissedAt = Date.now()
  root.months[monthKey] = month
  writeRoot(root, scopeId)
}

function formatMonthLabel(monthKey: string): string {
  const [yearRaw, monthRaw] = monthKey.split('-')
  const year = Number.parseInt(yearRaw ?? '', 10)
  const month = Number.parseInt(monthRaw ?? '', 10)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return monthKey
  }

  const date = new Date(Date.UTC(year, month - 1, 1))
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
}

function buildMonthlyReportText(input: MonthlyModerationReportInput, starterPack: {
  evaluatedPackCount: number
  blockedPackAuthorCount: number
  blockedProfileCount: number
  lastComputedAt: number | null
}): string {
  const monthLabel = formatMonthLabel(input.monthKey ?? currentMonthKey())
  const generatedAt = new Date().toISOString()

  const lines = [
    `Monthly Moderation Report - ${monthLabel}`,
    `Generated: ${generatedAt}`,
    '',
    'Overview',
    `- Active keyword filters: ${input.activeFilterCount} (${input.totalFilterCount} total configured)`,
    `- Muted users: ${input.mutedUsersCount}`,
    `- Hide explicit tags enabled: ${input.hideNsfwTaggedPostsEnabled ? 'yes' : 'no'}`,
    '',
    'Warning sources',
    `- AI labels: ${input.warningSources.aiLabelsEnabled ? 'enabled' : 'disabled'}`,
    `- Network report warnings: ${input.warningSources.networkReportWarningsEnabled ? 'enabled' : 'disabled'}`,
    `- Network label warnings: ${input.warningSources.networkLabelWarningsEnabled ? 'enabled' : 'disabled'}`,
    '',
    'Starter pack moderation impact',
    `- Candidate packs evaluated: ${starterPack.evaluatedPackCount}`,
    `- Pack authors filtered out: ${starterPack.blockedPackAuthorCount}`,
    `- Pack member accounts filtered out: ${starterPack.blockedProfileCount}`,
    `- Last pack moderation snapshot: ${starterPack.lastComputedAt ? new Date(starterPack.lastComputedAt).toISOString() : 'n/a'}`,
  ]

  return lines.join('\n')
}

export function generateMonthlyModerationReport(input: MonthlyModerationReportInput): MonthlyModerationReport {
  const monthKey = input.monthKey ?? currentMonthKey()
  const starterPack = getMonthlyStarterPackStats(input.scopeId, monthKey)
  const generatedAt = Date.now()
  const reportText = buildMonthlyReportText({ ...input, monthKey }, starterPack)

  const root = readRoot(input.scopeId)
  const month = getMonthData(root, monthKey)
  month.generatedAt = generatedAt
  month.generatedReport = reportText
  root.months[monthKey] = month
  writeRoot(root, input.scopeId)

  return {
    monthKey,
    generatedAt,
    reportText,
    starterPack,
  }
}
