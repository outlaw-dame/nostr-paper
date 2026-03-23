import {
  decodeAddressReference,
  decodeEventReference,
  decodeProfileReference,
} from '@/lib/nostr/nip21'

export type EntityCandidate =
  | {
    key: string
    type: 'url'
    order: number
    url: string
    label: string
  }
  | {
    key: string
    type: 'profile'
    order: number
    reference: string
    pubkey: string
  }
  | {
    key: string
    type: 'event'
    order: number
    reference: string
    eventId: string
  }
  | {
    key: string
    type: 'address'
    order: number
    reference: string
    pubkey: string
    kind: number
    identifier: string
  }

type EntityToken =
  | { type: 'url'; value: string }
  | { type: 'nostr'; value: string }

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function collectEntityCandidates(tokens: EntityToken[]): EntityCandidate[] {
  const seen = new Set<string>()
  const candidates: EntityCandidate[] = []

  for (const [order, token] of tokens.entries()) {
    if (token.type === 'url') {
      const key = `url:${token.value}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({
        key,
        type: 'url',
        order,
        url: token.value,
        label: hostnameFromUrl(token.value),
      })
      continue
    }

    const profile = decodeProfileReference(token.value)
    if (profile) {
      const key = `profile:${profile.pubkey}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({
        key,
        type: 'profile',
        order,
        reference: token.value,
        pubkey: profile.pubkey,
      })
      continue
    }

    const event = decodeEventReference(token.value)
    if (event) {
      const key = `event:${event.eventId}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({
        key,
        type: 'event',
        order,
        reference: token.value,
        eventId: event.eventId,
      })
      continue
    }

    const address = decodeAddressReference(token.value)
    if (!address) continue

    const key = `address:${address.kind}:${address.pubkey}:${address.identifier}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({
      key,
      type: 'address',
      order,
      reference: token.value,
      pubkey: address.pubkey,
      kind: address.kind,
      identifier: address.identifier,
    })
  }

  return candidates
}

function getPrimaryRank(candidate: EntityCandidate): number {
  switch (candidate.type) {
    case 'url':
      return 0
    case 'event':
    case 'address':
      return 1
    case 'profile':
      return 2
  }
}

export function rankPrimaryCandidates(candidates: EntityCandidate[]): EntityCandidate[] {
  return [...candidates].sort((left, right) => {
    const rankDifference = getPrimaryRank(left) - getPrimaryRank(right)
    if (rankDifference !== 0) return rankDifference
    return left.order - right.order
  })
}

export function shouldShowSourceRail(candidates: EntityCandidate[]): boolean {
  return candidates.length > 1 || candidates.some((candidate) => candidate.type === 'url')
}
