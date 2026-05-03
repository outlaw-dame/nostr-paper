import { NDKEvent } from '@nostr-dev-kit/ndk'
import { insertEvent } from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { decryptNip04, encryptNip04, hasNip04Support } from '@/lib/nostr/nip04'
import { getNDK } from '@/lib/nostr/ndk'
import { publishEventWithNip65Outbox } from '@/lib/nostr/outbox'
import { withRetry } from '@/lib/retry'
import {
  isSafeURL,
  isValidEvent,
  isValidHex32,
  isValidRelayURL,
  sanitizeText,
} from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

export const DVM_REQUEST_KIND_MIN = 5000
export const DVM_REQUEST_KIND_MAX = 5999
export const DVM_RESULT_KIND_MIN = 6000
export const DVM_RESULT_KIND_MAX = 6999

const DVM_INPUT_TYPES = ['url', 'event', 'job', 'text'] as const
const DVM_FEEDBACK_STATUSES = [
  'payment-required',
  'processing',
  'error',
  'success',
  'partial',
] as const

const MAX_DVM_INPUTS = 64
const MAX_DVM_OUTPUTS = 16
const MAX_DVM_PARAMS = 64
const MAX_DVM_RELAYS = 12
const MAX_DVM_PROVIDERS = 12
const MAX_DVM_VALUE_CHARS = 4_096
const MAX_DVM_ROLE_CHARS = 64
const MAX_DVM_OUTPUT_CHARS = 120
const MAX_DVM_PARAM_NAME_CHARS = 64
const MAX_DVM_PARAM_VALUE_CHARS = 1_024

export type DvmInputType = typeof DVM_INPUT_TYPES[number]
export type KnownDvmFeedbackStatus = typeof DVM_FEEDBACK_STATUSES[number]

export interface DvmJobInput {
  value: string
  type: DvmInputType
  relayHint?: string
  role?: string
}

export interface DvmJobParam {
  name: string
  value: string
}

export interface DvmAmount {
  msats: number
  invoice?: string
}

export interface ParsedDvmJobRequest {
  id: string
  pubkey: string
  createdAt: number
  kind: number
  requestKind: number
  inputs: DvmJobInput[]
  outputs: string[]
  params: DvmJobParam[]
  responseRelays: string[]
  providers: string[]
  maxBidMsats?: number
  isEncrypted: boolean
  hasEncryptedPayload: boolean
}

export interface ParsedDvmJobResult {
  id: string
  pubkey: string
  createdAt: number
  kind: number
  requestKind: number
  requestEventId?: string
  requestEvent?: NostrEvent
  customerPubkey?: string
  inputs: DvmJobInput[]
  amount?: DvmAmount
  isEncrypted: boolean
  hasEncryptedPayload: boolean
  content: string
}

export interface ParsedDvmJobFeedback {
  id: string
  pubkey: string
  createdAt: number
  requestEventId?: string
  requestEvent?: NostrEvent
  customerPubkey?: string
  status: string
  statusMessage?: string
  amount?: DvmAmount
  isEncrypted: boolean
  hasEncryptedPayload: boolean
  content: string
}

export interface ParsedDvmPrivateTagsPayload {
  rawTags: string[][]
  inputs: DvmJobInput[]
  params: DvmJobParam[]
}

export interface PublishDvmJobRequestOptions {
  requestKind: number
  inputs?: DvmJobInput[]
  outputs?: string[]
  params?: DvmJobParam[]
  responseRelays?: string[]
  providerPubkeys?: string[]
  maxBidMsats?: number
  encryptPrivateInputs?: boolean
  signal?: AbortSignal
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
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
      (normalized.protocol === 'wss:' && normalized.port === '443')
      || (normalized.protocol === 'ws:' && normalized.port === '80')
    ) {
      normalized.port = ''
    }
    return normalized.toString()
  } catch {
    return null
  }
}

