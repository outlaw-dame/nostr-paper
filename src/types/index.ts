/**
 * Nostr Paper — Core Type Definitions
 *
 * Strongly typed interfaces for all Nostr protocol data structures,
 * DB records, app state, and API contracts.
 */

// ── Nostr Protocol Types ─────────────────────────────────────

/** NIP-01 canonical event */
export interface NostrEvent {
  id: string         // 32-byte lowercase hex of the serialized event SHA256
  pubkey: string     // 32-byte lowercase hex of the author's public key
  created_at: number // Unix timestamp in seconds
  kind: number       // Event kind
  tags: string[][]   // Ordered list of tags
  content: string    // Arbitrary string content
  sig: string        // 64-byte lowercase hex signature of the id field
}

/** Unsigned event (before signing) */
export type UnsignedEvent = Omit<NostrEvent, 'id' | 'sig'>

/** NIP-01 subscription filter */
export interface NostrFilter {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  until?: number
  limit?: number
  search?: string   // NIP-50
  [key: `#${string}`]: string[] | undefined
}

/** NIP-01 relay message types */
export type RelayMessage =
  | ['EVENT', string, NostrEvent]
  | ['EOSE', string]
  | ['NOTICE', string]
  | ['CLOSED', string, string]
  | ['OK', string, boolean, string]
  | ['AUTH', string]
  | ['COUNT', string, { count: number; approximate?: boolean }]

/** NIP-11 relay information document */
export interface RelayInfo {
  name?: string
  description?: string
  pubkey?: string
  contact?: string
  supported_nips?: number[]
  software?: string
  version?: string
  limitation?: {
    max_message_length?: number
    max_subscriptions?: number
    max_filters?: number
    max_limit?: number
    max_subid_length?: number
    min_prefix?: number
    max_event_tags?: number
    max_content_length?: number
    min_pow_difficulty?: number
    auth_required?: boolean
    payment_required?: boolean
    restricted_writes?: boolean
    created_at_lower_limit?: number
    created_at_upper_limit?: number
  }
  fees?: {
    admission?: Array<{ amount: number; unit: string }>
    subscription?: Array<{ amount: number; unit: string; period: number }>
    publication?: Array<{ kinds: number[]; amount: number; unit: string }>
  }
  icon?: string
  banner?: string
}

// ── NIP Kind Constants ───────────────────────────────────────

export const Kind = {
  Metadata:          0,
  ShortNote:         1,
  RecommendRelay:    2,
  Contacts:          3,
  EncryptedDm:       4,
  EventDeletion:     5,
  Repost:            6,
  Reaction:          7,
  BadgeAward:        8,
  Thread:            11,
  DvmJobFeedback:    7000,
  MuteList:          10000,
  PinnedNotes:       10001,
  Bookmarks:         10003,
  CommunitiesList:   10004,
  PublicChatsList:   10005,
  BlockedRelays:     10006,
  SearchRelays:      10007,
  SimpleGroupsList:  10009,
  RelayFeeds:        10012,
  InterestsList:     10015,
  MediaFollows:      10020,
  EmojisList:        10030,
  DmRelays:          10050,
  GoodWikiAuthors:   10101,
  GoodWikiRelays:    10102,
  PollVote:          1018,
  Poll:              1068,
  Comment:           1111,
  Video:             21,
  ShortVideo:        22,
  GenericRepost:     16,
  ChannelCreation:   40,
  ChannelMetadata:   41,
  ChannelMessage:    42,
  LongFormContent:   30023,
  LongFormDraft:     30024,
  UserStatus:        30315,
  LiveActivity:      30311,
  MeetingSpace:      30312,
  MeetingRoom:       30313,
  MeetingRoomPresence: 10312,
  AddressableVideo:  34235,
  AddressableShortVideo: 34236,
  FollowSet:         30000,
  RelaySet:          30002,
  BookmarkSet:       30003,
  ArticleCurationSet: 30004,
  VideoCurationSet:  30005,
  PictureCurationSet: 30006,
  KindMuteSet:       30007,
  InterestSet:       30015,
  EmojiSet:          30030,
  ReleaseArtifactSet: 30063,
  AppCurationSet:    30267,
  SoftwareApplication: 32267,
  CalendarSet:       31924,
  StarterPack:       39089,
  MediaStarterPack:  39092,
  ProfileBadges:     30008,
  BadgeDefinition:   30009,
  RelayList:         10002,
  Highlight:         9802,  // NIP-84 Highlights
  ZapRequest:        9734,
  Zap:               9735,
  NWCInfo:           13194,
  NWCRequest:        23194,
  NWCResponse:       23195,
  NostrConnect:      24133,
  HandlerRecommendation: 31989,
  HandlerInformation: 31990,
  Report:            1984,
  Label:             1985,
  // Blossom / media
  HttpAuth:          27235,  // NIP-98 HTTP Auth
  FileMetadata:      1063,   // NIP-94 File Metadata
  FileServerPreference: 10096, // NIP-96 preferred file servers
  BlossomServerList: 10063,  // BUD-03 User Server List
} as const

