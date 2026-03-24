import type { ModerationDecision, ModerationLabel, ModerationScores } from '@/types'

export const DEFAULT_MODERATION_MODEL_ID = 'minuva/MiniLMv2-toxic-jigsaw-onnx'
export const MODERATION_POLICY_VERSION = 'extreme-harm-v1'

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
  const isCredibleThreat = scores.threat >= 0.70
  const isIdentityAttack = scores.identity_hate >= 0.72 && scores.toxic >= 0.60
  const isSevereAbuse = scores.severe_toxic >= 0.80
  const isExtremeObsceneAbuse = scores.obscene >= 0.98 && scores.toxic >= 0.95 && scores.insult >= 0.90
  const isExtremeHarassment = scores.toxic >= 0.97 && scores.insult >= 0.95

  let reason: string | null = null
  if (isCredibleThreat) {
    reason = 'threat'
  } else if (isIdentityAttack) {
    reason = 'identity_hate'
  } else if (isSevereAbuse) {
    reason = 'severe_toxic'
  } else if (isExtremeObsceneAbuse) {
    reason = 'obscene_abuse'
  } else if (isExtremeHarassment) {
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
