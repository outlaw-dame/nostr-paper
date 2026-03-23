import type { MediaModerationDecision, MediaModerationScores } from '@/types'

export const DEFAULT_MEDIA_NSFW_MODEL_ID = 'onnx-community/nsfw_image_detection-ONNX'
export const DEFAULT_MEDIA_VIOLENCE_MODEL_ID = 'onnx-community/vit-base-violence-detection-ONNX'
export const MEDIA_MODERATION_POLICY_VERSION = 'extreme-media-harm-v1'

export function emptyMediaModerationScores(): MediaModerationScores {
  return {
    nsfw: 0,
    violence: 0,
  }
}

function clampScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function normalizeNsfwScores(
  scores: ReadonlyArray<{ label: string; score: number }>,
): MediaModerationScores {
  const normalized = emptyMediaModerationScores()

  for (const entry of scores) {
    const label = normalizeLabel(entry.label)
    const score = clampScore(entry.score)

    if (['nsfw', 'porn', 'hentai', 'sexy', 'explicit'].includes(label)) {
      normalized.nsfw = Math.max(normalized.nsfw, score)
    }
  }

  return normalized
}

export function normalizeViolenceScores(
  scores: ReadonlyArray<{ label: string; score: number }>,
): MediaModerationScores {
  const normalized = emptyMediaModerationScores()

  for (const entry of scores) {
    const label = normalizeLabel(entry.label)
    const score = clampScore(entry.score)

    if (
      (label.includes('violence') || label.includes('violent') || label.includes('gore'))
      && !label.startsWith('non_')
      && !label.startsWith('not_')
    ) {
      normalized.violence = Math.max(normalized.violence, score)
    }
  }

  return normalized
}

export function mergeMediaModerationScores(
  nsfwScores: MediaModerationScores,
  violenceScores: MediaModerationScores,
): MediaModerationScores {
  return {
    nsfw: Math.max(nsfwScores.nsfw, violenceScores.nsfw),
    violence: Math.max(nsfwScores.violence, violenceScores.violence),
  }
}

export function evaluateMediaModerationScores(
  id: string,
  scores: MediaModerationScores,
  models: { nsfwModel: string | null; violenceModel: string | null },
): MediaModerationDecision {
  const isExplicitAdultContent = scores.nsfw >= 0.96
  const isGraphicViolence = scores.violence >= 0.97

  let reason: MediaModerationDecision['reason'] = null
  if (isExplicitAdultContent) {
    reason = 'nsfw'
  } else if (isGraphicViolence) {
    reason = 'violence'
  }

  return {
    id,
    action: reason ? 'block' : 'allow',
    reason,
    scores,
    nsfwModel: models.nsfwModel,
    violenceModel: models.violenceModel,
    policyVersion: MEDIA_MODERATION_POLICY_VERSION,
  }
}

export function shouldSilentlyHideMedia(decision: MediaModerationDecision | null | undefined): boolean {
  return decision?.action === 'block'
}