export type KindValue = typeof Kind[keyof typeof Kind]

// ── Profile Types ────────────────────────────────────────────

/** NIP-39 external identity claimed in kind-0 event i tags */
export interface Nip39ExternalIdentity {
  platform: string   // 'github', 'twitter', 'mastodon', 'telegram', etc.
  identity: string   // platform-specific handle or identifier
  proof?: string     // URL linking to the claim verification
}

/** NIP-01 / NIP-24 profile metadata (kind 0 content) */
export interface ProfileBirthday {
  year?: number
  month?: number
  day?: number
}

export interface ProfileMetadata {
  name?: string
  display_name?: string
  picture?: string
  banner?: string
  about?: string
  website?: string
  bot?: boolean
  birthday?: ProfileBirthday
  lud06?: string  // LNURL
  lud16?: string  // Lightning address
  nip05?: string  // NIP-05 identifier
}

/** Denormalized profile record stored in DB */
export interface Profile extends ProfileMetadata {
  pubkey: string
  eventId?: string
  updatedAt: number
  nip05Verified?: boolean
  nip05VerifiedAt?: number
  followerCount?: number
  followingCount?: number
  externalIdentities?: Nip39ExternalIdentity[]
}

// ── Relay Types ──────────────────────────────────────────────

export type RelayReadWrite = 'read' | 'write' | 'read-write'

export interface RelayConfig {
  url: string
  read: boolean
  write: boolean
  info?: RelayInfo
  connected?: boolean
  latencyMs?: number
  lastConnected?: number
  failCount?: number
  nextRetryAt?: number
}

// ── DB Record Types ──────────────────────────────────────────

export interface DBEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  content: string
  sig: string
  raw: string  // Full JSON serialization
}

export interface DBTag {
  event_id: string
  name: string
  value: string
  idx: number
}

export interface DBProfile {
  pubkey: string
  event_id: string | null
  name: string | null
  display_name: string | null
  picture: string | null
  banner: string | null
  about: string | null
  website: string | null
  nip05: string | null
  nip05_domain: string | null
  nip05_verified: number
  nip05_verified_at: number | null
  nip05_last_checked_at: number | null
  lud06: string | null
  lud16: string | null
  bot: number
  birthday_json: string | null
  external_identities: string | null
  updated_at: number
  raw: string
}

export interface DBFollow {
  follower: string
  followee: string
  relay_url: string | null
  petname: string | null
  position: number
  updated_at: number
}

export interface DBContactList {
  pubkey: string
  event_id: string
  updated_at: number
}

export interface ContactListEntry {
  pubkey: string
  position: number
  relayUrl?: string
  petname?: string
}

export interface ContactList {
  pubkey: string
  entries: ContactListEntry[]
  eventId?: string
  updatedAt?: number
}

export interface ReactionAggregate {
  key: string
  label: string
  count: number
  type: 'like' | 'dislike' | 'emoji' | 'custom-emoji' | 'other'
  emojiUrl?: string
}

