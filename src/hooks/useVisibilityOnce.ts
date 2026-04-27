import { useCallback, useEffect, useRef, useState } from 'react'

interface UseVisibilityOnceOptions {
  disabled?: boolean
  rootMargin?: string
  threshold?: number | number[]
}

export function useVisibilityOnce<T extends Element = HTMLElement>({
  disabled = false,
  rootMargin = '320px 0px',
  threshold = 0,
}: UseVisibilityOnceOptions = {}) {
  const [node, setNode] = useState<T | null>(null)
  const [visible, setVisible] = useState(disabled)
  const forcedVisibleRef = useRef(disabled)

  const ref = useCallback((nextNode: T | null) => {
    setNode(nextNode)
  }, [])

  useEffect(() => {
    if (disabled) {
      forcedVisibleRef.current = true
      setVisible(true)
      return
    }

    if (forcedVisibleRef.current) {
      forcedVisibleRef.current = false
      setVisible(false)
    }
  }, [disabled])

  useEffect(() => {
    if (disabled) return
    if (visible) return
    if (!node) return

    if (!('IntersectionObserver' in globalThis)) {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting || entry.intersectionRatio > 0) {
            setVisible(true)
            observer.disconnect()
            break
          }
        }
      },
      { rootMargin, threshold },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [disabled, node, rootMargin, threshold, visible])

  return { ref, visible }
}