function sanitizeField(
  value: string | undefined,
  maxChars: number,
): string | null {
  if (typeof value !== 'string') return null
  const normalized = sanitizeText(value).replace(/\r\n?/g, '\n').trim().slice(0, maxChars)
  return normalized.length > 0 ? normalized : null
}

function isDvmInputType(value: string | undefined): value is DvmInputType {
  return typeof value === 'string' && (DVM_INPUT_TYPES as readonly string[]).includes(value)
}

function normalizeInputType(value: string | undefined): DvmInputType | null {
  return isDvmInputType(value) ? value : null
}

function normalizeInputValue(
  value: string | undefined,
  type: DvmInputType,
): string | null {
  switch (type) {
    case 'url': {
      const normalized = typeof value === 'string' ? value.trim() : ''
      return isSafeURL(normalized) ? normalized : null
    }

    case 'event':
    case 'job': {
      const normalized = typeof value === 'string' ? value.trim() : ''
      return isValidHex32(normalized) ? normalized : null
    }

    case 'text':
      return sanitizeField(value, MAX_DVM_VALUE_CHARS)

    default:
      return null
  }
}

function normalizeInputRole(value: string | undefined): string | undefined {
  const normalized = sanitizeField(value, MAX_DVM_ROLE_CHARS)
  return normalized ?? undefined
}

function normalizeOutputValue(value: string | undefined): string | null {
  return sanitizeField(value, MAX_DVM_OUTPUT_CHARS)
}

function normalizeParamName(value: string | undefined): string | null {
  return sanitizeField(value, MAX_DVM_PARAM_NAME_CHARS)
}

function normalizeParamValue(value: string | undefined): string | null {
  return sanitizeField(value, MAX_DVM_PARAM_VALUE_CHARS)
}

function normalizeAmountMsats(value: string | number | undefined): number | undefined {
  const raw = typeof value === 'number' ? String(value) : value
  if (typeof raw !== 'string' || !/^\d{1,15}$/.test(raw)) return undefined
  const msats = Number(raw)
  return Number.isSafeInteger(msats) ? msats : undefined
}

function normalizeInvoice(value: string | undefined): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : undefined
}

function parseAmountTag(tags: string[][]): DvmAmount | undefined {
  for (const tag of tags) {
    if (tag[0] !== 'amount') continue
    const msats = normalizeAmountMsats(tag[1])
    if (msats === undefined) continue
    const invoice = normalizeInvoice(tag[2])
    return invoice ? { msats, invoice } : { msats }
  }
  return undefined
}

function parseProviderPubkeys(tags: string[][]): string[] {
  const providers: string[] = []
  const seen = new Set<string>()

  for (const tag of tags) {
    if (tag[0] !== 'p') continue
    const pubkey = typeof tag[1] === 'string' ? tag[1].trim() : ''
    if (!isValidHex32(pubkey) || seen.has(pubkey)) continue
    seen.add(pubkey)
    providers.push(pubkey)
    if (providers.length >= MAX_DVM_PROVIDERS) break
  }

  return providers
}

function parseInputTag(tag: string[]): DvmJobInput | null {
  if (tag[0] !== 'i') return null

  const type = normalizeInputType(tag[2])
  if (!type) return null

  const value = normalizeInputValue(tag[1], type)
  if (!value) return null

  let relayHint: string | null = null
  let role: string | undefined

  if (type === 'event' || type === 'job') {
    relayHint = normalizeRelayUrl(tag[3] ?? '')
    role = normalizeInputRole(relayHint ? tag[4] : (tag[4] ?? tag[3]))
  } else {
    role = normalizeInputRole(tag[4] ?? tag[3])
  }

  return {
    value,
    type,
    ...(relayHint ? { relayHint } : {}),
    ...(role ? { role } : {}),
  }
}

function parseInputTags(tags: string[][]): DvmJobInput[] {
  const inputs: DvmJobInput[] = []

  for (const tag of tags) {
    if (tag[0] !== 'i') continue
    const input = parseInputTag(tag)
    if (!input) continue
    inputs.push(input)
    if (inputs.length >= MAX_DVM_INPUTS) break
  }

  return inputs
}