export interface EventEngagementSummary {
  replyCount: number
  repostCount: number
  reactionCount: number
  likeCount: number
  dislikeCount: number
  emojiReactions: ReactionAggregate[]
  zapCount: number
  zapTotalMsats: number
  currentUserHasReposted: boolean
  currentUserHasLiked: boolean
  currentUserHasDisliked: boolean
}

export interface DBRelayList {
  pubkey: string
  url: string
  read: number  // SQLite uses 0/1 for boolean
  write: number
}

// ── App State Types ──────────────────────────────────────────

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'

export interface AppError {
  code: ErrorCodeValue
  message: string
  context?: Record<string, unknown>
  timestamp: number
  recoverable: boolean
}

export const ErrorCode = {
  // DB errors
  DB_INIT_FAILED:       'DB_INIT_FAILED',
  DB_QUERY_FAILED:      'DB_QUERY_FAILED',
  DB_WRITE_FAILED:      'DB_WRITE_FAILED',
  DB_MIGRATION_FAILED:  'DB_MIGRATION_FAILED',
  DB_STORAGE_FULL:      'DB_STORAGE_FULL',
  // Relay errors
  RELAY_CONNECT_FAILED: 'RELAY_CONNECT_FAILED',
  RELAY_AUTH_FAILED:    'RELAY_AUTH_FAILED',
  RELAY_RATE_LIMITED:   'RELAY_RATE_LIMITED',
  RELAY_INVALID_MESSAGE:'RELAY_INVALID_MESSAGE',
  // Crypto errors
  SIGNING_FAILED:       'SIGNING_FAILED',
  SIGNING_REJECTED:     'SIGNING_REJECTED',
  INVALID_KEY:          'INVALID_KEY',
  DECRYPTION_FAILED:    'DECRYPTION_FAILED',
  // Validation errors
  INVALID_EVENT:        'INVALID_EVENT',
  INVALID_SIGNATURE:    'INVALID_SIGNATURE',
  INVALID_PUBKEY:       'INVALID_PUBKEY',
  // Network errors
  NETWORK_OFFLINE:      'NETWORK_OFFLINE',
  REQUEST_TIMEOUT:      'REQUEST_TIMEOUT',
  NIP05_VERIFY_FAILED:  'NIP05_VERIFY_FAILED',
  // Permission errors
  PERMISSION_DENIED:    'PERMISSION_DENIED',
  STORAGE_DENIED:       'STORAGE_DENIED',
  NOTIFICATION_DENIED:  'NOTIFICATION_DENIED',
} as const

export type ErrorCodeValue = typeof ErrorCode[keyof typeof ErrorCode]

// ── Section / Feed Types ─────────────────────────────────────

export interface FeedSection {
  id: string
  label: string
  emoji?: string
  filter: NostrFilter
  pinned?: boolean
}

export type FeedLayout = 'paper' | 'list' | 'grid'

// ── Compose Types ────────────────────────────────────────────

export interface DraftNote {
  content: string
  replyTo?: string     // event id
  replyToPubkey?: string
  media?: DraftMedia[]
  createdAt: number
}

export interface DraftMedia {
  url: string
  type: 'image' | 'video' | 'gif'
  width?: number
  height?: number
  blurhash?: string
}

/** Parsed NIP-92 inline media metadata attached to an event */
export interface Nip92MediaAttachment {
  url: string
  mimeType?: string
  fileHash?: string
  originalHash?: string
  size?: number
  dim?: string
  magnet?: string
  torrentInfoHash?: string
  blurhash?: string
  thumb?: string
  image?: string
  imageFallbacks?: string[]
  summary?: string
  alt?: string
  fallbacks?: string[]
  service?: string
  durationSeconds?: number
  bitrate?: number
  source: 'imeta' | 'url'
}

// ── Blossom Types (BUD-01/02/03) ─────────────────────────────

/**
 * BUD-01 blob descriptor returned by Blossom servers.
 * SHA-256 is hex-encoded.
 */
export interface BlossomBlob {
  url:       string
  sha256:    string
  size:      number
  type:      string        // MIME type
  uploaded?: number        // Unix timestamp (seconds)
  nip94?:    Nip94Tags     // Extended NIP-94 metadata if provided
  metadataEventId?: string // Published kind-1063 event id, if available
}

