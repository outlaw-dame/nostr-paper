import { NDKEvent, NDKRelaySet, type NDKFilter } from '@nostr-dev-kit/ndk'
import { extractHashtags, isValidHex32, isValidRelayURL, sanitizeText } from '@/lib/security/sanitize'
import { getNDK } from '@/lib/nostr/ndk'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { insertEvent, listPollVoteEvents } from '@/lib/db/nostr'
import { withRetry } from '@/lib/retry'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

const POLL_TYPE_VALUES = ['singlechoice', 'multiplechoice'] as const
const OPTION_ID_PATTERN = /^[a-zA-Z0-9]{1,64}$/
const MAX_OPTION_LABEL_CHARS = 240
const MAX_OPTION_COUNT = 32
const MAX_RELAY_COUNT = 12

export type PollType = typeof POLL_TYPE_VALUES[number]

export interface PollOption {
  optionId: string
  label: string
  index: number
}

export interface ParsedPollEvent {
  id: string
  pubkey: string
  createdAt: number
  question: string
  pollType: PollType
  options: PollOption[]
  relayUrls: string[]
  endsAt?: number
}

export interface ParsedPollVoteEvent {
  id: string
  pubkey: string
  createdAt: number
  pollEventId: string
  responses: string[]
}

export interface PollResults {
  totalVotes: number
  optionCounts: Record<string, number>
  winningOptionIds: string[]
  currentUserResponses: string[]
  currentUserHasVoted: boolean
}

export interface PublishPollOptions {
  question: string
  options: string[]
  relayUrls: string[]
  pollType?: PollType
  endsAt?: number
  signal?: AbortSignal
}

export interface PublishPollVoteOptions {
  poll: ParsedPollEvent
  responses: string[]
  signal?: AbortSignal
}

function normalizeRelayUrl(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!isValidRelayURL(trimmed)) return null

  try {
    const normalized = new URL(trimmed)
    normalized.hash = ''
    normalized.username = ''
    normalized.password = ''
    if (
      (normalized.protocol === 'wss:' && normalized.port === '443') ||
      (normalized.protocol === 'ws:' && normalized.port === '80')
    ) {
      normalized.port = ''
    }
    return normalized.toString()
  } catch {
    return null
  }
}

function normalizePollType(value: string | undefined): PollType | null {
  if (value === undefined) return 'singlechoice'
  const normalized = value.trim().toLowerCase()
  return POLL_TYPE_VALUES.find((pollType) => pollType === normalized) ?? null
}

function normalizeQuestion(value: string): string {
  return sanitizeText(value).replace(/\r\n?/g, '\n').trim()
}

function normalizeOptionLabel(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = sanitizeText(value).trim().slice(0, MAX_OPTION_LABEL_CHARS)
  return normalized.length > 0 ? normalized : null
}

function normalizeOptionId(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return OPTION_ID_PATTERN.test(normalized) ? normalized : null
}

function normalizePollOption(
  optionId: string | undefined,
  label: string | undefined,
  index: number,
): PollOption | null {
  const normalizedOptionId = normalizeOptionId(optionId)
  const normalizedLabel = normalizeOptionLabel(label)
  if (!normalizedOptionId || !normalizedLabel) return null

  return {
    optionId: normalizedOptionId,
    label: normalizedLabel,
    index,
  }
}

function normalizeRelayUrls(relayUrls: Iterable<string | undefined>): string[] {
  const deduped = new Set<string>()

  for (const relayUrl of relayUrls) {
    const normalized = normalizeRelayUrl(relayUrl)
    if (!normalized) continue
    deduped.add(normalized)
    if (deduped.size >= MAX_RELAY_COUNT) break
  }

  return [...deduped]
}

function parseEndsAtTag(tags: string[][]): number | undefined {
  for (const tag of tags) {
    if (tag[0] !== 'endsAt' || typeof tag[1] !== 'string') continue
    if (!/^\d{1,12}$/.test(tag[1])) continue
    const endsAt = Number(tag[1])
    if (Number.isSafeInteger(endsAt) && endsAt > 0) {
      return endsAt
    }
  }

  return undefined
}

function getPollTypeTag(tags: string[][]): string | undefined {
  for (const tag of tags) {
    if (tag[0] === 'polltype') return tag[1]
  }
  return undefined
}

function getPollOptions(tags: string[][]): PollOption[] {
  const options: PollOption[] = []
  const seenOptionIds = new Set<string>()

  for (const tag of tags) {
    if (tag[0] !== 'option') continue
    const option = normalizePollOption(tag[1], tag[2], options.length)
    if (!option || seenOptionIds.has(option.optionId)) continue
    seenOptionIds.add(option.optionId)
    options.push(option)
    if (options.length >= MAX_OPTION_COUNT) break
  }

  return options
}

function getPollRelayUrls(tags: string[][]): string[] {
  return normalizeRelayUrls(
    tags
      .filter((tag) => tag[0] === 'relay')
      .map((tag) => tag[1]),
  )
}

