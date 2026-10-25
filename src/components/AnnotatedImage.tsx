import { useEffect, useRef, useState } from 'react'
import { migrateImage, renderImageAsset } from '../lib/annotations'
import { downloadCloudImage } from '../sync/controller'
import type { ImageAsset } from '../types'

export function AnnotatedImage({ image, showMasks = true, alt, className }: { image: ImageAsset; showMasks?: boolean; alt: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const missing = image.dataUrl === 'data:image/png;base64,'
  const download = async () => {
    setBusy(true); setNotice('')
    try { await downloadCloudImage(image.id) }
    catch (caught) { setNotice(caught instanceof Error ? caught.message : '原图下载失败，联网后可重试。') }
    finally { setBusy(false) }
  }

  useEffect(() => {
    if (missing) return
    const source = new Image()
    source.onload = () => {
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return
      renderImageAsset(context, migrateImage(image, source.naturalWidth, source.naturalHeight), source, { showMasks })
    }
    source.src = image.dataUrl
    return () => { source.onload = null; source.src = '' }
  }, [image, showMasks, missing])

  if (missing) return <div className="cloud-image-placeholder" role="group" aria-label={alt}><p>原图尚未下载，联网后可查看和继续编辑。</p><button className="button ghost" disabled={busy} onClick={() => void download()}>{busy ? '正在下载…' : '下载原图'}</button>{notice && <p role="status">{notice}</p>}</div>

  return <canvas ref={canvasRef} className={className} role="img" aria-label={alt} />
}