/** NIP-94 file metadata tags (from kind 1063 event body) */
export interface Nip94Tags {
  url:           string
  mimeType:      string
  fileHash:      string    // sha256 of file
  originalHash?: string    // sha256 before compression
  size?:         number
  dim?:          string    // e.g. "1920x1080"
  magnet?:       string
  torrentInfoHash?: string
  blurhash?:     string
  thumb?:        string    // thumbnail URL
  thumbHash?:    string    // Non-standard upload-server extension; never published in NIP-94 tags
  image?:        string    // preview image URL
  imageHash?:    string    // Non-standard upload-server extension; never published in NIP-94 tags
  summary?:      string
  alt?:          string
  fallbacks?:    string[]
  service?:      string
}

/** Parsed kind-1063 event plus its NIP-94 metadata */
export interface Nip94FileMetadata {
  id:            string
  pubkey:        string
  createdAt:     number
  description:   string
  metadata:      Nip94Tags
}

/** User-configured Blossom media server */
export interface BlossomServer {
  url:     string
  priority: number         // 0 = highest priority
  addedAt: number          // Unix timestamp (seconds)
}

/** DB record for a Blossom server */
export interface DBBlossomServer {
  url:      string
  priority: number
  added_at: number
}

/** DB record for a cached blob */
export interface DBBlossomBlob {
  sha256:      string
  url:         string
  mime_type:   string
  size:        number
  uploaded_at: number
  servers:     string      // JSON-encoded string[]
  nip94_json:  string | null
  metadata_event_id: string | null
}

/** Upload state machine */
export interface BlossomUploadDiagnostic {
  server: string
  transport: 'blossom' | 'nip96'
  success: boolean
  message?: string
}

export type BlossomUploadState =
  | { status: 'idle' }
  | { status: 'hashing' }
  | {
      status: 'uploading'
      server: string
      serverIndex: number
      serverCount: number
      diagnostics?: BlossomUploadDiagnostic[]
    }
  | { status: 'publishing' }
  | {
      status: 'done'
      blob: BlossomBlob
      successfulServers: string[]
      warning?: string
      diagnostics?: BlossomUploadDiagnostic[]
    }
  | { status: 'error'; error: string; diagnostics?: BlossomUploadDiagnostic[] }

// ── Zap Types (NIP-57) ───────────────────────────────────────

/** Parsed kind-9735 Zap Receipt event */
export interface ParsedZapReceipt {
  /** Zap receipt event id */
  id: string
  /** LNURL server pubkey (signer of the receipt) */
  pubkey: string
  createdAt: number
  /** Recipient's pubkey (from 'p' tag) */
  recipientPubkey: string
  /** The event that was zapped, or null for profile zaps */
  targetEventId: string | null
  /** Sender's pubkey (extracted from embedded zap request) */
  senderPubkey: string | null
  /** Amount in millisatoshis (from embedded zap request's 'amount' tag) */
  amountMsats: number | null
  /** Optional comment from the sender */
  comment: string | null
  /** The bolt11 invoice that was paid */
  bolt11: string | null
}

// ── Worker Message Protocol ──────────────────────────────────

export type DBWorkerRequest =
  | { id: number; type: 'init' }
  | { id: number; type: 'exec';        payload: { sql: string; bind?: unknown[] } }
  | { id: number; type: 'run';         payload: { sql: string; bind?: unknown[] } }
  | { id: number; type: 'transaction'; payload: Array<{ sql: string; bind?: unknown[] }> }
  | { id: number; type: 'close' }

export type DBWorkerResponse =
  | { id: number; result: unknown }
  | { id: number; error: string }

export interface SemanticDocument {
  id: string
  kind: 'event' | 'profile'
  text: string
  updatedAt: number
}

export interface SemanticMatch {
  id: string
  score: number
}

export interface TopicAssignment {
  id: string
  topicId: string
  keywords: string[]
}

