import { NDKEvent } from '@nostr-dev-kit/ndk'
import { insertEvent } from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { parseFileMetadataEvent } from '@/lib/nostr/fileMetadata'
import { getNDK } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'
import {
  isSafeURL,
  isValidHex32,
  sanitizeText,
} from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

const REPORT_TYPES = [
  'nudity',
  'malware',
  'profanity',
  'illegal',
  'spam',
  'impersonation',
  'other',
] as const

const MAX_REASON_CHARS = 2_000
const MAX_LABEL_NAMESPACE_CHARS = 128
const MAX_LABEL_VALUE_CHARS = 128
const CONTROL_CHARS_PATTERN = /[\u0000-\u001f\u007f]/u
const BLOB_HASH_PATTERN = /^[a-f0-9]{40,64}$/i

export { REPORT_TYPES }

export type ReportType = typeof REPORT_TYPES[number]

export interface ReportLabel {
  value: string
  namespace: string
}

export interface ParsedReportTargetProfile {
  pubkey: string
  reportType?: ReportType
}

export interface ParsedReportTargetEvent {
  eventId: string
  reportType?: ReportType
}

export interface ParsedReportTargetBlob {
  hash: string
  reportType?: ReportType
}

export interface ParsedReportEvent {
  id: string
  pubkey: string
  createdAt: number
  profileTargets: ParsedReportTargetProfile[]
  eventTargets: ParsedReportTargetEvent[]
  blobTargets: ParsedReportTargetBlob[]
  serverUrls: string[]
  labels: ReportLabel[]
  reportTypes: ReportType[]
  reason?: string
}

export type ReportPublishTarget =
  | {
    type: 'profile'
    pubkey: string
  }
  | {
    type: 'event'
    event: NostrEvent
  }

export interface PublishReportOptions {
  reportType: ReportType
  reason?: string
  labels?: ReportLabel[]
}

export interface ReportDraft {
  kind: typeof Kind.Report
  content: string
  tags: string[][]
}

export function normalizeReportType(value: string | undefined): ReportType | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return REPORT_TYPES.find((reportType) => reportType === normalized)
}

export function normalizeReportReason(value: string | undefined): string {
  if (typeof value !== 'string') return ''
  return sanitizeText(value).trim().slice(0, MAX_REASON_CHARS)
}

export function normalizeReportLabelNamespace(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = sanitizeText(value).trim().slice(0, MAX_LABEL_NAMESPACE_CHARS)
  if (normalized.length === 0 || CONTROL_CHARS_PATTERN.test(normalized)) return null
  return normalized
}

export function normalizeReportLabelValue(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = sanitizeText(value).trim().slice(0, MAX_LABEL_VALUE_CHARS)
  if (normalized.length === 0 || CONTROL_CHARS_PATTERN.test(normalized)) return null
  return normalized
}

export function parseReportLabelsInput(
  value: string | undefined,
  namespace: string | undefined,
): ReportLabel[] {
  const normalizedNamespace = normalizeReportLabelNamespace(namespace) ?? 'ugc'
  if (typeof value !== 'string') return []

  const labels: ReportLabel[] = []
  const seen = new Set<string>()

  for (const rawValue of value.split(/[,\n]/)) {
    const normalizedValue = normalizeReportLabelValue(rawValue)
    if (!normalizedValue) continue

    const key = `${normalizedNamespace}\u0000${normalizedValue}`
    if (seen.has(key)) continue
    seen.add(key)
    labels.push({
      value: normalizedValue,
      namespace: normalizedNamespace,
    })
  }

  return labels
}

function isValidBlobHash(value: string | undefined): boolean {
  return typeof value === 'string' && BLOB_HASH_PATTERN.test(value.trim())
}

function normalizeBlobHash(value: string | undefined): string | null {
  if (!isValidBlobHash(value)) return null
  return value!.trim().toLowerCase()
}

function buildLabelTags(labels: ReportLabel[]): string[][] {
  if (labels.length === 0) return []

  const namespaces = [...new Set(labels.map((label) => label.namespace))]
  return [
    ...namespaces.map((namespace) => ['L', namespace]),
    ...labels.map((label) => ['l', label.value, label.namespace]),
  ]
}