function parseOutputTags(tags: string[][]): string[] {
  const outputs: string[] = []
  const seen = new Set<string>()

  for (const tag of tags) {
    if (tag[0] !== 'output') continue
    const output = normalizeOutputValue(tag[1])
    if (!output) continue
    const dedupeKey = output.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    outputs.push(output)
    if (outputs.length >= MAX_DVM_OUTPUTS) break
  }

  return outputs
}

function parseParamTags(tags: string[][]): DvmJobParam[] {
  const params: DvmJobParam[] = []

  for (const tag of tags) {
    if (tag[0] !== 'param') continue
    const name = normalizeParamName(tag[1])
    const value = normalizeParamValue(tag[2])
    if (!name || !value) continue
    params.push({ name, value })
    if (params.length >= MAX_DVM_PARAMS) break
  }

  return params
}

function parseResponseRelays(tags: string[][]): string[] {
  const relays: string[] = []
  const seen = new Set<string>()

  for (const tag of tags) {
    if (tag[0] !== 'relays') continue
    for (const value of tag.slice(1)) {
      const relay = normalizeRelayUrl(value)
      if (!relay || seen.has(relay)) continue
      seen.add(relay)
      relays.push(relay)
      if (relays.length >= MAX_DVM_RELAYS) return relays
    }
  }

  return relays
}

function parseBidTag(tags: string[][]): number | undefined {
  for (const tag of tags) {
    if (tag[0] !== 'bid') continue
    const bid = normalizeAmountMsats(tag[1])
    if (bid !== undefined) return bid
  }
  return undefined
}

function getEventReferenceId(tags: string[][]): string | undefined {
  for (const tag of tags) {
    if (tag[0] !== 'e') continue
    const eventId = typeof tag[1] === 'string' ? tag[1].trim() : ''
    if (isValidHex32(eventId)) return eventId
  }
  return undefined
}

function getCustomerPubkey(tags: string[][]): string | undefined {
  for (const tag of tags) {
    if (tag[0] !== 'p') continue
    const pubkey = typeof tag[1] === 'string' ? tag[1].trim() : ''
    if (isValidHex32(pubkey)) return pubkey
  }
  return undefined
}

function parseRequestTag(tags: string[][]): NostrEvent | undefined {
  for (const tag of tags) {
    if (tag[0] !== 'request' || typeof tag[1] !== 'string') continue

    let parsed: unknown
    try {
      parsed = JSON.parse(tag[1])
    } catch {
      continue
    }

    if (isValidEvent(parsed)) {
      return parsed
    }
  }

  return undefined
}

function hasEncryptedTag(tags: string[][]): boolean {
  return tags.some((tag) => tag[0] === 'encrypted')
}

function parseFeedbackStatus(tags: string[][]): { status: string; message?: string } | null {
  for (const tag of tags) {
    if (tag[0] !== 'status') continue
    const status = sanitizeField(tag[1], 64)?.toLowerCase()
    if (!status) continue
    const message = sanitizeField(tag[2], 240) ?? undefined
    return message ? { status, message } : { status }
  }
  return null
}

function buildInputTag(input: DvmJobInput): string[] {
  const tag = ['i', input.value, input.type]
  if ((input.type === 'event' || input.type === 'job') && input.relayHint) tag.push(input.relayHint)
  else if (input.role) tag.push('')
  if (input.role) tag.push(input.role)
  return tag
}

function buildParamTag(param: DvmJobParam): string[] {
  return ['param', param.name, param.value]
}

