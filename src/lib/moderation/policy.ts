import type { ModerationDecision, ModerationLabel, ModerationScores } from '@/types'

export const DEFAULT_MODERATION_MODEL_ID = 'minuva/MiniLMv2-toxic-jigsaw-onnx'
export const MODERATION_POLICY_VERSION = 'content-harm-v2'

export interface ModerationThresholds {
  credibleThreat: number
  identityAttack: number
  identityAttackToxic: number
  severeAbuse: number
  highObscene: number
  obsceneAbuse: number
  obsceneAbuseToxicOrInsult: number
  heavyHarassmentToxic: number
  heavyHarassmentInsult: number
}

const DEFAULT_THRESHOLDS: ModerationThresholds = {
  credibleThreat: 0.60,
  identityAttack: 0.60,
  identityAttackToxic: 0.45,
  severeAbuse: 0.62,
  highObscene: 0.88,
  obsceneAbuse: 0.78,
  obsceneAbuseToxicOrInsult: 0.60,
  heavyHarassmentToxic: 0.85,
  heavyHarassmentInsult: 0.75,
}

const KNOWN_LABELS: readonly ModerationLabel[] = [
  'toxic',
  'severe_toxic',
  'obscene',
  'threat',
  'insult',
  'identity_hate',
] as const

const LABEL_ALIASES: Record<string, ModerationLabel> = {
  // Case variations
  'Toxic': 'toxic',
  'TOXIC': 'toxic',
  'Severe_Toxic': 'severe_toxic',
  'SEVERE_TOXIC': 'severe_toxic',
  'Severe Toxic': 'severe_toxic',
  'SEVERE TOXIC': 'severe_toxic',
  'Obscene': 'obscene',
  'OBSCENE': 'obscene',
  'Threat': 'threat',
  'THREAT': 'threat',
  'Insult': 'insult',
  'INSULT': 'insult',
  'Identity_Hate': 'identity_hate',
  'IDENTITY_HATE': 'identity_hate',
  'Identity Hate': 'identity_hate',
  'IDENTITY HATE': 'identity_hate',
  // Common model variations
  'severe-toxic': 'severe_toxic',
  'severe-toxicity': 'severe_toxic',
  'SEVERE-TOXIC': 'severe_toxic',
  'SEVERE-TOXICITY': 'severe_toxic',
  'identity-hate': 'identity_hate',
  'identity-attack': 'identity_hate',
  'IDENTITY-HATE': 'identity_hate',
  'IDENTITY-ATTACK': 'identity_hate',
  'identity_attack': 'identity_hate',
  'IDENTITY_ATTACK': 'identity_hate',
  'hate_speech': 'identity_hate',
  'HATE_SPEECH': 'identity_hate',
} as const

export function emptyModerationScores(): ModerationScores {
  return {
    toxic: 0,
    severe_toxic: 0,
    obscene: 0,
    threat: 0,
    insult: 0,
    identity_hate: 0,
  }
}

function clampScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function readThreshold(name: string, fallback: number): number {
  const raw = import.meta.env[name]
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  if (parsed < 0 || parsed > 1) return fallback
  return parsed
}

export function getModerationThresholds(): ModerationThresholds {
  return {
    credibleThreat: readThreshold('VITE_MODERATION_THRESHOLD_THREAT', DEFAULT_THRESHOLDS.credibleThreat),
    identityAttack: readThreshold('VITE_MODERATION_THRESHOLD_IDENTITY_HATE', DEFAULT_THRESHOLDS.identityAttack),
    identityAttackToxic: readThreshold('VITE_MODERATION_THRESHOLD_IDENTITY_HATE_TOXIC', DEFAULT_THRESHOLDS.identityAttackToxic),
    severeAbuse: readThreshold('VITE_MODERATION_THRESHOLD_SEVERE_TOXIC', DEFAULT_THRESHOLDS.severeAbuse),
    highObscene: readThreshold('VITE_MODERATION_THRESHOLD_HIGH_OBSCENE', DEFAULT_THRESHOLDS.highObscene),
    obsceneAbuse: readThreshold('VITE_MODERATION_THRESHOLD_OBSCENE_ABUSE', DEFAULT_THRESHOLDS.obsceneAbuse),
    obsceneAbuseToxicOrInsult: readThreshold('VITE_MODERATION_THRESHOLD_OBSCENE_ABUSE_SUPPORT', DEFAULT_THRESHOLDS.obsceneAbuseToxicOrInsult),
    heavyHarassmentToxic: readThreshold('VITE_MODERATION_THRESHOLD_HEAVY_HARASSMENT_TOXIC', DEFAULT_THRESHOLDS.heavyHarassmentToxic),
    heavyHarassmentInsult: readThreshold('VITE_MODERATION_THRESHOLD_HEAVY_HARASSMENT_INSULT', DEFAULT_THRESHOLDS.heavyHarassmentInsult),
  }
}