function normalizePublishLabels(labels: ReportLabel[] | undefined): ReportLabel[] {
  if (!Array.isArray(labels) || labels.length === 0) return []

  const normalized: ReportLabel[] = []
  const seen = new Set<string>()

  for (const label of labels) {
    const namespace = normalizeReportLabelNamespace(label.namespace)
    const value = normalizeReportLabelValue(label.value)
    if (!namespace || !value) continue

    const key = `${namespace}\u0000${value}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({ namespace, value })
  }

  return normalized
}

function parseProfileTargets(event: NostrEvent): ParsedReportTargetProfile[] {
  const targets: ParsedReportTargetProfile[] = []
  const seen = new Set<string>()

  for (const tag of event.tags) {
    if (tag[0] !== 'p' || !isValidHex32(tag[1] ?? '')) continue

    const pubkey = tag[1]!
    const reportType = normalizeReportType(tag[2])
    const key = `${pubkey}\u0000${reportType ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)

    targets.push({
      pubkey,
      ...(reportType ? { reportType } : {}),
    })
  }

  return targets
}

function parseEventTargets(event: NostrEvent): ParsedReportTargetEvent[] {
  const targets: ParsedReportTargetEvent[] = []
  const seen = new Set<string>()

  for (const tag of event.tags) {
    if (tag[0] !== 'e' || !isValidHex32(tag[1] ?? '')) continue

    const eventId = tag[1]!
    const reportType = normalizeReportType(tag[2])
    const key = `${eventId}\u0000${reportType ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)

    targets.push({
      eventId,
      ...(reportType ? { reportType } : {}),
    })
  }

  return targets
}

function parseBlobTargets(event: NostrEvent): ParsedReportTargetBlob[] {
  const targets: ParsedReportTargetBlob[] = []
  const seen = new Set<string>()

  for (const tag of event.tags) {
    if (tag[0] !== 'x') continue

    const hash = normalizeBlobHash(tag[1])
    if (!hash) continue

    const reportType = normalizeReportType(tag[2])
    const key = `${hash}\u0000${reportType ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)

    targets.push({
      hash,
      ...(reportType ? { reportType } : {}),
    })
  }

  return targets
}

function parseLabels(event: NostrEvent): ReportLabel[] {
  const declaredNamespaces = new Set<string>()
  for (const tag of event.tags) {
    if (tag[0] !== 'L') continue
    const namespace = normalizeReportLabelNamespace(tag[1])
    if (namespace) {
      declaredNamespaces.add(namespace)
    }
  }

  const labels: ReportLabel[] = []
  const seen = new Set<string>()

  for (const tag of event.tags) {
    if (tag[0] !== 'l') continue

    const value = normalizeReportLabelValue(tag[1])
    if (!value) continue

    const mark = normalizeReportLabelNamespace(tag[2])
    let namespace: string | null = null

    if (mark) {
      if (declaredNamespaces.size > 0 && !declaredNamespaces.has(mark)) continue
      namespace = mark
    } else if (declaredNamespaces.size === 0) {
      namespace = 'ugc'
    } else {
      continue
    }

    const key = `${namespace}\u0000${value}`
    if (seen.has(key)) continue
    seen.add(key)
    labels.push({ value, namespace })
  }

  return labels
}

function parseServerUrls(event: NostrEvent): string[] {
  const serverUrls: string[] = []
  const seen = new Set<string>()

  for (const tag of event.tags) {
    if (tag[0] !== 'server' || !isSafeURL(tag[1] ?? '')) continue
    const url = tag[1]!
    if (seen.has(url)) continue
    seen.add(url)
    serverUrls.push(url)
  }

  return serverUrls
}

export function parseReportEvent(event: NostrEvent): ParsedReportEvent | null {
  if (event.kind !== Kind.Report) return null

  const profileTargets = parseProfileTargets(event)
  const eventTargets = parseEventTargets(event)
  const blobTargets = parseBlobTargets(event)
  if (profileTargets.length === 0 && eventTargets.length === 0 && blobTargets.length === 0) {
    return null
  }

  const reportTypes = [...new Set(
    [...profileTargets, ...eventTargets, ...blobTargets]
      .map((target) => target.reportType)
      .filter((value): value is ReportType => value !== undefined),
  )]
  const reason = normalizeReportReason(event.content)

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    profileTargets,
    eventTargets,
    blobTargets,
    serverUrls: parseServerUrls(event),
    labels: parseLabels(event),
    reportTypes,
    ...(reason ? { reason } : {}),
  }
}

