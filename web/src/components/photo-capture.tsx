import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Camera, ImagePlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Foto-optagelse: upload en fil eller tag et billede med webcam'et, med
// forhåndsvisning og fjern-knap. Delt af Modtag-formularen (tilstandsfoto ved
// intake) og Tilstand-siden (dokumentation af eksisterende pakker).
export function PhotoCapture({
  photo,
  onPhoto,
}: {
  photo: Blob | null
  onPhoto: (blob: Blob | null) => void
}) {
  const { t } = useTranslation()
  const [camOpen, setCamOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!photo) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(photo)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  const stopCam = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCamOpen(false)
  }

  useEffect(() => stopCam, [])

  const startCam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      setCamOpen(true)
      // videoRef findes først efter render
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream
      })
    } catch (error) {
      console.error('Webcam kunne ikke startes:', error)
      toast.error(t('receive.cameraError'))
    }
  }

  const capture = () => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (blob) onPhoto(blob)
        stopCam()
      },
      'image/jpeg',
      0.85,
    )
  }

  if (previewUrl) {
    return (
      <div className="flex items-start gap-3">
        <img src={previewUrl} alt="" className="h-24 rounded-md border object-cover" />
        <Button type="button" variant="ghost" size="sm" onClick={() => onPhoto(null)}>
          <X className="size-4" /> {t('receive.removePhoto')}
        </Button>
      </div>
    )
  }

  if (camOpen) {
    return (
      <div className="flex flex-col items-start gap-2">
        <video ref={videoRef} autoPlay playsInline className="h-40 rounded-md border" />
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={capture}>
            {t('receive.takePhoto')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={stopCam}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
        <ImagePlus className="size-4" /> {t('receive.uploadPhoto')}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={startCam}>
        <Camera className="size-4" /> {t('receive.useCamera')}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onPhoto(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
