import { buildGroundedAnswerPrompt, type GroundedAnswerDocument } from '@/lib/llm/promptPlaybook'
import { eventToSemanticText, profileToSemanticText } from '@/lib/semantic/text'
import type { NostrEvent, Profile } from '@/types'

const MAX_GROUNDED_DOCUMENTS = 6

export function buildSearchGroundingDocuments(
  query: string,
  events: NostrEvent[],
  profiles: Profile[],
  maxDocuments = MAX_GROUNDED_DOCUMENTS,
): GroundedAnswerDocument[] {
  const documents: GroundedAnswerDocument[] = []

  for (const profile of profiles.slice(0, 2)) {
    const content = profileToSemanticText(profile)
    if (!content) continue
    documents.push({
      source: `profile:${profile.pubkey}`,
      content,
    })
    if (documents.length >= maxDocuments) return documents
  }

  for (const event of events) {
    const content = eventToSemanticText(event)
    if (!content) continue
    documents.push({
      source: `event:${event.id}`,
      content,
    })
    if (documents.length >= maxDocuments) return documents
  }

  return documents
}

export function buildSearchGroundedAnswerPrompt(
  query: string,
  events: NostrEvent[],
  profiles: Profile[],
): string | null {
  const documents = buildSearchGroundingDocuments(query, events, profiles)
  if (documents.length === 0) return null
  return buildGroundedAnswerPrompt(query, documents)
}