function preparePublishInput(input: DvmJobInput): DvmJobInput {
  const type = normalizeInputType(input.type)
  if (!type) {
    throw new Error('Each DVM input must declare a valid type: url, event, job, or text.')
  }

  const value = normalizeInputValue(input.value, type)
  if (!value) {
    throw new Error(`Invalid DVM input for type "${type}".`)
  }

  const relayHint = (type === 'event' || type === 'job')
    ? normalizeRelayUrl(input.relayHint ?? '')
    : null
  if ((type === 'event' || type === 'job') && input.relayHint && !relayHint) {
    throw new Error('Event/job inputs require a valid relay hint when a relay is provided.')
  }

  const role = normalizeInputRole(input.role)

  return {
    value,
    type,
    ...(relayHint ? { relayHint } : {}),
    ...(role ? { role } : {}),
  }
}

function preparePublishOutputs(outputs: string[] | undefined): string[] {
  if (!Array.isArray(outputs)) return []

  const normalized: string[] = []
  const seen = new Set<string>()

  for (const output of outputs) {
    if (typeof output !== 'string' || output.trim().length === 0) continue
    const normalizedOutput = normalizeOutputValue(output)
    if (!normalizedOutput) {
      throw new Error('Each DVM output format must be non-empty plain text.')
    }
    const dedupeKey = normalizedOutput.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    normalized.push(normalizedOutput)
    if (normalized.length >= MAX_DVM_OUTPUTS) break
  }

  return normalized
}

function preparePublishParams(params: DvmJobParam[] | undefined): DvmJobParam[] {
  if (!Array.isArray(params)) return []

  const normalized: DvmJobParam[] = []

  for (const param of params) {
    const rawName = typeof param?.name === 'string' ? param.name : ''
    const rawValue = typeof param?.value === 'string' ? param.value : ''
    if (rawName.trim().length === 0 && rawValue.trim().length === 0) continue

    const name = normalizeParamName(rawName)
    const value = normalizeParamValue(rawValue)
    if (!name || !value) {
      throw new Error('Each DVM param requires a non-empty key and value.')
    }

    normalized.push({ name, value })
    if (normalized.length >= MAX_DVM_PARAMS) break
  }

  return normalized
}

function preparePublishRelayUrls(relayUrls: string[] | undefined): string[] {
  if (!Array.isArray(relayUrls)) return []

  const normalized: string[] = []
  const seen = new Set<string>()

  for (const relayUrl of relayUrls) {
    if (typeof relayUrl !== 'string' || relayUrl.trim().length === 0) continue
    const relay = normalizeRelayUrl(relayUrl)
    if (!relay) {
      throw new Error('DVM response relays must be valid ws:// or wss:// URLs.')
    }
    if (seen.has(relay)) continue
    seen.add(relay)
    normalized.push(relay)
    if (normalized.length >= MAX_DVM_RELAYS) break
  }

  return normalized
}

function preparePublishProviders(providerPubkeys: string[] | undefined): string[] {
  if (!Array.isArray(providerPubkeys)) return []

  const providers: string[] = []
  const seen = new Set<string>()

  for (const providerPubkey of providerPubkeys) {
    if (typeof providerPubkey !== 'string' || providerPubkey.trim().length === 0) continue
    const pubkey = providerPubkey.trim()
    if (!isValidHex32(pubkey)) {
      throw new Error('DVM provider pubkeys must be 32-byte lowercase hex public keys.')
    }
    if (seen.has(pubkey)) continue
    seen.add(pubkey)
    providers.push(pubkey)
    if (providers.length >= MAX_DVM_PROVIDERS) break
  }

  return providers
}

function preparePublishBid(maxBidMsats: number | undefined): number | undefined {
  if (maxBidMsats === undefined) return undefined
  if (!Number.isSafeInteger(maxBidMsats) || maxBidMsats < 0) {
    throw new Error('DVM bids must be a non-negative integer number of millisats.')
  }
  return maxBidMsats
}

function buildEncryptedPrivateTagsPayload(
  inputs: DvmJobInput[],
  params: DvmJobParam[],
): string {
  const tags = [
    ...inputs.map((input) => buildInputTag(input)),
    ...params.map((param) => buildParamTag(param)),
  ]
  return JSON.stringify(tags)
}

