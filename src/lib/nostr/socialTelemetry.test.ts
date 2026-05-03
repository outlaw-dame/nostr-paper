import {
  classifySocialPublishFailure,
  getSocialTelemetrySnapshot,
  recordSocialPublishFailure,
  resetSocialTelemetryForTests,
} from './socialTelemetry'

describe('social telemetry', () => {
  beforeEach(() => {
    resetSocialTelemetryForTests()
  })

  it('classifies signer and network publish failures', () => {
    expect(classifySocialPublishFailure(new Error('No signer available'))).toBe('signer')
    expect(classifySocialPublishFailure(new Error('network timeout'))).toBe('network')
    expect(classifySocialPublishFailure(new DOMException('Aborted', 'AbortError'))).toBe('abort')
  })

  it('counts social publish failures by feature and category', () => {
    recordSocialPublishFailure('reaction', 'signer')
    recordSocialPublishFailure('reaction', 'signer')
    recordSocialPublishFailure('zap', 'network')

    expect(getSocialTelemetrySnapshot()).toMatchObject({
      'reaction:signer': 2,
      'zap:network': 1,
    })
  })
})