export type SemanticWorkerRequest =
  | { id: number; type: 'init' }
  | {
      id: number
      type: 'rank'
      payload: {
        query: string
        documents: SemanticDocument[]
        limit: number
      }
    }
  | {
      id: number
      type: 'cluster'
      payload: {
        documents: SemanticDocument[]
      }
    }
  | { id: number; type: 'close' }

export type SemanticWorkerResponse =
  | {
      id: number
      result: {
        matches?: SemanticMatch[]
        topics?: TopicAssignment[]
        model?: string
      }
    }
  | { id: number; error: string }

export type ModerationLabel =
  | 'toxic'
  | 'severe_toxic'
  | 'obscene'
  | 'threat'
  | 'insult'
  | 'identity_hate'

export interface ModerationScores {
  toxic: number
  severe_toxic: number
  obscene: number
  threat: number
  insult: number
  identity_hate: number
}

export interface ModerationDocument {
  id: string
  kind: 'event' | 'profile' | 'syndication-entry'
  text: string
  updatedAt: number
}

export interface ModerationDecision {
  id: string
  action: 'allow' | 'block'
  reason: string | null
  scores: ModerationScores
  model: string
  policyVersion: string
}

export type ModerationWorkerRequest =
  | { id: number; type: 'init' }
  | {
      id: number
      type: 'moderate'
      payload: {
        documents: ModerationDocument[]
      }
    }
  | { id: number; type: 'close' }

export type ModerationWorkerResponse =
  | {
      id: number
      result: {
        decisions?: ModerationDecision[]
        model?: string
      }
    }
  | { id: number; error: string }

export type MediaModerationKind =
  | 'image'
  | 'video_preview'
  | 'profile_avatar'
  | 'profile_banner'
  | 'article_image'

export interface MediaModerationScores {
  nsfw: number
  violence: number
}

export interface MediaModerationDocument {
  id: string
  kind: MediaModerationKind
  url: string
  updatedAt: number
}

export interface MediaModerationDecision {
  id: string
  action: 'allow' | 'block'
  reason: 'nsfw' | 'violence' | null
  scores: MediaModerationScores
  nsfwModel: string | null
  violenceModel: string | null
  policyVersion: string
  /**
   * True when the image URL could not be resolved to a classifiable input
   * (e.g. no media proxy configured for cross-origin URLs). The decision
   * defaults to 'allow' (fail-open), but callers can surface a "not checked"
   * indicator rather than silently treating it as a clean pass.
   */
  skipped?: boolean
}

export type MediaModerationWorkerRequest =
  | { id: number; type: 'init' }
  | {
      id: number
      type: 'moderate'
      payload: {
        documents: MediaModerationDocument[]
      }
    }
  | { id: number; type: 'close' }

export type MediaModerationWorkerResponse =
  | {
      id: number
      result: {
        decisions?: MediaModerationDecision[]
      }
    }
  | { id: number; error: string }

// ── Gemma Worker Types ────────────────────────────────────────

export type GemmaModel = 'E2B' | 'E4B'

export interface GemmaInitPayload {
  /** Absolute URL or path to the .task model file */
  modelPath: string
  /** URL to the @mediapipe/tasks-genai WASM directory */
  wasmPath?: string
  maxTokens?: number
  temperature?: number
  topK?: number
}

export type GemmaWorkerRequest =
  | { id: number; type: 'init'; payload: GemmaInitPayload }
  | { id: number; type: 'generate'; payload: { prompt: string } }
  | { id: number; type: 'close' }

export type GemmaWorkerResponse =
  | { id: number; type: 'init_ok' }
  | { id: number; type: 'token'; partial: string }
  | { id: number; type: 'done'; fullText: string }
  | { id: number; type: 'error'; error: string }

// ── Utility Types ────────────────────────────────────────────

export type Prettify<T> = { [K in keyof T]: T[K] } & {}

export type MaybePromise<T> = T | Promise<T>

export type Result<T, E = AppError> =
  | { ok: true;  value: T }
  | { ok: false; error: E }

/** Type-safe hex string */
export type HexString = string & { readonly __brand: 'HexString' }

/** Type-safe websocket URL */
export type RelayURL = string & { readonly __brand: 'RelayURL' }