function formatMsats(msats: number): string {
  return `${msats.toLocaleString()} msats`
}

export function isDvmJobRequestKind(kind: number): boolean {
  return Number.isInteger(kind) && kind >= DVM_REQUEST_KIND_MIN && kind <= DVM_REQUEST_KIND_MAX
}

export function isDvmJobResultKind(kind: number): boolean {
  return Number.isInteger(kind) && kind >= DVM_RESULT_KIND_MIN && kind <= DVM_RESULT_KIND_MAX
}

export function isDvmJobFeedbackKind(kind: number): boolean {
  return kind === Kind.DvmJobFeedback
}

export function isDvmEventKind(kind: number): boolean {
  return isDvmJobRequestKind(kind) || isDvmJobResultKind(kind) || isDvmJobFeedbackKind(kind)
}

export function getDvmResultKindForRequestKind(kind: number): number | null {
  return isDvmJobRequestKind(kind) ? kind + 1000 : null
}

export function getDvmRequestKindForResultKind(kind: number): number | null {
  return isDvmJobResultKind(kind) ? kind - 1000 : null
}

export function isKnownDvmFeedbackStatus(status: string): status is KnownDvmFeedbackStatus {
  return (DVM_FEEDBACK_STATUSES as readonly string[]).includes(status)
}

export function parseDvmJobRequestEvent(event: NostrEvent): ParsedDvmJobRequest | null {
  if (!isDvmJobRequestKind(event.kind)) return null

  const isEncrypted = hasEncryptedTag(event.tags)
  const hasEncryptedPayload = isEncrypted && event.content.trim().length > 0
  const providers = parseProviderPubkeys(event.tags)
  if (isEncrypted && (providers.length === 0 || !hasEncryptedPayload)) {
    return null
  }

  const maxBidMsats = parseBidTag(event.tags)

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    kind: event.kind,
    requestKind: event.kind,
    inputs: parseInputTags(event.tags),
    outputs: parseOutputTags(event.tags),
    params: parseParamTags(event.tags),
    responseRelays: parseResponseRelays(event.tags),
    providers,
    ...(maxBidMsats !== undefined ? { maxBidMsats } : {}),
    isEncrypted,
    hasEncryptedPayload,
  }
}

export function parseDvmJobResultEvent(event: NostrEvent): ParsedDvmJobResult | null {
  if (!isDvmJobResultKind(event.kind)) return null

  const requestEvent = parseRequestTag(event.tags)
  if (requestEvent && !isDvmJobRequestKind(requestEvent.kind)) return null

  const requestKind = requestEvent?.kind ?? getDvmRequestKindForResultKind(event.kind)
  if (requestKind === null) return null
  if (requestEvent && event.kind !== requestEvent.kind + 1000) return null

  const requestEventId = getEventReferenceId(event.tags) ?? requestEvent?.id
  if (!requestEventId) return null

  const isEncrypted = hasEncryptedTag(event.tags)
  const hasEncryptedPayload = isEncrypted && event.content.trim().length > 0
  const customerPubkey = getCustomerPubkey(event.tags) ?? requestEvent?.pubkey
  if (isEncrypted && (!customerPubkey || !hasEncryptedPayload)) {
    return null
  }

  const amount = parseAmountTag(event.tags)

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    kind: event.kind,
    requestKind,
    requestEventId,
    ...(requestEvent ? { requestEvent } : {}),
    ...(customerPubkey ? { customerPubkey } : {}),
    inputs: parseInputTags(event.tags),
    ...(amount ? { amount } : {}),
    isEncrypted,
    hasEncryptedPayload,
    content: event.content,
  }
}

