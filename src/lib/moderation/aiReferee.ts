import { generateAssistText } from '@/lib/ai/gemmaAssist'
import { decideModerationAssistProvider } from '@/lib/ai/taskPolicy'
import { normalizeModerationText } from '@/lib/moderation/content'
import type { ModerationDecision, ModerationDocument } from '@/types'

const MAX_REVIEW_DOCUMENTS = 50

type AiModerationVote = {
  action: 'allow' | 'block'
  reason: string
  confidence: number
}

function isAiModerationEnabled(): boolean {
  return import.meta.env.VITE_AI_MODERATION_ENABLED === 'true'
}

function allowsRemoteAiModeration(): boolean {
  return import.meta.env.VITE_AI_MODERATION_ALLOW_REMOTE !== 'false'
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function shouldReviewWithAi(decision: ModerationDecision): boolean {
  if (decision.action !== 'allow') return false

  const { scores } = decision
  return (
    scores.threat >= 0.42
    || scores.identity_hate >= 0.42
    || scores.severe_toxic >= 0.45
    || scores.obscene >= 0.60
    || (scores.toxic >= 0.62 && scores.insult >= 0.52)
  )
}

function buildPrompt(document: ModerationDocument): string {
  return [
    'You are the final tier in a multi-layer content moderation pipeline.',
    'The content below has already passed:',
    '  1. Lexical keyword filters (exact/whole-word term matching)',
    '  2. Semantic similarity filters (embedding-based concept matching)',
    '  3. ML toxicity classifier (scored on threat, identity_hate, severe_toxic, obscene, insult)',
    'It is being reviewed here because the ML scores were borderline — not clearly safe,',
    'not clearly blocked. Apply strict policy and block for any of:',
    '  • identity-hate — slurs or dehumanization targeting race, ethnicity, religion,',
    '    gender identity, or sexual orientation (e.g. racial slurs, "gas the [group]")',
    '  • self-harm-abuse — credible threats of violence, suicide-baiting, or directives',
    '    to self-harm directed at a person (e.g. "kill yourself", "go hang yourself")',
    '  • explicit-sexual — pornographic descriptions, explicit sexual acts, obscene',
    '    content, or sexual solicitation (e.g. graphic sex acts, cam solicitation)',
    '  • exploitative-sexual — any content that sexualizes or endangers minors,',
    '    CSAM indicators, or minor-coded fetish content (e.g. lolicon, jailbait)',
    '  • threat — credible threats of violence against an identifiable person or group',
    '  • severe-harassment — sustained targeted attacks, doxxing, or coordinated abuse',
    'Allow everything else: mild profanity, political speech, satire, adult discussion',
    'without explicit acts, and content that is merely uncomfortable or offensive.',
    'Return JSON only with keys: action, reason, confidence.',
    'action must be "allow" or "block".',
    'reason must be the snake_case category from the list above (e.g. identity_hate,',
    'self_harm_abuse, explicit_sexual, exploitative_sexual, threat, severe_harassment).',
    'confidence must be a number between 0 and 1.',
    '',
    `content_kind: ${document.kind}`,
    `content: ${JSON.stringify(normalizeModerationText(document.text))}`,
  ].join('\n')
}

function parseVote(raw: string): AiModerationVote | null {
  const compact = raw.trim()
  if (!compact) return null

  const match = compact.match(/\{[\s\S]*\}/)
  if (!match) return null

  try {
    const parsed = JSON.parse(match[0]) as {
      action?: unknown
      reason?: unknown
      confidence?: unknown
    }

    if (parsed.action !== 'allow' && parsed.action !== 'block') return null
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().toLowerCase().slice(0, 64) : ''
    if (!reason) return null

    return {
      action: parsed.action,
      reason,
      confidence: clampConfidence(parsed.confidence),
    }
  } catch {
    return null
  }
}

function applyVote(
  decision: ModerationDecision,
  vote: AiModerationVote,
  source: 'gemma' | 'gemini',
): ModerationDecision {
  if (vote.action !== 'block') return decision
  if (vote.confidence < 0.55) return decision

  return {
    ...decision,
    action: 'block',
    reason: `ai_${vote.reason}`,
    model: `${decision.model}+${source}`,
    policyVersion: `${decision.policyVersion}+ai-v1`,
  }
}

export async function refineModerationDecisionsWithAi(
  documents: ModerationDocument[],
  baseDecisions: ModerationDecision[],
  signal?: AbortSignal,
): Promise<ModerationDecision[]> {
  if (!isAiModerationEnabled()) return baseDecisions
  if (documents.length === 0 || baseDecisions.length === 0) return baseDecisions
  if (signal?.aborted) return baseDecisions

  const byId = new Map(baseDecisions.map((decision) => [decision.id, decision]))
  const candidates = documents
    .map((document) => ({
      document,
      decision: byId.get(document.id),
    }))
    .filter((entry): entry is { document: ModerationDocument; decision: ModerationDecision } => (
      entry.decision !== undefined && shouldReviewWithAi(entry.decision)
    ))
    .slice(0, MAX_REVIEW_DOCUMENTS)

  if (candidates.length === 0) return baseDecisions

  const moderationPolicy = decideModerationAssistProvider({
    allowRemote: allowsRemoteAiModeration(),
    candidateCount: candidates.length,
    maxDocumentLength: candidates.reduce((max, entry) => Math.max(max, entry.document.text.length), 0),
  })

  for (const candidate of candidates) {
    if (signal?.aborted) break

    try {
      const options = signal ? { provider: moderationPolicy.provider, signal } : { provider: moderationPolicy.provider }
      const result = await generateAssistText(buildPrompt(candidate.document), options)
      const vote = parseVote(result.text)
      if (!vote) continue

      const current = byId.get(candidate.decision.id)
      if (!current) continue
      byId.set(current.id, applyVote(current, vote, result.source))
    } catch {
      // Fail open: base moderation decision remains authoritative.
    }
  }

  return baseDecisions.map((decision) => byId.get(decision.id) ?? decision)
}
