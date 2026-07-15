import { useEffect, useRef } from 'react'
import { migrateImage, renderImageAsset } from '../lib/annotations'
import type { ImageAsset } from '../types'

export function AnnotatedImage({ image, showMasks = true, alt, className }: { image: ImageAsset; showMasks?: boolean; alt: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const source = new Image()
    source.onload = () => {
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return
      renderImageAsset(context, migrateImage(image, source.naturalWidth, source.naturalHeight), source, { showMasks })
    }
    source.src = image.dataUrl
  }, [image, showMasks])

  return <canvas ref={canvasRef} className={className} role="img" aria-label={alt} />
}