export function parseDvmJobFeedbackEvent(event: NostrEvent): ParsedDvmJobFeedback | null {
  if (!isDvmJobFeedbackKind(event.kind)) return null

  const status = parseFeedbackStatus(event.tags)
  if (!status) return null

  const requestEvent = parseRequestTag(event.tags)
  if (requestEvent && !isDvmJobRequestKind(requestEvent.kind)) return null

  const requestEventId = getEventReferenceId(event.tags) ?? requestEvent?.id
  if (!requestEventId) return null

  const isEncrypted = hasEncryptedTag(event.tags)
  const hasEncryptedPayload = isEncrypted && event.content.trim().length > 0
  const customerPubkey = getCustomerPubkey(event.tags) ?? requestEvent?.pubkey
  if (isEncrypted && (!customerPubkey || !hasEncryptedPayload)) {
    return null
  }

  const amount = parseAmountTag(event.tags)

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    requestEventId,
    ...(requestEvent ? { requestEvent } : {}),
    ...(customerPubkey ? { customerPubkey } : {}),
    status: status.status,
    ...(status.message ? { statusMessage: status.message } : {}),
    ...(amount ? { amount } : {}),
    isEncrypted,
    hasEncryptedPayload,
    content: event.content,
  }
}

export function parseDvmPrivateTagsPayload(payload: string): ParsedDvmPrivateTagsPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }

  if (!Array.isArray(parsed)) return null

  const rawTags: string[][] = []
  for (const entry of parsed) {
    if (!Array.isArray(entry) || entry.some((value) => typeof value !== 'string')) {
      return null
    }
    const tag = entry as string[]
    if (tag[0] !== 'i' && tag[0] !== 'param') {
      return null
    }
    rawTags.push(tag)
  }

  return {
    rawTags,
    inputs: parseInputTags(rawTags),
    params: parseParamTags(rawTags),
  }
}

export function getDvmEncryptionCounterparty(
  event: NostrEvent,
  viewerPubkey: string | null | undefined,
): string | null {
  if (!viewerPubkey || !isValidHex32(viewerPubkey)) return null

  const peerPubkeys = parseProviderPubkeys(event.tags)
  if (viewerPubkey === event.pubkey) {
    return peerPubkeys.find((pubkey) => pubkey !== viewerPubkey) ?? null
  }

  return peerPubkeys.includes(viewerPubkey) ? event.pubkey : null
}

export function canDecryptDvmEvent(
  event: NostrEvent,
  viewerPubkey: string | null | undefined,
): boolean {
  return hasNip04Support() && getDvmEncryptionCounterparty(event, viewerPubkey) !== null
}

export async function decryptDvmRequestPrivateTags(
  event: NostrEvent,
  viewerPubkey: string | null | undefined,
): Promise<ParsedDvmPrivateTagsPayload> {
  const parsed = parseDvmJobRequestEvent(event)
  if (!parsed?.hasEncryptedPayload) {
    throw new Error('This DVM request does not contain an encrypted private payload.')
  }

  const counterparty = getDvmEncryptionCounterparty(event, viewerPubkey)
  if (!counterparty) {
    throw new Error('The current signer is not a participant in this encrypted DVM request.')
  }

  const plaintext = await decryptNip04(counterparty, event.content)
  const privatePayload = parseDvmPrivateTagsPayload(plaintext)
  if (!privatePayload) {
    throw new Error('Decrypted DVM request payload is not a valid tag array.')
  }

  return privatePayload
}

export async function decryptDvmEncryptedContent(
  event: NostrEvent,
  viewerPubkey: string | null | undefined,
): Promise<string> {
  const counterparty = getDvmEncryptionCounterparty(event, viewerPubkey)
  if (!counterparty) {
    throw new Error('The current signer is not a participant in this encrypted DVM event.')
  }

  return decryptNip04(counterparty, event.content)
}