function getResponseTags(event: NostrEvent): string[] {
  return event.tags
    .filter((tag) => tag[0] === 'response')
    .map((tag) => tag[1] ?? '')
}

function getPollEventId(event: NostrEvent): string | null {
  for (const tag of event.tags) {
    if (tag[0] !== 'e') continue
    if (isValidHex32(tag[1] ?? '')) return tag[1]!
  }
  return null
}

function normalizeVoteResponses(
  event: NostrEvent,
  poll: ParsedPollEvent,
): string[] {
  const validOptionIds = new Set(poll.options.map((option) => option.optionId))
  const rawResponses = getResponseTags(event)

  if (poll.pollType === 'singlechoice') {
    const firstResponse = normalizeOptionId(rawResponses[0])
    return firstResponse && validOptionIds.has(firstResponse) ? [firstResponse] : []
  }

  const responses: string[] = []
  const seen = new Set<string>()

  for (const rawResponse of rawResponses) {
    const normalizedResponse = normalizeOptionId(rawResponse)
    if (!normalizedResponse || seen.has(normalizedResponse) || !validOptionIds.has(normalizedResponse)) {
      continue
    }
    seen.add(normalizedResponse)
    responses.push(normalizedResponse)
  }

  return responses
}

function buildPollRelaySet(poll: ParsedPollEvent): NDKRelaySet | null {
  if (poll.relayUrls.length === 0) return null
  return NDKRelaySet.fromRelayUrls(poll.relayUrls, getNDK())
}

function buildPollOptionTags(options: string[]): string[][] {
  return options.map((label, index) => ['option', `opt${index + 1}`, label])
}

function normalizePublishOptions(options: string[]): string[] {
  const normalized: string[] = []
  const seenLabels = new Set<string>()

  for (const option of options) {
    const normalizedOption = normalizeOptionLabel(option)
    if (!normalizedOption) continue
    const dedupeKey = normalizedOption.toLowerCase()
    if (seenLabels.has(dedupeKey)) continue
    seenLabels.add(dedupeKey)
    normalized.push(normalizedOption)
    if (normalized.length >= MAX_OPTION_COUNT) break
  }

  return normalized
}

function buildHashtagTags(question: string): string[][] {
  return extractHashtags(question).map((tag) => ['t', tag])
}

export function isPollClosed(poll: ParsedPollEvent, now = Math.floor(Date.now() / 1000)): boolean {
  return poll.endsAt !== undefined && now > poll.endsAt
}

export function parsePollEvent(event: NostrEvent): ParsedPollEvent | null {
  if (event.kind !== Kind.Poll) return null

  const question = normalizeQuestion(event.content)
  if (question.length === 0) return null

  const pollType = normalizePollType(getPollTypeTag(event.tags))
  if (!pollType) return null

  const options = getPollOptions(event.tags)
  if (options.length < 2) return null

  const relayUrls = getPollRelayUrls(event.tags)
  const endsAt = parseEndsAtTag(event.tags)

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    question,
    pollType,
    options,
    relayUrls,
    ...(endsAt !== undefined ? { endsAt } : {}),
  }
}

export function parsePollVoteEvent(
  event: NostrEvent,
  poll?: ParsedPollEvent,
): ParsedPollVoteEvent | null {
  if (event.kind !== Kind.PollVote) return null

  const pollEventId = getPollEventId(event)
  if (!pollEventId) return null
  if (poll && poll.id !== pollEventId) return null

  const responses = poll
    ? normalizeVoteResponses(event, poll)
    : (() => {
      const seen = new Set<string>()
      const normalizedResponses: string[] = []

      for (const response of getResponseTags(event)) {
        const normalizedResponse = normalizeOptionId(response)
        if (!normalizedResponse || seen.has(normalizedResponse)) continue
        seen.add(normalizedResponse)
        normalizedResponses.push(normalizedResponse)
      }

      return normalizedResponses
    })()

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    pollEventId,
    responses,
  }
}

export function tallyPollVotes(
  poll: ParsedPollEvent,
  voteEvents: NostrEvent[],
  currentUserPubkey?: string | null,
): PollResults {
  const optionCounts = Object.fromEntries(
    poll.options.map((option) => [option.optionId, 0]),
  ) as Record<string, number>

  const latestVoteByPubkey = new Map<string, NostrEvent>()
  const sortedVotes = [...voteEvents].sort((left, right) => (
    right.created_at - left.created_at ||
    right.id.localeCompare(left.id)
  ))

  for (const voteEvent of sortedVotes) {
    if (voteEvent.created_at < poll.createdAt) continue
    if (poll.endsAt !== undefined && voteEvent.created_at > poll.endsAt) continue
    if (latestVoteByPubkey.has(voteEvent.pubkey)) continue
    latestVoteByPubkey.set(voteEvent.pubkey, voteEvent)
  }

  let totalVotes = 0
  let currentUserResponses: string[] = []

  for (const [pubkey, voteEvent] of latestVoteByPubkey.entries()) {
    const parsedVote = parsePollVoteEvent(voteEvent, poll)
    if (!parsedVote || parsedVote.responses.length === 0) {
      if (currentUserPubkey && pubkey === currentUserPubkey) {
        currentUserResponses = []
      }
      continue
    }

    totalVotes += 1

    for (const response of parsedVote.responses) {
      optionCounts[response] = (optionCounts[response] ?? 0) + 1
    }

    if (currentUserPubkey && pubkey === currentUserPubkey) {
      currentUserResponses = parsedVote.responses
    }
  }

  const highestCount = Math.max(0, ...Object.values(optionCounts))
  const winningOptionIds = highestCount > 0
    ? Object.entries(optionCounts)
      .filter(([, count]) => count === highestCount)
      .map(([optionId]) => optionId)
    : []

  return {
    totalVotes,
    optionCounts,
    winningOptionIds,
    currentUserResponses,
    currentUserHasVoted: currentUserResponses.length > 0,
  }
}