export function getModerationPolicyCacheVersion(): string {
  const modelId = import.meta.env.VITE_MODERATION_MODEL_ID ?? DEFAULT_MODERATION_MODEL_ID
  const thresholds = getModerationThresholds()
  const thresholdSignature = [
    thresholds.credibleThreat,
    thresholds.identityAttack,
    thresholds.identityAttackToxic,
    thresholds.severeAbuse,
    thresholds.highObscene,
    thresholds.obsceneAbuse,
    thresholds.obsceneAbuseToxicOrInsult,
    thresholds.heavyHarassmentToxic,
    thresholds.heavyHarassmentInsult,
  ].join(',')
  return [MODERATION_POLICY_VERSION, modelId, thresholdSignature].join(':')
}

export function normalizeModerationScores(
  scores: ReadonlyArray<{ label: string; score: number }>,
): ModerationScores {
  const normalized = emptyModerationScores()

  for (const entry of scores) {
    const normalizedLabel = LABEL_ALIASES[entry.label] || (KNOWN_LABELS.includes(entry.label as ModerationLabel) ? entry.label as ModerationLabel : null)
    if (normalizedLabel) {
      normalized[normalizedLabel] = clampScore(entry.score)
    }
  }

  return normalized
}

export function evaluateModerationScores(
  id: string,
  scores: ModerationScores,
  model: string,
): ModerationDecision {
  const thresholds = getModerationThresholds()
  // Ordered from highest-confidence signals to lower — first match wins.
  const isCredibleThreat    = scores.threat >= thresholds.credibleThreat
  const isIdentityAttack    = scores.identity_hate >= thresholds.identityAttack && scores.toxic >= thresholds.identityAttackToxic
  const isSevereAbuse       = scores.severe_toxic >= thresholds.severeAbuse
  // Strong standalone obscenity signal (explicit sexual content in text)
  const isHighObscene       = scores.obscene >= thresholds.highObscene
  // Moderate obscenity combined with toxicity or insult
  const isObsceneAbuse      = scores.obscene >= thresholds.obsceneAbuse
    && (scores.toxic >= thresholds.obsceneAbuseToxicOrInsult || scores.insult >= thresholds.obsceneAbuseToxicOrInsult)
  const isHeavyHarassment   = scores.toxic >= thresholds.heavyHarassmentToxic
    && scores.insult >= thresholds.heavyHarassmentInsult

  let reason: string | null = null
  if (isCredibleThreat) {
    reason = 'threat'
  } else if (isIdentityAttack) {
    reason = 'identity_hate'
  } else if (isSevereAbuse) {
    reason = 'severe_toxic'
  } else if (isHighObscene) {
    reason = 'obscene'
  } else if (isObsceneAbuse) {
    reason = 'obscene_abuse'
  } else if (isHeavyHarassment) {
    reason = 'extreme_harassment'
  }

  return {
    id,
    action: reason ? 'block' : 'allow',
    reason,
    scores,
    model,
    policyVersion: MODERATION_POLICY_VERSION,
  }
}

export function shouldSilentlyHideContent(decision: ModerationDecision | null | undefined): boolean {
  return decision?.action === 'block'
}