export function getDvmRequestPreviewText(event: NostrEvent): string {
  const request = parseDvmJobRequestEvent(event)
  if (!request) return `Requested DVM job kind ${event.kind}.`

  const inputLabel = request.hasEncryptedPayload
    ? 'private inputs'
    : `${request.inputs.length} input${request.inputs.length === 1 ? '' : 's'}`
  const outputLabel = request.outputs.length > 0
    ? request.outputs.join(', ')
    : 'unspecified output'
  const bidLabel = request.maxBidMsats !== undefined ? ` up to ${formatMsats(request.maxBidMsats)}` : ''

  return `Requested DVM job kind ${request.requestKind} with ${inputLabel} for ${outputLabel}.${bidLabel}`
}

export function getDvmResultPreviewText(event: NostrEvent): string {
  const result = parseDvmJobResultEvent(event)
  if (!result) return `Published DVM result kind ${event.kind}.`

  const amountLabel = result.amount ? ` Provider requests ${formatMsats(result.amount.msats)}.` : ''
  return `Returned a DVM result for request kind ${result.requestKind}.${amountLabel}`
}

export function getDvmFeedbackPreviewText(event: NostrEvent): string {
  const feedback = parseDvmJobFeedbackEvent(event)
  if (!feedback) return 'Published DVM job feedback.'

  const statusLabel = isKnownDvmFeedbackStatus(feedback.status)
    ? feedback.status.replace(/-/g, ' ')
    : feedback.status
  const amountLabel = feedback.amount ? ` Provider requests ${formatMsats(feedback.amount.msats)}.` : ''
  return `DVM job feedback: ${statusLabel}.${amountLabel}`
}

export async function publishDvmJobRequest({
  requestKind,
  inputs = [],
  outputs = [],
  params = [],
  responseRelays = [],
  providerPubkeys = [],
  maxBidMsats,
  encryptPrivateInputs = false,
  signal,
}: PublishDvmJobRequestOptions): Promise<NostrEvent> {
  if (!isDvmJobRequestKind(requestKind)) {
    throw new Error('DVM request kinds must be in the 5000-5999 range.')
  }

  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install and unlock a NIP-07 extension to publish DVM requests.')
  }

  const normalizedInputs = inputs.slice(0, MAX_DVM_INPUTS).map((input) => preparePublishInput(input))
  const normalizedOutputs = preparePublishOutputs(outputs)
  const normalizedParams = preparePublishParams(params)
  const normalizedRelays = preparePublishRelayUrls(responseRelays)
  const normalizedProviders = preparePublishProviders(providerPubkeys)
  const normalizedBid = preparePublishBid(maxBidMsats)

  let content = ''
  const tags: string[][] = [
    ...normalizedOutputs.map((output) => ['output', output]),
    ...(normalizedRelays.length > 0 ? [['relays', ...normalizedRelays]] : []),
    ...(normalizedBid !== undefined ? [['bid', String(normalizedBid)]] : []),
    ...normalizedProviders.map((pubkey) => ['p', pubkey]),
  ]

  if (encryptPrivateInputs) {
    if (normalizedProviders.length !== 1) {
      throw new Error('Encrypted DVM requests require exactly one target provider pubkey.')
    }
    if (normalizedInputs.length === 0 && normalizedParams.length === 0) {
      throw new Error('Encrypted DVM requests require at least one private input or param.')
    }

    throwIfAborted(signal)
    content = await encryptNip04(
      normalizedProviders[0]!,
      buildEncryptedPrivateTagsPayload(normalizedInputs, normalizedParams),
    )
    tags.push(['encrypted'])
  } else {
    tags.push(
      ...normalizedInputs.map((input) => buildInputTag(input)),
      ...normalizedParams.map((param) => buildParamTag(param)),
    )
  }

  const event = new NDKEvent(ndk)
  event.kind = requestKind
  event.content = content
  event.tags = await withOptionalClientTag(tags, signal)

  throwIfAborted(signal)
  await event.sign()
  throwIfAborted(signal)

  await publishEventWithNip65Outbox(event, signal)

  const rawEvent = event.rawEvent() as unknown as NostrEvent
  await insertEvent(rawEvent)
  return rawEvent
}
