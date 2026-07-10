import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

// Underskrift på skærm (spec §handover). Fast hvid baggrund og mørk streg,
// så PNG'en er læsbar uanset app-tema — den er chain-of-custody-bevis.

export function SignaturePad({
  canvasRef,
  onChange,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  onChange: (hasInk: boolean) => void
}) {
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)
  const { t } = useTranslation()

  useEffect(() => {
    const canvas = canvasRef.current!
    const scale = window.devicePixelRatio || 1
    canvas.width = canvas.offsetWidth * scale
    canvas.height = canvas.offsetHeight * scale
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
    ctx.strokeStyle = '#1a1a2e'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])

  const point = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: React.PointerEvent) => {
    drawing.current = true
    canvasRef.current!.setPointerCapture(e.pointerId)
    const ctx = canvasRef.current!.getContext('2d')!
    const p = point(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    const p = point(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    if (!hasInk) {
      setHasInk(true)
      onChange(true)
    }
  }

  const end = () => {
    drawing.current = false
  }

  const clear = () => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
    setHasInk(false)
    onChange(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        className="h-32 w-full touch-none rounded-md border bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div>
        <Button type="button" variant="outline" size="sm" onClick={clear} disabled={!hasInk}>
          {t('handout.clearSignature')}
        </Button>
      </div>
    </div>
  )
}

export function signatureBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}
