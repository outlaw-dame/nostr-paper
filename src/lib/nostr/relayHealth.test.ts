import { describe, expect, it } from 'vitest'
import { scoreRelayInfo } from './relayHealth'

describe('relayHealth scoring', () => {
  it('marks relay as restricted when NIP-11 limitations require auth/payment', () => {
    expect(scoreRelayInfo({ limitation: { payment_required: true } })).toMatchObject({
      tier: 'restricted',
      label: 'Restricted',
    })

    expect(scoreRelayInfo({ limitation: { auth_required: true } })).toMatchObject({
      tier: 'restricted',
      label: 'Restricted',
    })
  })

  it('marks relay as caution when core NIP support is missing', () => {
    expect(scoreRelayInfo({ supported_nips: [1] })).toMatchObject({
      tier: 'caution',
      label: 'Limited',
    })
  })

  it('marks relay as healthy when metadata indicates open writes and core support', () => {
    expect(scoreRelayInfo({ supported_nips: [1, 11, 65], limitation: { max_limit: 1000 } })).toMatchObject({
      tier: 'good',
      label: 'Healthy',
    })
  })
})
