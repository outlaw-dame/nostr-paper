// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteMediaAttachments } from './NoteMediaAttachments'
import type { Nip92MediaAttachment } from '@/types'

let mediaModerationState = {
  blocked: false,
  loading: false,
  decision: null,
  error: null,
}

vi.mock('@/hooks/useMediaModeration', () => ({
  useMediaModerationDocument: () => mediaModerationState,
}))

const imageAttachment: Nip92MediaAttachment = {
  url: 'https://cdn.example.com/photo.jpg',
  mimeType: 'image/jpeg',
  source: 'url',
}

describe('NoteMediaAttachments', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mediaModerationState = {
      blocked: false,
      loading: false,
      decision: null,
      error: null,
    }
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
  })

  it('keeps media from unfollowed authors behind a tap-to-reveal gate', async () => {
    await act(async () => {
      root.render(
        <NoteMediaAttachments
          attachments={[imageAttachment]}
          isUnfollowed
        />,
      )
    })

    expect(container.textContent).toContain("Media from someone you don't follow")
    expect(container.querySelector('img')).toBeNull()

    const revealButton = container.querySelector('[role="button"]')
    expect(revealButton).not.toBeNull()

    await act(async () => {
      revealButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.querySelector('img')?.getAttribute('src')).toBe(imageAttachment.url)
  })

  it('warns instead of dropping media when moderation blocks it', async () => {
    mediaModerationState = {
      blocked: true,
      loading: false,
      decision: null,
      error: null,
    }

    await act(async () => {
      root.render(
        <NoteMediaAttachments attachments={[imageAttachment]} />,
      )
    })

    expect(container.textContent).toContain('Media warning')
    expect(container.querySelector('img')).toBeNull()
  })
})
