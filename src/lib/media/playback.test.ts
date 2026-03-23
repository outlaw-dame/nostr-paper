import { describe, expect, it } from 'vitest'
import {
  buildAttachmentPlaybackPlan,
  getMediaPlaybackProfile,
  rankVideoPlaybackCandidates,
} from './playback'

describe('getMediaPlaybackProfile', () => {
  it('classifies open, compatibility, and streaming profiles', () => {
    expect(getMediaPlaybackProfile('video/webm; codecs="vp9,opus"', 'https://cdn.example.com/video.webm')).toBe('open')
    expect(getMediaPlaybackProfile('video/mp4; codecs="avc1.42E01E,mp4a.40.2"', 'https://cdn.example.com/video.mp4')).toBe('compatibility')
    expect(getMediaPlaybackProfile('application/vnd.apple.mpegurl', 'https://cdn.example.com/master.m3u8')).toBe('streaming')
  })
})

describe('rankVideoPlaybackCandidates', () => {
  it('prefers a supported open profile before a compatibility fallback', () => {
    const ranked = rankVideoPlaybackCandidates(
      [
        {
          url: 'https://cdn.example.com/fallback.mp4',
          mimeType: 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
          dim: '1920x1080',
          bitrate: 2_400_000,
        },
        {
          url: 'https://cdn.example.com/open.webm',
          mimeType: 'video/webm; codecs="vp9,opus"',
          dim: '1280x720',
          bitrate: 1_200_000,
        },
      ],
      (_kind, type) => {
        if (type.includes('webm')) return 'probably'
        if (type.includes('mp4')) return 'probably'
        return ''
      },
    )

    expect(ranked[0]?.candidate.url).toBe('https://cdn.example.com/open.webm')
    expect(ranked[0]?.profile).toBe('open')
    expect(ranked[1]?.candidate.url).toBe('https://cdn.example.com/fallback.mp4')
  })

  it('falls back to the compatibility profile when the open profile is unsupported', () => {
    const ranked = rankVideoPlaybackCandidates(
      [
        {
          url: 'https://cdn.example.com/open.webm',
          mimeType: 'video/webm; codecs="vp9,opus"',
          dim: '1920x1080',
        },
        {
          url: 'https://cdn.example.com/fallback.mp4',
          mimeType: 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
          dim: '1280x720',
        },
      ],
      (_kind, type) => {
        if (type.includes('webm')) return ''
        if (type.includes('mp4')) return 'probably'
        return ''
      },
    )

    expect(ranked[0]?.candidate.url).toBe('https://cdn.example.com/fallback.mp4')
    expect(ranked[0]?.profile).toBe('compatibility')
    expect(ranked[1]?.playability).toBe('unsupported')
  })
})

describe('buildAttachmentPlaybackPlan', () => {
  it('infers playback types from URLs and preserves ordered fallback sources', () => {
    const plan = buildAttachmentPlaybackPlan(
      {
        url: 'https://cdn.example.com/track.m4a',
        fallbacks: [
          'https://mirror.example.com/track.m4a',
          'https://mirror.example.com/track.m4a',
        ],
      },
      'audio',
      (_kind, type) => (type.includes('audio/mp4') ? 'probably' : ''),
    )

    expect(plan.profile).toBe('compatibility')
    expect(plan.playability).toBe('probably')
    expect(plan.sources).toEqual([
      { url: 'https://cdn.example.com/track.m4a', type: 'audio/mp4' },
      { url: 'https://mirror.example.com/track.m4a', type: 'audio/mp4' },
    ])
  })

  it('promotes a playable fallback source ahead of an unsupported primary source', () => {
    const plan = buildAttachmentPlaybackPlan(
      {
        url: 'https://cdn.example.com/blob',
        mimeType: 'video/quicktime',
        fallbacks: ['https://mirror.example.com/video.mp4'],
      },
      'video',
      (_kind, type) => {
        if (type.includes('mp4')) return 'probably'
        if (type.includes('quicktime')) return ''
        return ''
      },
    )

    expect(plan.playability).toBe('probably')
    expect(plan.profile).toBe('compatibility')
    expect(plan.sources[0]).toEqual({
      url: 'https://mirror.example.com/video.mp4',
      type: 'video/mp4',
    })
  })
})