export function formatReportType(reportType: ReportType): string {
  switch (reportType) {
    case 'nudity':
      return 'nudity'
    case 'malware':
      return 'malware'
    case 'profanity':
      return 'profanity'
    case 'illegal':
      return 'illegal content'
    case 'spam':
      return 'spam'
    case 'impersonation':
      return 'impersonation'
    case 'other':
      return 'other reasons'
  }
}

export function getPrimaryReportType(report: ParsedReportEvent): ReportType | undefined {
  return report.reportTypes[0]
}

export function getReportSummary(report: ParsedReportEvent): string {
  const primaryType = getPrimaryReportType(report)
  const suffix = primaryType ? ` for ${formatReportType(primaryType)}` : ''

  if (report.blobTargets.length > 0) {
    if (report.blobTargets.length === 1) return `Reported a file${suffix}.`
    return `Reported ${report.blobTargets.length} files${suffix}.`
  }

  if (report.eventTargets.length > 0) {
    if (report.eventTargets.length === 1) return `Reported an event${suffix}.`
    return `Reported ${report.eventTargets.length} events${suffix}.`
  }

  if (report.profileTargets.length === 1) return `Reported a profile${suffix}.`
  return `Reported ${report.profileTargets.length} profiles${suffix}.`
}

export function getReportPreviewText(event: NostrEvent): string | null {
  const report = parseReportEvent(event)
  if (!report) return null
  return report.reason || getReportSummary(report)
}

export function buildReportDraft(
  target: ReportPublishTarget,
  options: PublishReportOptions,
): ReportDraft {
  const reportType = normalizeReportType(options.reportType)
  if (!reportType) {
    throw new Error('Invalid report type.')
  }

  const reason = normalizeReportReason(options.reason)
  const labels = normalizePublishLabels(options.labels)
  const tags: string[][] = []

  if (target.type === 'profile') {
    if (!isValidHex32(target.pubkey)) {
      throw new Error('Invalid profile pubkey for report target.')
    }
    tags.push(['p', target.pubkey, reportType])
  } else {
    if (!isValidHex32(target.event.id) || !isValidHex32(target.event.pubkey)) {
      throw new Error('Invalid event target for report.')
    }

    const fileMetadata = parseFileMetadataEvent(target.event)
    if (fileMetadata) {
      tags.push(['x', fileMetadata.metadata.fileHash, reportType])
      tags.push(['e', target.event.id, reportType])
      tags.push(['p', target.event.pubkey])

      const serverUrls = [
        fileMetadata.metadata.url,
        ...(fileMetadata.metadata.fallbacks ?? []),
      ].filter((url, index, list) => isSafeURL(url) && list.indexOf(url) === index)

      for (const serverUrl of serverUrls) {
        tags.push(['server', serverUrl])
      }
    } else {
      tags.push(['e', target.event.id, reportType])
      tags.push(['p', target.event.pubkey])
    }
  }

  return {
    kind: Kind.Report,
    content: reason,
    tags: [
      ...tags,
      ...buildLabelTags(labels),
    ],
  }
}

export async function publishReport(
  target: ReportPublishTarget,
  options: PublishReportOptions,
  signal?: AbortSignal,
): Promise<NostrEvent> {
  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to publish reports.')
  }

  const draft = buildReportDraft(target, options)
  const event = new NDKEvent(ndk)
  event.kind = draft.kind
  event.content = draft.content
  event.tags = await withOptionalClientTag(draft.tags, signal)

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await event.sign()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  await withRetry(
    async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await event.publish()
    },
    {
      maxAttempts: 2,
      baseDelayMs: 750,
      maxDelayMs: 2_500,
      ...(signal ? { signal } : {}),
    },
  )

  const rawEvent = event.rawEvent() as unknown as NostrEvent
  await insertEvent(rawEvent)
  return rawEvent
}
