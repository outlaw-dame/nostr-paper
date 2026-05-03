/**
 * Global image lightbox store.
 *
 * Image components call `openImageLightbox(url, alt?)` to open a fullscreen
 * viewer. A single <GlobalImageLightbox /> mounted at the App root subscribes
 * and renders the modal. This avoids passing onClick callbacks through every
 * media component.
 */

export interface ImageLightboxState {
  url: string | null
  alt: string
}

type Listener = (state: ImageLightboxState) => void

let state: ImageLightboxState = { url: null, alt: '' }
const listeners = new Set<Listener>()

export function openImageLightbox(url: string, alt: string = ''): void {
  if (!url) return
  state = { url, alt }
  listeners.forEach((listener) => listener(state))
}

export function closeImageLightbox(): void {
  if (state.url === null) return
  state = { url: null, alt: '' }
  listeners.forEach((listener) => listener(state))
}

export function getImageLightboxState(): ImageLightboxState {
  return state
}

export function subscribeImageLightbox(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
