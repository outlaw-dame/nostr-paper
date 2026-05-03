import { useEffect, useState } from 'react'

import {
  closeImageLightbox,
  getImageLightboxState,
  subscribeImageLightbox,
  type ImageLightboxState,
} from '@/lib/ui/imageLightbox'

import { ImageLightbox } from './ImageLightbox'

export function GlobalImageLightbox() {
  const [state, setState] = useState<ImageLightboxState>(getImageLightboxState)

  useEffect(() => subscribeImageLightbox(setState), [])

  return (
    <ImageLightbox
      open={state.url !== null}
      imageUrl={state.url}
      alt={state.alt}
      onClose={closeImageLightbox}
    />
  )
}
