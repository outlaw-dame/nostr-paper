import type { MediaModerationDecision, MediaModerationScores } from '@/types'

export const DEFAULT_MEDIA_NSFW_MODEL_ID = 'onnx-community/nsfw_image_detection-ONNX'
export const DEFAULT_MEDIA_VIOLENCE_MODEL_ID = 'onnx-community/vit-base-violence-detection-ONNX'
export const MEDIA_MODERATION_POLICY_VERSION = 'media-harm-v2'

export interface MediaModerationThresholds {
  explicitAdultContent: number
  graphicViolence: number
}

const DEFAULT_MEDIA_THRESHOLDS: MediaModerationThresholds = {
  explicitAdultContent: 0.70,
  graphicViolence: 0.75,
}

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

function readThreshold(name: string, fallback: number): number {
  const raw = import.meta.env[name]
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  if (parsed < 0 || parsed > 1) return fallback
  return parsed
}

export function getMediaModerationThresholds(): MediaModerationThresholds {
  return {
    explicitAdultContent: readThreshold('VITE_MEDIA_MODERATION_THRESHOLD_NSFW', DEFAULT_MEDIA_THRESHOLDS.explicitAdultContent),
    graphicViolence: readThreshold('VITE_MEDIA_MODERATION_THRESHOLD_VIOLENCE', DEFAULT_MEDIA_THRESHOLDS.graphicViolence),
  }
}

export function getMediaModerationCacheVersion(): string {
  const nsfwModel = import.meta.env.VITE_MEDIA_MODERATION_NSFW_MODEL_ID ?? DEFAULT_MEDIA_NSFW_MODEL_ID
  const violenceModel = import.meta.env.VITE_MEDIA_MODERATION_VIOLENCE_MODEL_ID ?? DEFAULT_MEDIA_VIOLENCE_MODEL_ID
  const thresholds = getMediaModerationThresholds()
  return [
    MEDIA_MODERATION_POLICY_VERSION,
    nsfwModel,
    violenceModel,
    thresholds.explicitAdultContent,
    thresholds.graphicViolence,
  ].join(':')
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
  const thresholds = getMediaModerationThresholds()
  const isExplicitAdultContent = scores.nsfw >= thresholds.explicitAdultContent
  const isGraphicViolence = scores.violence >= thresholds.graphicViolence

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