export async function getLocalPollResults(
  poll: ParsedPollEvent,
  currentUserPubkey?: string | null,
): Promise<PollResults> {
  const voteEvents = await listPollVoteEvents(poll.id, {
    since: poll.createdAt,
    ...(poll.endsAt !== undefined ? { until: poll.endsAt } : {}),
  })

  return tallyPollVotes(poll, voteEvents, currentUserPubkey)
}

export async function fetchPollVotesFromRelays(
  poll: ParsedPollEvent,
  signal?: AbortSignal,
): Promise<void> {
  const relaySet = buildPollRelaySet(poll)
  if (!relaySet) return
  const filter = {
    kinds: [Kind.PollVote as unknown as number],
    '#e': [poll.id],
    since: poll.createdAt,
    ...(poll.endsAt !== undefined ? { until: poll.endsAt } : {}),
  } as unknown as NDKFilter

  await withRetry(
    async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await getNDK().fetchEvents(
        filter,
        { closeOnEose: true },
        relaySet,
      )
    },
    {
      maxAttempts: 2,
      baseDelayMs: 750,
      maxDelayMs: 2_500,
      ...(signal ? { signal } : {}),
    },
  )
}

export async function publishPoll({
  question,
  options,
  relayUrls,
  pollType = 'singlechoice',
  endsAt,
  signal,
}: PublishPollOptions): Promise<NostrEvent> {
  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to publish polls.')
  }

  const normalizedQuestion = normalizeQuestion(question)
  if (normalizedQuestion.length === 0) {
    throw new Error('Polls require a question.')
  }

  const normalizedPollType = normalizePollType(pollType)
  if (!normalizedPollType) {
    throw new Error('Poll type must be singlechoice or multiplechoice.')
  }

  const normalizedOptions = normalizePublishOptions(options)
  if (normalizedOptions.length < 2) {
    throw new Error('Polls require at least two unique non-empty options.')
  }

  const normalizedRelayUrls = normalizeRelayUrls(relayUrls)
  if (normalizedRelayUrls.length === 0) {
    throw new Error('Polls require at least one valid relay URL for collecting votes.')
  }

  if (endsAt !== undefined) {
    if (!Number.isSafeInteger(endsAt) || endsAt <= Math.floor(Date.now() / 1000)) {
      throw new Error('Poll end times must be a future Unix timestamp.')
    }
  }

  const tags: string[][] = [
    ...buildPollOptionTags(normalizedOptions),
    ...normalizedRelayUrls.map((relayUrl) => ['relay', relayUrl]),
    ['polltype', normalizedPollType],
    ...(endsAt !== undefined ? [['endsAt', String(endsAt)]] : []),
    ...buildHashtagTags(normalizedQuestion),
  ]

  const event = new NDKEvent(ndk)
  event.kind = Kind.Poll
  event.content = normalizedQuestion
  event.tags = await withOptionalClientTag(tags, signal)

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

export async function publishPollVote({
  poll,
  responses,
  signal,
}: PublishPollVoteOptions): Promise<NostrEvent> {
  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to vote in polls.')
  }

  if (isPollClosed(poll)) {
    throw new Error('This poll has already closed.')
  }

  const relaySet = buildPollRelaySet(poll)
  if (!relaySet) {
    throw new Error('This poll does not declare any valid relay tags for publishing votes.')
  }

  const normalizedResponses = poll.pollType === 'singlechoice'
    ? responses.slice(0, 1)
    : [...new Set(responses)]

  const validOptionIds = new Set(poll.options.map((option) => option.optionId))
  const filteredResponses = normalizedResponses.filter((response) => validOptionIds.has(response))

  if (poll.pollType === 'singlechoice' && filteredResponses.length !== 1) {
    throw new Error('Single-choice polls require exactly one valid response.')
  }

  if (poll.pollType === 'multiplechoice' && filteredResponses.length === 0) {
    throw new Error('Select at least one valid option before voting.')
  }

  const event = new NDKEvent(ndk)
  event.kind = Kind.PollVote
  event.content = ''
  event.tags = await withOptionalClientTag([
    ['e', poll.id],
    ...filteredResponses.map((response) => ['response', response]),
  ], signal)

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await event.sign()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  await withRetry(
    async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await event.publish(relaySet)
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
